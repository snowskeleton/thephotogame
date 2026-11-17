import { fail, redirect } from '@sveltejs/kit';
import { becomesAdmin, cleanEmail, findUserByEmail, safeNext, sendCode } from '#lib/server/auth.ts';
import { str } from '#lib/server/game.ts';
import { settings } from '#lib/server/settings.ts';
import { humanCheck, NOT_HUMAN } from '#lib/server/turnstile.ts';

export const load = async ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	if (locals.user) redirect(303, next);
	return { next, email: cleanEmail(url.searchParams.get('email')) ?? '', signups: (await settings()).signups };
};

export const actions = {
	default: async ({ request, url, getClientAddress }) => {
		const f = await request.formData();
		const email = cleanEmail(f.get('email'));
		const next = safeNext(f.get('next'));
		const typed = String(f.get('email') ?? '');
		if (!email) return fail(400, { error: 'That email doesn’t look right.', email: typed, needName: false, name: '' });
		if (await findUserByEmail(email)) {
			await sendCode(email, url.origin);
		} else {
			// A new account. It's only made once they enter the emailed code, so it starts out verified.
			// The site admin can always sign up this way, even with public sign-ups off, to bootstrap the site.
			if (!(await settings()).signups && !(await becomesAdmin(email)))
				return fail(400, { error: 'No player has that email yet. Open your game’s join link to sign up.', email: typed, needName: false, name: '' });
			const name = str(f.get('name'), 40);
			if (!name) return fail(400, { needName: true, email: typed, name: '', error: f.has('name') ? 'Tell us your name.' : '' });
			if (!(await humanCheck(f, getClientAddress())))
				return fail(400, { needName: true, email: typed, name, error: NOT_HUMAN });
			await sendCode(email, url.origin, name);
		}
		redirect(303, `/login/code?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
	}
};
