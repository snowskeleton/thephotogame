import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { category, exec, get, jpeg, loc, one, photo, post, sql, user, session, useCleanSite, world, team, member } from './helpers.ts';

useCleanSite();

const P = (g: { code: string }, id: number, action: string) => `/g/${g.code}/p/${id}?/${action}`;

describe('uploading', () => {
	const files = () => ({ photo: jpeg(), thumb: jpeg('t.jpg'), large: jpeg('l.jpg'), width: '800', height: '600' });

	it('puts an upload in the player’s unsorted pile and stores three files', async () => {
		const { g, tA, alice, cookie } = await world();
		const r = await post(`/g/${g.code}?/upload`, files(), { cookie: cookie.alice });
		expect(r.status).toBeLessThan(400);
		const p = (await one('SELECT * FROM photo'))!;
		expect(p).toMatchObject({ category_id: null, team_id: tA, user_id: alice.id, status: 'ok' });
		expect((await env.PHOTOS.list({ prefix: `photos/${p.id}/` })).objects).toHaveLength(3);
	});
	it('files a photo into a category and shows it on the player’s own game page', async () => {
		const { g, cat, cookie } = await world();
		await post(`/g/${g.code}?/upload`, files(), { cookie: cookie.alice });
		const p = (await one<{ id: number }>('SELECT id FROM photo'))!;
		await post(`/g/${g.code}?/file`, { photo_id: String(p.id), category: String(cat.id), caption: 'sunset' }, { cookie: cookie.alice });
		expect(await one('SELECT category_id, caption FROM photo WHERE id = ?', p.id)).toEqual({ category_id: cat.id, caption: 'sunset' });
	});
	it('does not let someone else file or discard a photo from the pile', async () => {
		const { g, cat, cookie } = await world();
		await post(`/g/${g.code}?/upload`, files(), { cookie: cookie.alice });
		const id = (await one<{ id: number }>('SELECT id FROM photo'))!.id;
		await post(`/g/${g.code}?/file`, { photo_id: String(id), category: String(cat.id) }, { cookie: cookie.bob });
		await post(`/g/${g.code}?/discard`, { photo_id: String(id) }, { cookie: cookie.bob });
		expect(await one('SELECT category_id FROM photo WHERE id = ?', id)).toEqual({ category_id: null });
	});
	it('discards an own unsorted photo and its files', async () => {
		const { g, cookie } = await world();
		await post(`/g/${g.code}?/upload`, files(), { cookie: cookie.alice });
		const id = (await one<{ id: number }>('SELECT id FROM photo'))!.id;
		await post(`/g/${g.code}?/discard`, { photo_id: String(id) }, { cookie: cookie.alice });
		expect(await sql('SELECT * FROM photo')).toEqual([]);
		expect((await env.PHOTOS.list({ prefix: `photos/${id}/` })).objects).toEqual([]);
	});
	it('rejects an upload that is not an image', async () => {
		const { g, cookie } = await world();
		await post(`/g/${g.code}?/upload`, { ...files(), photo: new File(['<script>alert(1)</script>'], 'x.jpg', { type: 'image/jpeg' }) }, { cookie: cookie.alice });
		expect(await sql('SELECT * FROM photo')).toEqual([]);
	});
	it('refuses uploads once submissions close', async () => {
		const { g, cookie } = await world();
		await exec('UPDATE game SET submissions_open = 0 WHERE id = ?', g.id);
		await post(`/g/${g.code}?/upload`, files(), { cookie: cookie.alice });
		expect(await sql('SELECT * FROM photo')).toEqual([]);
	});
	it('refuses a signed-out upload', async () => {
		const { g } = await world();
		const r = await post(`/g/${g.code}?/upload`, files());
		expect(loc(r)).toBe(`/join/${g.code}`);
		expect(await sql('SELECT * FROM photo')).toEqual([]);
	});
});

