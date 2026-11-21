import { isHttpError, json, type RequestEvent } from '@sveltejs/kit';
import { cleanEmail, createUser, findUserByEmail, invitesLeft, INVITES_PER_DAY, sendInvite } from '#lib/server/auth.ts';
import { validColor } from '#lib/colors.ts';
import { all, batch, get, insert, now, q, run } from '#lib/server/db.ts';
import { createGame, gameByCode, intOrNull, num, positiveOrNull, str, type Game } from '#lib/server/game.ts';
import { remove } from '#lib/server/images.ts';
import { optionsFor } from '#lib/server/claims.ts';
import { actorFromToken, type Actor, type Scope } from '#lib/server/perms.ts';
import { scoreGame } from '#lib/server/scoring.ts';
import { saveSettings, settings } from '#lib/server/settings.ts';
import { listEvents, logEvent, summary } from '#lib/server/log.ts';
import { addWebhook, announce, listWebhooks, publicHook, testWebhook, updateWebhook } from '#lib/server/webhooks.ts';

/**
 * JSON API for API keys (see docs/API.md). Authenticated only by `Authorization: Bearer pgk_...`;
 * session cookies are ignored here. Every route names the scope it needs, and a key limited to one game
 * can't touch any other.
 */

class ApiError extends Error {
	constructor(public status: number, message: string) {
		super(message);
	}
}
const bad = (m: string) => new ApiError(400, m);
const missing = (m: string) => new ApiError(404, m);

type Ctx = { a: Actor; p: string[]; body: Record<string, unknown>; url: URL; origin: string };
type Route = { method: string; path: string; scope: Scope | Scope[]; game?: boolean; run: (c: Ctx) => unknown | Promise<unknown> };

const bool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
const theGame = (c: Ctx): Promise<Game> => gameByCode(c.p[1]);

async function findIn<T>(sql: string, id: string, gameId: number, what: string): Promise<T> {
	const r = await get<T>(sql, Number(id) || 0, gameId);
	if (!r) throw missing(`No such ${what}`);
	return r;
}

const gameJson = (g: Game) => ({
	code: g.code, name: g.name, visibility: g.visibility, revealed_at: g.revealed_at || null, team_mode: g.team_mode,
	max_team_size: g.max_team_size, submissions_open: !!g.submissions_open, doubt_limit: g.doubt_limit, bingo: !!g.bingo,
	bingo_cols: g.bingo_cols, bingo_line_points: g.bingo_line_points, bingo_board_points: g.bingo_board_points, created_at: g.created_at
});

async function categories(gameId: number) {
	const rows = await all<{ id: number; name: string; rules: string; notes: string; day_label: string; scoring_cap: number | null; max_points: number | null; sort: number; active: number }>(
		'SELECT id, name, rules, notes, day_label, scoring_cap, max_points, sort, active FROM category WHERE game_id = ? ORDER BY sort, id',
		gameId
	);
	return Promise.all(rows.map(async (c) => ({ ...c, active: !!c.active, options: await optionsFor(c.id) })));
}

const teams = (gameId: number) =>
	all(
		`SELECT t.id, t.name, t.color, (SELECT COUNT(*) FROM member m WHERE m.team_id = t.id) AS members,
			(SELECT COUNT(*) FROM photo p WHERE p.team_id = t.id) AS photos FROM team t WHERE t.game_id = ? ORDER BY t.id`,
		gameId
	);
const awardOf = (id: number) => get('SELECT id, name, description, points, scope, status FROM award WHERE id = ?', id);

async function invite(c: Ctx, game: { id: number; code: string; name: string } | null, u: { id: number; email: string; name: string }) {
	try {
		await sendInvite(u, c.origin, c.a.user, game);
		return true;
	} catch {
		return false; // The person is on the list; the invite can be resent later.
	}
}

