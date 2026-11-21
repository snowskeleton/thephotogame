import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { config, get, insert, now, run } from './db.ts';
import { sendMail } from './mail.ts';

const SESSION_DAYS = 180;
export const COOKIE = 'pg_session';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export type User = { id: number; email: string; name: string; is_admin: number; verified: boolean; last_seen_at?: number | null };

export async function userFromToken(token: string | undefined): Promise<User | null> {
	if (!token) return null;
	const row = await get<Omit<User, 'verified'> & { email_verified_at: number | null; expires_at: number }>(
		`SELECT u.id, u.email, u.name, u.is_admin, u.email_verified_at, u.last_seen_at, s.expires_at
		 FROM session s JOIN user u ON u.id = s.user_id WHERE s.token = ?`,
		sha(token)
	);
	if (!row || row.expires_at < now()) return null;
	return { id: row.id, email: row.email, name: row.name, is_admin: row.is_admin, verified: !!row.email_verified_at, last_seen_at: row.last_seen_at };
}

export async function startSession(cookies: Cookies, userId: number) {
	const token = randomBytes(32).toString('base64url');
	const expires = now() + SESSION_DAYS * 86400_000;
	await run('INSERT INTO session (token, user_id, expires_at) VALUES (?, ?, ?)', sha(token), userId, expires);
	cookies.set(COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		expires: new Date(expires)
	});
}

export async function endSession(cookies: Cookies) {
	const token = cookies.get(COOKIE);
	if (token) await run('DELETE FROM session WHERE token = ?', sha(token));
	cookies.delete(COOKIE, { path: '/' });
}

export function cleanEmail(v: unknown): string | null {
	const e = String(v ?? '').trim().toLowerCase();
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 200 ? e : null;
}

export async function findUserByEmail(email: string) {
	return get<{ id: number; email: string; name: string; is_admin: number }>(
		'SELECT id, email, name, is_admin FROM user WHERE email = ?',
		email
	);
}

/** The site owner's email (the OWNER_EMAIL variable), lower-cased, or '' if it isn't set. */
export const ownerEmail = () => (config().OWNER_EMAIL || '').trim().toLowerCase();

/** Whether this email becomes the site admin once it's confirmed: only OWNER_EMAIL does. */
export async function becomesAdmin(email: string) {
	return !!ownerEmail() && email === ownerEmail();
}

/** New accounts are never admins: admin rights only come with a verified email (see markVerified). */
export async function createUser(email: string, name: string): Promise<number> {
	return insert('INSERT INTO user (email, name, created_at) VALUES (?, ?, ?)', email, name, now());
}

/** Records that this person proved they own their email address, and makes them site admin if they're meant to be. */
export async function markVerified(userId: number) {
	await run('UPDATE user SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?', now(), userId);
	const u = await get<{ email: string; is_admin: number }>('SELECT email, is_admin FROM user WHERE id = ?', userId);
	if (u && !u.is_admin && (await becomesAdmin(u.email))) await run('UPDATE user SET is_admin = 1 WHERE id = ?', userId);
}

/**
 * Emails a six-digit sign-in code. `name` is kept so a brand new account can be created on verify.
 * Returns false if the email couldn't be sent (the code is in the Worker's logs then); the code still works.
 */
export async function sendCode(email: string, origin: string, name?: string): Promise<boolean> {
	const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
	await run('DELETE FROM login_code WHERE email = ? OR expires_at < ?', email, now());
	await run(
		'INSERT INTO login_code (email, code_hash, name, expires_at) VALUES (?, ?, ?, ?)',
		email,
		sha(code),
		name ?? null,
		now() + 15 * 60_000
	);
	try {
		await sendMail(
			email,
			`${code} is your Photo Game code`,
			`Your sign-in code for The Photo Game is:\n\n    ${code}\n\nIt works for 15 minutes. Enter it at ${origin}/login/code\n\nIf you didn't ask for this, ignore this email.`
		);
		return true;
	} catch {
		return false;
	}
}

export async function checkCode(email: string, code: string): Promise<{ ok: boolean; name: string | null }> {
	const row = await get<{ id: number; code_hash: string; name: string | null; expires_at: number; attempts: number }>(
		'SELECT * FROM login_code WHERE email = ?',
		email
	);
	if (!row || row.expires_at < now() || row.attempts >= 6) return { ok: false, name: null };
	if (row.code_hash !== sha(code.replace(/\D/g, ''))) {
		await run('UPDATE login_code SET attempts = attempts + 1 WHERE id = ?', row.id);
		return { ok: false, name: null };
	}
	await run('DELETE FROM login_code WHERE id = ?', row.id);
	return { ok: true, name: row.name };
}

