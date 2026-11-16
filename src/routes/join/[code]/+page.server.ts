import { fail, redirect } from '@sveltejs/kit';
import { cleanEmail, createUser, findUserByEmail, offerPasskey, sendCode, startSession } from '#lib/server/auth.ts';
import { run } from '#lib/server/db.ts';
import { gameByCode, str } from '#lib/server/game.ts';

const join = async (gameId: number, userId: number) =>
	await run('INSERT OR IGNORE INTO member (game_id, user_id) VALUES (?, ?)', gameId, userId);

export const load = async ({ params, locals }) => {
	const game = await gameByCode(params.code);
	if (locals.user) {
		await join(game.id, locals.user.id);
		redirect(303, `/g/${game.code}`);
	}
	return { game: { name: game.name, code: game.code } };
};

export const actions = {
	default: async ({ request, params, cookies, url }) => {
		const game = await gameByCode(params.code);
		const f = await request.formData();
		const name = str(f.get('name'), 40);
		const email = cleanEmail(f.get('email'));
		if (!name) return fail(400, { error: 'Tell us your name.', name, email: String(f.get('email') ?? '') });
		if (!email) return fail(400, { error: 'That email doesn’t look right.', name, email: String(f.get('email') ?? '') });

		if (await findUserByEmail(email)) {
			// Existing account: prove it's you before joining as them.
			await sendCode(email, url.origin);
			redirect(303, `/login/code?known=1&email=${encodeURIComponent(email)}&next=/join/${game.code}`);
		}
		const id = await createUser(email, name);
		await startSession(cookies, id);
		await join(game.id, id);
		redirect(303, offerPasskey(cookies, `/g/${game.code}?welcome=1`));
	}
};
