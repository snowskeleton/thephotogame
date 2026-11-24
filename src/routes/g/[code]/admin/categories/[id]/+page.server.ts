import { error, fail, redirect } from '@sveltejs/kit';
import { all, batch, get, q, run } from '#lib/server/db.ts';
import { gameByCode, intOrNull, positiveOrNull, num, requireHost, str } from '#lib/server/game.ts';
import { optionsFor } from '#lib/server/claims.ts';
import { itemStatements, itemsFor, parseItems } from '#lib/server/items.ts';
import { remove } from '#lib/server/images.ts';

const find = async (code: string, id: string) => {
	const game = await gameByCode(code);
	const category = await get<{
		id: number; name: string; rules: string; notes: string; day_label: string; scoring_cap: number | null; max_points: number | null; active: number;
	}>('SELECT * FROM category WHERE id = ? AND game_id = ?', Number(id), game.id);
	if (!category) error(404, 'No such category');
	return { game, category };
};

export const load = async ({ params }) => {
	const { category } = await find(params.code, params.id);
	return {
		category,
		options: await optionsFor(category.id),
		items: (await itemsFor(category.id)).map((i) => i.label),
		photos: (await get<{ n: number }>('SELECT COUNT(*) AS n FROM photo WHERE category_id = ?', category.id))!.n
	};
};

export const actions = {
	save: async ({ request, params, locals }) => {
		await requireHost(locals, params.code);
		const { game, category } = await find(params.code, params.id);
		const f = await request.formData();
		const name = str(f.get('name'), 80);
		if (!name) return fail(400, { error: 'The category needs a name.' });

		const ids = f.getAll('opt_id').map(Number);
		const labels = f.getAll('opt_label').map((v) => str(v, 120));
		const points = f.getAll('opt_points').map((v) => num(v));
		const kinds = f.getAll('opt_kind').map((v) => (v === 'extra' || v === 'bonus' ? v : 'tier'));
		const rows = ids.map((id, i) => ({ id, label: labels[i], points: points[i], kind: kinds[i] })).filter((r) => r.label);
		if (!rows.some((r) => r.kind === 'tier'))
			return fail(400, { error: 'Add at least one base scoring line (not an extra), even if it’s worth 0.' });

		const items = parseItems(f.get('items'));
		if ('error' in items) return fail(400, { error: items.error });

		const keep = rows.filter((r) => r.id).map((r) => r.id);
		await batch([
			q(
				'UPDATE category SET name = ?, rules = ?, notes = ?, day_label = ?, scoring_cap = ?, max_points = ?, active = ? WHERE id = ?',
				name,
				str(f.get('rules'), 4000),
				str(f.get('notes'), 4000),
				str(f.get('day_label'), 40),
				intOrNull(f.get('scoring_cap')),
				positiveOrNull(f.get('max_points')),
				f.get('active') ? 1 : 0,
				category.id
			),
			q(
				'DELETE FROM score_option WHERE category_id = ? AND id NOT IN (SELECT value FROM json_each(?))',
				category.id,
				JSON.stringify(keep)
			),
			...rows.map((r, i) =>
				r.id
					? q(
							'UPDATE score_option SET label = ?, points = ?, kind = ?, sort = ? WHERE id = ? AND category_id = ?',
							r.label, r.points, r.kind, i, r.id, category.id
						)
					: q(
							'INSERT INTO score_option (category_id, label, points, kind, sort) VALUES (?, ?, ?, ?, ?)',
							category.id, r.label, r.points, r.kind, i
						)
			),
			...(await itemStatements(category.id, items))
		]);
		redirect(303, `/g/${game.code}/admin/categories`);
	},
	delete: async ({ params, locals }) => {
		await requireHost(locals, params.code);
		const { game, category } = await find(params.code, params.id);
		const ids = await all<{ id: number; ext: string }>('SELECT id, ext FROM photo WHERE category_id = ?', category.id);
		await run('DELETE FROM category WHERE id = ?', category.id);
		await remove(ids);
		redirect(303, `/g/${game.code}/admin/categories`);
	}
};