const routes: Route[] = [
	{ method: 'GET', path: 'me', scope: [], run: async ({ a }) => ({
		user: { id: a.user.id, name: a.user.name, site_admin: !!a.user.is_admin },
		key: { name: a.key.name, scopes: [...a.scopes], game_id: a.gameId, expires_at: a.key.expires_at }
	}) },

	// ---- logs: server errors, failed sign-up checks, email failures, browser errors (site-wide keys only)
	{ method: 'GET', path: 'logs', scope: 'logs:read', run: async ({ url }) => {
		const qs = url.searchParams;
		const since = qs.get('since') ?? '';
		// `since` is a timestamp in ms, or a window like 30m, 6h, 2d.
		const m = since.match(/^(\d+)([mhd])$/);
		const sinceMs = m ? Date.now() - Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 'm' | 'h' | 'd'] : Number(since) || undefined;
		return listEvents({ level: qs.get('level') ?? undefined, kind: qs.get('kind') ?? undefined, since: sinceMs, limit: Number(qs.get('limit')) || 100 });
	} },
	{ method: 'GET', path: 'logs/summary', scope: 'logs:read', run: () => summary() },

	// ---- site (site admins only: these scopes can't be put on a game-limited key)
	{ method: 'GET', path: 'settings', scope: 'site:read', run: () => settings() },
	{ method: 'PUT', path: 'settings', scope: 'site:write', run: async ({ body }) => {
		const s: Record<string, unknown> = {};
		if ('signups' in body) s.signups = bool(body.signups);
		if ('maxGames' in body) s.maxGames = Math.max(0, Math.floor(num(body.maxGames)));
		if ('maxPhotos' in body) s.maxPhotos = Math.max(0, Math.floor(num(body.maxPhotos)));
		if ('mailFrom' in body) s.mailFrom = str(body.mailFrom, 200);
		await saveSettings(s);
		return settings();
	} },
	{ method: 'GET', path: 'people', scope: 'site:read', run: () =>
		all('SELECT id, name, email, is_admin, email_verified_at, created_at, last_seen_at FROM user ORDER BY name COLLATE NOCASE') },
	{ method: 'POST', path: 'people', scope: 'site:write', run: async (c) => {
		const name = str(c.body.name, 40);
		const email = cleanEmail(c.body.email);
		if (!name || !email) throw bad('name and a valid email are required');
		if (await findUserByEmail(email)) throw new ApiError(409, 'That email already has an account');
		const id = await createUser(email, name);
		const g = c.body.game ? await get<{ id: number; code: string; name: string }>('SELECT id, code, name FROM game WHERE code = ?', String(c.body.game)) : undefined;
		if (g) await run("INSERT OR IGNORE INTO member (game_id, user_id, status) VALUES (?, ?, 'invited')", g.id, id);
		return { id, name, email, invited: await invite(c, g ?? null, { id, email, name }) };
	} },
	{ method: 'POST', path: 'games', scope: 'site:write', run: async ({ a, body }) => {
		if (a.gameId) throw new ApiError(403, 'This key is limited to one game.');
		const name = str(body.name, 80);
		if (!name) throw bad('name is required');
		return gameJson(await gameByCode(await createGame(a.user as never, name)));
	} },

	// ---- games
	{ method: 'GET', path: 'games', scope: 'games:read', run: async ({ a }) =>
		(await all<Game>('SELECT * FROM game ORDER BY created_at DESC')).filter((g) => !a.gameId || g.id === a.gameId).map(gameJson) },
	{ method: 'GET', path: 'games/:code', scope: 'games:read', game: true, run: async (c) => {
		const g = await theGame(c);
		return {
			...gameJson(g),
			players: (await get<{ n: number }>("SELECT COUNT(*) AS n FROM member WHERE game_id = ? AND status = 'active'", g.id))!.n,
			photos: (await get<{ n: number }>('SELECT COUNT(*) AS n FROM photo WHERE game_id = ?', g.id))!.n
		};
	} },
	{ method: 'PATCH', path: 'games/:code', scope: 'games:write', game: true, run: async (c) => {
		const g = await theGame(c);
		const b = c.body;
		const has = (k: string) => k in b;
		const name = has('name') ? str(b.name, 80) : g.name;
		if (!name) throw bad('name can’t be empty');
		await run(
			`UPDATE game SET name = ?, visibility = ?, team_mode = ?, max_team_size = ?, submissions_open = ?, doubt_limit = ?,
				bingo = ?, bingo_cols = ?, bingo_line_points = ?, bingo_board_points = ? WHERE id = ?`,
			name,
			has('visibility') ? (b.visibility === 'open' ? 'open' : 'hidden') : g.visibility,
			has('team_mode') ? (b.team_mode === 'self' ? 'self' : 'admin') : g.team_mode,
			has('max_team_size') ? intOrNull(b.max_team_size) : g.max_team_size,
			has('submissions_open') ? (bool(b.submissions_open) ? 1 : 0) : g.submissions_open,
			has('doubt_limit') ? Math.max(0, Math.floor(num(b.doubt_limit, 2))) : g.doubt_limit,
			has('bingo') ? (bool(b.bingo) ? 1 : 0) : g.bingo,
			has('bingo_cols') ? Math.min(8, Math.max(2, Math.floor(num(b.bingo_cols, 4)))) : g.bingo_cols,
			has('bingo_line_points') ? num(b.bingo_line_points) : g.bingo_line_points,
			has('bingo_board_points') ? num(b.bingo_board_points) : g.bingo_board_points,
			g.id
		);
		return gameJson(await gameByCode(g.code));
	} },
	{ method: 'POST', path: 'games/:code/reveal', scope: 'games:write', game: true, run: async (c) => {
		await run('UPDATE game SET revealed_at = ? WHERE id = ?', now(), (await theGame(c)).id);
		return { ok: true };
	} },
	{ method: 'POST', path: 'games/:code/unreveal', scope: 'games:write', game: true, run: async (c) => {
		await run('UPDATE game SET revealed_at = 0 WHERE id = ?', (await theGame(c)).id);
		return { ok: true };
	} },
	{ method: 'GET', path: 'games/:code/scores', scope: 'games:read', game: true, run: async (c) => scoreGame(await theGame(c)) },

	// ---- categories
	{ method: 'GET', path: 'games/:code/categories', scope: 'games:read', game: true, run: async (c) => categories((await theGame(c)).id) },
	{ method: 'POST', path: 'games/:code/categories', scope: 'games:write', game: true, run: async (c) => {
		const g = await theGame(c);
		const name = str(c.body.name, 80);
		if (!name) throw bad('name is required');
		const sort = ((await get<{ m: number | null }>('SELECT MAX(sort) AS m FROM category WHERE game_id = ?', g.id))!.m ?? 0) + 1;
		const [made] = await batch([
			q('INSERT INTO category (game_id, name, sort) VALUES (?, ?, ?) RETURNING id', g.id, name, sort),
			q(`INSERT INTO score_option (category_id, label, points, kind) VALUES (last_insert_rowid(), 'Found it', ?, 'tier')`, num(c.body.points, 1))
		]);
		const id = (made.results[0] as { id: number }).id;
		return (await categories(g.id)).find((x) => x.id === id);
	} },
	{ method: 'PATCH', path: 'games/:code/categories/:id', scope: 'games:write', game: true, run: async (c) => {
		const g = await theGame(c);
		const cat = await findIn<{ id: number; name: string; rules: string; notes: string; day_label: string; scoring_cap: number | null; max_points: number | null; active: number }>(
			'SELECT * FROM category WHERE id = ? AND game_id = ?', c.p[3], g.id, 'category');
		const b = c.body;
		const name = 'name' in b ? str(b.name, 80) : cat.name;
		if (!name) throw bad('name can’t be empty');
		// `options` (optional) replaces the scoring lines: {id?, label, points, kind: 'tier'|'extra'|'bonus'}.
		let opts: { id: number; label: string; points: number; kind: string }[] | null = null;
		if (Array.isArray(b.options)) {
			opts = (b.options as Record<string, unknown>[])
				.map((o) => ({ id: Number(o.id) || 0, label: str(o.label, 120), points: num(o.points), kind: o.kind === 'extra' || o.kind === 'bonus' ? o.kind : 'tier' }))
				.filter((o) => o.label);
			if (!opts.some((o) => o.kind === 'tier')) throw bad('options needs at least one base line (kind "tier")');
		}
		const stmts = [
			q('UPDATE category SET name = ?, rules = ?, notes = ?, day_label = ?, scoring_cap = ?, max_points = ?, active = ? WHERE id = ?',
				name,
				'rules' in b ? str(b.rules, 4000) : cat.rules,
				'notes' in b ? str(b.notes, 4000) : cat.notes,
				'day_label' in b ? str(b.day_label, 40) : cat.day_label,
				'scoring_cap' in b ? intOrNull(b.scoring_cap) : cat.scoring_cap,
				'max_points' in b ? positiveOrNull(b.max_points) : cat.max_points,
				'active' in b ? (bool(b.active) ? 1 : 0) : cat.active,
				cat.id)
		];
		if (opts) {
			const keep = opts.filter((o) => o.id).map((o) => o.id);
			stmts.push(q('DELETE FROM score_option WHERE category_id = ? AND id NOT IN (SELECT value FROM json_each(?))', cat.id, JSON.stringify(keep)));
			opts.forEach((o, i) =>
				stmts.push(
					o.id
						? q('UPDATE score_option SET label = ?, points = ?, kind = ?, sort = ? WHERE id = ? AND category_id = ?', o.label, o.points, o.kind, i, o.id, cat.id)
						: q('INSERT INTO score_option (category_id, label, points, kind, sort) VALUES (?, ?, ?, ?, ?)', cat.id, o.label, o.points, o.kind, i)
				)
			);
		}
		await batch(stmts);
		return (await categories(g.id)).find((x) => x.id === cat.id);
	} },
	// Deleting a category deletes its photos, so it needs photo rights too.
	{ method: 'DELETE', path: 'games/:code/categories/:id', scope: ['games:write', 'photos:moderate'], game: true, run: async (c) => {
		const g = await theGame(c);
		const cat = await findIn<{ id: number }>('SELECT id FROM category WHERE id = ? AND game_id = ?', c.p[3], g.id, 'category');
		const ids = await all<{ id: number; ext: string }>('SELECT id, ext FROM photo WHERE category_id = ?', cat.id);
		await run('DELETE FROM category WHERE id = ?', cat.id);
		await remove(ids);
		return { ok: true, photos_deleted: ids.length };
	} },

	// ---- teams
	{ method: 'GET', path: 'games/:code/teams', scope: 'games:read', game: true, run: async (c) => teams((await theGame(c)).id) },
	{ method: 'POST', path: 'games/:code/teams', scope: 'games:write', game: true, run: async (c) => {
		const g = await theGame(c);
		const name = str(c.body.name, 40);
		const color = validColor(c.body.color);
		if (!name || !color) throw bad('name and a valid color are required');
		const id = await insert('INSERT INTO team (game_id, name, color) VALUES (?, ?, ?)', g.id, name, color);
		return (await teams(g.id)).find((t: any) => t.id === id);
	} },
	{ method: 'PATCH', path: 'games/:code/teams/:id', scope: 'games:write', game: true, run: async (c) => {
		const g = await theGame(c);
		const t = await findIn<{ id: number; name: string; color: string }>('SELECT * FROM team WHERE id = ? AND game_id = ?', c.p[3], g.id, 'team');
		const name = 'name' in c.body ? str(c.body.name, 40) : t.name;
		const color = 'color' in c.body ? validColor(c.body.color) : t.color;
		if (!name || !color) throw bad('name and color must be valid');
		await run('UPDATE team SET name = ?, color = ? WHERE id = ?', name, color, t.id);
		return (await teams(g.id)).find((x: any) => x.id === t.id);
	} },
	{ method: 'DELETE', path: 'games/:code/teams/:id', scope: 'games:write', game: true, run: async (c) => {
		const g = await theGame(c);
		const t = await findIn<{ id: number }>('SELECT id FROM team WHERE id = ? AND game_id = ?', c.p[3], g.id, 'team');
		if (await get('SELECT 1 FROM photo WHERE team_id = ? LIMIT 1', t.id)) throw bad('That team has photos and can’t be deleted.');
		await run('DELETE FROM team WHERE id = ?', t.id);
		return { ok: true };
	} },

	// ---- awards
	{ method: 'GET', path: 'games/:code/awards', scope: 'games:read', game: true, run: async (c) =>
		all('SELECT id, name, description, points, scope, status FROM award WHERE game_id = ? ORDER BY sort, id', (await theGame(c)).id) },
	{ method: 'POST', path: 'games/:code/awards', scope: 'games:write', game: true, run: async (c) => {
		const g = await theGame(c);
		const name = str(c.body.name, 80);
		if (!name) throw bad('name is required');
		const id = await insert(
			'INSERT INTO award (game_id, name, description, points, scope) VALUES (?, ?, ?, ?, ?)',
			g.id, name, str(c.body.description, 400), num(c.body.points), c.body.scope === 'category' ? 'category' : 'game'
		);
		return awardOf(id);
	} },
	{ method: 'PATCH', path: 'games/:code/awards/:id', scope: 'games:write', game: true, run: async (c) => {
		const g = await theGame(c);
		const a = await findIn<{ id: number; name: string; description: string; points: number; scope: string; status: string }>(
			'SELECT * FROM award WHERE id = ? AND game_id = ?', c.p[3], g.id, 'award');
		const b = c.body;
		const name = 'name' in b ? str(b.name, 80) : a.name;
		if (!name) throw bad('name can’t be empty');
		const status = 'status' in b ? String(b.status) : a.status;
		if (!['draft', 'open', 'closed'].includes(status)) throw bad('status must be draft, open or closed');
		await run(
			'UPDATE award SET name = ?, description = ?, points = ?, scope = ?, status = ? WHERE id = ?',
			name,
			'description' in b ? str(b.description, 400) : a.description,
			'points' in b ? num(b.points) : a.points,
			'scope' in b ? (b.scope === 'category' ? 'category' : 'game') : a.scope,
			status,
			a.id
		);
		return awardOf(a.id);
	} },
	{ method: 'DELETE', path: 'games/:code/awards/:id', scope: 'games:write', game: true, run: async (c) => {
		await run('DELETE FROM award WHERE id = ? AND game_id = ?', Number(c.p[3]) || 0, (await theGame(c)).id);
		return { ok: true };
	} },

	// ---- photos (metadata only; the image files aren't served here)
	{ method: 'GET', path: 'games/:code/photos', scope: 'games:read', game: true, run: async (c) => {
		const g = await theGame(c);
		const qs = c.url.searchParams;
		const where = ['p.game_id = ?'];
		const params: (string | number)[] = [g.id];
		for (const [key, col] of [['category', 'p.category_id'], ['team', 'p.team_id'], ['status', 'p.status'], ['user', 'p.user_id']] as const)
			if (qs.get(key)) (where.push(`${col} = ?`), params.push(key === 'status' ? qs.get(key)! : Number(qs.get(key))));
		const limit = Math.min(500, Math.max(1, Number(qs.get('limit')) || 100));
		return all(
			`SELECT p.id, p.category_id, c.name AS category, p.team_id, t.name AS team, p.user_id, u.name AS photographer,
				p.caption, p.status, p.points_override, p.width, p.height, p.bytes, p.created_at
			 FROM photo p LEFT JOIN category c ON c.id = p.category_id JOIN team t ON t.id = p.team_id JOIN user u ON u.id = p.user_id
			 WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT ${limit}`,
			...params
		);
	} },
	{ method: 'PATCH', path: 'games/:code/photos/:id', scope: 'photos:moderate', game: true, run: async (c) => {
		const g = await theGame(c);
		const p = await findIn<{ id: number; status: string }>('SELECT id, status FROM photo WHERE id = ? AND game_id = ?', c.p[3], g.id, 'photo');
		if ('status' in c.body) {
			if (!['ok', 'disqualified'].includes(String(c.body.status))) throw bad('status must be ok or disqualified');
			await batch([
				q('UPDATE photo SET status = ? WHERE id = ?', String(c.body.status), p.id),
				q('DELETE FROM doubt WHERE photo_id = ?', p.id),
				q('DELETE FROM review_vote WHERE photo_id = ?', p.id)
			]);
			if (String(c.body.status) !== p.status) announce(String(c.body.status) === 'disqualified' ? 'photo.disqualified' : 'photo.restored', p.id);
		}
		if ('points_override' in c.body) {
			const raw = c.body.points_override;
			await run('UPDATE photo SET points_override = ? WHERE id = ?', raw === null || raw === '' ? null : num(raw), p.id);
			announce('photo.scored', p.id);
		}
		return get('SELECT id, status, points_override FROM photo WHERE id = ?', p.id);
	} },
	{ method: 'DELETE', path: 'games/:code/photos/:id', scope: 'photos:moderate', game: true, run: async (c) => {
		const p = await findIn<{ id: number; ext: string }>('SELECT id, ext FROM photo WHERE id = ? AND game_id = ?', c.p[3], (await theGame(c)).id, 'photo');
		await run('DELETE FROM photo WHERE id = ?', p.id);
		await remove([p]);
		return { ok: true };
	} },

	// ---- webhooks (the address holds a secret key, so it is never returned)
	{ method: 'GET', path: 'games/:code/webhooks', scope: 'games:read', game: true, run: async (c) =>
		(await listWebhooks((await theGame(c)).id)).map(publicHook) },
	{ method: 'POST', path: 'games/:code/webhooks', scope: 'games:write', game: true, run: async (c) => {
		const g = await theGame(c);
		const r = await addWebhook(g.id, { name: c.body.name, kind: c.body.kind, url: c.body.url, secret: c.body.secret, events: c.body.events, hiddenOk: c.body.hidden_ok, active: c.body.active });
		if ('error' in r) throw bad(r.error);
		return publicHook((await listWebhooks(g.id)).find((h) => h.id === r.id)!);
	} },
	{ method: 'PATCH', path: 'games/:code/webhooks/:id', scope: 'games:write', game: true, run: async (c) => {
		const g = await theGame(c);
		const r = await updateWebhook(g.id, Number(c.p[3]) || 0, { name: c.body.name, url: c.body.url, secret: c.body.secret, events: c.body.events, hiddenOk: c.body.hidden_ok, active: c.body.active });
		if ('error' in r) throw r.error === 'No such webhook.' ? missing(r.error) : bad(r.error);
		return publicHook((await listWebhooks(g.id)).find((h) => h.id === Number(c.p[3]))!);
	} },
	{ method: 'POST', path: 'games/:code/webhooks/:id/test', scope: 'games:write', game: true, run: async (c) => {
		const result = await testWebhook((await theGame(c)).id, Number(c.p[3]) || 0);
		if (result === 'No such webhook.') throw missing(result);
		return { ok: result === 'Sent.', result };
	} },
	{ method: 'DELETE', path: 'games/:code/webhooks/:id', scope: 'games:write', game: true, run: async (c) => {
		await run('DELETE FROM webhook WHERE id = ? AND game_id = ?', Number(c.p[3]) || 0, (await theGame(c)).id);
		return { ok: true };
	} },

	// ---- players in a game
	{ method: 'GET', path: 'games/:code/players', scope: 'players:read', game: true, run: async (c) =>
		all(
			`SELECT u.id, u.name, u.email, m.team_id, m.role, m.status,
				(SELECT COUNT(*) FROM photo p WHERE p.user_id = u.id AND p.game_id = m.game_id) AS photos
			 FROM member m JOIN user u ON u.id = m.user_id WHERE m.game_id = ? ORDER BY u.name COLLATE NOCASE`,
			(await theGame(c)).id
		) },
	// Same rules as the Teams page: an emailed invite, counted against the minter's daily limit.
	{ method: 'POST', path: 'games/:code/players', scope: 'players:write', game: true, run: async (c) => {
		const g = await theGame(c);
		const email = cleanEmail(c.body.email);
		const name = str(c.body.name, 40);
		if (!email) throw bad('a valid email is required');
		if (!(await invitesLeft(c.a.user))) throw new ApiError(429, `${INVITES_PER_DAY} invites in the last day is the limit.`);
		const existing = await findUserByEmail(email);
		if (!existing && !name) throw bad('new players need a name');
		const id = existing?.id ?? (await createUser(email, name));
		if (await get("SELECT 1 FROM member WHERE game_id = ? AND user_id = ? AND status = 'active'", g.id, id)) throw new ApiError(409, 'Already in this game');
		await run("INSERT OR IGNORE INTO member (game_id, user_id, status) VALUES (?, ?, 'invited')", g.id, id);
		return { id, invited: await invite(c, g, { id, email, name: existing?.name ?? name }) };
	} },
	{ method: 'PATCH', path: 'games/:code/players/:id', scope: 'games:write', game: true, run: async (c) => {
		const g = await theGame(c);
		const teamId = c.body.team_id === null ? null : Number(c.body.team_id) || null;
		if (teamId && !(await get('SELECT 1 FROM team WHERE id = ? AND game_id = ?', teamId, g.id))) throw bad('No such team in this game');
		if (!(await get('SELECT 1 FROM member WHERE game_id = ? AND user_id = ?', g.id, Number(c.p[3]) || 0))) throw missing('That player isn’t in this game');
		await run('UPDATE member SET team_id = ? WHERE game_id = ? AND user_id = ?', teamId, g.id, Number(c.p[3]));
		return { ok: true, team_id: teamId };
	} },
	{ method: 'DELETE', path: 'games/:code/players/:id', scope: 'players:write', game: true, run: async (c) => {
		const g = await theGame(c);
		const uid = Number(c.p[3]) || 0;
		if (await get("SELECT 1 FROM member WHERE game_id = ? AND user_id = ? AND role = 'host'", g.id, uid)) throw bad('Hosts can’t be removed.');
		await run('DELETE FROM member WHERE game_id = ? AND user_id = ?', g.id, uid);
		return { ok: true };
	} }
];

