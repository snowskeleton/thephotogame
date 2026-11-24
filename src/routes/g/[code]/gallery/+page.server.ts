import { all } from '#lib/server/db.ts';
import { enter } from '#lib/server/game.ts';
import { itemsFor } from '#lib/server/items.ts';
import { browseFilter, listPhotos } from '#lib/server/photos.ts';
import { scoreGame } from '#lib/server/scoring.ts';

export const load = async ({ params, locals, url }) => {
	const { game, viewer } = await enter(locals, params.code);
	const filter = browseFilter(url, viewer.isHost);
	// The checklist filter only means something inside its own category.
	const items = filter.cat ? await itemsFor(filter.cat) : [];
	if (filter.item && !items.some((i) => i.id === filter.item)) filter.item = undefined;
	// Hosts see each photo's scoring state and can filter to the ones that still need points.
	const scores = viewer.isHost ? (await scoreGame(game)).photoScores : null;
	const rows = await listPhotos(game, viewer, filter);
	const photos = rows.map((p) => ({ ...p, score: scores?.get(p.id) }));
	const everything = await listPhotos(game, viewer);
	const people = new Map(everything.map((p) => [p.user_id, p.who]));
	return {
		filter,
		items,
		photos: filter.unscored ? photos.filter((p) => p.score?.pending && p.status !== 'disqualified') : photos,
		days: [...new Set(everything.map((p) => p.day))],
		people: [...people].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
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
