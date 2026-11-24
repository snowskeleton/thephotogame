import { all, config } from './db.ts';
import type { BrowseFilter } from '../browse.ts';
import { visibleSql, type Game, type Viewer } from './game.ts';

export type PhotoRow = {
	id: number;
	category_id: number;
	category: string;
	item_id: number | null;
	item: string | null;
	team_id: number;
	team: string;
	color: string;
	user_id: number;
	who: string;
	caption: string;
	status: 'ok' | 'review' | 'disqualified';
	width: number;
	height: number;
	created_at: number;
	day: string;
};

const SELECT = `SELECT p.id, p.category_id, c.name AS category, p.item_id, ci.label AS item, p.team_id, t.name AS team, t.color,
	p.user_id, u.name AS who, p.caption, p.status, p.width, p.height, p.created_at
	FROM photo p JOIN category c ON c.id = p.category_id LEFT JOIN category_item ci ON ci.id = p.item_id JOIN team t ON t.id = p.team_id
	JOIN user u ON u.id = p.user_id`;

// D1's "localtime" is UTC, so the calendar day is worked out here, in the game's time zone.
let dayFormat: Intl.DateTimeFormat | undefined;
export function dayOf(ms: number): string {
	dayFormat ??= new Intl.DateTimeFormat('en-CA', { timeZone: config().TIME_ZONE || 'America/New_York' });
	return dayFormat.format(ms); // en-CA formats as YYYY-MM-DD
}
const withDay = (rows: Omit<PhotoRow, 'day'>[]): PhotoRow[] => rows.map((p) => ({ ...p, day: dayOf(p.created_at) }));

export async function listPhotos(
	game: Game,
	viewer: Viewer,
	f: { cat?: number; item?: number; team?: number; user?: number; day?: string; status?: string; oldestFirst?: boolean } = {}
): Promise<PhotoRow[]> {
	const vis = visibleSql(game, viewer);
	const where = ['p.game_id = ?', vis.sql];
	const params: (number | string)[] = [game.id, ...vis.params];
	if (f.cat) (where.push('p.category_id = ?'), params.push(f.cat));
	if (f.item) (where.push('p.item_id = ?'), params.push(f.item));
	if (f.team) (where.push('p.team_id = ?'), params.push(f.team));
	if (f.user) (where.push('p.user_id = ?'), params.push(f.user));
	if (f.status) (where.push('p.status = ?'), params.push(f.status));
	const rows = withDay(
		await all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY p.created_at ${f.oldestFirst ? 'ASC' : 'DESC'}`, ...params)
	);
	return f.day ? rows.filter((p) => p.day === f.day) : rows;
}

export async function onePhoto(gameId: number, id: number): Promise<PhotoRow | undefined> {
	return withDay(await all(`${SELECT} WHERE p.game_id = ? AND p.id = ?`, gameId, id))[0];
}

/** The gallery filters carried in a URL's query string (gallery, slideshow and photo pages all share them). */
export function browseFilter(url: URL, isHost: boolean): BrowseFilter {
	const p = url.searchParams;
	return {
		cat: Number(p.get('cat')) || undefined,
		item: Number(p.get('item')) || undefined,
		team: Number(p.get('team')) || undefined,
		user: Number(p.get('user')) || undefined,
		day: p.get('day') || undefined,
		unscored: isHost && p.get('unscored') === '1'
	};
}
