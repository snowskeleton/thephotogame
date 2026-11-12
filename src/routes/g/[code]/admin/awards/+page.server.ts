import { fail } from '@sveltejs/kit';
import { all, get, insert, now, run, tx } from '#lib/server/db.ts';
import { gameByCode, num, requireAdmin, str } from '#lib/server/game.ts';

export const load = ({ params, url }) => {
	const game = gameByCode(params.code);
	const photos = all<{ id: number; team_id: number; user_id: number; color: string; category: string }>(
		`SELECT p.id, p.team_id, p.user_id, t.color, c.name AS category FROM photo p
		 JOIN team t ON t.id = p.team_id JOIN category c ON c.id = p.category_id
		 WHERE p.game_id = ? ORDER BY p.created_at DESC`,
		game.id
	);
	return {
		awards: all<{ id: number; name: string; description: string; points: number; scope: string; status: string; votes: number; voters: number }>(
			`SELECT a.*, (SELECT COUNT(*) FROM vote v WHERE v.award_id = a.id) AS votes,
				(SELECT COUNT(DISTINCT user_id) FROM vote v WHERE v.award_id = a.id) AS voters
			 FROM award a WHERE a.game_id = ? ORDER BY a.sort, a.id`,
			game.id
		),
		grants: all<{ id: number; title: string; note: string; points: number; team: string; color: string; who: string | null; photos: number }>(
			`SELECT g.id, g.title, g.note, g.points, t.name AS team, t.color, u.name AS who,
				(SELECT COUNT(*) FROM grant_photo gp WHERE gp.grant_id = g.id) AS photos
			 FROM grant_award g JOIN team t ON t.id = g.team_id LEFT JOIN user u ON u.id = g.user_id
			 WHERE g.game_id = ? ORDER BY g.created_at DESC`,
			game.id
		),
		teams: all<{ id: number; name: string }>('SELECT id, name FROM team WHERE game_id = ? ORDER BY id', game.id),
		players: all<{ id: number; name: string; team_id: number | null }>(
			`SELECT u.id, u.name, m.team_id FROM member m JOIN user u ON u.id = m.user_id WHERE m.game_id = ? ORDER BY u.name`,
			game.id
		),
		photos,
		preset: photos.find((p) => p.id === Number(url.searchParams.get('photo'))) ?? null
	};
};

export const actions = {
	addAward: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		const f = await request.formData();
		const name = str(f.get('name'), 80);
		if (!name) return fail(400, { error: 'Give the award a name.' });
		insert(
			'INSERT INTO award (game_id, name, description, points, scope) VALUES (?, ?, ?, ?, ?)',
			game.id, name, str(f.get('description'), 400), num(f.get('points')), f.get('scope') === 'category' ? 'category' : 'game'
		);
	},
	saveAward: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		const f = await request.formData();
		const name = str(f.get('name'), 80);
		if (!name) return fail(400, { error: 'Give the award a name.' });
		run(
			'UPDATE award SET name = ?, description = ?, points = ?, scope = ? WHERE id = ? AND game_id = ?',
			name, str(f.get('description'), 400), num(f.get('points')), f.get('scope') === 'category' ? 'category' : 'game',
			Number(f.get('id')), game.id
		);
	},
	status: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		const f = await request.formData();
		const to = String(f.get('to'));
		if (!['draft', 'open', 'closed'].includes(to)) return fail(400, { error: 'Unknown status' });
		run('UPDATE award SET status = ? WHERE id = ? AND game_id = ?', to, Number(f.get('id')), game.id);
	},
	deleteAward: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		run('DELETE FROM award WHERE id = ? AND game_id = ?', Number((await request.formData()).get('id')), game.id);
	},
	grant: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		const f = await request.formData();
		const title = str(f.get('title'), 80);
		const teamId = Number(f.get('team'));
		const userId = Number(f.get('user')) || null;
		if (!title) return fail(400, { grantError: 'Give the award a title.' });
		if (!get('SELECT 1 FROM team WHERE id = ? AND game_id = ?', teamId, game.id))
			return fail(400, { grantError: 'Choose which team gets the points.' });
		if (userId && !get('SELECT 1 FROM member WHERE user_id = ? AND game_id = ?', userId, game.id))
			return fail(400, { grantError: 'That player isn’t in this game.' });
		const photoIds = f.getAll('photos').map(Number);
		tx(() => {
			const id = insert(
				'INSERT INTO grant_award (game_id, team_id, user_id, title, note, points, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
				game.id, teamId, userId, title, str(f.get('note'), 400), num(f.get('points')), now()
			);
			for (const pid of new Set(photoIds))
				if (get('SELECT 1 FROM photo WHERE id = ? AND game_id = ?', pid, game.id))
					run('INSERT INTO grant_photo (grant_id, photo_id) VALUES (?, ?)', id, pid);
		});
		return { granted: true };
	},
	deleteGrant: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		run('DELETE FROM grant_award WHERE id = ? AND game_id = ?', Number((await request.formData()).get('id')), game.id);
	}
};
