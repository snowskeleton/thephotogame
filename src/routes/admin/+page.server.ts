import { fail, redirect } from '@sveltejs/kit';
import { all, get } from '#lib/server/db.ts';
import { createGame, requireAdmin, str } from '#lib/server/game.ts';
import { mailReady } from '#lib/server/mail.ts';
import { settings } from '#lib/server/settings.ts';

export const load = async ({ locals }) => {
	requireAdmin(locals);
	return {
		games: await all<{ code: string; name: string; players: number; photos: number; bytes: number; host: string | null }>(
			`SELECT g.code, g.name, (SELECT COUNT(*) FROM member m WHERE m.game_id = g.id AND m.status = 'active') AS players,
				(SELECT COUNT(*) FROM photo p WHERE p.game_id = g.id) AS photos,
				(SELECT COALESCE(SUM(p.bytes), 0) FROM photo p WHERE p.game_id = g.id) AS bytes,
				(SELECT u.name FROM user u WHERE u.id = g.created_by) AS host
			 FROM game g ORDER BY g.created_at DESC`
		),
		people: (await get<{ n: number; admins: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(is_admin), 0) AS admins FROM user'))!,
		settings: await settings(),
		mailReady: mailReady()
	};
};

export const actions = {
	newGame: async ({ request, locals }) => {
		const me = requireAdmin(locals);
		const name = str((await request.formData()).get('name'), 80);
		if (!name) return fail(400, { error: 'Give the game a name.' });
		redirect(303, `/g/${await createGame(me, name)}/admin`);
	}
};
