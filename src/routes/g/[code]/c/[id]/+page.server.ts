import { error } from '@sveltejs/kit';
import { all, get } from '#lib/server/db.ts';
import { enter } from '#lib/server/game.ts';
import { optionsFor } from '#lib/server/claims.ts';
import { listPhotos } from '#lib/server/photos.ts';
import { scoreGame } from '#lib/server/scoring.ts';
import { savePhotos } from '#lib/server/uploads.ts';

type Category = {
	id: number; name: string; rules: string; notes: string; day_label: string; scoring_cap: number | null; max_points: number | null; active: number;
};
const find = async (gameId: number, id: string) => {
	const c = await get<Category>('SELECT * FROM category WHERE id = ? AND game_id = ?', Number(id), gameId);
	if (!c) error(404, 'No such category');
	return c;
};

export const load = async ({ params, locals, url }) => {
	const { game, viewer } = await enter(locals, params.code);
	const category = await find(game.id, params.id);
	const scores = (await scoreGame(game)).photoScores;
	const photos = (await listPhotos(game, viewer, { cat: category.id })).map((p) => ({ ...p, score: scores.get(p.id)! }));
	const ours = photos.filter((p) => p.team_id === viewer.teamId);
	const claims = await all<{ photo_id: number; option_id: number; qty: number }>(
		`SELECT c.photo_id, c.option_id, c.qty FROM photo_claim c JOIN photo p ON p.id = c.photo_id
		 WHERE p.category_id = ? AND p.team_id = ?`,
		category.id,
		viewer.teamId ?? -1
	);
	return {
		category,
		options: await optionsFor(category.id),
		ours: ours.map((p) => ({ ...p, claims: claims.filter((c) => c.photo_id === p.id) })),
		theirs: photos.filter((p) => p.team_id !== viewer.teamId),
		categories: await all<{ id: number; name: string }>(
			'SELECT id, name FROM category WHERE game_id = ? AND (active = 1 OR ? OR id = ?) ORDER BY sort, id',
			game.id,
			viewer.isHost ? 1 : 0,
			category.id
		)
	};
};

export const actions = {
	default: async ({ request, params, locals, url }) => {
		const { game, viewer } = await enter(locals, params.code);
		return await savePhotos(game, viewer, await request.formData(), await find(game.id, params.id));
	}
};
