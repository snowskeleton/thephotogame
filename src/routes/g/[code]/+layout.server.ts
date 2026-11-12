import { get } from '#lib/server/db.ts';
import { enter, type Team } from '#lib/server/game.ts';

export const load = ({ params, locals, url }) => {
	const { game, viewer } = enter(locals, params.code, url.pathname);
	const team = viewer.teamId ? (get<Team>('SELECT * FROM team WHERE id = ?', viewer.teamId) ?? null) : null;
	return { game, team, isAdmin: viewer.isAdmin };
};
