import { fail, redirect } from '@sveltejs/kit';
import { all, batch, get, q } from '#lib/server/db.ts';
import { gameByCode, num, requireHost, str } from '#lib/server/game.ts';

const list = async (gameId: number) =>
	await all<{ id: number; name: string; day_label: string; active: number; sort: number; photos: number; scoring: string | null }>(
		`SELECT c.id, c.name, c.day_label, c.active, c.sort,
			(SELECT COUNT(*) FROM photo p WHERE p.category_id = c.id) AS photos,
			(SELECT GROUP_CONCAT(CASE o.kind WHEN 'extra' THEN '+' ELSE '' END || o.points, ' / ')
				FROM score_option o WHERE o.category_id = c.id) AS scoring
		 FROM category c WHERE c.game_id = ? ORDER BY c.sort, c.id`,
		gameId
	);

export const load = async ({ params }) => ({ categories: await list((await gameByCode(params.code)).id) });

export const actions = {
	add: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		const f = await request.formData();
		const name = str(f.get('name'), 80);
		if (!name) return fail(400, { error: 'Give the category a name.' });
		const sort = ((await get<{ m: number | null }>('SELECT MAX(sort) AS m FROM category WHERE game_id = ?', game.id))!.m ?? 0) + 1;
		const [made] = await batch([
			q('INSERT INTO category (game_id, name, sort) VALUES (?, ?, ?) RETURNING id', game.id, name, sort),
			q(`INSERT INTO score_option (category_id, label, points, kind) VALUES (last_insert_rowid(), 'Found it', ?, 'tier')`, num(f.get('points'), 1))
		]);
		const id = (made.results[0] as { id: number }).id;
		if (f.get('then') === 'edit') redirect(303, `/g/${game.code}/admin/categories/${id}`);
	},
	move: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		const f = await request.formData();
		const ids = (await list(game.id)).map((c) => c.id);
		const i = ids.indexOf(Number(f.get('id')));
		const j = i + (f.get('dir') === 'up' ? -1 : 1);
		if (i < 0 || j < 0 || j >= ids.length) return;
		[ids[i], ids[j]] = [ids[j], ids[i]];
		await batch(ids.map((id, n) => q('UPDATE category SET sort = ? WHERE id = ?', n + 1, id)));
	}
};