/** One-time sign-in token, used for the QR hand-off to your own other devices and site-admin sign-in links. */
export async function makeHandoff(userId: number, minutes: number): Promise<string> {
	const token = randomBytes(24).toString('base64url');
	await run('DELETE FROM handoff WHERE expires_at < ?', now());
	await run(
		'INSERT INTO handoff (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
		sha(token),
		userId,
		now() + minutes * 60_000
	);
	return token;
}

export async function useHandoff(token: string): Promise<number | null> {
	const row = await get<{ user_id: number; expires_at: number }>(
		'SELECT user_id, expires_at FROM handoff WHERE token_hash = ?',
		sha(token)
	);
	if (!row) return null;
	await run('DELETE FROM handoff WHERE token_hash = ?', sha(token));
	return row.expires_at < now() ? null : row.user_id;
}

const INVITE_DAYS = 7;
/** Invite emails one host may send per 24 hours (site admins aren't limited). Join links and QR codes have no limit. */
export const INVITES_PER_DAY = 20;

/** How many more invites this person can send right now. */
export async function invitesLeft(user: { id: number; is_admin: number }): Promise<number> {
	if (user.is_admin) return Infinity;
	const sent = (await get<{ n: number }>(
		'SELECT COUNT(*) AS n FROM invite WHERE invited_by = ? AND created_at > ?',
		user.id,
		now() - 86400_000
	))!.n;
	return Math.max(0, INVITES_PER_DAY - sent);
}

/**
 * Emails an invite link (good for a week). Opening it signs the person in, counts as verifying their email
 * and, with a game, makes them an active member of it. The link only ever goes to the person's own inbox.
 */
export async function sendInvite(
	user: { id: number; email: string; name: string },
	origin: string,
	from: { id: number; name: string },
	game?: { id: number; code: string; name: string } | null
) {
	const token = randomBytes(24).toString('base64url');
	await run('DELETE FROM invite WHERE expires_at < ?', now());
	await run(
		'INSERT INTO invite (token_hash, user_id, game_id, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
		sha(token),
		user.id,
		game?.id ?? null,
		from.id,
		now(),
		now() + INVITE_DAYS * 86400_000
	);
	const link = `${origin}/invite/${token}`;
	await sendMail(
		user.email,
		game ? `${from.name} invited you to ${game.name}` : 'Your Photo Game invite',
		`Hi ${user.name},\n\n${from.name} invited you to ${game ? `“${game.name}” on ` : ''}The Photo Game.\n\nTap to accept:\n\n    ${link}\n\nThe link works once, for ${INVITE_DAYS} days. After that you can sign in any time at ${origin}/login with this email address.`
	);
}

export type Invite = { user_id: number; game_id: number | null; expires_at: number; used_at: number | null; name: string; email: string; game: string | null; code: string | null; from: string | null };

export const findInvite = (token: string) =>
	get<Invite>(
		`SELECT i.user_id, i.game_id, i.expires_at, i.used_at, u.name, u.email, g.name AS game, g.code, f.name AS "from"
		 FROM invite i JOIN user u ON u.id = i.user_id LEFT JOIN game g ON g.id = i.game_id LEFT JOIN user f ON f.id = i.invited_by
		 WHERE i.token_hash = ?`,
		sha(token)
	);

/** Uses up an invite: the person's email counts as verified and they join the game. Returns the invite, or null. */
export async function acceptInvite(token: string): Promise<Invite | null> {
	// Marking it used in the same statement that checks it means two taps can't both accept.
	const used = await get('UPDATE invite SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING 1', now(), sha(token), now());
	const inv = used && (await findInvite(token));
	if (!inv) return null;
	await markVerified(inv.user_id);
	if (inv.game_id)
		await run(
			`INSERT INTO member (game_id, user_id, status) VALUES (?, ?, 'active')
			 ON CONFLICT(game_id, user_id) DO UPDATE SET status = 'active'`,
			inv.game_id,
			inv.user_id
		);
	return inv;
}

/** After signing in, people without a passkey go via the "save a passkey" page on the way to `next`, every time. */
export async function offerPasskey(userId: number, next: string): Promise<string> {
	const has = await get('SELECT 1 FROM passkey WHERE user_id = ? LIMIT 1', userId);
	return has ? next : `/passkey?next=${encodeURIComponent(next)}`;
}

/** Only allow redirects back into this site. */
export function safeNext(v: unknown, fallback = '/'): string {
	const s = String(v ?? '');
	return s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') ? s : fallback;
}
