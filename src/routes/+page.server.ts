import { fail, redirect } from '@sveltejs/kit';
import { all, get } from '#lib/server/db.ts';
import { sendCode } from '#lib/server/auth.ts';
import { createGame, hostingCheck, str } from '#lib/server/game.ts';
import { settings } from '#lib/server/settings.ts';

export const load = async ({ locals }) => {
	if (!locals.user) return { games: [], invited: [], hosting: null, signups: (await settings()).signups };
	const games = await all<{ code: string; name: string; role: string; status: string }>(
		`SELECT g.code, g.name, m.role, m.status FROM game g JOIN member m ON m.game_id = g.id
		 WHERE m.user_id = ? ORDER BY g.created_at DESC`,
		locals.user.id
	);
	const active = games.filter((g) => g.status === 'active');
	const invited = games.filter((g) => g.status === 'invited');
	const hosting = await hostingCheck(locals.user);
	// Someone who only plays in one game, and can't host one, goes straight to it.
	if (active.length === 1 && !invited.length && active[0].role !== 'host' && !hosting.ok && hosting.why !== 'unverified')
		redirect(303, `/g/${active[0].code}`);
	return { games: active, invited, hosting, signups: true };
};

export const actions = {
	join: async ({ request }) => {
		const code = String((await request.formData()).get('code') ?? '').trim();
		const g = await get<{ code: string }>('SELECT code FROM game WHERE code = ?', code);
		if (!g) return fail(400, { error: `No game with the code “${code}”.` });
		redirect(303, `/join/${g.code}`);
	},
	newGame: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const check = await hostingCheck(locals.user);
		if (!check.ok) return fail(403, { hostError: 'You can’t host another game right now.' });
		const name = str((await request.formData()).get('name'), 80);
		if (!name) return fail(400, { hostError: 'Give the game a name.' });
		redirect(303, `/g/${await createGame(locals.user, name)}/admin`);
	},
	verify: async ({ locals, url }) => {
		if (!locals.user) redirect(303, '/login');
		await sendCode(locals.user.email, url.origin);
		redirect(303, `/login/code?verify=1&email=${encodeURIComponent(locals.user.email)}&next=/`);
	}
};