describe('who sees which photos', () => {
	it('shows a team its own photo but hides it from the other team until revealed', async () => {
		const { g, tA, alice, cat, cookie } = await world();
		const id = await photo(g, { cat: cat.id, team: tA, user: alice.id });
		expect((await get(`/g/${g.code}/p/${id}`, { cookie: cookie.alice })).status).toBe(200);
		expect((await get(`/g/${g.code}/p/${id}`, { cookie: cookie.bob })).status).toBe(403);
		expect((await get(`/media/${id}/thumb`, { cookie: cookie.alice })).status).toBe(200);
		expect((await get(`/media/${id}/thumb`, { cookie: cookie.bob })).status).toBe(403);
	});
	it('shows the photo to everyone after a reveal', async () => {
		const { g, tA, alice, cat, cookie } = await world();
		const id = await photo(g, { cat: cat.id, team: tA, user: alice.id, created_at: 1000 });
		await exec('UPDATE game SET revealed_at = ? WHERE id = ?', Date.now(), g.id);
		expect((await get(`/g/${g.code}/p/${id}`, { cookie: cookie.bob })).status).toBe(200);
		expect((await get(`/media/${id}/large`, { cookie: cookie.bob })).status).toBe(200);
	});
	it('shows everything in an open game', async () => {
		const { g, tA, alice, cat, cookie } = await world({ visibility: 'open' });
		const id = await photo(g, { cat: cat.id, team: tA, user: alice.id });
		expect((await get(`/media/${id}/thumb`, { cookie: cookie.bob })).status).toBe(200);
	});
	it('shows hosts everything', async () => {
		const { g, tB, bob, cat, cookie } = await world();
		const id = await photo(g, { cat: cat.id, team: tB, user: bob.id });
		expect((await get(`/media/${id}/original`, { cookie: cookie.host })).status).toBe(200);
	});
	it('keeps an unsorted photo with its team even after a reveal', async () => {
		const { g, tA, alice, cookie } = await world();
		const id = await photo(g, { cat: null, team: tA, user: alice.id, created_at: 1000 });
		await exec('UPDATE game SET revealed_at = ? WHERE id = ?', Date.now(), g.id);
		expect((await get(`/media/${id}/thumb`, { cookie: cookie.bob })).status).toBe(403);
		expect((await get(`/media/${id}/thumb`, { cookie: cookie.alice })).status).toBe(200);
	});
	it('serves media with the right content type and caching, and 401s signed-out requests', async () => {
		const { g, tA, alice, cat, cookie } = await world();
		const id = await photo(g, { cat: cat.id, team: tA, user: alice.id });
		const r = await get(`/media/${id}/thumb`, { cookie: cookie.alice });
		expect(r.headers.get('content-type')).toBe('image/jpeg');
		expect(r.headers.get('cache-control')).toContain('private');
		expect(r.headers.get('etag')).toBeTruthy();
		expect((await get(`/media/${id}/thumb`)).status).toBe(401);
	});
	it('answers a repeat request with 304 when the browser copy is current', async () => {
		const { g, tA, alice, cat, cookie } = await world();
		const id = await photo(g, { cat: cat.id, team: tA, user: alice.id });
		const etag = (await get(`/media/${id}/thumb`, { cookie: cookie.alice })).headers.get('etag')!;
		expect((await get(`/media/${id}/thumb`, { cookie: cookie.alice, headers: { 'if-none-match': etag } })).status).toBe(304);
	});
	it('404s on an unknown size or photo and 403s on another game’s photo', async () => {
		const { g, tA, alice, cat, cookie } = await world();
		const id = await photo(g, { cat: cat.id, team: tA, user: alice.id });
		expect((await get(`/media/${id}/huge`, { cookie: cookie.alice })).status).toBe(404);
		expect((await get('/media/999999/thumb', { cookie: cookie.alice })).status).toBe(404);
		const other = await world();
		expect((await get(`/media/${id}/thumb`, { cookie: other.cookie.alice })).status).toBe(403);
	});
	it('does not list hidden photos in another team’s gallery', async () => {
		const { g, tA, alice, cat, cookie } = await world();
		const id = await photo(g, { cat: cat.id, team: tA, user: alice.id });
		const html = await (await get(`/g/${g.code}/gallery`, { cookie: cookie.bob })).text();
		expect(html).not.toContain(`/media/${id}/`);
		expect(await (await get(`/g/${g.code}/gallery`, { cookie: cookie.alice })).text()).toContain(`/media/${id}/`);
	});
});

