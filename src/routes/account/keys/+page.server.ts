import { error, fail, redirect } from '@sveltejs/kit';
import { str } from '#lib/server/game.ts';
import { GAME_SCOPES, hostedGames, keysFor, mintKey, revokeKey, SITE_SCOPES } from '#lib/server/perms.ts';

/** Site admins and game hosts. Everyone else has nothing to make a key for. */
async function allowed(locals: App.Locals) {
	if (!locals.user) redirect(303, '/login?next=/account/keys');
	const games = await hostedGames(locals.user);
	if (!games.length && !locals.user.is_admin) error(403, 'Only site admins and game hosts can make API keys.');
	return { me: locals.user, games };
}

export const load = async ({ locals }) => {
	const { me, games } = await allowed(locals);
	return {
		siteAdmin: !!me.is_admin,
		me: me.id,
		games,
		gameScopes: Object.entries(GAME_SCOPES).map(([id, s]) => ({ id, ...s })),
		siteScopes: me.is_admin ? Object.entries(SITE_SCOPES).map(([id, s]) => ({ id, ...s })) : [],
		keys: (await keysFor(me)).map((k) => ({ ...k, scopes: JSON.parse(k.scopes) as string[] }))
	};
};

export const actions = {
	mint: async ({ request, locals }) => {
		const { me } = await allowed(locals);
		const f = await request.formData();
		const days = Number(f.get('days')) || null;
		const gameId = Number(f.get('game')) || null;
		const name = str(f.get('name'), 60);
		// A site-wide key may carry any scope; a one-game key only game scopes (checked again in mintKey).
		const scopes = f.getAll('scope').map(String);
		const r = await mintKey(me, { name, scopes, gameId, days: days && days > 0 ? Math.min(days, 3650) : null });
		if ('error' in r) return fail(400, { error: r.error });
		return { token: r.token, name };
	},
	revoke: async ({ request, locals }) => {
		const { me } = await allowed(locals);
		if (!(await revokeKey(me, Number((await request.formData()).get('id'))))) return fail(403, { error: 'You can’t revoke that key.' });
	}
};
