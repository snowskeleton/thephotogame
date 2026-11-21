import { redirect } from '@sveltejs/kit';
import { safeNext } from '#lib/server/auth.ts';

export const load = async ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	if (!locals.user) redirect(303, next);
	return { next };
};

export const actions = {
	// "Not now" and "saved" both just carry on. People without a passkey are asked again at their next sign-in.
	default: async ({ request }) => {
		redirect(303, safeNext((await request.formData()).get('next')));
	}
};
