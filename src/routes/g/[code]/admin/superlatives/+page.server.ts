import { fail } from '@sveltejs/kit';
import { all } from '#lib/server/db.ts';
import { requireHost } from '#lib/server/game.ts';
import { addSuperlative, listSuperlatives, removeSuperlative } from '#lib/server/superlatives.ts';

export const load = async ({ params, locals, url }) => {
	const game = await requireHost(locals, params.code);
	return {
		items: await listSuperlatives(game.id),
		players: await all<{ id: number; name: string; team: string | null }>(
			`SELECT u.id, u.name, t.name AS team FROM member m JOIN user u ON u.id = m.user_id LEFT JOIN team t ON t.id = m.team_id
			 WHERE m.game_id = ? AND m.status = 'active' ORDER BY u.name`,
			game.id
		),
		teams: await all<{ id: number; name: string }>('SELECT id, name FROM team WHERE game_id = ? ORDER BY id', game.id),
		photos: await all<{ id: number; who: string; category: string; caption: string }>(
			`SELECT p.id, u.name AS who, c.name AS category, p.caption FROM photo p JOIN user u ON u.id = p.user_id
			 JOIN category c ON c.id = p.category_id WHERE p.game_id = ? ORDER BY p.created_at DESC`,
			game.id
		),
		preset: Number(url.searchParams.get('photo')) || null
	};
};

export const actions = {
	add: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		const f = await request.formData();
		const kind = String(f.get('kind'));
		const r = await addSuperlative(game.id, { title: f.get('title'), kind, note: f.get('note'), to: f.get(kind === 'team' ? 'team' : kind === 'photo' ? 'photo' : 'person') });
		if ('error' in r) return fail(400, { error: r.error, kind });
		return { added: r.id };
	},
	delete: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		await removeSuperlative(game.id, Number((await request.formData()).get('id')));
	}
};
