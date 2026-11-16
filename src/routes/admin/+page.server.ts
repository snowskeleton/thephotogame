import { fail, redirect } from '@sveltejs/kit';
import { all, get, insert, now, run } from '#lib/server/db.ts';
import { requireAdmin, str } from '#lib/server/game.ts';

export const load = async ({ locals }) => {
	requireAdmin(locals);
	return {
		games: await all<{ code: string; name: string; players: number; photos: number }>(
			`SELECT g.code, g.name, (SELECT COUNT(*) FROM member m WHERE m.game_id = g.id) AS players,
				(SELECT COUNT(*) FROM photo p WHERE p.game_id = g.id) AS photos
			 FROM game g ORDER BY g.created_at DESC`
		),
		people: (await get<{ n: number; admins: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(is_admin), 0) AS admins FROM user'))!
	};
};

const randomCode = async () => {
	const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
	for (;;) {
		const code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
		if (!await get('SELECT 1 FROM game WHERE code = ?', code)) return code;
	}
};

export const actions = {
	newGame: async ({ request, locals }) => {
		const me = requireAdmin(locals);
		const f = await request.formData();
		const name = str(f.get('name'), 80);
		if (!name) return fail(400, { error: 'Give the game a name.' });
		const code = await randomCode();
		const id = await insert('INSERT INTO game (code, name, created_at) VALUES (?, ?, ?)', code, name, now());
		await run('INSERT INTO member (game_id, user_id) VALUES (?, ?)', id, me.id);
		redirect(303, `/g/${code}/admin`);
	}
};
