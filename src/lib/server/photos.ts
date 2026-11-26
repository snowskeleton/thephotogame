import { all, config } from './db.ts';
import { BROWSE_SETS, type BrowseFilter, type BrowseSet } from '../browse.ts';
import { scoreGame } from './scoring.ts';
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

/** Ids of the photos in a subset (winners, any vote, superlatives), before visibility rules are applied. */
export async function setIds(game: Game, set: BrowseSet): Promise<Set<number>> {
	if (set === 'winners') return new Set((await scoreGame(game)).winners.map((w) => w.photo_id));
	const rows =
		set === 'voted'
			? await all<{ id: number }>('SELECT DISTINCT v.photo_id AS id FROM vote v JOIN award a ON a.id = v.award_id WHERE a.game_id = ?', game.id)
			: await all<{ id: number }>("SELECT photo_id AS id FROM superlative WHERE game_id = ? AND kind = 'photo'", game.id);
	return new Set(rows.map((r) => r.id));
}

export async function listPhotos(
	game: Game,
	viewer: Viewer,
	f: { cat?: number; item?: number; team?: number; user?: number; day?: string; set?: BrowseSet; status?: string; oldestFirst?: boolean } = {}
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
	const inSet = f.set ? await setIds(game, f.set) : null;
	return rows.filter((p) => (!f.day || p.day === f.day) && (!inSet || inSet.has(p.id)));
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
		unscored: isHost && p.get('unscored') === '1',
		// Open votes are secret, so only hosts may list every photo that received one.
		set: BROWSE_SETS.find((s) => s === p.get('set') && (s !== 'voted' || isHost))
	};
}
