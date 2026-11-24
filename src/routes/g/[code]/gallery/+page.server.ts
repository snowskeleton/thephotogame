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
	// Each dropdown's counts apply every other active filter, so "(0) Poodle" means none in the current view.
	const dims = {
		cat: (p: (typeof everything)[number]) => !filter.cat || p.category_id === filter.cat,
		item: (p: (typeof everything)[number]) => !filter.item || p.item_id === filter.item,
		team: (p: (typeof everything)[number]) => !filter.team || p.team_id === filter.team,
		user: (p: (typeof everything)[number]) => !filter.user || p.user_id === filter.user,
		day: (p: (typeof everything)[number]) => !filter.day || p.day === filter.day,
		unscored: (p: (typeof everything)[number]) =>
			!filter.unscored || (scores?.get(p.id)?.pending === true && p.status !== 'disqualified')
	};
	const counts = Object.fromEntries(
		(['cat', 'item', 'team', 'user', 'day'] as const).map((skip) => {
			const n: Record<string, number> = {};
			const key = { cat: 'category_id', item: 'item_id', team: 'team_id', user: 'user_id', day: 'day' }[skip] as keyof (typeof everything)[number];
			for (const p of everything)
				if (Object.entries(dims).every(([k, fn]) => k === skip || fn(p))) n[String(p[key])] = (n[String(p[key])] ?? 0) + 1;
			return [skip, n];
		})
	) as Record<'cat' | 'item' | 'team' | 'user' | 'day', Record<string, number>>;
	return {
		filter,
		counts,
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