describe('scoring is the host’s call', () => {
	async function filed() {
		const w = await world();
		const id = await photo(w.g, { cat: w.cat.id, team: w.tA, user: w.alice.id });
		return { ...w, id };
	}
	const claim = (w: Awaited<ReturnType<typeof filed>>) => ({ category: String(w.cat.id), tier: String(w.cat.option), caption: 'hello' });

	it('ignores a player’s points but keeps their caption', async () => {
		const w = await filed();
		await post(P(w.g, w.id, 'claims'), claim(w), { cookie: w.cookie.alice });
		expect(await sql('SELECT * FROM photo_claim')).toEqual([]);
		expect((await one('SELECT caption FROM photo WHERE id = ?', w.id))!.caption).toBe('hello');
	});
	it('stores a host’s claim and the team’s score follows', async () => {
		const w = await filed();
		await post(P(w.g, w.id, 'claims'), claim(w), { cookie: w.cookie.host });
		expect(await sql('SELECT option_id FROM photo_claim')).toEqual([{ option_id: w.cat.option }]);
		const scores = await (await get(`/g/${w.g.code}/scores`, { cookie: w.cookie.host })).text();
		expect(scores).toContain('Reds');
	});
	it('refuses another player’s edit or delete', async () => {
		const w = await filed();
		await exec('UPDATE game SET visibility = ? WHERE id = ?', 'open', w.g.id);
		expect((await post(P(w.g, w.id, 'claims'), claim(w), { cookie: w.cookie.bob })).status).toBe(403);
		expect((await post(P(w.g, w.id, 'delete'), {}, { cookie: w.cookie.bob })).status).toBe(403);
		expect(await sql('SELECT * FROM photo')).toHaveLength(1);
	});
	it.each(['settle', 'adjust', 'give', 'removeCredit'])('refuses the host-only action %s for players', async (action) => {
		const w = await filed();
		const r = await post(P(w.g, w.id, action), { to: 'disqualified', points: '99', team: String(w.tB), title: 'x', id: '1' }, { cookie: w.cookie.alice });
		expect(r.status).toBe(403);
		expect(await one('SELECT status, points_override FROM photo WHERE id = ?', w.id)).toEqual({ status: 'ok', points_override: null });
		expect(await sql('SELECT * FROM grant_award')).toEqual([]);
	});
	it('lets the host override points and disqualify', async () => {
		const w = await filed();
		await post(P(w.g, w.id, 'adjust'), { points: '12' }, { cookie: w.cookie.host });
		expect((await one('SELECT points_override FROM photo'))!.points_override).toBe(12);
		await post(P(w.g, w.id, 'adjust'), { points: '' }, { cookie: w.cookie.host });
		expect((await one('SELECT points_override FROM photo'))!.points_override).toBeNull();
		await post(P(w.g, w.id, 'settle'), { to: 'disqualified' }, { cookie: w.cookie.host });
		expect((await one('SELECT status FROM photo'))!.status).toBe('disqualified');
	});
	it('credits another team from a photo and removes the credit with the photo', async () => {
		const w = await filed();
		await post(P(w.g, w.id, 'give'), { team: String(w.tB), title: 'Bob is in it', points: '2' }, { cookie: w.cookie.host });
		expect(await sql('SELECT team_id, points FROM grant_award')).toEqual([{ team_id: w.tB, points: 2 }]);
		await post(P(w.g, w.id, 'delete'), {}, { cookie: w.cookie.host });
		expect(await sql('SELECT * FROM grant_award')).toEqual([]);
		expect(await sql('SELECT * FROM photo')).toEqual([]);
	});
	it('lets the photographer delete their own photo, files included, and goes back to the category', async () => {
		const w = await filed();
		const r = await post(P(w.g, w.id, 'delete'), {}, { cookie: w.cookie.alice });
		expect(loc(r)).toBe(`/g/${w.g.code}/c/${w.cat.id}`);
		expect((await env.PHOTOS.list({ prefix: `photos/${w.id}/` })).objects).toEqual([]);
	});
	it('goes back to the filtered gallery when the delete came from it', async () => {
		const w = await filed();
		const r = await post(`/g/${w.g.code}/p/${w.id}?/delete&from=gallery&team=${w.tA}`, {}, { cookie: w.cookie.alice });
		expect(loc(r)).toBe(`/g/${w.g.code}/gallery?team=${w.tA}`);
	});
	it('moving a photo to another category clears its claims, and players can’t move a disqualified photo', async () => {
		const w = await filed();
		const other = await category(w.g.id);
		await post(P(w.g, w.id, 'claims'), claim(w), { cookie: w.cookie.host });
		await post(P(w.g, w.id, 'claims'), { category: String(other.id) }, { cookie: w.cookie.alice });
		expect((await one('SELECT category_id FROM photo'))!.category_id).toBe(other.id);
		expect(await sql('SELECT * FROM photo_claim')).toEqual([]);
		await exec("UPDATE photo SET status = 'disqualified'");
		await post(P(w.g, w.id, 'claims'), { category: String(w.cat.id) }, { cookie: w.cookie.alice });
		expect((await one('SELECT category_id FROM photo'))!.category_id).toBe(other.id);
	});
	it('does not let a photo move into another game’s category', async () => {
		const w = await filed();
		const foreign = await category((await world()).g.id);
		await post(P(w.g, w.id, 'claims'), { category: String(foreign.id) }, { cookie: w.cookie.host });
		expect((await one('SELECT category_id FROM photo'))!.category_id).toBe(w.cat.id);
	});
});

