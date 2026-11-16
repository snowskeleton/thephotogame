import { fail, redirect } from '@sveltejs/kit';
import { checkCode, cleanEmail, findUserByEmail, offerPasskey, safeNext, sendCode, startSession } from '#lib/server/auth.ts';

export const load = async ({ url }) => ({
	email: url.searchParams.get('email') ?? '',
	next: safeNext(url.searchParams.get('next')),
	known: url.searchParams.has('known')
});

export const actions = {
	verify: async ({ request, cookies }) => {
		const f = await request.formData();
		const email = cleanEmail(f.get('email'));
		const user = email && await findUserByEmail(email);
		if (!email || !user || !(await checkCode(email, String(f.get('code') ?? ''))).ok)
			return fail(400, { error: 'That code is wrong or has expired. Check the newest email, or send another.' });
		await startSession(cookies, user.id);
		redirect(303, offerPasskey(cookies, safeNext(f.get('next'))));
	},
	resend: async ({ request, url }) => {
		const email = cleanEmail((await request.formData()).get('email'));
		if (email && await findUserByEmail(email)) await sendCode(email, url.origin);
		return { resent: true };
	}
};