const table = routes.map((r) => ({ ...r, re: new RegExp('^' + r.path.replace(/:\w+/g, '([^/]+)') + '$') }));

async function handle(event: RequestEvent) {
	try {
		const auth = event.request.headers.get('authorization') ?? '';
		const actor = await actorFromToken(/^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : null);
		if (!actor) throw new ApiError(401, 'Missing, invalid, expired or revoked API key.');

		const path = ((event.params as Record<string, string>).path ?? '').replace(/\/+$/, '');
		const method = event.request.method;
		const matches = table.filter((r) => r.re.test(path));
		if (!matches.length) throw missing('No such endpoint');
		const route = matches.find((r) => r.method === method);
		if (!route) throw new ApiError(405, `Use ${matches.map((m) => m.method).join(' or ')} here.`);

		const need = Array.isArray(route.scope) ? route.scope : [route.scope];
		const lacking = need.filter((s) => !actor.scopes.has(s));
		if (lacking.length) throw new ApiError(403, `This key lacks the scope: ${lacking.join(', ')}.`);

		const p = path.split('/');
		if (route.game && actor.gameId) {
			const g = await get<{ id: number }>('SELECT id FROM game WHERE code = ?', p[1]);
			if (!g || g.id !== actor.gameId) throw new ApiError(403, 'This key is limited to a different game.');
		}

		let body: Record<string, unknown> = {};
		if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
			const text = await event.request.text();
			if (text.trim()) {
				try {
					const parsed = JSON.parse(text);
					if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw 0;
					body = parsed;
				} catch {
					throw bad('Send a JSON object as the body.');
				}
			}
		}
		return json((await route.run({ a: actor, p, body, url: event.url, origin: event.url.origin })) ?? { ok: true });
	} catch (e) {
		if (e instanceof ApiError) return json({ error: e.message }, { status: e.status });
		if (isHttpError(e)) return json({ error: e.body.message }, { status: e.status });
		console.error('[api]', e);
		await logEvent('error', 'api_error', e instanceof Error ? `${e.name}: ${e.message}` : String(e), { request: event.request, status: 500, detail: e instanceof Error ? e.stack : undefined });
		return json({ error: 'Something went wrong.' }, { status: 500 });
	}
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