describe('doubts and review', () => {
	it('sends a photo to review once doubts pass the limit, and back when they fall', async () => {
		const w = await world({ visibility: 'open' });
		await exec('UPDATE game SET doubt_limit = 1 WHERE id = ?', w.g.id);
		const id = await photo(w.g, { cat: w.cat.id, team: w.tA, user: w.alice.id });
		const carol = await user();
		await member(w.g.id, carol.id, w.tB);
		const carolCookie = await session(carol.id);
		await post(P(w.g, id, 'doubt'), { on: '1' }, { cookie: w.cookie.bob });
		expect((await one('SELECT status FROM photo'))!.status).toBe('ok');
		await post(P(w.g, id, 'doubt'), { on: '1' }, { cookie: carolCookie });
		expect((await one('SELECT status FROM photo'))!.status).toBe('review');
		await post(P(w.g, id, 'doubt'), { on: '0' }, { cookie: carolCookie });
		expect((await one('SELECT status FROM photo'))!.status).toBe('ok');
	});
	it('does not let a team doubt its own photo', async () => {
		const w = await world({ visibility: 'open' });
		const id = await photo(w.g, { cat: w.cat.id, team: w.tA, user: w.alice.id });
		const r = await post(P(w.g, id, 'doubt'), { on: '1' }, { cookie: w.cookie.alice });
		expect(r.status).toBe(400);
		expect(await sql('SELECT * FROM doubt')).toEqual([]);
	});
	it('counts one doubt per person', async () => {
		const w = await world({ visibility: 'open' });
		const id = await photo(w.g, { cat: w.cat.id, team: w.tA, user: w.alice.id });
		await post(P(w.g, id, 'doubt'), { on: '1' }, { cookie: w.cookie.bob });
		await post(P(w.g, id, 'doubt'), { on: '1' }, { cookie: w.cookie.bob });
		expect(await sql('SELECT * FROM doubt')).toHaveLength(1);
	});
	it('records review votes only while a photo is under review', async () => {
		const w = await world({ visibility: 'open' });
		const id = await photo(w.g, { cat: w.cat.id, team: w.tA, user: w.alice.id });
		await post(P(w.g, id, 'review'), { agree: '1' }, { cookie: w.cookie.bob });
		expect(await sql('SELECT * FROM review_vote')).toEqual([]);
		await exec("UPDATE photo SET status = 'review'");
		await post(P(w.g, id, 'review'), { agree: '1' }, { cookie: w.cookie.bob });
		await post(P(w.g, id, 'review'), { agree: '0' }, { cookie: w.cookie.bob });
		expect(await sql('SELECT agree FROM review_vote')).toEqual([{ agree: 0 }]);
	});
});

