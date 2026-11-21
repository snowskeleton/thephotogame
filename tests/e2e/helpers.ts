import { createHash, randomBytes } from 'node:crypto';
import { env, SELF } from 'cloudflare:test';
import { beforeEach } from 'vitest';

export const BASE = 'https://t.test';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const db = () => env.DB;

/** Empties the data tables before each test. The Worker applies migrations itself on its first request. */
export const useCleanSite = () =>
	beforeEach(async () => {
		await SELF.fetch(`${BASE}/robots.txt`);
		await SELF.fetch(`${BASE}/login`); // first request applies the migrations
		for (const t of ['game', 'user', 'setting', 'event', 'login_code', 'score_cache'])
			await db().prepare(`DELETE FROM ${t}`).run();
		const left = await Promise.all(['photos/'].map((p) => env.PHOTOS.list({ prefix: p })));
		for (const l of left) if (l.objects.length) await env.PHOTOS.delete(l.objects.map((o) => o.key));
	});

export const sql = async <T = any>(query: string, ...p: unknown[]) => (await db().prepare(query).bind(...p).all<T>()).results;
export const one = async <T = any>(query: string, ...p: unknown[]) => (await sql<T>(query, ...p))[0] as T | undefined;
export const exec = async (query: string, ...p: unknown[]) => (await db().prepare(query).bind(...p).run()).meta;

// ---- seeding -------------------------------------------------------------------------------

let n = 0;
export const user = async (o: { admin?: boolean; verified?: boolean; name?: string; email?: string } = {}) => {
	const email = o.email ?? `u${Date.now()}x${++n}@example.com`;
	const id = (await exec('INSERT INTO user (email, name, is_admin, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?)',
		email, o.name ?? `Person ${n}`, o.admin ? 1 : 0, o.verified === false ? null : Date.now(), Date.now())).last_row_id as number;
	return { id, email };
};

/** A signed-in browser session for this user; returns a Cookie header value. */
export const session = async (userId: number) => {
	const token = randomBytes(24).toString('base64url');
	await exec('INSERT INTO session (token, user_id, expires_at) VALUES (?, ?, ?)', sha(token), userId, Date.now() + 86400_000);
	return `pg_session=${token}`;
};

export const game = async (o: { visibility?: 'hidden' | 'open'; revealed_at?: number; team_mode?: string; max_team_size?: number | null } = {}) => {
	const code = `T${Date.now()}${++n}`.slice(-10).toUpperCase().padStart(10, 'A');
	const id = (await exec(
		'INSERT INTO game (code, name, visibility, revealed_at, team_mode, max_team_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
		code, 'Test game', o.visibility ?? 'hidden', o.revealed_at ?? 0, o.team_mode ?? 'admin', o.max_team_size ?? null, Date.now()
	)).last_row_id as number;
	return { id, code };
};
export const team = async (gameId: number, name = 'Team') => (await exec('INSERT INTO team (game_id, name, color) VALUES (?, ?, ?)', gameId, name, '#336699')).last_row_id as number;
export const member = (gameId: number, userId: number, teamId: number | null, role = 'player', status = 'active') =>
	exec('INSERT INTO member (game_id, user_id, team_id, role, status) VALUES (?, ?, ?, ?, ?)', gameId, userId, teamId, role, status);
export const category = async (gameId: number, o: { name?: string; points?: number } = {}) => {
	const id = (await exec('INSERT INTO category (game_id, name, sort) VALUES (?, ?, ?)', gameId, o.name ?? 'Cat', ++n)).last_row_id as number;
	const option = (await exec("INSERT INTO score_option (category_id, label, points, kind) VALUES (?, 'Found it', ?, 'tier')", id, o.points ?? 5)).last_row_id as number;
	return { id, option };
};
export const photo = async (g: { id: number }, o: { cat: number | null; team: number; user: number; status?: string; created_at?: number }) => {
	const id = (await exec(
		'INSERT INTO photo (game_id, category_id, user_id, team_id, ext, width, height, status, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)',
		g.id, o.cat, o.user, o.team, 'jpg', o.status ?? 'ok', o.created_at ?? Date.now()
	)).last_row_id as number;
	for (const s of ['original', 'thumb', 'large']) await env.PHOTOS.put(`photos/${id}/${s}.jpg`, new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { httpMetadata: { contentType: 'image/jpeg' } });
	return id;
};

/** A game with a host, two teams of one player each, and one category. */
export const world = async (o: Parameters<typeof game>[0] = {}) => {
	const g = await game(o);
	const [tA, tB] = [await team(g.id, 'Reds'), await team(g.id, 'Blues')];
	const host = await user({ name: 'Host' });
	const alice = await user({ name: 'Alice' });
	const bob = await user({ name: 'Bob' });
	await member(g.id, host.id, tA, 'host');
	await member(g.id, alice.id, tA);
	await member(g.id, bob.id, tB);
	const cat = await category(g.id);
	const cookie = { host: await session(host.id), alice: await session(alice.id), bob: await session(bob.id) };
	return { g, tA, tB, host, alice, bob, cat, cookie };
};

// ---- requests ------------------------------------------------------------------------------

type Init = { cookie?: string; headers?: Record<string, string> };
export const get = (path: string, o: Init = {}) =>
	SELF.fetch(BASE + path, { redirect: 'manual', headers: { ...(o.cookie ? { cookie: o.cookie } : {}), ...o.headers } });

/** A form POST like the browser sends it: urlencoded (or multipart if it holds files), with the same-origin header SvelteKit checks. */
export const post = (path: string, body: Record<string, string | string[] | Blob> = {}, o: Init & { origin?: string | null } = {}) => {
	const hasFile = Object.values(body).some((v) => v instanceof Blob);
	let payload: BodyInit;
	if (hasFile) {
		const f = new FormData();
		for (const [k, v] of Object.entries(body)) for (const x of [v].flat()) f.append(k, x as string | Blob);
		payload = f;
	} else {
		const p = new URLSearchParams();
		for (const [k, v] of Object.entries(body)) for (const x of [v].flat()) p.append(k, x as string);
		payload = p;
	}
	// Browsers send Accept: text/html, which makes SvelteKit answer with a real 303 instead of a JSON redirect.
	const headers: Record<string, string> = { accept: 'text/html', ...(o.cookie ? { cookie: o.cookie } : {}), ...o.headers };
	if (o.origin !== null) headers.origin = o.origin ?? BASE;
	return SELF.fetch(BASE + path, { method: 'POST', redirect: 'manual', headers, body: payload });
};

export const api = (path: string, token: string | null, o: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
	SELF.fetch(`${BASE}/api/v1/${path}`, {
		method: o.method ?? 'GET',
		redirect: 'manual',
		// JSON clients send a content type. Without one, SvelteKit's CSRF check rejects bodiless POST/PATCH/DELETE (see api.test.ts).
		headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', ...o.headers },
		body: o.body ? JSON.stringify(o.body) : undefined
	});

export const loc = (r: Response) => r.headers.get('location');

/** A minimal JPEG-looking file; the app only checks the first bytes. */
export const jpeg = (name = 'a.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(32).fill(7)])], name, { type: 'image/jpeg' });
