import { redirect } from '@sveltejs/kit';
import { PASSKEY_SKIP, safeNext } from '#lib/server/auth.ts';

export const load = async ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	if (!locals.user) redirect(303, next);
	return { next };
};

export const actions = {
	// "Not now" and "saved" both stop this device being asked again for a while.
	default: async ({ request, cookies }) => {
		const f = await request.formData();
		cookies.set(PASSKEY_SKIP, '1', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: (f.get('saved') ? 365 : 30) * 86400 });
		redirect(303, safeNext(f.get('next')));
	}
};
