import { fail } from '@sveltejs/kit';
import { all } from '#lib/server/db.ts';
import { requireAdmin, str } from '#lib/server/game.ts';
import { grantable, isOwner, keysFor, mintKey, revokeKey, SCOPES } from '#lib/server/perms.ts';

export const load = ({ locals }) => {
	const me = requireAdmin(locals);
	const can = grantable(me);
	return {
		owner: isOwner(me),
		me: me.id,
		scopes: (Object.keys(SCOPES) as (keyof typeof SCOPES)[]).map((id) => ({
			id,
			label: SCOPES[id].label,
			help: SCOPES[id].help,
			ok: can.includes(id)
		})),
		games: all<{ id: number; name: string; code: string }>('SELECT id, name, code FROM game ORDER BY created_at DESC'),
		keys: keysFor(me).map((k) => ({ ...k, scopes: JSON.parse(k.scopes) as string[] }))
	};
};

export const actions = {
	mint: async ({ request, locals }) => {
		const me = requireAdmin(locals);
		const f = await request.formData();
		const days = Number(f.get('days')) || null;
		const gameId = Number(f.get('game')) || null;
		const r = mintKey(me, {
			name: str(f.get('name'), 60),
			scopes: f.getAll('scope').map(String),
			gameId,
			days: days && days > 0 ? Math.min(days, 3650) : null
		});
		if ('error' in r) return fail(400, { error: r.error });
		return { token: r.token, name: str(f.get('name'), 60) };
	},
	revoke: async ({ request, locals }) => {
		const me = requireAdmin(locals);
		if (!revokeKey(me, Number((await request.formData()).get('id')))) return fail(403, { error: 'You can’t revoke that key.' });
	}
};
