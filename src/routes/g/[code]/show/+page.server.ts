import { enter } from '#lib/server/game.ts';
import { browseFilter, listPhotos } from '#lib/server/photos.ts';

export const load = async ({ params, locals, url }) => {
	const { game, viewer } = await enter(locals, params.code);
	const { unscored: _, ...filter } = browseFilter(url, viewer.isHost);
	return {
		photos: (await listPhotos(game, viewer, { ...filter, oldestFirst: true })).filter((p) => p.status !== 'disqualified'),
		back: `/g/${game.code}/gallery${url.search}`
	};
};
