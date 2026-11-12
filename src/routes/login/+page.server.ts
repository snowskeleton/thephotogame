import { fail, redirect } from '@sveltejs/kit';
import { cleanEmail, createUser, findUserByEmail, safeNext, sendCode } from '#lib/server/auth.ts';
import { get } from '#lib/server/db.ts';

export const load = ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	if (locals.user) redirect(303, next);
	return { next };
};

export const actions = {
	default: async ({ request, url }) => {
		const f = await request.formData();
		const email = cleanEmail(f.get('email'));
		const next = safeNext(f.get('next'));
		if (!email) return fail(400, { error: 'That email doesn’t look right.' });
		if (!findUserByEmail(email)) {
			// Bootstrap: the admin has no join link to sign up through, so their account is made here.
			const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
			const isFirstAdmin = adminEmail ? email === adminEmail : !get('SELECT 1 FROM user LIMIT 1');
			if (!isFirstAdmin)
				return fail(400, { error: 'No player has that email yet. Open your game’s join link to sign up.' });
			createUser(email, email.split('@')[0]);
		}
		await sendCode(email, url.origin);
		redirect(303, `/login/code?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
	}
};
