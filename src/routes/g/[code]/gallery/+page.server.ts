import { all } from '#lib/server/db.ts';
import { enter } from '#lib/server/game.ts';
import { listPhotos } from '#lib/server/photos.ts';

export const load = ({ params, locals, url }) => {
	const { game, viewer } = enter(locals, params.code, url.pathname);
	const filter = {
		cat: Number(url.searchParams.get('cat')) || undefined,
		team: Number(url.searchParams.get('team')) || undefined,
		day: url.searchParams.get('day') || undefined
	};
	const everything = listPhotos(game, viewer);
	return {
		filter,
		photos: listPhotos(game, viewer, filter),
		days: [...new Set(everything.map((p) => p.day))],
		hiddenCount: viewer.isAdmin
			? 0
			: (all<{ n: number }>('SELECT COUNT(*) AS n FROM photo WHERE game_id = ?', game.id)[0].n - everything.length),
		categories: all<{ id: number; name: string }>(
			'SELECT id, name FROM category WHERE game_id = ? ORDER BY sort, id',
			game.id
		),
		teams: all<{ id: number; name: string }>('SELECT id, name FROM team WHERE game_id = ? ORDER BY id', game.id)
	};
};
