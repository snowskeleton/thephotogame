import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { all, batch, get, insert, q, run } from '../../src/lib/server/db.ts';
import { clientErrorRoom, listEvents, logEvent, summary } from '../../src/lib/server/log.ts';
import { saveSettings, settings } from '../../src/lib/server/settings.ts';
import { key, remove, sniff, store } from '../../src/lib/server/images.ts';
import { browseFilter, dayOf, listPhotos, onePhoto } from '../../src/lib/server/photos.ts';
import { categoryIn, fileInto, savePhotos, unsortedFor } from '../../src/lib/server/uploads.ts';
import { claim, game, mkCategory, mkGame, mkMember, mkOption, mkPhoto, mkTeam, mkUser, useDatabase } from './helpers.ts';
import type { Viewer } from '../../src/lib/server/game.ts';

useDatabase();

describe('migrations', () => {
	it('records every migration file as applied', async () => {
		const names = (await all<{ name: string }>('SELECT name FROM d1_migrations ORDER BY name')).map((r) => r.name);
		expect(names[0]).toBe('0001_init.sql');
		expect(names.length).toBeGreaterThanOrEqual(9);
		expect(new Set(names).size).toBe(names.length);
	});
	it('creates the score triggers with their full bodies', async () => {
		const triggers = await all<{ name: string; sql: string }>("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'score_%'");
		expect(triggers.length).toBeGreaterThanOrEqual(30);
		for (const t of triggers) expect(t.sql).toMatch(/BEGIN .*UPDATE game SET score_epoch.* END$/s);
	});
	it('covers hot queries with indexes', async () => {
		const plan = await all<{ detail: string }>('EXPLAIN QUERY PLAN SELECT * FROM photo WHERE game_id = 1 AND category_id = 2');
		expect(plan.map((r) => r.detail).join(' ')).toMatch(/USING (COVERING )?INDEX/);
	});
	it('enforces cascades: deleting a game removes its teams, photos and claims', async () => {
		const g = await mkGame();
		const team = await mkTeam(g.id);
		const user = await mkUser();
		const cat = await mkCategory(g.id);
		const p = await mkPhoto(g, { cat, team, user });
		await claim(p, await mkOption(cat, 1));
		await run('DELETE FROM game WHERE id = ?', g.id);
		for (const t of ['team', 'category', 'photo', 'photo_claim', 'score_option']) expect(await all(`SELECT 1 FROM ${t}`)).toEqual([]);
	});
});

describe('db helpers', () => {
	it('turns undefined and NaN into NULL', async () => {
		await run('INSERT INTO setting (key, value) VALUES (?, ?)', 'k', 'v');
		const id = await insert("INSERT INTO event (at, level, kind, message, status, user_id) VALUES (1, 'info', 'k', 'm', ?, ?)", NaN, undefined);
		expect(await get('SELECT status, user_id FROM event WHERE id = ?', id)).toEqual({ status: null, user_id: null });
	});
	it('batch is all or nothing', async () => {
		await expect(
			batch([q("INSERT INTO setting (key, value) VALUES ('a', '1')"), q("INSERT INTO setting (key, value) VALUES ('a', '2')")])
		).rejects.toThrow();
		expect(await all("SELECT * FROM setting WHERE key = 'a'")).toEqual([]);
	});
	it('batch of nothing is fine', async () => expect(await batch([])).toEqual([]));
});

describe('event log', () => {
	it('records an event with request details', async () => {
		await logEvent('error', 'server_error', 'boom', { request: new Request('https://x.test/a/b?c=1', { method: 'POST', headers: { 'user-agent': 'UA/1' } }), status: 500, detail: { a: 1 } });
		const [e] = await listEvents({});
		expect(e).toMatchObject({ level: 'error', kind: 'server_error', message: 'boom', method: 'POST', path: '/a/b', status: 500, agent: 'UA/1', detail: '{"a":1}' });
	});
	it('truncates long fields', async () => {
		await logEvent('info', 'k', 'x'.repeat(2000), { detail: 'y'.repeat(5000) });
		const [e] = await listEvents({});
		expect(e.message).toHaveLength(500);
		expect(e.detail).toHaveLength(2000);
	});
	it('never throws, even when the table is gone', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		await run('ALTER TABLE event RENAME TO event_x');
		try {
			await expect(logEvent('error', 'k', 'm')).resolves.toBeUndefined();
		} finally {
			await run('ALTER TABLE event_x RENAME TO event');
			err.mockRestore();
		}
	});
	it('filters and caps the list, newest first', async () => {
		for (let i = 0; i < 5; i++) await logEvent(i % 2 ? 'warn' : 'error', i % 2 ? 'a' : 'b', `m${i}`);
		expect((await listEvents({ kind: 'a' })).map((e) => e.message)).toEqual(['m3', 'm1']);
		expect((await listEvents({ level: 'error' })).length).toBe(3);
		expect(await listEvents({ limit: 2 })).toHaveLength(2);
		expect((await listEvents({ limit: 2 }))[0].message).toBe('m4');
	});
	it('summarises the last day by kind', async () => {
		await logEvent('error', 'k1', 'a');
		await logEvent('error', 'k1', 'b');
		await logEvent('warn', 'k2', 'c');
		await run("INSERT INTO event (at, level, kind, message) VALUES (1, 'error', 'old', 'm')");
		const s = await summary();
		expect(s.find((r) => r.kind === 'k1')!.n).toBe(2);
		expect(s.find((r) => r.kind === 'old')).toBeUndefined();
	});
	it('limits browser error reports to 30 a minute', async () => {
		expect(await clientErrorRoom()).toBe(true);
		for (let i = 0; i < 30; i++) await logEvent('error', 'client_error', 'm');
		expect(await clientErrorRoom()).toBe(false);
	});
});