describe('teams', () => {
	it('lets a player join a team in self-serve games, up to the size limit', async () => {
		const w = await world({ team_mode: 'self', max_team_size: 1 });
		const newbie = await user();
		await member(w.g.id, newbie.id, null);
		const c = await session(newbie.id);
		await post(`/g/${w.g.code}?/joinTeam`, { team: String(w.tB) }, { cookie: c });
		expect((await one('SELECT team_id FROM member WHERE user_id = ?', newbie.id))!.team_id).toBeNull();
		const w2 = await world({ team_mode: 'self' });
		const n2 = await user();
		await member(w2.g.id, n2.id, null);
		await post(`/g/${w2.g.code}?/joinTeam`, { team: String(w2.tB) }, { cookie: await session(n2.id) });
		expect((await one('SELECT team_id FROM member WHERE user_id = ?', n2.id))!.team_id).toBe(w2.tB);
	});
	it('does not let players pick teams when the host assigns them', async () => {
		const w = await world();
		const n = await user();
		await member(w.g.id, n.id, null);
		const r = await post(`/g/${w.g.code}?/joinTeam`, { team: String(w.tB) }, { cookie: await session(n.id) });
		expect(r.status).toBe(403);
	});
	it('does not let someone join a team from another game', async () => {
		const w = await world({ team_mode: 'self' });
		const other = await world();
		const n = await user();
		await member(w.g.id, n.id, null);
		await post(`/g/${w.g.code}?/joinTeam`, { team: String(other.tA) }, { cookie: await session(n.id) });
		expect((await one('SELECT team_id FROM member WHERE user_id = ?', n.id))!.team_id).toBeNull();
	});
	it('lets a player start a team, but only once', async () => {
		const w = await world({ team_mode: 'self' });
		const n = await user();
		await member(w.g.id, n.id, null);
		const c = await session(n.id);
		await post(`/g/${w.g.code}?/newTeam`, { name: 'Greens', color: '#00aa00' }, { cookie: c });
		await post(`/g/${w.g.code}?/newTeam`, { name: 'Again', color: '#00aa00' }, { cookie: c });
		expect((await sql("SELECT name FROM team WHERE name IN ('Greens', 'Again')")).map((t) => t.name)).toEqual(['Greens']);
	});
});

