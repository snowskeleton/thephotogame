import { fail, redirect } from '@sveltejs/kit';
import { all, get, insert, run, tx } from '#lib/server/db.ts';
import { gameByCode, num, requireAdmin, str } from '#lib/server/game.ts';

const list = (gameId: number) =>
	all<{ id: number; name: string; day_label: string; active: number; sort: number; photos: number; scoring: string | null }>(
		`SELECT c.id, c.name, c.day_label, c.active, c.sort,
			(SELECT COUNT(*) FROM photo p WHERE p.category_id = c.id) AS photos,
			(SELECT GROUP_CONCAT(CASE o.kind WHEN 'extra' THEN '+' ELSE '' END || o.points, ' / ')
				FROM score_option o WHERE o.category_id = c.id) AS scoring
		 FROM category c WHERE c.game_id = ? ORDER BY c.sort, c.id`,
		gameId
	);

export const load = ({ params }) => ({ categories: list(gameByCode(params.code).id) });

export const actions = {
	add: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		const f = await request.formData();
		const name = str(f.get('name'), 80);
		if (!name) return fail(400, { error: 'Give the category a name.' });
		const sort = (get<{ m: number | null }>('SELECT MAX(sort) AS m FROM category WHERE game_id = ?', game.id)!.m ?? 0) + 1;
		const id = tx(() => {
			const id = insert('INSERT INTO category (game_id, name, sort) VALUES (?, ?, ?)', game.id, name, sort);
			run(`INSERT INTO score_option (category_id, label, points, kind) VALUES (?, 'Found it', ?, 'tier')`, id, num(f.get('points'), 1));
			return id;
		});
		if (f.get('then') === 'edit') redirect(303, `/g/${game.code}/admin/categories/${id}`);
	},
	move: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const game = gameByCode(params.code);
		const f = await request.formData();
		const ids = list(game.id).map((c) => c.id);
		const i = ids.indexOf(Number(f.get('id')));
		const j = i + (f.get('dir') === 'up' ? -1 : 1);
		if (i < 0 || j < 0 || j >= ids.length) return;
		[ids[i], ids[j]] = [ids[j], ids[i]];
		tx(() => ids.forEach((id, n) => run('UPDATE category SET sort = ? WHERE id = ?', n + 1, id)));
	}
};
