import { fail, redirect } from '@sveltejs/kit';
import { acceptInvite, endSession, findInvite, offerPasskey, startSession } from '#lib/server/auth.ts';
import { now } from '#lib/server/db.ts';

// Accepting is a button (a POST), so email scanners that open links can't use the invite up.
export const load = async ({ params, locals }) => {
	const inv = await findInvite(params.token);
	if (!inv || inv.used_at || inv.expires_at < now()) return { invite: null };
	return {
		invite: { name: inv.name, email: inv.email, game: inv.game, from: inv.from },
		otherUser: locals.user && locals.user.id !== inv.user_id ? locals.user.name : null
	};
};

export const actions = {
	default: async ({ params, cookies }) => {
		const inv = await acceptInvite(params.token);
		if (!inv) return fail(400, { error: 'This invite has expired or was already used. Ask for a new one, or sign in with your email.' });
		await endSession(cookies);
		await startSession(cookies, inv.user_id);
		redirect(303, await offerPasskey(inv.user_id, inv.code ? `/g/${inv.code}?welcome=1` : '/'));
	}
};
