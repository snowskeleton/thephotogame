import { fail, redirect } from '@sveltejs/kit';
import { checkCode, cleanEmail, createUser, findUserByEmail, markVerified, offerPasskey, safeNext, sendCode, startSession } from '#lib/server/auth.ts';
import { get } from '#lib/server/db.ts';

export const load = async ({ url }) => ({
	email: url.searchParams.get('email') ?? '',
	next: safeNext(url.searchParams.get('next')),
	known: url.searchParams.has('known'),
	verify: url.searchParams.has('verify')
});

export const actions = {
	verify: async ({ request, cookies }) => {
		const f = await request.formData();
		const email = cleanEmail(f.get('email'));
		const check = email ? await checkCode(email, String(f.get('code') ?? '')) : { ok: false, name: null };
		const wrong = () => fail(400, { error: 'That code is wrong or has expired. Check the newest email, or send another.' });
		if (!email || !check.ok) return wrong();
		// A sign-up code carries the new person's name; the account is made now that the email is proven.
		let id = (await findUserByEmail(email))?.id;
		if (!id && check.name) id = await createUser(email, check.name);
		if (!id) return wrong();
		await markVerified(id);
		await startSession(cookies, id);
		redirect(303, await offerPasskey(id, safeNext(f.get('next'))));
	},
	resend: async ({ request, url }) => {
		const email = cleanEmail((await request.formData()).get('email'));
		if (!email) return { resent: true };
		if (await findUserByEmail(email)) await sendCode(email, url.origin);
		else {
			// Still signing up: only resend if a sign-up code was already sent (it passed the bot check).
			const pending = await get<{ name: string }>('SELECT name FROM login_code WHERE email = ? AND name IS NOT NULL', email);
			if (pending) await sendCode(email, url.origin, pending.name);
		}
		return { resent: true };
	}
};
