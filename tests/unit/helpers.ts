import { beforeAll, beforeEach } from 'vitest';
import { insert, now, run } from '../../src/lib/server/db.ts';
import { databaseReady } from '../../src/lib/server/migrate.ts';
import { scoreGame } from '../../src/lib/server/scoring.ts';
import type { Game } from '../../src/lib/server/game.ts';

/**
 * Applies the real migrations once per test file and empties the data tables before every test.
 * (The plugin does not roll D1 back between tests, and tests share a file's database.)
 * Deleting users and games cascades to everything else that references them.
 */
export const useDatabase = () => {
	beforeAll(() => databaseReady());
	beforeEach(async () => {
		for (const t of ['game', 'user', 'setting', 'event', 'login_code', 'score_cache']) await run(`DELETE FROM ${t}`);
	});
};

let n = 0;
const uniq = () => `${Date.now()}-${++n}`;

export const mkUser = (o: { admin?: boolean; verified?: boolean; name?: string } = {}) =>
	insert(
		'INSERT INTO user (email, name, is_admin, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?)',
		`u${uniq()}@example.com`, o.name ?? 'Person', o.admin ? 1 : 0, o.verified === false ? null : now(), now()
	);

export const mkGame = async (o: Partial<Pick<Game, 'bingo' | 'bingo_cols' | 'bingo_line_points' | 'bingo_board_points' | 'visibility' | 'revealed_at'>> = {}) => {
	const id = await insert(
		`INSERT INTO game (code, name, visibility, revealed_at, bingo, bingo_cols, bingo_line_points, bingo_board_points, created_at)
		 VALUES (?, 'Test game', ?, ?, ?, ?, ?, ?, ?)`,
		`CODE${uniq()}`.replace(/\W/g, ''), o.visibility ?? 'hidden', o.revealed_at ?? 0, o.bingo ?? 0, o.bingo_cols ?? 4,
		o.bingo_line_points ?? 0, o.bingo_board_points ?? 0, now()
	);
	return game(id);
};

export const game = async (id: number) => {
	const { get } = await import('../../src/lib/server/db.ts');
	return (await get<Game>('SELECT * FROM game WHERE id = ?', id))!;
};

export const mkTeam = (gameId: number, name = 'Team') => insert('INSERT INTO team (game_id, name, color) VALUES (?, ?, ?)', gameId, name, '#fff');

export const mkMember = (gameId: number, userId: number, teamId: number | null, role = 'player', status = 'active') =>
	run('INSERT INTO member (game_id, user_id, team_id, role, status) VALUES (?, ?, ?, ?, ?)', gameId, userId, teamId, role, status);

export const mkCategory = (gameId: number, o: { cap?: number | null; max?: number | null; sort?: number; active?: number } = {}) =>
	insert('INSERT INTO category (game_id, name, scoring_cap, max_points, sort, active) VALUES (?, ?, ?, ?, ?, ?)', gameId, 'Cat', o.cap ?? null, o.max ?? null, o.sort ?? 0, o.active ?? 1);

export const mkOption = (categoryId: number, points: number, kind: 'tier' | 'extra' | 'bonus' = 'tier') =>
	insert('INSERT INTO score_option (category_id, label, points, kind) VALUES (?, ?, ?, ?)', categoryId, `${kind} ${points}`, points, kind);

export const mkPhoto = (g: { id: number }, o: { cat: number | null; team: number; user: number; status?: string; override?: number | null }) =>
	insert(
		'INSERT INTO photo (game_id, category_id, user_id, team_id, ext, width, height, status, points_override, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)',
		g.id, o.cat, o.user, o.team, 'jpg', o.status ?? 'ok', o.override ?? null, now()
	);

export const claim = (photoId: number, optionId: number, qty = 1) =>
	run('INSERT INTO photo_claim (photo_id, option_id, qty) VALUES (?, ?, ?)', photoId, optionId, qty);

export const teamTotal = async (gameId: number, teamId: number) =>
	(await scoreGame(await game(gameId))).teams.find((t) => t.id === teamId)!;

export const asUser = async (id: number) => {
	const { get } = await import('../../src/lib/server/db.ts');
	const u = (await get<any>('SELECT id, email, name, is_admin, email_verified_at FROM user WHERE id = ?', id))!;
	return { id: u.id, email: u.email, name: u.name, is_admin: u.is_admin, verified: !!u.email_verified_at };
};
export const locals = async (id: number | null) => ({ user: id ? await asUser(id) : null }) as unknown as App.Locals;
