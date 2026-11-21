import { all } from '#lib/server/db.ts';
import { enter } from '#lib/server/game.ts';
import { listPhotos } from '#lib/server/photos.ts';
import { scoreGame } from '#lib/server/scoring.ts';

export const load = async ({ params, locals, url }) => {
	const { game, viewer } = await enter(locals, params.code);
	const filter = {
		cat: Number(url.searchParams.get('cat')) || undefined,
		team: Number(url.searchParams.get('team')) || undefined,
		day: url.searchParams.get('day') || undefined,
		unscored: viewer.isHost && url.searchParams.get('unscored') === '1'
	};
	// Hosts see each photo's scoring state and can filter to the ones that still need points.
	const scores = viewer.isHost ? (await scoreGame(game)).photoScores : null;
	const withScores = async () => {
		const rows = await listPhotos(game, viewer, filter);
		if (!scores) return rows;
		const scored = rows.map((p) => ({ ...p, score: scores.get(p.id) }));
		return filter.unscored ? scored.filter((p) => p.score?.pending) : scored;
	};
	const everything = await listPhotos(game, viewer);
	return {
		filter,
		photos: await withScores(),
		days: [...new Set(everything.map((p) => p.day))],
		hiddenCount: viewer.isHost
			? 0
			: ((await all<{ n: number }>('SELECT COUNT(*) AS n FROM photo WHERE game_id = ? AND category_id IS NOT NULL', game.id))[0].n - everything.length),
		categories: await all<{ id: number; name: string }>(
			'SELECT id, name FROM category WHERE game_id = ? ORDER BY sort, id',
			game.id
		),
		teams: await all<{ id: number; name: string }>('SELECT id, name FROM team WHERE game_id = ? ORDER BY id', game.id)
	};
};