describe('host tools', () => {
	it('creates a category with a default scoring line', async () => {
		const { g, cookie } = await world();
		await post(`/g/${g.code}/admin/categories?/add`, { name: 'Best hat', points: '3' }, { cookie: cookie.host });
		expect(await sql("SELECT o.points, o.kind FROM category c JOIN score_option o ON o.category_id = c.id WHERE c.name = 'Best hat'")).toEqual([{ points: 3, kind: 'tier' }]);
	});
	it('refuses category creation by a player', async () => {
		const { g, cookie } = await world();
		expect((await post(`/g/${g.code}/admin/categories?/add`, { name: 'Sneaky' }, { cookie: cookie.alice })).status).toBe(403);
		expect(await sql("SELECT * FROM category WHERE name = 'Sneaky'")).toEqual([]);
	});
	it('refuses every host action to players', async () => {
		const { g, tA, cookie } = await world();
		const forbidden = [
			[`/g/${g.code}/admin?/save`, { name: 'Hacked' }],
			[`/g/${g.code}/admin?/reveal`, {}],
			[`/g/${g.code}/admin?/deleteGame`, { confirm: g.code }],
			[`/g/${g.code}/admin/teams?/addTeam`, { name: 'X', color: '#000000' }],
			[`/g/${g.code}/admin/teams?/setRole`, { user: '1', role: 'host' }],
			[`/g/${g.code}/admin/teams?/removePlayer`, { user: '1' }],
			[`/g/${g.code}/admin/awards?/addAward`, { name: 'X' }],
			[`/g/${g.code}/admin/awards?/grant`, { title: 'x', team: String(tA), points: '99' }]
		] as const;
		for (const [path, body] of forbidden) expect((await post(path, { ...body }, { cookie: cookie.alice })).status, path).toBe(403);
		expect(await one('SELECT name, revealed_at FROM game WHERE id = ?', g.id)).toEqual({ name: 'Test game', revealed_at: 0 });
	});
	it('saves game settings with clamping', async () => {
		const { g, cookie } = await world();
		await post(`/g/${g.code}/admin?/save`, { name: ' New name ', visibility: 'open', bingo: 'on', bingo_cols: '99', doubt_limit: '-3', max_team_size: 'abc' }, { cookie: cookie.host });
		expect(await one('SELECT name, visibility, bingo, bingo_cols, doubt_limit, max_team_size, submissions_open FROM game WHERE id = ?', g.id))
			.toEqual({ name: 'New name', visibility: 'open', bingo: 1, bingo_cols: 8, doubt_limit: 0, max_team_size: null, submissions_open: 0 });
	});
	it('reveals and unreveals photos', async () => {
		const { g, cookie } = await world();
		await post(`/g/${g.code}/admin?/reveal`, {}, { cookie: cookie.host });
		expect((await one('SELECT revealed_at FROM game WHERE id = ?', g.id))!.revealed_at).toBeGreaterThan(0);
		await post(`/g/${g.code}/admin?/unreveal`, {}, { cookie: cookie.host });
		expect((await one('SELECT revealed_at FROM game WHERE id = ?', g.id))!.revealed_at).toBe(0);
	});
	it('replaces the join code and the old link stops working', async () => {
		const { g, cookie } = await world();
		const r = await post(`/g/${g.code}/admin?/newCode`, {}, { cookie: cookie.host });
		const fresh = loc(r)!.split('/')[2];
		expect(fresh).not.toBe(g.code);
		expect((await get(`/join/${g.code}`)).status).toBe(404);
		expect((await get(`/join/${fresh}`)).status).toBe(200);
	});
	it('deletes a game only when the code is typed, and removes its photos from storage', async () => {
		const { g, tA, alice, cat, cookie } = await world();
		const id = await photo(g, { cat: cat.id, team: tA, user: alice.id });
		await post(`/g/${g.code}/admin?/deleteGame`, { confirm: 'wrong' }, { cookie: cookie.host });
		expect(await sql('SELECT * FROM game WHERE id = ?', g.id)).toHaveLength(1);
		const r = await post(`/g/${g.code}/admin?/deleteGame`, { confirm: g.code.toLowerCase() }, { cookie: cookie.host });
		expect(loc(r)).toBe('/');
		expect(await sql('SELECT * FROM game WHERE id = ?', g.id)).toEqual([]);
		expect(await sql('SELECT * FROM photo')).toEqual([]);
		expect((await env.PHOTOS.list({ prefix: `photos/${id}/` })).objects).toEqual([]);
	});
	it('will not demote the last host, and will not remove a host', async () => {
		const { g, host, cookie } = await world();
		await post(`/g/${g.code}/admin/teams?/setRole`, { user: String(host.id), role: 'player' }, { cookie: cookie.host });
		expect((await one('SELECT role FROM member WHERE user_id = ?', host.id))!.role).toBe('host');
		await post(`/g/${g.code}/admin/teams?/removePlayer`, { user: String(host.id) }, { cookie: cookie.host });
		expect(await sql('SELECT * FROM member WHERE user_id = ?', host.id)).toHaveLength(1);
	});
	it('does not delete a team that has photos, and ignores another game’s team', async () => {
		const { g, tA, tB, alice, cat, cookie } = await world();
		await photo(g, { cat: cat.id, team: tA, user: alice.id });
		await post(`/g/${g.code}/admin/teams?/deleteTeam`, { id: String(tA) }, { cookie: cookie.host });
		expect(await sql('SELECT * FROM team WHERE id = ?', tA)).toHaveLength(1);
		const other = await world();
		await post(`/g/${g.code}/admin/teams?/deleteTeam`, { id: String(other.tB) }, { cookie: cookie.host });
		expect(await sql('SELECT * FROM team WHERE id = ?', other.tB)).toHaveLength(1);
		await post(`/g/${g.code}/admin/teams?/deleteTeam`, { id: String(tB) }, { cookie: cookie.host });
		expect(await sql('SELECT * FROM team WHERE id = ?', tB)).toEqual([]);
	});
	it('invites a player by email, creating an unverified-nothing account that must accept', async () => {
		const { g, cookie } = await world();
		await post(`/g/${g.code}/admin/teams?/addPlayer`, { email: 'Guest@Example.com', name: 'Guest' }, { cookie: cookie.host });
		expect(await one("SELECT m.status FROM member m JOIN user u ON u.id = m.user_id WHERE u.email = 'guest@example.com'")).toEqual({ status: 'invited' });
		expect(await one('SELECT COUNT(*) AS n FROM invite')).toEqual({ n: 1 });
	});
	it('limits invites to 20 a day per host', async () => {
		const { g, cookie, host } = await world();
		for (let i = 0; i < 20; i++) await exec('INSERT INTO invite (token_hash, user_id, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', `h${i}`, host.id, host.id, Date.now(), Date.now() + 1e6);
		const r = await post(`/g/${g.code}/admin/teams?/addPlayer`, { email: 'late@example.com', name: 'Late' }, { cookie: cookie.host });
		expect(r.status).toBe(429);
	});
});