describe('settings', () => {
	it('has defaults', async () => expect(await settings()).toEqual({ signups: true, maxGames: 3, maxPhotos: 1000, mailFrom: '' }));
	it('saves and updates values', async () => {
		await saveSettings({ signups: false, maxGames: 7 });
		await saveSettings({ maxGames: 9 });
		expect(await settings()).toMatchObject({ signups: false, maxGames: 9, maxPhotos: 1000 });
	});
});

describe('images', () => {
	const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
	const ascii = (at: number, s: string) => { const a = new Uint8Array(16); [...s].forEach((c, i) => (a[at + i] = c.charCodeAt(0))); return a; };
	it('recognises supported formats by their first bytes', () => {
		expect(sniff(bytes(0xff, 0xd8, 0xff))).toBe('jpg');
		expect(sniff(bytes(0x89, 0x50, 0x4e, 0x47))).toBe('png');
		expect(sniff(new Uint8Array([...ascii(0, 'RIFF').slice(0, 8), ...ascii(0, 'WEBP').slice(0, 4)]))).toBe('webp');
		expect(sniff(ascii(0, 'GIF89a'))).toBe('gif');
		const heic = ascii(4, 'ftyp'); heic.set([...'heic'].map((c) => c.charCodeAt(0)), 8);
		expect(sniff(heic)).toBe('heic');
		const avif = ascii(4, 'ftyp'); avif.set([...'avif'].map((c) => c.charCodeAt(0)), 8);
		expect(sniff(avif)).toBe('avif');
	});
	it('refuses everything else', () => {
		expect(sniff(ascii(0, '<?php echo 1;'))).toBeNull();
		expect(sniff(ascii(0, '<svg xmlns='))).toBeNull();
		expect(sniff(new Uint8Array(0))).toBeNull();
		const mov = ascii(4, 'ftyp'); mov.set([...'qt  '].map((c) => c.charCodeAt(0)), 8);
		expect(sniff(mov)).toBeNull();
	});
	it('names the stored files', () => {
		expect(key(5, 'original', 'png')).toBe('photos/5/original.png');
		expect(key(5, 'thumb', 'png')).toBe('photos/5/thumb.jpg');
	});
	it('stores three files in R2 with the right types, and removes them', async () => {
		const b = (n: number) => new Uint8Array(n).fill(1).buffer;
		await store(77, 'png', { original: b(3), thumb: b(2), large: b(4) });
		expect((await env.PHOTOS.head(key(77, 'original', 'png')))!.httpMetadata!.contentType).toBe('image/png');
		expect((await env.PHOTOS.head(key(77, 'thumb', 'png')))!.httpMetadata!.contentType).toBe('image/jpeg');
		await remove([{ id: 77, ext: 'png' }]);
		expect((await env.PHOTOS.list({ prefix: 'photos/77/' })).objects).toEqual([]);
	});
});

