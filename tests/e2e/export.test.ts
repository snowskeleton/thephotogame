import { describe, expect, it } from 'vitest';
import { exec, get, photo, useCleanSite, world } from './helpers.ts';

useCleanSite();

describe('export subsets', () => {
	it('lists winners for hosts only and rejects unknown sets', async () => {
		const w = await world();
		const p1 = await photo(w.g, { cat: w.cat.id, team: w.tA, user: w.alice.id });
		await photo(w.g, { cat: w.cat.id, team: w.tB, user: w.bob.id });
		const award = (await exec("INSERT INTO award (game_id, name, points, scope, status) VALUES (?, 'Best', 5, 'game', 'closed')", w.g.id)).last_row_id;
		await exec('INSERT INTO vote (award_id, photo_id, user_id) VALUES (?, ?, ?)', award, p1, w.bob.id);

		const url = `/g/${w.g.code}/admin/download`;
		expect((await get(`${url}?set=winners`, { cookie: w.cookie.alice })).status).toBeGreaterThanOrEqual(400);
		const r = await get(`${url}?set=winners`, { cookie: w.cookie.host });
		expect(r.status).toBe(200);
		const body = (await r.json()) as { zip: string; files: { url: string; name: string }[] };
		expect(body.zip).toContain('winners');
		expect(body.files.map((f) => f.url)).toEqual([`/media/${p1}/original`]);
		expect(body.files[0].name.startsWith('Best/')).toBe(true);

		const v = (await (await get(`${url}?set=voted`, { cookie: w.cookie.host })).json()) as { files: { url: string }[] };
		expect(v.files.map((f) => f.url)).toEqual([`/media/${p1}/original`]);
		expect((await get(`${url}?set=nonsense`, { cookie: w.cookie.host })).status).toBe(400);
		expect((await get(`${url}?set=team:999999`, { cookie: w.cookie.host })).status).toBe(404);
		expect(((await (await get(url, { cookie: w.cookie.host })).json()) as any).files).toHaveLength(2);
	});
});
