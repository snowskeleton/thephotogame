import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { get, insert, now, run } from './db.ts';
import { sendMail } from './mail.ts';

const SESSION_DAYS = 180;
export const COOKIE = 'pg_session';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export type User = { id: number; email: string; name: string; is_admin: number };

export function userFromToken(token: string | undefined): User | null {
	if (!token) return null;
	const row = get<User & { expires_at: number }>(
		`SELECT u.id, u.email, u.name, u.is_admin, s.expires_at
		 FROM session s JOIN user u ON u.id = s.user_id WHERE s.token = ?`,
		sha(token)
	);
	if (!row || row.expires_at < now()) return null;
	return { id: row.id, email: row.email, name: row.name, is_admin: row.is_admin };
}

export function startSession(cookies: Cookies, userId: number) {
	const token = randomBytes(32).toString('base64url');
	const expires = now() + SESSION_DAYS * 86400_000;
	run('INSERT INTO session (token, user_id, expires_at) VALUES (?, ?, ?)', sha(token), userId, expires);
	cookies.set(COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		expires: new Date(expires)
	});
}

export function endSession(cookies: Cookies) {
	const token = cookies.get(COOKIE);
	if (token) run('DELETE FROM session WHERE token = ?', sha(token));
	cookies.delete(COOKIE, { path: '/' });
}

export function cleanEmail(v: unknown): string | null {
	const e = String(v ?? '').trim().toLowerCase();
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length < 200 ? e : null;
}

export function findUserByEmail(email: string) {
	return get<User>('SELECT id, email, name, is_admin FROM user WHERE email = ?', email);
}

export function createUser(email: string, name: string): number {
	const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
	const first = !get('SELECT 1 FROM user LIMIT 1');
	const isAdmin = adminEmail ? email === adminEmail : first;
	return insert(
		'INSERT INTO user (email, name, is_admin, created_at) VALUES (?, ?, ?, ?)',
		email,
		name,
		isAdmin ? 1 : 0,
		now()
	);
}

/** Emails a six-digit sign-in code. `name` is kept so a brand new account can be created on verify. */
export async function sendCode(email: string, origin: string, name?: string) {
	const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
	run('DELETE FROM login_code WHERE email = ? OR expires_at < ?', email, now());
	run(
		'INSERT INTO login_code (email, code_hash, name, expires_at) VALUES (?, ?, ?, ?)',
		email,
		sha(code),
		name ?? null,
		now() + 15 * 60_000
	);
	await sendMail(
		email,
		`${code} is your Photo Game code`,
		`Your sign-in code for The Photo Game is:\n\n    ${code}\n\nIt works for 15 minutes. Enter it at ${origin}/login/code\n\nIf you didn't ask for this, ignore this email.`
	);
}

export function checkCode(email: string, code: string): { ok: boolean; name: string | null } {
	const row = get<{ id: number; code_hash: string; name: string | null; expires_at: number; attempts: number }>(
		'SELECT * FROM login_code WHERE email = ?',
		email
	);
	if (!row || row.expires_at < now() || row.attempts >= 6) return { ok: false, name: null };
	if (row.code_hash !== sha(code.replace(/\D/g, ''))) {
		run('UPDATE login_code SET attempts = attempts + 1 WHERE id = ?', row.id);
		return { ok: false, name: null };
	}
	run('DELETE FROM login_code WHERE id = ?', row.id);
	return { ok: true, name: row.name };
}

/** One-time sign-in token, used for QR hand-off and admin-made sign-in links. */
export function makeHandoff(userId: number, minutes: number): string {
	const token = randomBytes(24).toString('base64url');
	run('DELETE FROM handoff WHERE expires_at < ?', now());
	run(
		'INSERT INTO handoff (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
		sha(token),
		userId,
		now() + minutes * 60_000
	);
	return token;
}

export function useHandoff(token: string): number | null {
	const row = get<{ user_id: number; expires_at: number }>(
		'SELECT user_id, expires_at FROM handoff WHERE token_hash = ?',
		sha(token)
	);
	if (!row) return null;
	run('DELETE FROM handoff WHERE token_hash = ?', sha(token));
	return row.expires_at < now() ? null : row.user_id;
}

/** Emails a one-time sign-in link (good for a week) to someone an admin added. */
export async function sendInvite(
	user: { id: number; email: string; name: string },
	origin: string,
	from: string,
	game?: { code: string; name: string }
) {
	const link = `${origin}/link/${makeHandoff(user.id, 7 * 24 * 60)}${game ? `?next=/g/${game.code}` : ''}`;
	await sendMail(
		user.email,
		game ? `You're in: ${game.name}` : 'Your Photo Game sign-in link',
		`Hi ${user.name},\n\n${from} added you to ${game ? `“${game.name}” on ` : ''}The Photo Game.\n\nTap to sign in:\n\n    ${link}\n\nThe link works once, for 7 days. After that you can sign in any time at ${origin}/login with this email address.`
	);
}

/** Only allow redirects back into this site. */
export function safeNext(v: unknown, fallback = '/'): string {
	const s = String(v ?? '');
	return s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') ? s : fallback;
}
