import { isHttpError, json, type RequestEvent } from '@sveltejs/kit';
import { cleanEmail, createUser, findUserByEmail } from '#lib/server/auth.ts';
import { validColor } from '#lib/colors.ts';
import { all, get, insert, now, run, tx } from '#lib/server/db.ts';
import { gameByCode, intOrNull, num, str, type Game } from '#lib/server/game.ts';
import { remove } from '#lib/server/images.ts';
import { optionsFor } from '#lib/server/claims.ts';
import { actorFromToken, canManage, roleOf, SCOPES, type Actor, type Scope } from '#lib/server/perms.ts';
import { scoreGame } from '#lib/server/scoring.ts';

/**
 * JSON API for API keys (see docs/API.md). Authenticated only by `Authorization: Bearer pgk_...`;
 * session cookies are ignored here. Every route names the scope it needs.
 */

class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}
const bad = (m: string) => new ApiError(400, m);
const missing = (m: string) => new ApiError(404, m);

type Ctx = { a: Actor; p: string[]; body: Record<string, unknown>; url: URL };
type Route = { method: string; path: string; scope: Scope | Scope[]; game?: boolean; run: (c: Ctx) => unknown | Promise<unknown> };

const bool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';

function theGame(c: Ctx): Game {
	const g = gameByCode(c.p[1]);
	return g;
}
const findIn = <T>(sql: string, id: string, gameId: number, what: string): T => {
	const r = get<T>(sql, Number(id) || 0, gameId);
	if (!r) throw missing(`No such ${what}`);
	return r;
};

const gameJson = (g: Game) => ({
	code: g.code, name: g.name, visibility: g.visibility, revealed_at: g.revealed_at || null, team_mode: g.team_mode,
	max_team_size: g.max_team_size, submissions_open: !!g.submissions_open, doubt_limit: g.doubt_limit, bingo: !!g.bingo,
	bingo_cols: g.bingo_cols, bingo_line_points: g.bingo_line_points, bingo_board_points: g.bingo_board_points, created_at: g.created_at
});

const categories = (gameId: number) =>
	all<{ id: number; name: string; rules: string; notes: string; day_label: string; scoring_cap: number | null; sort: number; active: number }>(
		'SELECT id, name, rules, notes, day_label, scoring_cap, sort, active FROM category WHERE game_id = ? ORDER BY sort, id',
		gameId
	).map((c) => ({ ...c, active: !!c.active, options: optionsFor(c.id) }));

const teamRow = (gameId: number) =>
	all(
		`SELECT t.id, t.name, t.color, (SELECT COUNT(*) FROM member m WHERE m.team_id = t.id) AS members,
			(SELECT COUNT(*) FROM photo p WHERE p.team_id = t.id) AS photos FROM team t WHERE t.game_id = ? ORDER BY t.id`,
		gameId
	);

const person = (id: string) => {
	const u = get<{ id: number; name: string; email: string; is_admin: number; is_owner: number; created_at: number; last_seen_at: number | null }>(
		'SELECT id, name, email, is_admin, is_owner, created_at, last_seen_at FROM user WHERE id = ?',
		Number(id) || 0
	);
	if (!u) throw missing('No such person');
	return u;
};
const personJson = (u: ReturnType<typeof person>) => ({
	id: u.id, name: u.name, email: u.email, role: roleOf(u), created_at: u.created_at, last_seen_at: u.last_seen_at
});

