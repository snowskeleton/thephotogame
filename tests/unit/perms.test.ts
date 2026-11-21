import { describe, expect, it } from 'vitest';
import { get, run } from '../../src/lib/server/db.ts';
import { actorFromToken, grantable, hostedGames, isHostOf, keysFor, mintKey, revokeKey, TOKEN_PREFIX } from '../../src/lib/server/perms.ts';
import { asUser, mkGame, mkMember, mkTeam, mkUser, useDatabase } from './helpers.ts';

useDatabase();

async function world() {
	const g = await mkGame();
	const other = await mkGame();
	const admin = await asUser(await mkUser({ admin: true }));
	const hostId = await mkUser();
	await mkMember(g.id, hostId, await mkTeam(g.id), 'host');
	const host = await asUser(hostId);
	const player = await asUser(await mkUser());
	await mkMember(g.id, player.id, null);
	return { g, other, admin, host, player };
}
const token = async (r: Awaited<ReturnType<typeof mintKey>>) => ('token' in r ? r.token : (() => { throw new Error(r.error); })());

describe('grantable scopes', () => {
	it('gives admins every scope site-wide and game scopes for a game', async () => {
		const { admin, g } = await world();
		expect(await grantable(admin, null)).toContain('site:write');
		const forGame = await grantable(admin, g.id);
		expect(forGame).toContain('games:write');
		expect(forGame).not.toContain('site:read');
	});
	it('gives hosts game scopes only for their own game', async () => {
		const { host, g, other } = await world();
		expect(await grantable(host, g.id)).toContain('photos:moderate');
		expect(await grantable(host, other.id)).toEqual([]);
		expect(await grantable(host, null)).toEqual([]);
	});
	it('gives players nothing', async () => {
		const { player, g } = await world();
		expect(await grantable(player, g.id)).toEqual([]);
	});
});

describe('mintKey', () => {
	it('stores only a hash, never the token', async () => {
		const { host, g } = await world();
		const t = await token(await mintKey(host, { name: 'bot', scopes: ['games:read'], gameId: g.id, days: null }));
		expect(t.startsWith(TOKEN_PREFIX)).toBe(true);
		const rows = await get<{ n: number }>('SELECT COUNT(*) AS n FROM api_key WHERE token_hash = ? OR hint = ? AND token_hash LIKE ?', t, t, `%${t}%`);
		expect(rows!.n).toBe(0);
		const row = await get<{ token_hash: string; hint: string }>('SELECT token_hash, hint FROM api_key ORDER BY id DESC LIMIT 1');
		expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
		expect(row!.hint).toBe(t.slice(-4));
	});
	it.each([
		['a name', (w: any) => ({ name: '', scopes: ['games:read'], gameId: w.g.id, days: null }), 'Give the key a name.'],
		['at least one valid scope', (w: any) => ({ name: 'k', scopes: ['nonsense'], gameId: w.g.id, days: null }), 'Pick at least one permission.'],
		['a game for non-admins', (_w: any) => ({ name: 'k', scopes: ['games:read'], gameId: null, days: null }), 'Pick the game this key is for.'],
		['an existing game', (_w: any) => ({ name: 'k', scopes: ['games:read'], gameId: 999999, days: null }), 'No such game.']
	])('requires %s', async (_n, opts, error) => {
		const w = await world();
		expect(await mintKey(w.host, opts(w))).toEqual({ error });
	});
	it('stops a host minting for a game they do not host', async () => {
		const { host, other } = await world();
		expect(await mintKey(host, { name: 'k', scopes: ['games:read'], gameId: other.id, days: null })).toMatchObject({ error: expect.stringContaining('can’t make keys') });
	});
	it('stops a host granting site scopes', async () => {
		const { host, g } = await world();
		expect(await mintKey(host, { name: 'k', scopes: ['games:read', 'site:write'], gameId: g.id, days: null })).toMatchObject({ error: 'You can’t grant: site:write.' });
	});
	it('stops players minting at all', async () => {
		const { player, g } = await world();
		expect(await mintKey(player, { name: 'k', scopes: ['games:read'], gameId: g.id, days: null })).toHaveProperty('error');
	});
});

