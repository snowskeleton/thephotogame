import { describe, expect, it } from 'vitest';
import { exec, get, loc, one, post, session, sql, user, useCleanSite, world } from './helpers.ts';

useCleanSite();

describe('public pages', () => {
	it('serve the sign-in page and robots.txt', async () => {
		expect((await get('/login')).status).toBe(200);
		expect((await get('/robots.txt')).status).toBe(200);
	});
	it('answer icon probes without touching the database', async () => {
		const r = await get('/apple-touch-icon-precomposed.png');
		expect(r.status).toBe(404);
		expect(r.headers.get('cache-control')).toContain('max-age=86400');
	});
	it('send a visitor with an unknown game code to a 404', async () => {
		expect((await get('/g/NOSUCHGAME/gallery', { cookie: await session((await user()).id) })).status).toBe(404);
	});
});

describe('cross-site protection', () => {
	it('rejects a form post with a foreign Origin', async () => {
		const { cookie, g } = await world();
		const r = await post(`/g/${g.code}?/joinTeam`, {}, { cookie: cookie.alice, origin: 'https://evil.example' });
		expect(r.status).toBe(403);
	});
	it('rejects a form post without an Origin', async () => {
		const r = await post('/login', { email: 'a@example.com' }, { origin: null });
		expect(r.status).toBe(403);
	});
});

describe('who can open what', () => {
	it('sends signed-out visitors to the join page', async () => {
		const { g } = await world();
		const r = await get(`/g/${g.code}`);
		expect(r.status).toBe(303);
		expect(loc(r)).toBe(`/join/${g.code}`);
	});
	it('sends strangers who are signed in to the join page too', async () => {
		const { g } = await world();
		const r = await get(`/g/${g.code}`, { cookie: await session((await user()).id) });
		expect(loc(r)).toBe(`/join/${g.code}`);
	});
	it('lets players into their game', async () => {
		const { g, cookie } = await world();
		expect((await get(`/g/${g.code}`, { cookie: cookie.alice })).status).toBe(200);
		expect((await get(`/g/${g.code}/gallery`, { cookie: cookie.alice })).status).toBe(200);
		expect((await get(`/g/${g.code}/scores`, { cookie: cookie.alice })).status).toBe(200);
	});
	it('keeps players out of the host pages', async () => {
		const { g, cookie } = await world();
		for (const p of ['admin', 'admin/categories', 'admin/teams', 'admin/awards'])
			expect((await get(`/g/${g.code}/${p}`, { cookie: cookie.alice })).status, p).toBe(403);
	});
	it('lets the host into the host pages', async () => {
		const { g, cookie } = await world();
		for (const p of ['admin', 'admin/categories', 'admin/teams', 'admin/awards'])
			expect((await get(`/g/${g.code}/${p}`, { cookie: cookie.host })).status, p).toBe(200);
	});
	it('sends a signed-out visitor from a host page to the join page', async () => {
		const { g } = await world();
		expect(loc(await get(`/g/${g.code}/admin`))).toBe(`/join/${g.code}`);
	});
	it('keeps a host of one game out of another game’s host pages', async () => {
		const a = await world();
		const b = await world();
		expect(loc(await get(`/g/${b.g.code}/admin`, { cookie: a.cookie.host }))).toBe(`/join/${b.g.code}`);
	});
	it('keeps non-admins out of site admin pages and lets admins in', async () => {
		const { cookie } = await world();
		expect((await get('/admin', { cookie: cookie.host })).status).toBe(403);
		expect((await get('/admin/users', { cookie: cookie.host })).status).toBe(403);
		expect((await get('/admin/settings', { cookie: cookie.host })).status).toBe(403);
		const admin = await session((await user({ admin: true })).id);
		expect((await get('/admin', { cookie: admin })).status).toBe(200);
		expect((await get('/admin/settings', { cookie: admin })).status).toBe(200);
	});
	it('lets a site admin into any game', async () => {
		const { g } = await world();
		const admin = await session((await user({ admin: true })).id);
		expect((await get(`/g/${g.code}/admin`, { cookie: admin })).status).toBe(200);
	});
	it('rejects an expired session', async () => {
		const { g, alice } = await world();
		const cookie = await session(alice.id);
		await exec('UPDATE session SET expires_at = 1');
		expect(loc(await get(`/g/${g.code}`, { cookie }))).toBe(`/join/${g.code}`);
	});
	it('stops working after logout', async () => {
		const { g, cookie } = await world();
		expect((await post('/logout', {}, { cookie: cookie.alice })).status).toBeLessThan(400);
		expect(loc(await get(`/g/${g.code}`, { cookie: cookie.alice }))).toBe(`/join/${g.code}`);
		expect((await sql('SELECT * FROM session')).length).toBe(2);
	});
});

describe('errors are logged', () => {
	it('records an unexpected server error with its stack, and keeps 404s out of the log', async () => {
		const { g, cookie } = await world();
		await get('/g/NOSUCHGAME', { cookie: cookie.alice });
		expect(await sql("SELECT * FROM event WHERE kind = 'server_error'")).toEqual([]);
		await exec('ALTER TABLE category RENAME TO category_x');
		try {
			const r = await get(`/g/${g.code}`, { cookie: cookie.alice });
			expect(r.status).toBe(500);
		} finally {
			await exec('ALTER TABLE category_x RENAME TO category');
		}
		const e = await one("SELECT * FROM event WHERE kind = 'server_error'");
		expect(e).toMatchObject({ level: 'error', path: `/g/${g.code}`, status: 500 });
		expect(e.detail).toContain('category');
	});
	it('accepts browser error reports and rate-limits them', async () => {
		const r = await fetchJson('/client-error', { message: 'TypeError: x', page: '/g/A', source: 'app.js', line: 1, stack: 's' });
		expect(r.status).toBe(200);
		expect(await one("SELECT message, path FROM event WHERE kind = 'client_error'")).toEqual({ message: 'TypeError: x', path: '/g/A' });
		for (let i = 0; i < 40; i++) await fetchJson('/client-error', { message: `m${i}` });
		expect((await sql("SELECT * FROM event WHERE kind = 'client_error'")).length).toBe(30);
	});
	it('does not choke on junk in a browser error report', async () => {
		const r = await post('/client-error', {}, { headers: { 'content-type': 'text/plain' } });
		expect(r.status).toBe(200);
	});
});

import { SELF } from 'cloudflare:test';
const fetchJson = (path: string, body: unknown) =>
	SELF.fetch(`https://t.test${path}`, { method: 'POST', headers: { origin: 'https://t.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
