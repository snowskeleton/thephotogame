import { batch, get, now, q } from './db.ts';
import { num, str, type Game } from './game.ts';

/** Gives a team points for a photo (e.g. someone from another team is in it). The points show on the photo's page and stop counting if the photo is disqualified. */
export async function giveTeamPoints(game: Game, f: FormData, photoIds: number[]) {
	// Several teams can be credited at once; each gets its own grant with the same points and reason.
	const teamIds = [...new Set(f.getAll('team').map(Number))];
	const title = str(f.get('title'), 80);
	const points = num(f.get('points'));
	if (!photoIds.length) return 'Points have to come from a photo.';
	if (!title) return 'Give it a short reason.';
	if (!points) return 'Enter how many points.';
	for (const id of teamIds) if (!(await get('SELECT 1 FROM team WHERE id = ? AND game_id = ?', id, game.id))) return 'Choose a team.';
	if (!teamIds.length) return 'Choose at least one team.';
	// One batch so a grant never exists without its photos. Each grant is the highest id in the table when its photo rows run.
	const note = str(f.get('note'), 400);
	await batch(
		teamIds.flatMap((teamId) => [
			q(
				'INSERT INTO grant_award (game_id, team_id, user_id, title, note, points, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)',
				game.id, teamId, title, note, points, now()
			),
			q(
				`INSERT INTO grant_photo (grant_id, photo_id)
				 SELECT (SELECT MAX(id) FROM grant_award), p.id FROM photo p
				 WHERE p.id IN (SELECT value FROM json_each(?)) AND p.game_id = ? AND p.category_id IS NOT NULL`,
				JSON.stringify(photoIds), game.id
			)
		])
	);
	return null;
}
