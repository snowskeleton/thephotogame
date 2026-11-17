import { error, redirect } from '@sveltejs/kit';
import { get, insert, now } from './db.ts';
import { settings } from './settings.ts';
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
/** isHost: may run this game (a host of it, or the site admin). */
export type Viewer = { user: User; teamId: number | null; isHost: boolean };
type Membership = { team_id: number | null; role: string; status: string };

export async function gameByCode(code: string): Promise<Game> {
	const g = await get<Game>('SELECT * FROM game WHERE code = ?', code);
	if (!g) error(404, 'No game with that code');
	return g;
}

const membership = (gameId: number, userId: number) =>
	get<Membership>('SELECT team_id, role, status FROM member WHERE game_id = ? AND user_id = ?', gameId, userId);

/** Loads the game and the signed-in player's place in it; sends strangers (and the not-yet-accepted) to the join page. */
export async function enter(locals: App.Locals, code: string): Promise<{ game: Game; viewer: Viewer }> {
	const game = await gameByCode(code);
	if (!locals.user) redirect(303, `/join/${game.code}`);
	const m = await membership(game.id, locals.user.id);
	const active = m?.status === 'active';
	if (!active && !locals.user.is_admin) redirect(303, `/join/${game.code}`);
	return {
		game,
		viewer: {
			user: locals.user,
			teamId: active ? m!.team_id : null,
			isHost: !!locals.user.is_admin || (active && m!.role === 'host')
		}
	};
}

/** The game, if the signed-in person may run it (one of its hosts, or the site admin). */
export async function requireHost(locals: App.Locals, code: string): Promise<Game> {
	if (!locals.user) redirect(303, '/login');
	const game = await gameByCode(code);
	if (locals.user.is_admin) return game;
	const m = await membership(game.id, locals.user.id);
	if (m?.status !== 'active' || m.role !== 'host') error(403, 'Only this game’s hosts can do that');
	return game;
}

/** Site admins only: the site-wide pages (all games, all people, settings). */
export function requireAdmin(locals: App.Locals): User {
	if (!locals.user) redirect(303, '/login');
	if (!locals.user.is_admin) error(403, 'Site admins only');
	return locals.user;
}

/** Whether this person may create a game now, and if not, why. */
export async function hostingCheck(user: User): Promise<{ ok: true } | { ok: false; why: 'closed' | 'unverified' | 'limit'; limit?: number }> {
	if (user.is_admin) return { ok: true };
	const s = await settings();
	if (!s.signups) return { ok: false, why: 'closed' };
	if (!user.verified) return { ok: false, why: 'unverified' };
	const made = (await get<{ n: number }>('SELECT COUNT(*) AS n FROM game WHERE created_by = ?', user.id))!.n;
	if (made >= s.maxGames) return { ok: false, why: 'limit', limit: s.maxGames };
	return { ok: true };
}

// Join codes: 10 characters from 31 that can't be mixed up (no 0/O, 1/I/L), about 8×10^14 possibilities,
// so a code can't be found by guessing. Anyone with the code can join, so it's as good as an invite.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;

/** A code as typed: upper case, with spaces and dashes dropped. */
export const cleanCode = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);

export async function randomCode(): Promise<string> {
	for (;;) {
		// 248 is the largest multiple of 31 under 256, so every letter is equally likely.
		const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2)).filter((b) => b < 248);
		if (bytes.length < CODE_LENGTH) continue;
		const code = Array.from(bytes.slice(0, CODE_LENGTH), (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
		if (!(await get('SELECT 1 FROM game WHERE code = ?', code))) return code;
	}
}

/** Creates a game with its creator as host. Check hostingCheck first. */
export async function createGame(user: User, name: string): Promise<string> {
	const code = await randomCode();
	const id = await insert('INSERT INTO game (code, name, created_by, created_at) VALUES (?, ?, ?, ?)', code, name, user.id, now());
	await insert("INSERT INTO member (game_id, user_id, role, status) VALUES (?, ?, 'host', 'active')", id, user.id);
	return code;
}

export function canSee(
	game: Game,
	viewer: Viewer,
	photo: { team_id: number; created_at: number }
): boolean {
	return (
		viewer.isHost ||
		game.visibility === 'open' ||
		photo.team_id === viewer.teamId ||
		photo.created_at <= game.revealed_at
	);
}

/** SQL condition (on alias `p`) matching the photos this viewer may see. */
export function visibleSql(game: Game, viewer: Viewer): { sql: string; params: number[] } {
	if (viewer.isHost || game.visibility === 'open') return { sql: '1=1', params: [] };
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
