import { error, redirect } from '@sveltejs/kit';
import { get } from './db.ts';
import type { User } from './auth.ts';

export type Game = {
	id: number;
	code: string;
	name: string;
	visibility: 'hidden' | 'open';
	revealed_at: number;
	team_mode: 'admin' | 'self';
	max_team_size: number | null;
	submissions_open: number;
	doubt_limit: number;
	bingo: number;
	bingo_cols: number;
	bingo_line_points: number;
	bingo_board_points: number;
	created_at: number;
};
export type Team = { id: number; game_id: number; name: string; color: string };
export type Viewer = { user: User; teamId: number | null; isAdmin: boolean };

export async function gameByCode(code: string): Promise<Game> {
	const g = await get<Game>('SELECT * FROM game WHERE code = ?', code);
	if (!g) error(404, 'No game with that code');
	return g;
}

/** Loads the game and the signed-in player's place in it; sends strangers to the join page. */
export async function enter(locals: App.Locals, code: string): Promise<{ game: Game; viewer: Viewer }> {
	const game = await gameByCode(code);
	if (!locals.user) redirect(303, `/join/${game.code}`);
	const m = await get<{ team_id: number | null }>(
		'SELECT team_id FROM member WHERE game_id = ? AND user_id = ?',
		game.id,
		locals.user.id
	);
	if (!m && !locals.user.is_admin) redirect(303, `/join/${game.code}`);
	return {
		game,
		viewer: { user: locals.user, teamId: m?.team_id ?? null, isAdmin: !!locals.user.is_admin }
	};
}

export function requireAdmin(locals: App.Locals): User {
	if (!locals.user) redirect(303, '/login');
	if (!locals.user.is_admin) error(403, 'Admins only');
	return locals.user;
}

export function canSee(
	game: Game,
	viewer: Viewer,
	photo: { team_id: number; created_at: number }
): boolean {
	return (
		viewer.isAdmin ||
		game.visibility === 'open' ||
		photo.team_id === viewer.teamId ||
		photo.created_at <= game.revealed_at
	);
}

/** SQL condition (on alias `p`) matching the photos this viewer may see. */
export function visibleSql(game: Game, viewer: Viewer): { sql: string; params: number[] } {
	if (viewer.isAdmin || game.visibility === 'open') return { sql: '1=1', params: [] };
	return {
		sql: '(p.team_id = ? OR p.created_at <= ?)',
		params: [viewer.teamId ?? -1, game.revealed_at]
	};
}

export function num(v: unknown, fallback = 0): number {
	const n = Number(String(v ?? '').trim());
	return Number.isFinite(n) ? n : fallback;
}
export function intOrNull(v: unknown): number | null {
	const s = String(v ?? '').trim();
	if (!s) return null;
	const n = Math.floor(Number(s));
	return Number.isFinite(n) && n > 0 ? n : null;
}
export function str(v: unknown, max = 2000): string {
	return String(v ?? '').trim().slice(0, max);
}