describe('actorFromToken', () => {
	const mint = async (who: any, gameId: number | null, scopes = ['games:read', 'games:write'], days: number | null = null) =>
		token(await mintKey(who, { name: 'k', scopes, gameId, days }));

	it('rejects empty and malformed tokens', async () => {
		expect(await actorFromToken(null)).toBeNull();
		expect(await actorFromToken('')).toBeNull();
		expect(await actorFromToken('abc')).toBeNull();
		expect(await actorFromToken(`${TOKEN_PREFIX}wrong`)).toBeNull();
	});
	it('resolves a valid token to its minter and scopes', async () => {
		const { host, g } = await world();
		const a = await actorFromToken(await mint(host, g.id));
		expect(a!.user.id).toBe(host.id);
		expect(a!.gameId).toBe(g.id);
		expect([...a!.scopes].sort()).toEqual(['games:read', 'games:write']);
	});
	it('stops working when revoked', async () => {
		const { host, g } = await world();
		const t = await mint(host, g.id);
		const id = (await get<{ id: number }>('SELECT MAX(id) AS id FROM api_key'))!.id;
		expect(await revokeKey(host, id)).toBe(true);
		expect(await actorFromToken(t)).toBeNull();
	});
	it('stops working after it expires', async () => {
		const { host, g } = await world();
		const t = await mint(host, g.id, ['games:read'], 1);
		await run('UPDATE api_key SET expires_at = 1 WHERE token_hash IS NOT NULL AND user_id = ?', host.id);
		expect(await actorFromToken(t)).toBeNull();
	});
	it('stops working the moment the minter loses host power', async () => {
		const { host, g } = await world();
		const t = await mint(host, g.id);
		await run("UPDATE member SET role = 'player' WHERE user_id = ?", host.id);
		expect(await actorFromToken(t)).toBeNull();
	});
	it('drops scopes the minter no longer holds', async () => {
		const { admin, g } = await world();
		const t = await mint(admin, null, ['site:read', 'games:read']);
		await run('UPDATE user SET is_admin = 0 WHERE id = ?', admin.id);
		expect(await actorFromToken(t)).toBeNull();
		expect(g.id).toBeGreaterThan(0);
	});
	it('stops working when the minter is deleted', async () => {
		const { host, g } = await world();
		const t = await mint(host, g.id);
		await run('DELETE FROM user WHERE id = ?', host.id);
		expect(await actorFromToken(t)).toBeNull();
	});
	it('records last use', async () => {
		const { host, g } = await world();
		await actorFromToken(await mint(host, g.id));
		expect((await get<{ last_used_at: number }>('SELECT last_used_at FROM api_key WHERE user_id = ?', host.id))!.last_used_at).toBeGreaterThan(0);
	});
});

describe('key management', () => {
	it('lets admins revoke anyone’s key but others only their own', async () => {
		const { host, admin, player, g } = await world();
		await mintKey(host, { name: 'k', scopes: ['games:read'], gameId: g.id, days: null });
		const id = (await get<{ id: number }>('SELECT MAX(id) AS id FROM api_key'))!.id;
		expect(await revokeKey(player, id)).toBe(false);
		expect(await revokeKey(admin, id)).toBe(true);
		expect(await revokeKey(admin, 999999)).toBe(false);
	});
	it('lists all keys for admins, own keys for others', async () => {
		const { host, admin, g } = await world();
		await mintKey(host, { name: 'mine', scopes: ['games:read'], gameId: g.id, days: null });
		await mintKey(admin, { name: 'theirs', scopes: ['games:read'], gameId: g.id, days: null });
		expect((await keysFor(host)).map((k) => k.name)).toEqual(['mine']);
		expect((await keysFor(admin)).map((k) => k.name).sort()).toEqual(['mine', 'theirs']);
	});
});

describe('isHostOf / hostedGames', () => {
	it('knows who hosts what', async () => {
		const { host, admin, g, other } = await world();
		expect(await isHostOf(host.id, g.id)).toBe(true);
		expect(await isHostOf(host.id, other.id)).toBe(false);
		expect((await hostedGames(host)).map((x) => x.id)).toEqual([g.id]);
		expect((await hostedGames(admin)).length).toBeGreaterThanOrEqual(2);
	});
});
