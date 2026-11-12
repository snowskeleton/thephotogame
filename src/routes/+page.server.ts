import { fail, redirect } from '@sveltejs/kit';
import { all, get } from '#lib/server/db.ts';

export const load = ({ locals }) => {
	if (!locals.user) return { games: [] };
	const games = locals.user.is_admin
		? all('SELECT code, name FROM game ORDER BY created_at DESC')
		: all(
				`SELECT g.code, g.name FROM game g JOIN member m ON m.game_id = g.id
				 WHERE m.user_id = ? ORDER BY g.created_at DESC`,
				locals.user.id
			);
	if (games.length === 1 && !locals.user.is_admin) redirect(303, `/g/${games[0].code}`);
	return { games };
};

export const actions = {
	default: async ({ request }) => {
		const code = String((await request.formData()).get('code') ?? '').trim();
		const g = get<{ code: string }>('SELECT code FROM game WHERE code = ?', code);
		if (!g) return fail(400, { error: `No game with the code “${code}”.` });
		redirect(303, `/join/${g.code}`);
	}
};
