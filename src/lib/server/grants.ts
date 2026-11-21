import { batch, get, now, q } from './db.ts';
import { num, str, type Game } from './game.ts';

/** Gives a team points straight from the host, optionally tied to photos (they show on the photo's page). */
export async function giveTeamPoints(game: Game, f: FormData, photoIds: number[] = []) {
	const teamId = Number(f.get('team'));
	const title = str(f.get('title'), 80);
	const points = num(f.get('points'));
	if (!title) return 'Give it a short reason.';
	if (!points) return 'Enter how many points.';
	if (!(await get('SELECT 1 FROM team WHERE id = ? AND game_id = ?', teamId, game.id))) return 'Choose a team.';
	// One batch so a grant never exists without its photos. The new grant is the highest id in the table.
	await batch([
		q(
			'INSERT INTO grant_award (game_id, team_id, user_id, title, note, points, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)',
			game.id, teamId, title, str(f.get('note'), 400), points, now()
		),
		q(
			`INSERT INTO grant_photo (grant_id, photo_id)
			 SELECT (SELECT MAX(id) FROM grant_award), p.id FROM photo p
			 WHERE p.id IN (SELECT value FROM json_each(?)) AND p.game_id = ? AND p.category_id IS NOT NULL`,
			JSON.stringify(photoIds), game.id
		)
	]);
	return null;
}
