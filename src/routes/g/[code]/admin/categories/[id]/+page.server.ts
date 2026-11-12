import { error, fail, redirect } from '@sveltejs/kit';
import { all, get, insert, run, tx } from '#lib/server/db.ts';
import { gameByCode, intOrNull, num, requireAdmin, str } from '#lib/server/game.ts';
import { optionsFor } from '#lib/server/claims.ts';
import { remove } from '#lib/server/images.ts';

const find = (code: string, id: string) => {
	const game = gameByCode(code);
	const category = get<{
		id: number; name: string; rules: string; notes: string; day_label: string; scoring_cap: number | null; active: number;
	}>('SELECT * FROM category WHERE id = ? AND game_id = ?', Number(id), game.id);
	if (!category) error(404, 'No such category');
	return { game, category };
};

export const load = ({ params }) => {
	const { category } = find(params.code, params.id);
	return {
		category,
		options: optionsFor(category.id),
		photos: get<{ n: number }>('SELECT COUNT(*) AS n FROM photo WHERE category_id = ?', category.id)!.n
	};
};

export const actions = {
	save: async ({ request, params, locals }) => {
		requireAdmin(locals);
		const { game, category } = find(params.code, params.id);
		const f = await request.formData();
		const name = str(f.get('name'), 80);
		if (!name) return fail(400, { error: 'The category needs a name.' });

		const ids = f.getAll('opt_id').map(Number);
		const labels = f.getAll('opt_label').map((v) => str(v, 120));
		const points = f.getAll('opt_points').map((v) => num(v));
		const kinds = f.getAll('opt_kind').map((v) => (v === 'extra' ? 'extra' : 'tier'));
		const rows = ids.map((id, i) => ({ id, label: labels[i], points: points[i], kind: kinds[i] })).filter((r) => r.label);
		if (!rows.some((r) => r.kind === 'tier'))
			return fail(400, { error: 'Add at least one base scoring line (not an extra), even if it’s worth 0.' });

		tx(() => {
			run(
				'UPDATE category SET name = ?, rules = ?, notes = ?, day_label = ?, scoring_cap = ?, active = ? WHERE id = ?',
				name,
				str(f.get('rules'), 4000),
				str(f.get('notes'), 4000),
				str(f.get('day_label'), 40),
				intOrNull(f.get('scoring_cap')),
				f.get('active') ? 1 : 0,
				category.id
			);
			const keep = rows.filter((r) => r.id).map((r) => r.id);
			for (const o of all<{ id: number }>('SELECT id FROM score_option WHERE category_id = ?', category.id))
				if (!keep.includes(o.id)) run('DELETE FROM score_option WHERE id = ?', o.id);
			rows.forEach((r, i) => {
				if (r.id)
					run(
						'UPDATE score_option SET label = ?, points = ?, kind = ?, sort = ? WHERE id = ? AND category_id = ?',
						r.label, r.points, r.kind, i, r.id, category.id
					);
				else
					insert(
						'INSERT INTO score_option (category_id, label, points, kind, sort) VALUES (?, ?, ?, ?, ?)',
						category.id, r.label, r.points, r.kind, i
					);
			});
		});
		redirect(303, `/g/${game.code}/admin/categories`);
	},
	delete: async ({ params, locals }) => {
		requireAdmin(locals);
		const { game, category } = find(params.code, params.id);
		const ids = all<{ id: number }>('SELECT id FROM photo WHERE category_id = ?', category.id);
		run('DELETE FROM category WHERE id = ?', category.id);
		for (const p of ids) await remove(p.id);
		redirect(303, `/g/${game.code}/admin/categories`);
	}
};
