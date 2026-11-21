import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { exec, get, loc, one, post, sql, user, useCleanSite, world } from './helpers.ts';

useCleanSite();

/** The Worker only stores a hash of the emailed code, and there are a million of them: find it by hashing. */
async function codeFor(email: string) {
	const row = await one<{ code_hash: string }>('SELECT code_hash FROM login_code WHERE email = ?', email);
	if (!row) throw new Error(`no code was issued for ${email}`);
	for (let i = 0; i < 1_000_000; i++) {
		const c = String(i).padStart(6, '0');
		if (createHash('sha256').update(c).digest('hex') === row.code_hash) return c;
	}
	throw new Error('code not found');
}
const cookieFrom = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('pg_session='));

describe('sign in with an emailed code', () => {
	it('signs an existing person in and lands them on the page they wanted', async () => {
		const u = await user({ email: 'amy@example.com' });
		const r1 = await post('/login', { email: 'AMY@example.com', next: '/g/ABC' });
		expect(loc(r1)).toContain('/login/code?email=amy%40example.com&next=%2Fg%2FABC');
		const r2 = await post('/login/code?/verify', { email: 'amy@example.com', code: await codeFor('amy@example.com'), next: '/g/ABC' });
		expect(r2.status).toBe(303);
		expect(decodeURIComponent(loc(r2)!)).toContain('/g/ABC');
		const cookie = cookieFrom(r2)!;
		expect(cookie).toBeTruthy();
		expect((await get('/', { cookie })).status).toBeLessThan(400);
		expect(await one('SELECT user_id FROM session')).toEqual({ user_id: u.id });
	});
	it('rejects a wrong code and sets no session', async () => {
		await user({ email: 'amy@example.com' });
		await post('/login', { email: 'amy@example.com' });
		const real = await codeFor('amy@example.com');
		const r = await post('/login/code?/verify', { email: 'amy@example.com', code: real === '123456' ? '654321' : '123456' });
		expect(r.status).toBe(400);
		expect(cookieFrom(r)).toBeUndefined();
		expect(await sql('SELECT * FROM session')).toEqual([]);
	});
	it('rejects a malformed email', async () => {
		expect((await post('/login', { email: 'not an email' })).status).toBe(400);
	});
	it('does not redirect to another site after sign-in', async () => {
		await user({ email: 'amy@example.com' });
		await post('/login', { email: 'amy@example.com' });
		const r = await post('/login/code?/verify', { email: 'amy@example.com', code: await codeFor('amy@example.com'), next: '//evil.example' });
		expect(loc(r)).not.toContain('evil.example');
	});
	it('creates a new account only after the code is entered', async () => {
		const r1 = await post('/login', { email: 'new@example.com', name: 'Newcomer' });
		expect(r1.status).toBe(303);
		expect(await sql("SELECT * FROM user WHERE email = 'new@example.com'")).toEqual([]);
		const r2 = await post('/login/code?/verify', { email: 'new@example.com', code: await codeFor('new@example.com') });
		expect(cookieFrom(r2)).toBeTruthy();
		expect(await one("SELECT name, is_admin, email_verified_at IS NOT NULL AS verified FROM user WHERE email = 'new@example.com'")).toEqual({ name: 'Newcomer', is_admin: 0, verified: 1 });
	});
	it('asks a new person for their name first', async () => {
		const r = await post('/login', { email: 'new@example.com' });
		expect(r.status).toBe(400);
		expect(await sql('SELECT * FROM login_code')).toEqual([]);
	});
	it('turns the owner’s email into the site admin', async () => {
		await post('/login', { email: 'owner@example.com', name: 'Owner' });
		await post('/login/code?/verify', { email: 'owner@example.com', code: await codeFor('owner@example.com') });
		expect((await one("SELECT is_admin FROM user WHERE email = 'owner@example.com'"))!.is_admin).toBe(1);
	});
	it('refuses new sign-ups when they are closed, except for the owner', async () => {
		await exec("INSERT INTO setting (key, value) VALUES ('signups', '0')");
		expect((await post('/login', { email: 'stranger@example.com', name: 'S' })).status).toBe(400);
		expect((await post('/login', { email: 'owner@example.com', name: 'Owner' })).status).toBe(303);
	});
});