describe('voted awards', () => {
	async function open() {
		const w = await world({ visibility: 'open' });
		const a = (await exec("INSERT INTO award (game_id, name, points, status) VALUES (?, 'Best', 5, 'open')", w.g.id)).last_row_id as number;
		const mine = await photo(w.g, { cat: w.cat.id, team: w.tA, user: w.alice.id });
		const theirs = await photo(w.g, { cat: w.cat.id, team: w.tB, user: w.bob.id });
		return { ...w, a, mine, theirs };
	}
	it('records votes for other teams’ photos and drops votes for the voter’s own team', async () => {
		const w = await open();
		const r = await post(`/g/${w.g.code}/vote/${w.a}`, { pick: [String(w.mine), String(w.theirs)] }, { cookie: w.cookie.alice });
		expect(loc(r)).toBe(`/g/${w.g.code}/vote/${w.a}?saved=1`);
		expect(await sql('SELECT photo_id FROM vote')).toEqual([{ photo_id: w.theirs }]);
	});
	it('replaces earlier votes and ignores duplicates', async () => {
		const w = await open();
		await post(`/g/${w.g.code}/vote/${w.a}`, { pick: [String(w.theirs), String(w.theirs)] }, { cookie: w.cookie.alice });
		await post(`/g/${w.g.code}/vote/${w.a}`, { pick: [] as string[] }, { cookie: w.cookie.alice });
		expect(await sql('SELECT * FROM vote')).toEqual([]);
	});
	it('refuses votes unless voting is open', async () => {
		const w = await open();
		await exec("UPDATE award SET status = 'closed'");
		expect((await post(`/g/${w.g.code}/vote/${w.a}`, { pick: [String(w.theirs)] }, { cookie: w.cookie.alice })).status).toBe(400);
		expect(await sql('SELECT * FROM vote')).toEqual([]);
	});
	it('hides draft awards from players', async () => {
		const w = await open();
		await exec("UPDATE award SET status = 'draft'");
		expect((await get(`/g/${w.g.code}/vote/${w.a}`, { cookie: w.cookie.alice })).status).toBe(404);
		expect((await get(`/g/${w.g.code}/vote/${w.a}`, { cookie: w.cookie.host })).status).toBe(200);
	});
	it('will not show an award from another game', async () => {
		const w = await open();
		const other = await world();
		expect((await get(`/g/${other.g.code}/vote/${w.a}`, { cookie: other.cookie.alice })).status).toBe(404);
	});
	it('pays the winner once the host closes voting', async () => {
		const w = await open();
		await post(`/g/${w.g.code}/vote/${w.a}`, { pick: [String(w.theirs)] }, { cookie: w.cookie.alice });
		await post(`/g/${w.g.code}/admin/awards?/status`, { id: String(w.a), to: 'closed' }, { cookie: w.cookie.host });
		const scores = await (await get(`/g/${w.g.code}/scores`, { cookie: w.cookie.host })).text();
		expect(scores).toContain('Blues');
		expect(await one("SELECT status FROM award")).toEqual({ status: 'closed' });
	});
});
void team;

