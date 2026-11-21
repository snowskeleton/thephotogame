import { all } from '#lib/server/db.ts';
import { enter } from '#lib/server/game.ts';
import { listPhotos } from '#lib/server/photos.ts';

export const load = async ({ params, locals, url }) => {
	const { game, viewer } = await enter(locals, params.code);
	return {
		awards: await all<{ id: number; name: string; description: string; points: number; scope: string; status: string; mine: number }>(
			`SELECT a.id, a.name, a.description, a.points, a.scope, a.status,
				(SELECT COUNT(*) FROM vote v WHERE v.award_id = a.id AND v.user_id = ?) AS mine
			 FROM award a WHERE a.game_id = ? AND a.status != 'draft' ORDER BY a.status DESC, a.sort, a.id`,
			viewer.user.id,
			game.id
		),
		reviews: await listPhotos(game, viewer, { status: 'review' })
	};
};
