import { all, get, insert, now, run } from './db.ts';
import { str } from './game.ts';
import { announce } from './webhooks.ts';

/**
 * Superlatives: titles a host makes up and gives to a person, a team or a photo. Free text, so a host can be
 * creative; there is no fixed list yet. They carry no points. Players see them on the Scores page (a photo's only
 * if that photo is visible to them), and the game's webhooks hear about each new one.
 */
export type Kind = 'person' | 'team' | 'photo';
export type Superlative = {
	id: number; title: string; note: string; kind: Kind; user_id: number | null; team_id: number | null; photo_id: number | null;
	created_at: number;
	/** Who or what won, as words: the person, the team, or the photographer for a photo. */
	who: string;
	team: string | null;
	color: string | null;
	/** For a photo: its owner team and age, which decide whether a viewer may see it. */
	photo_team_id: number | null;
	photo_created_at: number | null;
	photo_status: string | null;
};

export const MAX_PER_GAME = 200;

const SELECT = `SELECT s.id, s.title, s.note, s.kind, s.user_id, s.team_id, s.photo_id, s.created_at,
		CASE s.kind WHEN 'person' THEN pu.name WHEN 'team' THEN st.name ELSE ph_u.name END AS who,
		CASE s.kind WHEN 'person' THEN pt.name WHEN 'team' THEN NULL ELSE ph_t.name END AS team,
		CASE s.kind WHEN 'person' THEN pt.color WHEN 'team' THEN st.color ELSE ph_t.color END AS color,
		ph.team_id AS photo_team_id, ph.created_at AS photo_created_at, ph.status AS photo_status
	FROM superlative s
	LEFT JOIN user pu ON pu.id = s.user_id
	LEFT JOIN member pm ON pm.game_id = s.game_id AND pm.user_id = s.user_id
	LEFT JOIN team pt ON pt.id = pm.team_id
	LEFT JOIN team st ON st.id = s.team_id
	LEFT JOIN photo ph ON ph.id = s.photo_id
	LEFT JOIN user ph_u ON ph_u.id = ph.user_id
	LEFT JOIN team ph_t ON ph_t.id = ph.team_id`;

export const listSuperlatives = (gameId: number) => all<Superlative>(`${SELECT} WHERE s.game_id = ? ORDER BY s.id DESC`, gameId);
export const oneSuperlative = (id: number) => get<Superlative>(`${SELECT} WHERE s.id = ?`, id);

/** Gives a superlative. `to` is the person's user id, the team's id or the photo's id, by kind. Returns the new id or a message. */
export async function addSuperlative(gameId: number, o: { title: unknown; kind: unknown; to: unknown; note?: unknown }): Promise<{ id: number } | { error: string }> {
	const title = str(o.title, 80);
	if (!title) return { error: 'Write the superlative, such as “Most likely to nap”.' };
	const kind: Kind = o.kind === 'team' ? 'team' : o.kind === 'photo' ? 'photo' : 'person';
	const to = Number(o.to);
	const ok =
		kind === 'person' ? await get('SELECT 1 FROM member WHERE game_id = ? AND user_id = ?', gameId, to)
		: kind === 'team' ? await get('SELECT 1 FROM team WHERE game_id = ? AND id = ?', gameId, to)
		: await get('SELECT 1 FROM photo WHERE game_id = ? AND id = ? AND category_id IS NOT NULL', gameId, to);
	if (!ok) return { error: kind === 'person' ? 'Choose a player in this game.' : kind === 'team' ? 'Choose a team.' : 'Choose a photo that is filed in a category.' };
	const n = (await get<{ n: number }>('SELECT COUNT(*) AS n FROM superlative WHERE game_id = ?', gameId))!.n;
	if (n >= MAX_PER_GAME) return { error: `A game can have ${MAX_PER_GAME} superlatives.` };
	const id = await insert(
		'INSERT INTO superlative (game_id, title, note, kind, user_id, team_id, photo_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		gameId, title, str(o.note, 300), kind, kind === 'person' ? to : null, kind === 'team' ? to : null, kind === 'photo' ? to : null, now()
	);
	announce('superlative.awarded', kind === 'photo' ? to : null, { superlativeId: id }, gameId);
	return { id };
}

export const removeSuperlative = (gameId: number, id: number) => run('DELETE FROM superlative WHERE id = ? AND game_id = ?', id, gameId);