describe('reordering categories', () => {
	const order = async (gameId: number) => (await sql('SELECT id FROM category WHERE game_id = ? ORDER BY sort, id', gameId)).map((r) => r.id);

	it('saves a new order from a list of ids', async () => {
		const { g, cookie, cat } = await world();
		const b = await category(g.id);
		const c = await category(g.id);
		await post(`/g/${g.code}/admin/categories?/reorder`, { ids: JSON.stringify([c.id, cat.id, b.id]) }, { cookie: cookie.host });
		expect(await order(g.id)).toEqual([c.id, cat.id, b.id]);
	});
	it('keeps categories that are missing from the list, after the listed ones', async () => {
		const { g, cookie, cat } = await world();
		const b = await category(g.id);
		const c = await category(g.id);
		await post(`/g/${g.code}/admin/categories?/reorder`, { ids: JSON.stringify([c.id]) }, { cookie: cookie.host });
		expect(await order(g.id)).toEqual([c.id, cat.id, b.id]);
	});
	it('ignores ids from other games and junk', async () => {
		const { g, cookie, cat } = await world();
		const other = await world();
		const b = await category(g.id);
		await post(`/g/${g.code}/admin/categories?/reorder`, { ids: JSON.stringify([other.cat.id, 'x', b.id, b.id]) }, { cookie: cookie.host });
		expect(await order(g.id)).toEqual([b.id, cat.id]);
		expect(await order(other.g.id)).toEqual([other.cat.id]);
		expect((await post(`/g/${g.code}/admin/categories?/reorder`, { ids: 'not json' }, { cookie: cookie.host })).status).toBeLessThan(500);
	});
	it('is for hosts only', async () => {
		const { g, cookie, cat } = await world();
		const b = await category(g.id);
		const r = await post(`/g/${g.code}/admin/categories?/reorder`, { ids: JSON.stringify([b.id, cat.id]) }, { cookie: cookie.alice });
		expect(r.status).toBe(403);
		expect(await order(g.id)).toEqual([cat.id, b.id]);
	});
});
