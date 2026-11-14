import { fail } from '@sveltejs/kit';
import { all, get, insert, run } from '#lib/server/db.ts';
import { validColor } from '#lib/colors.ts';
import { enter, str } from '#lib/server/game.ts';
import { scoreGame } from '#lib/server/scoring.ts';

export const load = ({ params, locals, url }) => {
	const { game, viewer } = enter(locals, params.code, url.pathname);
	const categories = all<{ id: number; name: string; day_label: string; top: number | null }>(
		`SELECT c.id, c.name, c.day_label,
			(SELECT MAX(points) FROM score_option o WHERE o.category_id = c.id AND o.kind = 'tier') AS top
		 FROM category c WHERE c.game_id = ? AND c.active = 1 ORDER BY c.sort, c.id`,
		game.id
	);
	const mine = viewer.teamId
		? all<{ category_id: number; n: number; cover: number }>(
				`SELECT category_id, COUNT(*) AS n, MAX(id) AS cover FROM photo
				 WHERE team_id = ? AND status != 'disqualified' GROUP BY category_id`,
				viewer.teamId
			)
		: [];
	const others = all<{ category_id: number; color: string }>(
		`SELECT DISTINCT p.category_id, t.color FROM photo p JOIN team t ON t.id = p.team_id
		 WHERE p.game_id = ? AND p.status != 'disqualified' AND p.team_id != ?`,
		game.id,
		viewer.teamId ?? -1
	);
	const teams = all<{ id: number; name: string; color: string; members: number; names: string | null }>(
		`SELECT t.*, COUNT(m.user_id) AS members, GROUP_CONCAT(u.name, ', ') AS names
		 FROM team t LEFT JOIN member m ON m.team_id = t.id LEFT JOIN user u ON u.id = m.user_id
		 WHERE t.game_id = ? GROUP BY t.id ORDER BY t.id`,
		game.id
	);
	const score = scoreGame(game).teams.find((t) => t.id === viewer.teamId) ?? null;
	return { categories, mine, others, teams, score };
};

export const actions = {
	joinTeam: async ({ request, params, locals, url }) => {
		const { game, viewer } = enter(locals, params.code, url.pathname);
		if (game.team_mode !== 'self') return fail(403, { error: 'The showrunner is assigning teams.' });
		if (viewer.teamId) return fail(400, { error: 'You’re already on a team. Ask the showrunner to move you.' });
		const teamId = Number((await request.formData()).get('team'));
		const team = get<{ id: number; n: number }>(
			`SELECT t.id, (SELECT COUNT(*) FROM member m WHERE m.team_id = t.id) AS n
			 FROM team t WHERE t.id = ? AND t.game_id = ?`,
			teamId,
			game.id
		);
		if (!team) return fail(400, { error: 'That team is gone.' });
		if (game.max_team_size && team.n >= game.max_team_size) return fail(400, { error: 'That team is full.' });
		run('INSERT OR REPLACE INTO member (game_id, user_id, team_id) VALUES (?, ?, ?)', game.id, viewer.user.id, team.id);
	},
	newTeam: async ({ request, params, locals, url }) => {
		const { game, viewer } = enter(locals, params.code, url.pathname);
		if (game.team_mode !== 'self') return fail(403, { error: 'The showrunner is assigning teams.' });
		if (viewer.teamId) return fail(400, { error: 'You’re already on a team.' });
		const f = await request.formData();
		const name = str(f.get('name'), 40);
		const color = validColor(f.get('color'));
		if (!name) return fail(400, { error: 'Give your team a name.' });
		if (!color) return fail(400, { error: 'Pick a color.' });
		const id = insert('INSERT INTO team (game_id, name, color) VALUES (?, ?, ?)', game.id, name, color);
		run('INSERT OR REPLACE INTO member (game_id, user_id, team_id) VALUES (?, ?, ?)', game.id, viewer.user.id, id);
	}
};
