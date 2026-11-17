import { fail, redirect } from '@sveltejs/kit';
import { offerPasskey, safeNext, startSession, useHandoff } from '#lib/server/auth.ts';

export const load = async ({ url }) => ({ next: safeNext(url.searchParams.get('next')) });

export const actions = {
	default: async ({ params, cookies, request }) => {
		const next = safeNext((await request.formData()).get('next'));
		const userId = await useHandoff(params.token);
		if (!userId) return fail(400, { error: 'This sign-in link has expired or was already used. Ask for a new one.' });
		await startSession(cookies, userId);
		redirect(303, await offerPasskey(userId, next));
	}
};
