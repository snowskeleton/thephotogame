import { json } from '@sveltejs/kit';
import { gameByCode, requireHost } from '#lib/server/game.ts';
import { all } from '#lib/server/db.ts';

const safe = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 60) || 'untitled';

/**
 * The list of originals and their names inside the zip. The admin page fetches each one and builds the
 * zip in the browser: zipping hundreds of MB would blow through a Worker's CPU limit.
 */
export const GET = async ({ params, locals }) => {
	const game = await requireHost(locals, params.code);
	const photos = await all<{ id: number; ext: string; category: string; team: string; who: string }>(
		`SELECT p.id, p.ext, c.name AS category, t.name AS team, u.name AS who
		 FROM photo p JOIN category c ON c.id = p.category_id JOIN team t ON t.id = p.team_id
		 JOIN user u ON u.id = p.user_id WHERE p.game_id = ? ORDER BY c.sort, p.id`,
		game.id
	);
	return json({
		zip: `${safe(game.name)}.zip`,
		files: photos.map((p) => ({
			url: `/media/${p.id}/original`,
			name: `${safe(p.category)}/${safe(p.team)} - ${safe(p.who)} - ${p.id}.${p.ext}`
		}))
	});
};