describe('photo listing', () => {
	async function world() {
		const g = await mkGame({ visibility: 'hidden', revealed_at: 1000 });
		const mine = await mkTeam(g.id, 'Mine');
		const theirs = await mkTeam(g.id, 'Theirs');
		const me = await mkUser();
		const you = await mkUser();
		const cat = await mkCategory(g.id);
		const own = await mkPhoto(g, { cat, team: mine, user: me });
		const revealed = await mkPhoto(g, { cat, team: theirs, user: you });
		const secret = await mkPhoto(g, { cat, team: theirs, user: you });
		await run('UPDATE photo SET created_at = 500 WHERE id = ?', revealed);
		await mkPhoto(g, { cat: null, team: mine, user: me });
		const viewer = (isHost: boolean): Viewer => ({ user: { id: me } as never, teamId: mine, isHost });
		return { g: await game(g.id), own, revealed, secret, viewer, cat, theirs, you };
	}
	it('hides other teams’ unrevealed photos from players', async () => {
		const { g, viewer, own, revealed } = await world();
		expect((await listPhotos(g, viewer(false))).map((p) => p.id).sort()).toEqual([own, revealed].sort());
	});
	it('shows hosts everything that is filed', async () => {
		const { g, viewer } = await world();
		expect(await listPhotos(g, viewer(true))).toHaveLength(3);
	});
	it('filters by team, category and user', async () => {
		const { g, viewer, theirs, cat, you } = await world();
		expect(await listPhotos(g, viewer(true), { team: theirs })).toHaveLength(2);
		expect(await listPhotos(g, viewer(true), { cat })).toHaveLength(3);
		expect(await listPhotos(g, viewer(true), { cat: cat + 99 })).toHaveLength(0);
		expect(await listPhotos(g, viewer(true), { user: you })).toHaveLength(2);
	});
	it('filters by calendar day in the game time zone', async () => {
		const { g, viewer, own } = await world();
		// 03:00 UTC on the 5th is still the 4th in New York.
		await run('UPDATE photo SET created_at = ? WHERE id = ?', Date.UTC(2026, 6, 5, 3), own);
		expect(dayOf(Date.UTC(2026, 6, 5, 3))).toBe('2026-07-04');
		expect((await listPhotos(g, viewer(true), { day: '2026-07-04' })).map((p) => p.id)).toEqual([own]);
		expect(await listPhotos(g, viewer(true), { day: '2026-07-05' })).toHaveLength(0);
	});
	it('orders newest first, or oldest first on request', async () => {
		const { g, viewer } = await world();
		const desc = (await listPhotos(g, viewer(true))).map((p) => p.created_at);
		expect(desc).toEqual([...desc].sort((a, b) => b - a));
		const asc = (await listPhotos(g, viewer(true), { oldestFirst: true })).map((p) => p.created_at);
		expect(asc).toEqual([...asc].sort((a, b) => a - b));
	});
	it('onePhoto is scoped to its game', async () => {
		const { g, own } = await world();
		expect((await onePhoto(g.id, own))!.id).toBe(own);
		expect(await onePhoto(g.id + 999, own)).toBeUndefined();
	});
});

describe('browseFilter', () => {
	const u = (s: string) => new URL(`https://x.test/g/A/gallery${s}`);
	it('reads filters from the URL', () => {
		expect(browseFilter(u('?cat=1&team=2&user=3&day=2026-07-04'), false)).toEqual({ cat: 1, team: 2, user: 3, day: '2026-07-04', unscored: false });
	});
	it('ignores junk numbers', () => {
		expect(browseFilter(u('?cat=abc&team=-0'), false)).toMatchObject({ cat: undefined, team: undefined });
	});
	it('lets only hosts filter to unscored photos', () => {
		expect(browseFilter(u('?unscored=1'), true).unscored).toBe(true);
		expect(browseFilter(u('?unscored=1'), false).unscored).toBe(false);
	});
});