describe('joining a game from its link', () => {
	it('shows the join page to signed-out visitors', async () => {
		const { g } = await world();
		expect((await get(`/join/${g.code}`)).status).toBe(200);
	});
	it('creates an unverified player, signs them in and adds them to the game', async () => {
		const { g } = await world();
		const r = await post(`/join/${g.code}`, { name: 'Dana', email: 'dana@example.com' });
		expect(r.status).toBe(303);
		expect(cookieFrom(r)).toBeTruthy();
		expect(await one("SELECT u.name, u.email_verified_at AS v, m.status, m.role, m.team_id FROM user u JOIN member m ON m.user_id = u.id WHERE u.email = 'dana@example.com'"))
			.toEqual({ name: 'Dana', v: null, status: 'active', role: 'player', team_id: null });
	});
	it('makes an existing email prove itself with a code instead of signing in', async () => {
		const { g } = await world();
		await user({ email: 'dana@example.com' });
		const r = await post(`/join/${g.code}`, { name: 'Dana', email: 'dana@example.com' });
		expect(loc(r)).toContain('/login/code?known=1');
		expect(cookieFrom(r)).toBeUndefined();
	});
	it('requires a name and a valid email', async () => {
		const { g } = await world();
		expect((await post(`/join/${g.code}`, { name: '', email: 'a@example.com' })).status).toBe(400);
		expect((await post(`/join/${g.code}`, { name: 'A', email: 'nope' })).status).toBe(400);
	});
	it('adds an already-signed-in person just by opening the link', async () => {
		const { g } = await world();
		const u = await user();
		const { session } = await import('./helpers.ts');
		const r = await get(`/join/${g.code}`, { cookie: await session(u.id) });
		expect(loc(r)).toBe(`/g/${g.code}`);
		expect((await one('SELECT status FROM member WHERE user_id = ?', u.id))!.status).toBe('active');
	});
	it('activates someone who was only invited', async () => {
		const { g } = await world();
		const u = await user();
		await exec("INSERT INTO member (game_id, user_id, status) VALUES (?, ?, 'invited')", g.id, u.id);
		const { session } = await import('./helpers.ts');
		await get(`/join/${g.code}`, { cookie: await session(u.id) });
		expect((await one('SELECT status FROM member WHERE user_id = ?', u.id))!.status).toBe('active');
	});
	it('404s on a bad code', async () => {
		expect((await get('/join/NOPE')).status).toBe(404);
	});
});

describe('home page', () => {
	it('finds a game by its code and rejects unknown codes', async () => {
		const { g, cookie } = await world();
		expect(loc(await post('/?/join', { code: g.code.toLowerCase() }, { cookie: cookie.alice }))).toBe(`/join/${g.code}`);
		expect((await post('/?/join', { code: 'NOPE' }, { cookie: cookie.alice })).status).toBe(400);
	});
	it('lets a verified person start a game and makes them its host', async () => {
		const u = await user();
		const { session } = await import('./helpers.ts');
		const r = await post('/?/newGame', { name: 'Fun' }, { cookie: await session(u.id) });
		const g = (await one<{ code: string; id: number }>("SELECT id, code FROM game WHERE name = 'Fun'"))!;
		expect(loc(r)).toBe(`/g/${g.code}/admin`);
		expect(await one('SELECT role FROM member WHERE game_id = ? AND user_id = ?', g.id, u.id)).toEqual({ role: 'host' });
	});
	it('refuses a fourth game', async () => {
		const u = await user();
		const { session } = await import('./helpers.ts');
		const cookie = await session(u.id);
		for (let i = 0; i < 3; i++) await post('/?/newGame', { name: `G${i}` }, { cookie });
		expect((await post('/?/newGame', { name: 'One too many' }, { cookie })).status).toBe(403);
		expect((await sql('SELECT * FROM game')).length).toBe(3);
	});
	it('refuses an unverified person', async () => {
		const u = await user({ verified: false });
		const { session } = await import('./helpers.ts');
		expect((await post('/?/newGame', { name: 'X' }, { cookie: await session(u.id) })).status).toBe(403);
	});
});
