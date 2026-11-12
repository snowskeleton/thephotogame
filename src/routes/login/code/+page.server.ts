import { fail, redirect } from '@sveltejs/kit';
import { checkCode, cleanEmail, findUserByEmail, safeNext, startSession } from '#lib/server/auth.ts';

export const load = ({ url }) => ({
	email: url.searchParams.get('email') ?? '',
	next: safeNext(url.searchParams.get('next'))
});

export const actions = {
	default: async ({ request, cookies }) => {
		const f = await request.formData();
		const email = cleanEmail(f.get('email'));
		const user = email && findUserByEmail(email);
		if (!email || !user || !checkCode(email, String(f.get('code') ?? '')).ok)
			return fail(400, { error: 'That code is wrong or has expired. Check the newest email, or ask for another.' });
		startSession(cookies, user.id);
		redirect(303, safeNext(f.get('next')));
	}
};