describe('uploads', () => {
	const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(0)])], 'a.jpg', { type: 'image/jpeg' });
	const upload = (o: Record<string, FormDataEntryValue | null> = {}) => {
		const f = new FormData();
		const all: Record<string, FormDataEntryValue | null> = { photo: jpeg(), thumb: jpeg(), large: jpeg(), width: '800', height: '600', ...o };
		for (const [k, v] of Object.entries(all)) if (v !== null) f.set(k, v);
		return f;
	};
	async function world(o: { team?: boolean; host?: boolean; open?: boolean } = {}) {
		const g0 = await mkGame();
		const team = await mkTeam(g0.id);
		const user = await mkUser();
		await mkMember(g0.id, user, team);
		const cat = await mkCategory(g0.id);
		if (o.open === false) await run('UPDATE game SET submissions_open = 0 WHERE id = ?', g0.id);
		const g = await game(g0.id);
		const viewer: Viewer = { user: { id: user } as never, teamId: o.team === false ? null : team, isHost: !!o.host };
		return { g, viewer, cat, user, team, category: (await categoryIn(g.id, cat))! };
	}
	const count = async () => (await get<{ n: number }>('SELECT COUNT(*) AS n FROM photo'))!.n;

	it('files a photo in a category and stores its three files', async () => {
		const { g, viewer, category, team, user } = await world();
		expect(await savePhotos(g, viewer, upload({ caption: ' nice ' }), category)).toEqual({ added: 1 });
		const p = (await get<any>('SELECT * FROM photo'))!;
		expect(p).toMatchObject({ category_id: category.id, team_id: team, user_id: user, caption: 'nice', ext: 'jpg', width: 800, height: 600, status: 'ok' });
		expect((await env.PHOTOS.list({ prefix: `photos/${p.id}/` })).objects).toHaveLength(3);
	});
	it('drops the photo into the unsorted pile without a category', async () => {
		const { g, viewer, user } = await world();
		await savePhotos(g, viewer, upload(), null);
		expect((await unsortedFor(g.id, user)).length).toBe(1);
	});
	it('never stores a player’s own claim', async () => {
		const { g, viewer, category, cat } = await world();
		const o = await mkOption(cat, 5);
		await savePhotos(g, viewer, upload({ tier: String(o) }), category);
		expect(await all('SELECT * FROM photo_claim')).toEqual([]);
	});
	it('stores a host’s claim', async () => {
		const { g, viewer, category, cat } = await world({ host: true });
		const o = await mkOption(cat, 5);
		await savePhotos(g, viewer, upload({ tier: String(o) }), category);
		expect(await all('SELECT option_id FROM photo_claim')).toEqual([{ option_id: o }]);
	});
	it('refuses people without a team', async () => {
		const { g, viewer, category } = await world({ team: false });
		expect(await savePhotos(g, viewer, upload(), category)).toMatchObject({ status: 400 });
		expect(await count()).toBe(0);
	});
	it('refuses when submissions are closed', async () => {
		const { g, viewer, category } = await world({ open: false });
		expect(await savePhotos(g, viewer, upload(), category)).toMatchObject({ status: 400 });
		expect(await count()).toBe(0);
	});
	it('refuses an inactive category', async () => {
		const { g, viewer, category } = await world();
		expect(await savePhotos(g, viewer, upload(), { ...category, active: 0 })).toMatchObject({ status: 400 });
	});
	it.each([
		['no photo', { photo: null }],
		['no thumbnail', { thumb: null }],
		['no large copy', { large: null }],
		['an empty file', { photo: new File([], 'x.jpg') }],
		['a non-image', { photo: new File(['<?php ?>'], 'x.jpg', { type: 'image/jpeg' }) }],
		['a thumbnail that is not a JPEG', { thumb: new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])], 't.png') }]
	])('refuses %s', async (_n, o) => {
		const { g, viewer, category } = await world();
		expect(await savePhotos(g, viewer, upload(o), category)).toMatchObject({ status: 400 });
		expect(await count()).toBe(0);
	});
	it('clamps absurd dimensions', async () => {
		const { g, viewer, category } = await world();
		await savePhotos(g, viewer, upload({ width: '9999999', height: '-5' }), category);
		expect(await get('SELECT width, height FROM photo')).toEqual({ width: 100000, height: 1 });
	});
	it('stops at the photo limit, but not for games a site admin made', async () => {
		const { g, viewer, category } = await world();
		await saveSettings({ maxPhotos: 1 });
		expect(await savePhotos(g, viewer, upload(), category)).toEqual({ added: 1 });
		expect(await savePhotos(g, viewer, upload(), category)).toMatchObject({ status: 400 });
		const admin = await mkUser({ admin: true });
		await run('UPDATE game SET created_by = ? WHERE id = ?', admin, g.id);
		expect(await savePhotos(g, viewer, upload(), category)).toEqual({ added: 1 });
	});
	it('removes the row when R2 fails', async () => {
		const { g, viewer, category } = await world();
		const put = vi.spyOn(env.PHOTOS, 'put').mockRejectedValue(new Error('r2 down'));
		try {
			expect(await savePhotos(g, viewer, upload(), category)).toMatchObject({ status: 400 });
		} finally {
			put.mockRestore();
		}
		expect(await count()).toBe(0);
	});
	it('categoryIn will not find a category from another game', async () => {
		const { g, cat } = await world();
		const other = await mkGame();
		expect(await categoryIn(other.id, cat)).toBeUndefined();
		expect(await categoryIn(g.id, 'abc')).toBeUndefined();
	});
	it('fileInto moves a photo, clears claims and restamps an unsorted photo', async () => {
		const { g, cat, team, user } = await world();
		const p = await mkPhoto(g, { cat: null, team, user });
		const o = await mkOption(cat, 3);
		await claim(p, o);
		await run('UPDATE photo SET created_at = 5 WHERE id = ?', p);
		await fileInto(p, cat, true);
		const row = (await get<any>('SELECT category_id, created_at FROM photo WHERE id = ?', p))!;
		expect(row.category_id).toBe(cat);
		expect(row.created_at).toBeGreaterThan(5);
		expect(await all('SELECT * FROM photo_claim WHERE photo_id = ?', p)).toEqual([]);
	});
	it('fileInto keeps the timestamp of an already-filed photo', async () => {
		const { g, cat, team, user } = await world();
		const p = await mkPhoto(g, { cat, team, user });
		await run('UPDATE photo SET created_at = 5 WHERE id = ?', p);
		await fileInto(p, cat, false);
		expect((await get<any>('SELECT created_at FROM photo WHERE id = ?', p)).created_at).toBe(5);
	});
});
