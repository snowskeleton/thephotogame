import { get } from '#lib/server/db.ts';
import { enter, type Team } from '#lib/server/game.ts';

export const load = async ({ params, locals, url }) => {
	const { game, viewer } = await enter(locals, params.code);
	const team = viewer.teamId ? (await get<Team>('SELECT * FROM team WHERE id = ?', viewer.teamId) ?? null) : null;
	return { game, team, isAdmin: viewer.isAdmin };
};
