import { createHash, randomBytes } from 'node:crypto';
import { all, get, insert, now, run } from './db.ts';

/**
 * Who can do what, for API keys.
 *
 * The site already has two powers: a **site admin** (OWNER_EMAIL and anyone they promote) runs the whole site, and a
 * **host** runs the games they host. A key acts as the person who minted it and can never do more than they can:
 *   - a site admin may mint site-wide keys (all games, plus the site scopes) or keys limited to one game;
 *   - a host may only mint keys limited to one game they host, with game scopes.
 * Every request re-checks the minter's *current* power, so demoting someone or removing a host kills their keys at once.
 */
export type Who = { id: number; is_admin: number };

export const GAME_SCOPES = {
	'games:read': { label: 'Read the game', help: 'Settings, categories, teams, awards, photos (metadata), players and scores.' },
	'games:write': { label: 'Edit the game', help: 'Settings, categories and scoring, teams, awards; reveal or hide photos; put players in teams.' },
	'photos:moderate': { label: 'Moderate photos', help: 'Disqualify or restore photos, adjust points, delete photos.' },
	'players:read': { label: 'See players', help: 'Names and emails of the people in the game.' },
	'players:write': { label: 'Invite players', help: 'Invite people by email (counts toward your daily invite limit) and remove players.' }
} as const;
export const SITE_SCOPES = {
	'site:read': { label: 'Read the whole site (site admin only)', help: 'List every game and person, and the site settings.' },
	'site:write': { label: 'Run the whole site (site admin only)', help: 'Create games, add people, change site settings.' },
	'logs:read': { label: 'Read error logs (site admin only)', help: 'Server errors, failed sign-up checks, email failures and browser errors. No emails or codes are logged.' }
} as const;
export const SCOPES = { ...GAME_SCOPES, ...SITE_SCOPES };
export type Scope = keyof typeof SCOPES;
export const isScope = (s: string): s is Scope => s in SCOPES;

/** What this person may put on a key for this game (null = a site-wide key). */
export async function grantable(user: Who, gameId: number | null): Promise<Scope[]> {
	if (user.is_admin) return Object.keys(gameId === null ? SCOPES : GAME_SCOPES) as Scope[];
	if (gameId !== null && (await isHostOf(user.id, gameId))) return Object.keys(GAME_SCOPES) as Scope[];
	return [];
}

export async function isHostOf(userId: number, gameId: number) {
	return !!(await get("SELECT 1 FROM member WHERE game_id = ? AND user_id = ? AND role = 'host' AND status = 'active'", gameId, userId));
}

/** Games this person hosts (all games for a site admin). */
export async function hostedGames(user: Who) {
	return all<{ id: number; code: string; name: string }>(
		user.is_admin
			? 'SELECT id, code, name FROM game ORDER BY created_at DESC'
			: `SELECT g.id, g.code, g.name FROM game g JOIN member m ON m.game_id = g.id
			   WHERE m.user_id = ${Number(user.id)} AND m.role = 'host' AND m.status = 'active' ORDER BY g.created_at DESC`
	);
}

// ---- keys -------------------------------------------------------------------------------

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const TOKEN_PREFIX = 'pgk_';

export type KeyRow = {
	id: number; user_id: number; name: string; hint: string; scopes: string; game_id: number | null;
	expires_at: number | null; last_used_at: number | null; revoked_at: number | null; created_at: number;
};

export async function mintKey(
	user: Who,
	opts: { name: string; scopes: string[]; gameId: number | null; days: number | null }
): Promise<{ token: string } | { error: string }> {
	if (!opts.name) return { error: 'Give the key a name.' };
	if (opts.gameId === null && !user.is_admin) return { error: 'Pick the game this key is for.' };
	if (opts.gameId !== null && !(await get('SELECT 1 FROM game WHERE id = ?', opts.gameId))) return { error: 'No such game.' };
	const allowed = new Set<string>(await grantable(user, opts.gameId));
	if (!allowed.size) return { error: 'You can’t make keys for that game.' };
	const scopes = [...new Set(opts.scopes)].filter(isScope);
	if (!scopes.length) return { error: 'Pick at least one permission.' };
	const denied = scopes.filter((s) => !allowed.has(s));
	if (denied.length) return { error: `You can’t grant: ${denied.join(', ')}.` };
	const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
	await insert(
		`INSERT INTO api_key (user_id, name, token_hash, hint, scopes, game_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		user.id, opts.name, sha(token), token.slice(-4), JSON.stringify(scopes), opts.gameId,
		opts.days ? now() + opts.days * 86400_000 : null, now()
	);
	return { token };
}

export type Actor = {
	key: KeyRow;
	user: { id: number; name: string; email: string; is_admin: number };
	scopes: Set<Scope>;
	gameId: number | null;
};

/** Resolves a bearer token to who it acts as and what it may do right now, or null. */
export async function actorFromToken(token: string | null): Promise<Actor | null> {
	if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
	const key = await get<KeyRow>('SELECT * FROM api_key WHERE token_hash = ?', sha(token));
	if (!key || key.revoked_at || (key.expires_at && key.expires_at < now())) return null;
	const user = await get<Actor['user']>('SELECT id, name, email, is_admin FROM user WHERE id = ?', key.user_id);
	if (!user) return null;
	const allowed = new Set<string>(await grantable(user, key.game_id));
	if (!allowed.size) return null;
	const scopes = new Set((JSON.parse(key.scopes) as string[]).filter(isScope).filter((s) => allowed.has(s)));
	if (!key.last_used_at || key.last_used_at < now() - 60_000) await run('UPDATE api_key SET last_used_at = ? WHERE id = ?', now(), key.id);
	return { key, user, scopes, gameId: key.game_id };
}

/** Site admins see every key; everyone else sees their own. */
export const keysFor = (user: Who) =>
	all<KeyRow & { owner_name: string; game_name: string | null }>(
		`SELECT k.*, u.name AS owner_name, g.name AS game_name FROM api_key k
		 JOIN user u ON u.id = k.user_id LEFT JOIN game g ON g.id = k.game_id
		 ${user.is_admin ? '' : 'WHERE k.user_id = ' + Number(user.id)}
		 ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`
	);

/** Site admins can revoke any key; others only their own. */
export async function revokeKey(user: Who, id: number): Promise<boolean> {
	const k = await get<KeyRow>('SELECT * FROM api_key WHERE id = ?', id);
	if (!k || (!user.is_admin && k.user_id !== user.id)) return false;
	await run('UPDATE api_key SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now(), id);
	return true;
}
