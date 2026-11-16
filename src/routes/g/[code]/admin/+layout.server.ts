import { requireAdmin } from '#lib/server/game.ts';

export const load = async ({ locals }) => {
	requireAdmin(locals);
};