const routes: Route[] = [
	{ method: 'GET', path: 'me', scope: [], run: ({ a }) => ({
		user: { id: a.user.id, name: a.user.name, role: roleOf(a.user) },
		key: { name: a.key.name, scopes: [...a.scopes], game_id: a.gameId, expires_at: a.key.expires_at }
	}) },

	// ---- games
	{ method: 'GET', path: 'games', scope: 'games:read', run: ({ a }) =>
		all<Game>('SELECT * FROM game ORDER BY created_at DESC').filter((g) => !a.gameId || g.id === a.gameId).map(gameJson) },
	{ method: 'POST', path: 'games', scope: 'games:write', run: ({ a, body }) => {
		if (a.gameId) throw new ApiError(403, 'This key is limited to one game.');
		const name = str(body.name, 80);
		if (!name) throw bad('name is required');
		let code = '';
		do code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
		while (get('SELECT 1 FROM game WHERE code = ?', code));
		const id = insert('INSERT INTO game (code, name, created_at) VALUES (?, ?, ?)', code, name, now());
		run('INSERT INTO member (game_id, user_id) VALUES (?, ?)', id, a.user.id);
		return gameJson(gameByCode(code));
	} },
	{ method: 'GET', path: 'games/:code', scope: 'games:read', game: true, run: (c) => {
		const g = theGame(c);
		return {
			...gameJson(g),
			players: get<{ n: number }>('SELECT COUNT(*) AS n FROM member WHERE game_id = ?', g.id)!.n,
			photos: get<{ n: number }>('SELECT COUNT(*) AS n FROM photo WHERE game_id = ?', g.id)!.n
		};
	} },
	{ method: 'PATCH', path: 'games/:code', scope: 'games:write', game: true, run: (c) => {
		const g = theGame(c);
		const b = c.body;
		const has = (k: string) => k in b;
		const name = has('name') ? str(b.name, 80) : g.name;
		if (!name) throw bad('name can’t be empty');
		run(
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
		return gameJson(gameByCode(g.code));
	} },
	{ method: 'POST', path: 'games/:code/reveal', scope: 'games:write', game: true, run: (c) => {
		run('UPDATE game SET revealed_at = ? WHERE id = ?', now(), theGame(c).id);
		return { ok: true };
	} },
	{ method: 'POST', path: 'games/:code/unreveal', scope: 'games:write', game: true, run: (c) => {
		run('UPDATE game SET revealed_at = 0 WHERE id = ?', theGame(c).id);
		return { ok: true };
	} },
	{ method: 'GET', path: 'games/:code/scores', scope: 'games:read', game: true, run: (c) => scoreGame(theGame(c)) },

	// ---- categories
	{ method: 'GET', path: 'games/:code/categories', scope: 'games:read', game: true, run: (c) => categories(theGame(c).id) },
	{ method: 'POST', path: 'games/:code/categories', scope: 'games:write', game: true, run: (c) => {
		const g = theGame(c);
		const name = str(c.body.name, 80);
		if (!name) throw bad('name is required');
		const sort = (get<{ m: number | null }>('SELECT MAX(sort) AS m FROM category WHERE game_id = ?', g.id)!.m ?? 0) + 1;
		const id = tx(() => {
			const id = insert('INSERT INTO category (game_id, name, sort) VALUES (?, ?, ?)', g.id, name, sort);
			run(`INSERT INTO score_option (category_id, label, points, kind) VALUES (?, 'Found it', ?, 'tier')`, id, num(c.body.points, 1));
			return id;
		});
		return categories(g.id).find((x) => x.id === id);
	} },
	{ method: 'PATCH', path: 'games/:code/categories/:id', scope: 'games:write', game: true, run: (c) => {
		const g = theGame(c);
		const cat = findIn<{ id: number; name: string; rules: string; notes: string; day_label: string; scoring_cap: number | null; active: number }>(
			'SELECT * FROM category WHERE id = ? AND game_id = ?', c.p[3], g.id, 'category');
		const b = c.body;
		const name = 'name' in b ? str(b.name, 80) : cat.name;
		if (!name) throw bad('name can’t be empty');
		// `options` (optional) replaces the scoring lines; each is {label, points, kind: 'tier'|'extra'}, id to keep an existing one.
		let opts: { id: number; label: string; points: number; kind: string }[] | null = null;
		if (Array.isArray(b.options)) {
			opts = (b.options as Record<string, unknown>[])
				.map((o) => ({ id: Number(o.id) || 0, label: str(o.label, 120), points: num(o.points), kind: o.kind === 'extra' ? 'extra' : 'tier' }))
				.filter((o) => o.label);
			if (!opts.some((o) => o.kind === 'tier')) throw bad('options needs at least one base line (kind "tier")');
		}
		tx(() => {
			run(
				'UPDATE category SET name = ?, rules = ?, notes = ?, day_label = ?, scoring_cap = ?, active = ? WHERE id = ?',
				name,
				'rules' in b ? str(b.rules, 4000) : cat.rules,
				'notes' in b ? str(b.notes, 4000) : cat.notes,
				'day_label' in b ? str(b.day_label, 40) : cat.day_label,
				'scoring_cap' in b ? intOrNull(b.scoring_cap) : cat.scoring_cap,
				'active' in b ? (bool(b.active) ? 1 : 0) : cat.active,
				cat.id
			);
			if (!opts) return;
			const keep = opts.filter((o) => o.id).map((o) => o.id);
			for (const o of all<{ id: number }>('SELECT id FROM score_option WHERE category_id = ?', cat.id))
				if (!keep.includes(o.id)) run('DELETE FROM score_option WHERE id = ?', o.id);
			opts.forEach((o, i) => {
				if (o.id) run('UPDATE score_option SET label = ?, points = ?, kind = ?, sort = ? WHERE id = ? AND category_id = ?', o.label, o.points, o.kind, i, o.id, cat.id);
				else insert('INSERT INTO score_option (category_id, label, points, kind, sort) VALUES (?, ?, ?, ?, ?)', cat.id, o.label, o.points, o.kind, i);
			});
		});
		return categories(g.id).find((x) => x.id === cat.id);
	} },
	// Deleting a category deletes its photos, so it needs photo rights too.
	{ method: 'DELETE', path: 'games/:code/categories/:id', scope: ['games:write', 'photos:moderate'], game: true, run: async (c) => {
		const g = theGame(c);
		const cat = findIn<{ id: number }>('SELECT id FROM category WHERE id = ? AND game_id = ?', c.p[3], g.id, 'category');
		const ids = all<{ id: number }>('SELECT id FROM photo WHERE category_id = ?', cat.id);
		run('DELETE FROM category WHERE id = ?', cat.id);
		for (const p of ids) await remove(p.id);
		return { ok: true, photos_deleted: ids.length };
	} },

	// ---- teams
	{ method: 'GET', path: 'games/:code/teams', scope: 'games:read', game: true, run: (c) => teamRow(theGame(c).id) },
	{ method: 'POST', path: 'games/:code/teams', scope: 'games:write', game: true, run: (c) => {
		const g = theGame(c);
		const name = str(c.body.name, 40);
		const color = validColor(c.body.color);
		if (!name || !color) throw bad('name and a valid color are required');
		const id = insert('INSERT INTO team (game_id, name, color) VALUES (?, ?, ?)', g.id, name, color);
		return teamRow(g.id).find((t: any) => t.id === id);
	} },
	{ method: 'PATCH', path: 'games/:code/teams/:id', scope: 'games:write', game: true, run: (c) => {
		const g = theGame(c);
		const t = findIn<{ id: number; name: string; color: string }>('SELECT * FROM team WHERE id = ? AND game_id = ?', c.p[3], g.id, 'team');
		const name = 'name' in c.body ? str(c.body.name, 40) : t.name;
		const color = 'color' in c.body ? validColor(c.body.color) : t.color;
		if (!name || !color) throw bad('name and color must be valid');
		run('UPDATE team SET name = ?, color = ? WHERE id = ?', name, color, t.id);
		return teamRow(g.id).find((x: any) => x.id === t.id);
	} },
	{ method: 'DELETE', path: 'games/:code/teams/:id', scope: 'games:write', game: true, run: (c) => {
		const g = theGame(c);
		const t = findIn<{ id: number }>('SELECT id FROM team WHERE id = ? AND game_id = ?', c.p[3], g.id, 'team');
		if (get('SELECT 1 FROM photo WHERE team_id = ? LIMIT 1', t.id)) throw bad('That team has photos and can’t be deleted.');
		run('DELETE FROM team WHERE id = ?', t.id);
		return { ok: true };
	} },

	// ---- awards
	{ method: 'GET', path: 'games/:code/awards', scope: 'games:read', game: true, run: (c) =>
		all('SELECT id, name, description, points, scope, status FROM award WHERE game_id = ? ORDER BY sort, id', theGame(c).id) },
	{ method: 'POST', path: 'games/:code/awards', scope: 'games:write', game: true, run: (c) => {
		const g = theGame(c);
		const name = str(c.body.name, 80);
		if (!name) throw bad('name is required');
		const id = insert(
			'INSERT INTO award (game_id, name, description, points, scope) VALUES (?, ?, ?, ?, ?)',
			g.id, name, str(c.body.description, 400), num(c.body.points), c.body.scope === 'category' ? 'category' : 'game'
		);
		return get('SELECT id, name, description, points, scope, status FROM award WHERE id = ?', id);
	} },
	{ method: 'PATCH', path: 'games/:code/awards/:id', scope: 'games:write', game: true, run: (c) => {
		const g = theGame(c);
		const a = findIn<{ id: number; name: string; description: string; points: number; scope: string; status: string }>(
			'SELECT * FROM award WHERE id = ? AND game_id = ?', c.p[3], g.id, 'award');
		const b = c.body;
		const name = 'name' in b ? str(b.name, 80) : a.name;
		if (!name) throw bad('name can’t be empty');
		const status = 'status' in b ? String(b.status) : a.status;
		if (!['draft', 'open', 'closed'].includes(status)) throw bad('status must be draft, open or closed');
		run(
			'UPDATE award SET name = ?, description = ?, points = ?, scope = ?, status = ? WHERE id = ?',
			name,
			'description' in b ? str(b.description, 400) : a.description,
			'points' in b ? num(b.points) : a.points,
			'scope' in b ? (b.scope === 'category' ? 'category' : 'game') : a.scope,
			status,
			a.id
		);
		return get('SELECT id, name, description, points, scope, status FROM award WHERE id = ?', a.id);
	} },
	{ method: 'DELETE', path: 'games/:code/awards/:id', scope: 'games:write', game: true, run: (c) => {
		const g = theGame(c);
		run('DELETE FROM award WHERE id = ? AND game_id = ?', Number(c.p[3]) || 0, g.id);
		return { ok: true };
	} },

	// ---- photos (metadata only; the image files themselves aren't served here)
	{ method: 'GET', path: 'games/:code/photos', scope: 'games:read', game: true, run: (c) => {
		const g = theGame(c);
		const q = c.url.searchParams;
		const where = ['p.game_id = ?'];
		const params: (string | number)[] = [g.id];
		for (const [key, col] of [['category', 'p.category_id'], ['team', 'p.team_id'], ['status', 'p.status'], ['user', 'p.user_id']] as const)
			if (q.get(key)) (where.push(`${col} = ?`), params.push(key === 'status' ? q.get(key)! : Number(q.get(key))));
		const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 100));
		return all(
			`SELECT p.id, p.category_id, c.name AS category, p.team_id, t.name AS team, p.user_id, u.name AS photographer,
				p.caption, p.status, p.points_override, p.width, p.height, p.created_at
			 FROM photo p LEFT JOIN category c ON c.id = p.category_id JOIN team t ON t.id = p.team_id JOIN user u ON u.id = p.user_id
			 WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT ${limit}`,
			...params
		);
	} },
	{ method: 'PATCH', path: 'games/:code/photos/:id', scope: 'photos:moderate', game: true, run: (c) => {
		const g = theGame(c);
		const p = findIn<{ id: number }>('SELECT id FROM photo WHERE id = ? AND game_id = ?', c.p[3], g.id, 'photo');
		if ('status' in c.body) {
			if (!['ok', 'disqualified'].includes(String(c.body.status))) throw bad('status must be ok or disqualified');
			run('UPDATE photo SET status = ? WHERE id = ?', String(c.body.status), p.id);
			run('DELETE FROM doubt WHERE photo_id = ?', p.id);
			run('DELETE FROM review_vote WHERE photo_id = ?', p.id);
		}
		if ('points_override' in c.body) {
			const raw = c.body.points_override;
			run('UPDATE photo SET points_override = ? WHERE id = ?', raw === null || raw === '' ? null : num(raw), p.id);
		}
		return get('SELECT id, status, points_override FROM photo WHERE id = ?', p.id);
	} },
	{ method: 'DELETE', path: 'games/:code/photos/:id', scope: 'photos:moderate', game: true, run: async (c) => {
		const p = findIn<{ id: number }>('SELECT id FROM photo WHERE id = ? AND game_id = ?', c.p[3], theGame(c).id, 'photo');
		run('DELETE FROM photo WHERE id = ?', p.id);
		await remove(p.id);
		return { ok: true };
	} },

	// ---- players in a game
	{ method: 'GET', path: 'games/:code/players', scope: 'people:read', game: true, run: (c) =>
		all(
			`SELECT u.id, u.name, u.email, m.team_id, (SELECT COUNT(*) FROM photo p WHERE p.user_id = u.id AND p.game_id = m.game_id) AS photos
			 FROM member m JOIN user u ON u.id = m.user_id WHERE m.game_id = ? ORDER BY u.name COLLATE NOCASE`,
			theGame(c).id
		) },
	{ method: 'POST', path: 'games/:code/players', scope: 'people:write', game: true, run: (c) => {
		const g = theGame(c);
		const email = cleanEmail(c.body.email);
		if (!email) throw bad('a valid email is required');
		let u = findUserByEmail(email);
		if (!u && !str(c.body.name, 40)) throw bad('new players need a name');
		const id = u?.id ?? createUser(email, str(c.body.name, 40));
		run('INSERT OR IGNORE INTO member (game_id, user_id) VALUES (?, ?)', g.id, id);
		return personJson(person(String(id)));
	} },
	{ method: 'PATCH', path: 'games/:code/players/:id', scope: 'people:write', game: true, run: (c) => {
		const g = theGame(c);
		const teamId = c.body.team_id === null ? null : Number(c.body.team_id) || null;
		if (teamId && !get('SELECT 1 FROM team WHERE id = ? AND game_id = ?', teamId, g.id)) throw bad('No such team in this game');
		if (!get('SELECT 1 FROM member WHERE game_id = ? AND user_id = ?', g.id, Number(c.p[3]) || 0)) throw missing('That player isn’t in this game');
		run('UPDATE member SET team_id = ? WHERE game_id = ? AND user_id = ?', teamId, g.id, Number(c.p[3]));
		return { ok: true, team_id: teamId };
	} },
	{ method: 'DELETE', path: 'games/:code/players/:id', scope: 'people:write', game: true, run: (c) => {
		run('DELETE FROM member WHERE game_id = ? AND user_id = ?', theGame(c).id, Number(c.p[3]) || 0);
		return { ok: true };
	} },

	// ---- people (site-wide). No sign-in links, passkey changes or session control here, by design.
	{ method: 'GET', path: 'people', scope: 'people:read', run: () =>
		all<ReturnType<typeof person>>('SELECT id, name, email, is_admin, is_owner, created_at, last_seen_at FROM user ORDER BY name COLLATE NOCASE').map(personJson) },
	{ method: 'POST', path: 'people', scope: 'people:write', run: ({ body }) => {
		const name = str(body.name, 40);
		const email = cleanEmail(body.email);
		if (!name || !email) throw bad('name and a valid email are required');
		if (findUserByEmail(email)) throw new ApiError(409, 'That email already has an account');
		const id = createUser(email, name);
		const g = body.game ? get<{ id: number }>('SELECT id FROM game WHERE code = ?', String(body.game)) : undefined;
		if (g) run('INSERT OR IGNORE INTO member (game_id, user_id) VALUES (?, ?)', g.id, id);
		return personJson(person(String(id)));
	} },
	{ method: 'PATCH', path: 'people/:id', scope: 'people:write', run: ({ a, p, body }) => {
		const u = person(p[1]);
		if (!canManage(a.user, u)) throw new ApiError(403, 'Only an owner can change an admin or owner.');
		// Email and role changes are account-takeover levers, so they need the owner-only scope too.
		const privileged = ['email', 'role', 'is_admin'].some((k) => k in body);
		if (privileged && !a.scopes.has('people:privileged')) throw new ApiError(403, 'Changing email or role needs the people:privileged scope.');
		const name = 'name' in body ? str(body.name, 40) : u.name;
		const email = 'email' in body ? cleanEmail(body.email) : u.email;
		if (!name || !email) throw bad('valid name and email required');
		if (get('SELECT 1 FROM user WHERE email = ? AND id != ?', email, u.id)) throw new ApiError(409, 'Another person already has that email');
		let admin = u.is_admin;
		if ('role' in body || 'is_admin' in body) {
			if (u.is_owner) throw bad('The owner’s role can’t be changed here.');
			if (u.id === a.user.id) throw bad('You can’t change your own role.');
			const want = 'role' in body ? body.role === 'admin' : bool(body.is_admin);
			if ('role' in body && !['admin', 'player'].includes(String(body.role))) throw bad('role must be admin or player');
			admin = want ? 1 : 0;
		}
		run('UPDATE user SET name = ?, email = ?, is_admin = ? WHERE id = ?', name, email, admin, u.id);
		return personJson(person(p[1]));
	} },
	{ method: 'DELETE', path: 'people/:id', scope: ['people:write', 'people:privileged'], run: async ({ a, p }) => {
		const u = person(p[1]);
		if (u.id === a.user.id) throw bad('You can’t delete yourself.');
		if (u.is_owner) throw bad('The owner can’t be deleted.');
		if (!canManage(a.user, u)) throw new ApiError(403, 'Only an owner can delete an admin.');
		const ids = all<{ id: number }>('SELECT id FROM photo WHERE user_id = ?', u.id);
		run('DELETE FROM user WHERE id = ?', u.id);
		for (const ph of ids) await remove(ph.id);
		return { ok: true };
	} }
];

