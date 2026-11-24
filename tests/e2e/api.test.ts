import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { api, exec, get, one, photo, post, sql, session, useCleanSite, user, world } from './helpers.ts';

useCleanSite();

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Makes a key the way the app does: only the hash is stored. */
async function key(userId: number, scopes: string[], gameId: number | null, o: { expires?: number } = {}) {
	const token = `pgk_${randomBytes(24).toString('base64url')}`;
	await exec('INSERT INTO api_key (user_id, name, token_hash, hint, scopes, game_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		userId, 'test', sha(token), token.slice(-4), JSON.stringify(scopes), gameId, o.expires ?? null, Date.now());
	return token;
}
const ALL_GAME = ['games:read', 'games:write', 'photos:moderate', 'players:read', 'players:write'];
const json = async (r: Response) => r.json() as Promise<any>;

describe('authentication', () => {
	it('401s with no key, a malformed key or an unknown key', async () => {
		expect((await api('me', null)).status).toBe(401);
		expect((await api('me', 'garbage')).status).toBe(401);
		expect((await api('me', 'pgk_unknown')).status).toBe(401);
	});
	it('ignores session cookies', async () => {
		const w = await world();
		const r = await get('/api/v1/me', { cookie: w.cookie.host });
		expect(r.status).toBe(401);
	});
	it('says who the key is and what it may do', async () => {
		const w = await world();
		const body = await json(await api('me', await key(w.host.id, ['games:read'], w.g.id)));
		expect(body).toMatchObject({ user: { id: w.host.id, site_admin: false }, key: { scopes: ['games:read'], game_id: w.g.id } });
	});
	it('rejects revoked and expired keys', async () => {
		const w = await world();
		const t = await key(w.host.id, ['games:read'], w.g.id);
		await exec('UPDATE api_key SET revoked_at = ?', Date.now());
		expect((await api('me', t)).status).toBe(401);
		const t2 = await key(w.host.id, ['games:read'], w.g.id, { expires: 1 });
		expect((await api('me', t2)).status).toBe(401);
	});
	it('stops working the moment the minter stops being a host', async () => {
		const w = await world();
		const t = await key(w.host.id, ['games:read'], w.g.id);
		expect((await api(`games/${w.g.code}`, t)).status).toBe(200);
		await exec("UPDATE member SET role = 'player' WHERE user_id = ?", w.host.id);
		expect((await api(`games/${w.g.code}`, t)).status).toBe(401);
	});
	it('never trusts scopes the minter no longer holds', async () => {
		const admin = await user({ admin: true });
		const t = await key(admin.id, ['site:read', 'games:read'], null);
		expect((await api('settings', t)).status).toBe(200);
		await exec('UPDATE user SET is_admin = 0 WHERE id = ?', admin.id);
		expect((await api('settings', t)).status).toBe(401);
	});
});

describe('scopes and game limits', () => {
	it('403s without the needed scope', async () => {
		const w = await world();
		const t = await key(w.host.id, ['games:read'], w.g.id);
		const r = await api(`games/${w.g.code}`, t, { method: 'PATCH', body: { name: 'x' } });
		expect(r.status).toBe(403);
		expect((await json(r)).error).toContain('games:write');
	});
	it('keeps a game-limited key out of other games', async () => {
		const w = await world();
		const other = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		expect((await api(`games/${other.g.code}`, t)).status).toBe(403);
		expect((await api(`games/${other.g.code}/photos`, t)).status).toBe(403);
		expect((await api(`games/${other.g.code}`, t, { method: 'PATCH', body: { name: 'x' } })).status).toBe(403);
	});
	it('lists only the key’s own game', async () => {
		const w = await world();
		await world();
		const list = await json(await api('games', await key(w.host.id, ['games:read'], w.g.id)));
		expect(list.map((g: any) => g.code)).toEqual([w.g.code]);
	});
	it('keeps site scopes away from hosts even when the key row claims them', async () => {
		const w = await world();
		const t = await key(w.host.id, ['site:write', 'logs:read', 'games:read'], w.g.id);
		expect((await api('settings', t)).status).toBe(403);
		expect((await api('logs', t)).status).toBe(403);
		expect((await api('games', t, { method: 'POST', body: { name: 'x' } })).status).toBe(403);
	});
	it('404s unknown endpoints and 405s wrong methods', async () => {
		const w = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		expect((await api('nope', t)).status).toBe(404);
		expect((await api('me', t, { method: 'DELETE' })).status).toBe(405);
	});
	it('rejects a body that is not a JSON object', async () => {
		const w = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		const { SELF } = await import('cloudflare:test');
		for (const body of ['[1]', '"x"', '{oops'])
			expect((await SELF.fetch(`https://t.test/api/v1/games/${w.g.code}`, { method: 'PATCH', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body })).status).toBe(400);
	});
});

describe('bodiless requests from scripts', () => {
	// curl -X DELETE / -X POST with no body sends no Content-Type and no Origin. SvelteKit's CSRF check treats that as
	// a cross-site form post and answers 403 before the API sees it, so a client has to add a JSON content type.
	// This documents the gap: it should pass once /api is exempted from the check, and then `.fails` must go.
	it.fails('accepts a bodiless POST with a valid key', async () => {
		const w = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		const { SELF } = await import('cloudflare:test');
		const r = await SELF.fetch(`https://t.test/api/v1/games/${w.g.code}/reveal`, { method: 'POST', headers: { authorization: `Bearer ${t}` } });
		expect(r.status).toBe(200);
	});
});

describe('game management', () => {
	it('patches settings with the same clamping as the web form', async () => {
		const w = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		const r = await json(await api(`games/${w.g.code}`, t, { method: 'PATCH', body: { name: 'Renamed', visibility: 'open', bingo: true, bingo_cols: 99, doubt_limit: -5 } }));
		expect(r).toMatchObject({ name: 'Renamed', visibility: 'open', bingo: true, bingo_cols: 8 });
		expect((await one('SELECT doubt_limit FROM game'))!.doubt_limit).toBe(0);
		expect((await api(`games/${w.g.code}`, t, { method: 'PATCH', body: { name: ' ' } })).status).toBe(400);
	});
	it('creates, edits and lists categories with scoring options', async () => {
		const w = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		const made = await json(await api(`games/${w.g.code}/categories`, t, { method: 'POST', body: { name: 'Hats', points: 3 } }));
		expect(made.options).toMatchObject([{ label: 'Found it', points: 3, kind: 'tier' }]);
		const patched = await json(await api(`games/${w.g.code}/categories/${made.id}`, t, {
			method: 'PATCH',
			body: { scoring_cap: 2, max_points: 9, options: [{ id: made.options[0].id, label: 'Base', points: 4, kind: 'tier' }, { label: 'Per hat', points: 1, kind: 'extra' }, { label: 'Funny', points: 2, kind: 'bonus' }] }
		}));
		expect(patched).toMatchObject({ scoring_cap: 2, max_points: 9 });
		expect(patched.options.map((o: any) => [o.label, o.kind])).toEqual([['Base', 'tier'], ['Per hat', 'extra'], ['Funny', 'bonus']]);
		expect((await api(`games/${w.g.code}/categories/${made.id}`, t, { method: 'PATCH', body: { options: [{ label: 'Only extra', points: 1, kind: 'extra' }] } })).status).toBe(400);
	});
	it('replaces a category checklist and filters photos by item', async () => {
		const w = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		const url = `games/${w.g.code}/categories/${w.cat.id}`;
		const set = async (items: unknown) => api(url, t, { method: 'PATCH', body: { items } });
		const a = await json(await set(['Ohio', 'Iowa', ' ohio ', '']));
		expect(a.items.map((i: any) => i.label)).toEqual(['Ohio', 'Iowa']);
		const b = await json(await set(['Iowa', 'Utah']));
		expect(b.items.map((i: any) => i.label)).toEqual(['Iowa', 'Utah']);
		expect(b.items[0].id).toBe(a.items[1].id);
		expect((await set(Array.from({ length: 501 }, (_, i) => `s${i}`))).status).toBe(400);
		// A PATCH without `items` leaves the list alone.
		const c = await json(await api(url, t, { method: 'PATCH', body: { name: 'Plates' } }));
		expect(c.items.map((i: any) => i.label)).toEqual(['Iowa', 'Utah']);
		const id = await photo(w.g, { cat: w.cat.id, team: w.tA, user: w.alice.id });
		await exec('UPDATE photo SET item_id = ? WHERE id = ?', b.items[0].id, id);
		const hit = await json(await api(`games/${w.g.code}/photos?item=${b.items[0].id}`, t));
		expect(hit).toMatchObject([{ id, item: 'Iowa' }]);
		expect(await json(await api(`games/${w.g.code}/photos?item=${b.items[1].id}`, t))).toEqual([]);
	});
	it('needs both scopes to delete a category, which takes its photos along', async () => {
		const w = await world();
		const id = await photo(w.g, { cat: w.cat.id, team: w.tA, user: w.alice.id });
		const weak = await key(w.host.id, ['games:write'], w.g.id);
		expect((await api(`games/${w.g.code}/categories/${w.cat.id}`, weak, { method: 'DELETE' })).status).toBe(403);
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		const r = await json(await api(`games/${w.g.code}/categories/${w.cat.id}`, t, { method: 'DELETE' }));
		expect(r).toEqual({ ok: true, photos_deleted: 1 });
		expect(await sql('SELECT * FROM photo WHERE id = ?', id)).toEqual([]);
	});
	it('does not reach into another game by id', async () => {
		const w = await world();
		const other = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		expect((await api(`games/${w.g.code}/categories/${other.cat.id}`, t, { method: 'PATCH', body: { name: 'x' } })).status).toBe(404);
		expect((await api(`games/${w.g.code}/teams/${other.tA}`, t, { method: 'PATCH', body: { name: 'x' } })).status).toBe(404);
		expect((await api(`games/${w.g.code}/players/${other.alice.id}`, t, { method: 'PATCH', body: { team_id: null } })).status).toBe(404);
	});
	it('validates team names and colors, and refuses to delete a team with photos', async () => {
		const w = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		expect((await api(`games/${w.g.code}/teams`, t, { method: 'POST', body: { name: 'X', color: 'javascript:1' } })).status).toBe(400);
		expect((await api(`games/${w.g.code}/teams`, t, { method: 'POST', body: { name: 'Greens', color: '#00aa00' } })).status).toBe(200);
		await photo(w.g, { cat: w.cat.id, team: w.tA, user: w.alice.id });
		expect((await api(`games/${w.g.code}/teams/${w.tA}`, t, { method: 'DELETE' })).status).toBe(400);
	});
	it('moves a player to a team of the same game only', async () => {
		const w = await world();
		const other = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		expect((await api(`games/${w.g.code}/players/${w.bob.id}`, t, { method: 'PATCH', body: { team_id: w.tA } })).status).toBe(200);
		expect((await one('SELECT team_id FROM member WHERE user_id = ?', w.bob.id))!.team_id).toBe(w.tA);
		expect((await api(`games/${w.g.code}/players/${w.bob.id}`, t, { method: 'PATCH', body: { team_id: other.tA } })).status).toBe(400);
	});
	it('removes players but never hosts', async () => {
		const w = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		expect((await api(`games/${w.g.code}/players/${w.host.id}`, t, { method: 'DELETE' })).status).toBe(400);
		expect((await api(`games/${w.g.code}/players/${w.bob.id}`, t, { method: 'DELETE' })).status).toBe(200);
		expect(await sql('SELECT * FROM member WHERE user_id = ?', w.bob.id)).toEqual([]);
	});
	it('only shows player emails to keys with players:read', async () => {
		const w = await world();
		expect((await api(`games/${w.g.code}/players`, await key(w.host.id, ['games:read'], w.g.id))).status).toBe(403);
		const rows = await json(await api(`games/${w.g.code}/players`, await key(w.host.id, ['players:read'], w.g.id)));
		expect(rows.map((r: any) => r.email)).toContain(w.alice.email);
	});
	it('invites players, creating the account, and stops at the daily limit', async () => {
		const w = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		const r = await api(`games/${w.g.code}/players`, t, { method: 'POST', body: { email: 'new@example.com', name: 'New' } });
		expect(r.status).toBe(200);
		expect(await one("SELECT m.status FROM member m JOIN user u ON u.id = m.user_id WHERE u.email = 'new@example.com'")).toEqual({ status: 'invited' });
		expect((await api(`games/${w.g.code}/players`, t, { method: 'POST', body: { email: 'bad' } })).status).toBe(400);
		expect((await api(`games/${w.g.code}/players`, t, { method: 'POST', body: { email: 'nameless@example.com' } })).status).toBe(400);
		expect((await api(`games/${w.g.code}/players`, t, { method: 'POST', body: { email: w.alice.email } })).status).toBe(409);
		for (let i = 0; i < 20; i++) await exec('INSERT INTO invite (token_hash, user_id, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', `x${i}`, w.host.id, w.host.id, Date.now(), Date.now() + 1e6);
		expect((await api(`games/${w.g.code}/players`, t, { method: 'POST', body: { email: 'one-more@example.com', name: 'X' } })).status).toBe(429);
	});
	it('moderates photos', async () => {
		const w = await world();
		const id = await photo(w.g, { cat: w.cat.id, team: w.tA, user: w.alice.id });
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		expect((await api(`games/${w.g.code}/photos/${id}`, t, { method: 'PATCH', body: { status: 'weird' } })).status).toBe(400);
		expect(await json(await api(`games/${w.g.code}/photos/${id}`, t, { method: 'PATCH', body: { status: 'disqualified', points_override: 3 } }))).toEqual({ id, status: 'disqualified', points_override: 3 });
		expect((await json(await api(`games/${w.g.code}/photos/${id}`, t, { method: 'PATCH', body: { points_override: null } }))).points_override).toBeNull();
		expect((await api(`games/${w.g.code}/photos/${id}`, t, { method: 'DELETE' })).status).toBe(200);
		expect(await sql('SELECT * FROM photo')).toEqual([]);
	});
	it('filters photos and caps the page size', async () => {
		const w = await world();
		await photo(w.g, { cat: w.cat.id, team: w.tA, user: w.alice.id });
		await photo(w.g, { cat: w.cat.id, team: w.tB, user: w.bob.id, status: 'review' });
		const t = await key(w.host.id, ['games:read'], w.g.id);
		expect((await json(await api(`games/${w.g.code}/photos?status=review`, t))).length).toBe(1);
		expect((await json(await api(`games/${w.g.code}/photos?team=${w.tA}`, t))).length).toBe(1);
		expect((await json(await api(`games/${w.g.code}/photos?limit=1`, t))).length).toBe(1);
	});
	it('computes scores, honoring claims', async () => {
		const w = await world();
		const id = await photo(w.g, { cat: w.cat.id, team: w.tA, user: w.alice.id });
		await exec('INSERT INTO photo_claim (photo_id, option_id, qty) VALUES (?, ?, 1)', id, w.cat.option);
		const s = await json(await api(`games/${w.g.code}/scores`, await key(w.host.id, ['games:read'], w.g.id)));
		expect(s.teams.find((x: any) => x.id === w.tA).total).toBe(5);
	});
	it('manages awards and validates their status', async () => {
		const w = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		const a = await json(await api(`games/${w.g.code}/awards`, t, { method: 'POST', body: { name: 'Best', points: 5, scope: 'category' } }));
		expect(a).toMatchObject({ name: 'Best', status: 'draft', scope: 'category' });
		expect((await api(`games/${w.g.code}/awards/${a.id}`, t, { method: 'PATCH', body: { status: 'nope' } })).status).toBe(400);
		expect((await json(await api(`games/${w.g.code}/awards/${a.id}`, t, { method: 'PATCH', body: { status: 'open' } }))).status).toBe('open');
		expect((await api(`games/${w.g.code}/awards/${a.id}`, t, { method: 'DELETE' })).status).toBe(200);
	});
	it('reveals and unreveals', async () => {
		const w = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		await api(`games/${w.g.code}/reveal`, t, { method: 'POST' });
		expect((await one('SELECT revealed_at FROM game'))!.revealed_at).toBeGreaterThan(0);
		await api(`games/${w.g.code}/unreveal`, t, { method: 'POST' });
		expect((await one('SELECT revealed_at FROM game'))!.revealed_at).toBe(0);
	});
});

describe('site-wide keys', () => {
	it('let an admin read and change site settings', async () => {
		const admin = await user({ admin: true });
		const t = await key(admin.id, ['site:read', 'site:write'], null);
		expect(await json(await api('settings', t, { method: 'PUT', body: { signups: false, maxGames: 5.7, maxPhotos: -4, mailFrom: 'Hi <hi@example.com>' } })))
			.toEqual({ signups: false, maxGames: 5, maxPhotos: 0, mailFrom: 'Hi <hi@example.com>' });
	});
	it('create games with the admin as host, and people with an optional game', async () => {
		const admin = await user({ admin: true });
		const t = await key(admin.id, ['site:read', 'site:write'], null);
		const g = await json(await api('games', t, { method: 'POST', body: { name: 'Admin game' } }));
		expect(g.name).toBe('Admin game');
		expect((await api('games', t, { method: 'POST', body: {} })).status).toBe(400);
		const p = await json(await api('people', t, { method: 'POST', body: { name: 'Pat', email: 'pat@example.com', game: g.code } }));
		expect(p.email).toBe('pat@example.com');
		expect((await api('people', t, { method: 'POST', body: { name: 'Pat', email: 'pat@example.com' } })).status).toBe(409);
		expect((await json(await api('people', t))).some((x: any) => x.email === 'pat@example.com')).toBe(true);
	});
	it('are the only ones that can read the log, which holds no emails or codes', async () => {
		const admin = await user({ admin: true });
		const t = await key(admin.id, ['logs:read'], null);
		await exec("INSERT INTO event (at, level, kind, message) VALUES (?, 'error', 'server_error', 'boom')", Date.now());
		const rows = await json(await api('logs?kind=server_error&since=1h', t));
		expect(rows.map((r: any) => r.message)).toEqual(['boom']);
		expect((await json(await api('logs/summary', t)))[0]).toMatchObject({ kind: 'server_error', n: 1 });
	});
	it('stay out of game routes unless they carry the game scope', async () => {
		const w = await world();
		const admin = await user({ admin: true });
		const t = await key(admin.id, ['site:read'], null);
		expect((await api(`games/${w.g.code}`, t)).status).toBe(403);
	});
});

describe('a key can read a log of its own API errors', () => {
	it('records a 500 in the event log and returns a generic message', async () => {
		const w = await world();
		const t = await key(w.host.id, ['games:read'], w.g.id);
		await exec('ALTER TABLE team RENAME TO team_x');
		let r: Response;
		try {
			r = await api(`games/${w.g.code}/teams`, t);
		} finally {
			await exec('ALTER TABLE team_x RENAME TO team');
		}
		expect(r.status).toBe(500);
		expect(await json(r)).toEqual({ error: 'Something went wrong.' });
		expect((await one("SELECT kind FROM event WHERE kind = 'api_error'"))).toBeTruthy();
	});
});
describe('webhooks', () => {
	const URL_ = 'https://chat.example.com/rooms/r1/secret-key/messages';
	it('creates, lists without the key, changes, and deletes; needs games:write to change', async () => {
		const w = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		const readOnly = await key(w.host.id, ['games:read'], w.g.id);
		const path = `games/${w.g.code}/webhooks`;
		expect((await api(path, readOnly, { method: 'POST', body: { name: 'Chat', kind: 'ember', url: URL_ } })).status).toBe(403);
		const made = await json(await api(path, t, { method: 'POST', body: { name: 'Chat', kind: 'ember', url: URL_, events: ['photo.added'] } }));
		expect(made).toMatchObject({ name: 'Chat', kind: 'ember', url: 'https://chat.example.com/…', events: ['photo.added'], active: true });
		const list = await api(path, readOnly);
		const text = await list.text();
		expect(text).not.toContain('secret-key');
		expect(JSON.parse(text)).toHaveLength(1);
		expect((await api(path, t, { method: 'POST', body: { name: 'Bad', kind: 'ember', url: 'http://chat.example.com/rooms/a/b/messages' } })).status).toBe(400);
		const patched = await json(await api(`${path}/${made.id}`, t, { method: 'PATCH', body: { active: false, events: ['photo.added', 'photo.scored'] } }));
		expect(patched).toMatchObject({ active: false, events: ['photo.added', 'photo.scored'] });
		expect((await api(`${path}/${made.id}`, t, { method: 'DELETE' })).status).toBe(200);
		expect(await json(await api(path, t))).toEqual([]);
	});
});

describe('superlatives', () => {
	it('gives, lists and deletes them over the API, and needs games:write to change', async () => {
		const w = await world();
		const t = await key(w.host.id, ALL_GAME, w.g.id);
		const readOnly = await key(w.host.id, ['games:read'], w.g.id);
		const path = `games/${w.g.code}/superlatives`;
		const body = { title: 'Loudest', kind: 'team', team_id: w.tA };
		expect((await api(path, readOnly, { method: 'POST', body })).status).toBe(403);
		const made = await json(await api(path, t, { method: 'POST', body }));
		expect((await api(path, t, { method: 'POST', body: { title: '', kind: 'team', team_id: w.tA } })).status).toBe(400);
		expect(await json(await api(path, readOnly))).toMatchObject([{ id: made.id, title: 'Loudest', kind: 'team', recipient: expect.any(String) }]);
		expect((await api(`${path}/${made.id}`, t, { method: 'DELETE' })).status).toBe(200);
		expect(await json(await api(path, t))).toEqual([]);
	});
});

void post; void session;
