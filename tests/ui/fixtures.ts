import { test as base, expect, type Page } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const state = () => JSON.parse(readFileSync(join(import.meta.dirname, '.run/state.json'), 'utf8')) as { persist: string; logPath: string; port: string };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
let n = 0;
const uniq = () => `${Date.now().toString(36)}${++n}`;

/** A real PNG (the browser decodes it and makes the thumbnail and screen copies itself). */
export function png(width = 96, height = 64, seed = 0): Buffer {
	const crc = (buf: Buffer) => {
		let c = ~0;
		for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
		return ~c >>> 0;
	};
	const chunk = (type: string, data: Buffer) => {
		const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type), data]);
		const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
		return Buffer.concat([len, body, sum]);
	};
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
	const rows: Buffer[] = [];
	for (let y = 0; y < height; y++) {
		const row = Buffer.alloc(1 + width * 3);
		for (let x = 0; x < width; x++) { row[1 + x * 3] = (x * 2 + seed * 40) & 255; row[2 + x * 3] = (y * 3) & 255; row[3 + x * 3] = (seed * 70) & 255; }
		rows.push(row);
	}
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

export type Site = ReturnType<typeof makeSite>;

function makeSite(baseURL: string) {
	const { persist, logPath } = state();
	const dir = join(persist, 'v3/d1/miniflare-D1DatabaseObject');
	const file = readdirSync(dir).find((f) => f.endsWith('.sqlite') && !f.startsWith('metadata'));
	if (!file) throw new Error('The Worker has not created its database yet');
	const db = new DatabaseSync(join(dir, file), { timeout: 10_000 });
	const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as any[];
	const one = (sql: string, ...p: any[]) => all(sql, ...p)[0];
	const exec = (sql: string, ...p: any[]) => Number(db.prepare(sql).run(...p).lastInsertRowid);

	const site = {
		baseURL, all, one, exec,
		user(o: { name?: string; email?: string; admin?: boolean; verified?: boolean } = {}) {
			const email = o.email ?? `u${uniq()}@example.com`;
			const id = exec('INSERT INTO user (email, name, is_admin, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?)', email, o.name ?? 'Person', o.admin ? 1 : 0, o.verified === false ? null : Date.now(), Date.now());
			return { id, email, name: o.name ?? 'Person' };
		},
		game(o: { visibility?: string; team_mode?: string; bingo?: number } = {}) {
			const code = `U${uniq()}`.toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(10, 'X').slice(0, 10);
			const id = exec('INSERT INTO game (code, name, visibility, team_mode, bingo, bingo_cols, created_at) VALUES (?, ?, ?, ?, ?, 2, ?)', code, 'UI Game', o.visibility ?? 'hidden', o.team_mode ?? 'admin', o.bingo ?? 0, Date.now());
			return { id, code };
		},
		// Tests share one database, so queries are scoped to the test's own game.
		photos: (gameId: number) => all('SELECT * FROM photo WHERE game_id = ? ORDER BY id', gameId),
		claims: (gameId: number) => all('SELECT c.* FROM photo_claim c JOIN photo p ON p.id = c.photo_id WHERE p.game_id = ?', gameId),
		grants: (gameId: number) => all('SELECT * FROM grant_award WHERE game_id = ?', gameId),
		team: (gameId: number, name: string, color = '#d33a3a') => exec('INSERT INTO team (game_id, name, color) VALUES (?, ?, ?)', gameId, name, color),
		member: (gameId: number, userId: number, teamId: number | null, role = 'player') =>
			exec("INSERT INTO member (game_id, user_id, team_id, role, status) VALUES (?, ?, ?, ?, 'active')", gameId, userId, teamId, role),
		category(gameId: number, name: string, points = 5) {
			const id = exec('INSERT INTO category (game_id, name, sort) VALUES (?, ?, ?)', gameId, name, ++n);
			const option = exec("INSERT INTO score_option (category_id, label, points, kind) VALUES (?, 'Found it', ?, 'tier')", id, points);
			return { id, option, name };
		},
		/** A signed-in browser session for this person. */
		session(userId: number) {
			const token = randomBytes(24).toString('base64url');
			exec('INSERT INTO session (token, user_id, expires_at) VALUES (?, ?, ?)', sha(token), userId, Date.now() + 86400_000);
			return token;
		},
		async signIn(page: Page, userId: number) {
			await page.context().addCookies([{ name: 'pg_session', value: site.session(userId), url: baseURL }]);
		},
		/** The six-digit code the Worker printed for this address (it is only stored hashed). */
		async codeFor(email: string) {
			for (let i = 0; i < 50; i++) {
				const log = readFileSync(logPath, 'utf8');
				const hits = [...log.matchAll(new RegExp(`\\[mail not configured\\] to=${email.replace(/[.+]/g, '\\$&')} subject=(\\d{6}) is your`, 'g'))];
				if (hits.length) return hits.at(-1)![1];
				await new Promise((r) => setTimeout(r, 200));
			}
			throw new Error(`No sign-in code was printed for ${email}`);
		},
		/** Posts a photo to the real upload action (as the app's uploader does) so tests have photos without clicking through. */
		async upload(userId: number, code: string, o: { category?: number; caption?: string; seed?: number; file?: Buffer } = {}) {
			const token = site.session(userId);
			const jpeg = await site.jpeg();
			const fd = new FormData();
			fd.set('photo', new Blob([new Uint8Array(o.file ?? png(96, 64, o.seed ?? 0))], { type: 'image/png' }), 'p.png');
			fd.set('thumb', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'thumb.jpg');
			fd.set('large', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'large.jpg');
			fd.set('width', '96'); fd.set('height', '64');
			if (o.caption) fd.set('caption', o.caption);
			const before = one('SELECT COALESCE(MAX(id), 0) AS m FROM photo').m;
			const res = await fetch(`${baseURL}/g/${code}?/upload`, {
				method: 'POST', body: fd, headers: { cookie: `pg_session=${token}`, origin: baseURL, accept: 'application/json', 'x-sveltekit-action': 'true' }
			});
			const id = one('SELECT MAX(id) AS m FROM photo').m;
			if (!res.ok || id === before) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
			if (o.category) exec('UPDATE photo SET category_id = ?, created_at = ? WHERE id = ?', o.category, Date.now() + id, id);
			return id as number;
		},
		_jpeg: undefined as Buffer | undefined,
		async jpeg() {
			// A small valid JPEG, made by Chromium itself so it is certain to decode.
			if (site._jpeg) return site._jpeg;
			const { chromium } = await import('@playwright/test');
			const b = await chromium.launch();
			const p = await b.newPage();
			const b64 = await p.evaluate(() => {
				const c = document.createElement('canvas'); c.width = 48; c.height = 32;
				const g = c.getContext('2d')!; g.fillStyle = '#c33'; g.fillRect(0, 0, 48, 32); g.fillStyle = '#39c'; g.fillRect(8, 8, 32, 16);
				return c.toDataURL('image/jpeg', 0.8).split(',')[1];
			});
			await b.close();
			return (site._jpeg = Buffer.from(b64, 'base64'));
		}
	};
	return site;
}

