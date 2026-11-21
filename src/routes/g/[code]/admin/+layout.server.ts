import { requireHost } from '#lib/server/game.ts';

export const load = async ({ locals, params }) => {
	await requireHost(locals, params.code);
};