const compile = (path: string) => new RegExp('^' + path.replace(/:\w+/g, '([^/]+)') + '$');
const table = routes.map((r) => ({ ...r, re: compile(r.path) }));

async function handle(event: RequestEvent) {
	try {
		const auth = event.request.headers.get('authorization') ?? '';
		const actor = actorFromToken(/^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : null);
		if (!actor) throw new ApiError(401, 'Missing, invalid, expired or revoked API key.');

		const path = (event.params.path ?? '').replace(/\/+$/, '');
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
			const g = get<{ id: number }>('SELECT id FROM game WHERE code = ?', p[1]);
			if (!g || g.id !== actor.gameId) throw new ApiError(403, 'This key is limited to a different game.');
		}
		if (actor.gameId && /^people(\/|$)/.test(path)) throw new ApiError(403, 'This key is limited to one game.');

		let body: Record<string, unknown> = {};
		if (method === 'POST' || method === 'PATCH') {
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
		const result = await route.run({ a: actor, p, body, url: event.url });
		return json(result ?? { ok: true });
	} catch (e) {
		if (e instanceof ApiError) return json({ error: e.message }, { status: e.status });
		if (isHttpError(e)) return json({ error: e.body.message }, { status: e.status });
		console.error('[api]', e);
		return json({ error: 'Something went wrong.' }, { status: 500 });
	}
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;

