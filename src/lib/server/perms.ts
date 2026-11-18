import { createHash, randomBytes } from 'node:crypto';
import { all, get, insert, now, run } from './db.ts';

/**
 * Roles: player < admin < owner. Owners are admins too (is_admin = 1, is_owner = 1).
 * An API key acts as the person who minted it and can never do more than they can:
 * its scopes are checked against the minter's *current* role every time it is used,
 * so demoting or deleting someone neutralises their keys immediately.
 */
export type Role = 'owner' | 'admin' | 'player';
export type Who = { id: number; is_admin: number; is_owner: number };

export const roleOf = (u: Pick<Who, 'is_admin' | 'is_owner'>): Role => (u.is_owner ? 'owner' : u.is_admin ? 'admin' : 'player');
export const isOwner = (u: { is_owner: number }) => !!u.is_owner;

/** Each scope names the lowest role allowed to hold it. */
export const SCOPES = {
	'games:read': { min: 'admin', label: 'Read games', help: 'Games and settings, categories, teams, awards, photos (metadata) and scores.' },
	'games:write': { min: 'admin', label: 'Edit games', help: 'Create games; edit settings, categories, teams and awards; reveal or hide photos.' },
	'photos:moderate': { min: 'admin', label: 'Moderate photos', help: 'Disqualify or restore photos, adjust a photo’s points, delete photos.' },
	'people:read': { min: 'admin', label: 'Read people', help: 'List players (names, emails, games, teams).' },
	'people:write': { min: 'admin', label: 'Manage players', help: 'Add players, rename them, put them in games and teams. Never admins, never sign-in links.' },
	'people:privileged': { min: 'owner', label: 'Manage admins (owner only)', help: 'Make or remove admins, change anyone’s email, delete people.' }
} as const satisfies Record<string, { min: Role; label: string; help: string }>;
export type Scope = keyof typeof SCOPES;
export const SCOPE_NAMES = Object.keys(SCOPES) as Scope[];

const rank: Record<Role, number> = { player: 0, admin: 1, owner: 2 };

/** The scopes this person may put on a key. */
export const grantable = (u: Pick<Who, 'is_admin' | 'is_owner'>): Scope[] =>
	SCOPE_NAMES.filter((s) => rank[roleOf(u)] >= rank[SCOPES[s].min]);

/** Admins manage players; only owners manage other admins and owners. */
export const canManage = (actor: Who, target: Who) => isOwner(actor) || (!!actor.is_admin && (actor.id === target.id || !target.is_admin));

// ---- keys -------------------------------------------------------------------------------

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const TOKEN_PREFIX = 'pgk_';

export type KeyRow = {
	id: number;
	user_id: number;
	name: string;
	hint: string;
	scopes: string;
	game_id: number | null;
	expires_at: number | null;
	last_used_at: number | null;
	revoked_at: number | null;
	created_at: number;
};

export function mintKey(
	user: Who,
	opts: { name: string; scopes: string[]; gameId?: number | null; days?: number | null }
): { token: string; id: number } | { error: string } {
	const allowed = new Set<string>(grantable(user));
	const scopes = [...new Set(opts.scopes)].filter((s): s is Scope => s in SCOPES);
	if (!opts.name) return { error: 'Give the key a name.' };
	if (!scopes.length) return { error: 'Pick at least one permission.' };
	const denied = scopes.filter((s) => !allowed.has(s));
	if (denied.length) return { error: `You can’t grant: ${denied.join(', ')}.` };
	const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
	const id = insert(
		`INSERT INTO api_key (user_id, name, token_hash, hint, scopes, game_id, expires_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		user.id,
		opts.name,
		sha(token),
		token.slice(-4),
		JSON.stringify(scopes),
		opts.gameId ?? null,
		opts.days ? now() + opts.days * 86400_000 : null,
		now()
	);
	return { token, id };
}

export type Actor = {
	key: KeyRow;
	user: { id: number; email: string; name: string; is_admin: number; is_owner: number };
	scopes: Set<Scope>;
	gameId: number | null;
};

/** Resolves a bearer token to who it acts as and what it may do right now, or null. */
export function actorFromToken(token: string | null): Actor | null {
	if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
	const key = get<KeyRow>('SELECT * FROM api_key WHERE token_hash = ?', sha(token));
	if (!key || key.revoked_at || (key.expires_at && key.expires_at < now())) return null;
	const user = get<Actor['user']>('SELECT id, email, name, is_admin, is_owner FROM user WHERE id = ?', key.user_id);
	if (!user || !user.is_admin) return null;
	const allowed = new Set<string>(grantable(user));
	const scopes = new Set((JSON.parse(key.scopes) as Scope[]).filter((s) => allowed.has(s)));
	if (!key.last_used_at || key.last_used_at < now() - 60_000) run('UPDATE api_key SET last_used_at = ? WHERE id = ?', now(), key.id);
	return { key, user, scopes, gameId: key.game_id };
}

/** Keys an owner may see (all) or an admin may see (their own). */
export const keysFor = (user: Who) =>
	all<KeyRow & { owner_name: string; game_name: string | null }>(
		`SELECT k.*, u.name AS owner_name, g.name AS game_name FROM api_key k
		 JOIN user u ON u.id = k.user_id LEFT JOIN game g ON g.id = k.game_id
		 ${isOwner(user) ? '' : 'WHERE k.user_id = ' + Number(user.id)}
		 ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`
	);

/** Owners can revoke any key; admins only their own. */
export function revokeKey(user: Who, id: number): boolean {
	const k = get<KeyRow>('SELECT * FROM api_key WHERE id = ?', id);
	if (!k || (!isOwner(user) && k.user_id !== user.id)) return false;
	run('UPDATE api_key SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now(), id);
	return true;
}
