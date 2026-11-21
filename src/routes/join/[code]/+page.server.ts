import { fail, redirect } from '@sveltejs/kit';
import { cleanEmail, createUser, findUserByEmail, offerPasskey, sendCode, startSession } from '#lib/server/auth.ts';
import { run } from '#lib/server/db.ts';
import { gameByCode, str } from '#lib/server/game.ts';
import { humanCheck, NOT_HUMAN } from '#lib/server/turnstile.ts';

// Opening the join link also accepts a pending invite to the game.
const join = async (gameId: number, userId: number) =>
	await run(
		`INSERT INTO member (game_id, user_id) VALUES (?, ?)
		 ON CONFLICT(game_id, user_id) DO UPDATE SET status = 'active'`,
		gameId,
		userId
	);

export const load = async ({ params, locals }) => {
	const game = await gameByCode(params.code);
	if (locals.user) {
		await join(game.id, locals.user.id);
		redirect(303, `/g/${game.code}`);
	}
	return { game: { name: game.name, code: game.code } };
};

export const actions = {
	default: async ({ request, params, cookies, url, getClientAddress }) => {
		const game = await gameByCode(params.code);
		const f = await request.formData();
		const name = str(f.get('name'), 40);
		const email = cleanEmail(f.get('email'));
		if (!name) return fail(400, { error: 'Tell us your name.', name, email: String(f.get('email') ?? '') });
		if (!email) return fail(400, { error: 'That email doesn’t look right.', name, email: String(f.get('email') ?? '') });

		if (await findUserByEmail(email)) {
			// Existing account: prove it's you before joining as them.
			const sent = await sendCode(email, url.origin);
			redirect(303, `/login/code?known=1&email=${encodeURIComponent(email)}&next=/join/${game.code}${sent ? '' : '&unsent'}`);
		}
		// Playing doesn't need a confirmed email, so new players are in straight away (unverified).
		if (!(await humanCheck(f, getClientAddress()))) return fail(400, { error: NOT_HUMAN, name, email });
		const id = await createUser(email, name);
		await startSession(cookies, id);
		await join(game.id, id);
		redirect(303, await offerPasskey(id, `/g/${game.code}?welcome=1`));
	}
};
