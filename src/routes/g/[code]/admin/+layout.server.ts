import { requireAdmin } from '#lib/server/game.ts';

export const load = ({ locals }) => {
	requireAdmin(locals);
};
