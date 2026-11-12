import { enter } from '#lib/server/game.ts';
import { listPhotos } from '#lib/server/photos.ts';

export const load = ({ params, locals, url }) => {
	const { game, viewer } = enter(locals, params.code, url.pathname);
	return {
		photos: listPhotos(game, viewer, {
			cat: Number(url.searchParams.get('cat')) || undefined,
			team: Number(url.searchParams.get('team')) || undefined,
			day: url.searchParams.get('day') || undefined,
			oldestFirst: true
		}).filter((p) => p.status !== 'disqualified'),
		back: `/g/${game.code}/gallery${url.search}`
	};
};