/** A game with a host (on Reds), Alice (Reds), Bob (Blues) and two categories. */
export type World = ReturnType<typeof buildWorld>;
export function buildWorld(site: Site, o: Parameters<Site['game']>[0] = {}) {
	const g = site.game(o);
	const reds = site.team(g.id, 'Reds', '#d33a3a');
	const blues = site.team(g.id, 'Blues', '#2f6fd3');
	const host = site.user({ name: 'Hannah Host' });
	const alice = site.user({ name: 'Alice' });
	const bob = site.user({ name: 'Bob' });
	site.member(g.id, host.id, reds, 'host');
	site.member(g.id, alice.id, reds);
	site.member(g.id, bob.id, blues);
	const hats = site.category(g.id, 'Silly hats', 5);
	const dogs = site.category(g.id, 'Dogs', 3);
	return { g, reds, blues, host, alice, bob, hats, dogs };
}

export const test = base.extend<{ site: Site; world: World; guard: void }>({
	site: async ({ baseURL }, use) => {
		// The first request makes the Worker apply its migrations; the database file exists after that.
		await fetch(`${baseURL}/login`);
		await use(makeSite(baseURL!));
	},
	world: async ({ site }, use) => use(buildWorld(site)),
	// Every test fails on a JS error in the page, a failed script/API request, a 5xx, or a server/client error the app logged.
	guard: [
		async ({ page, site }, use) => {
			const problems: string[] = [];
			const before = site.one("SELECT COALESCE(MAX(id), 0) AS m FROM event WHERE kind IN ('server_error', 'client_error', 'api_error')").m;
			page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
			page.on('console', (m) => {
				if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console.error: ${m.text()}`);
			});
			page.on('response', (r) => { if (r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
			await use();
			await page.waitForTimeout(150);
			const logged = site.all("SELECT kind, message, path FROM event WHERE id > ? AND kind IN ('server_error', 'client_error', 'api_error')", before);
			for (const e of logged) problems.push(`app logged ${e.kind} at ${e.path}: ${e.message}`);
			expect(problems, 'errors seen while the test ran').toEqual([]);
		},
		{ auto: true }
	]
});
export { expect };
