import { all, config } from './db.ts';
import { visibleSql, type Game, type Viewer } from './game.ts';

export type PhotoRow = {
	id: number;
	category_id: number;
	category: string;
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

const SELECT = `SELECT p.id, p.category_id, c.name AS category, p.team_id, t.name AS team, t.color,
	p.user_id, u.name AS who, p.caption, p.status, p.width, p.height, p.created_at
	FROM photo p JOIN category c ON c.id = p.category_id JOIN team t ON t.id = p.team_id
	JOIN user u ON u.id = p.user_id`;

// D1's "localtime" is UTC, so the calendar day is worked out here, in the game's time zone.
let dayFormat: Intl.DateTimeFormat | undefined;
export function dayOf(ms: number): string {
	dayFormat ??= new Intl.DateTimeFormat('en-CA', { timeZone: config().TIME_ZONE || 'UTC' });
	return dayFormat.format(ms); // en-CA formats as YYYY-MM-DD
}
const withDay = (rows: Omit<PhotoRow, 'day'>[]): PhotoRow[] => rows.map((p) => ({ ...p, day: dayOf(p.created_at) }));

export async function listPhotos(
	game: Game,
	viewer: Viewer,
	f: { cat?: number; team?: number; day?: string; status?: string; oldestFirst?: boolean } = {}
): Promise<PhotoRow[]> {
	const vis = visibleSql(game, viewer);
	const where = ['p.game_id = ?', vis.sql];
	const params: (number | string)[] = [game.id, ...vis.params];
	if (f.cat) (where.push('p.category_id = ?'), params.push(f.cat));
	if (f.team) (where.push('p.team_id = ?'), params.push(f.team));
	if (f.status) (where.push('p.status = ?'), params.push(f.status));
	const rows = withDay(
		await all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY p.created_at ${f.oldestFirst ? 'ASC' : 'DESC'}`, ...params)
	);
	return f.day ? rows.filter((p) => p.day === f.day) : rows;
}

export async function onePhoto(gameId: number, id: number): Promise<PhotoRow | undefined> {
	return withDay(await all(`${SELECT} WHERE p.game_id = ? AND p.id = ?`, gameId, id))[0];
}
