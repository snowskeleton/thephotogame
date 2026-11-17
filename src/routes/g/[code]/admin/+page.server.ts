import { fail, redirect } from '@sveltejs/kit';
import { qrDataUrl } from '#lib/server/qr.ts';
import { get, now, run } from '#lib/server/db.ts';
import { gameByCode, intOrNull, num, requireHost, str } from '#lib/server/game.ts';
import { remove } from '#lib/server/images.ts';
import { all } from '#lib/server/db.ts';

export const load = async ({ params, url }) => {
	const game = await gameByCode(params.code);
	const link = `${url.origin}/join/${game.code}`;
	return {
		link,
		qr: await qrDataUrl(link),
		stats: (await get<{ photos: number; hidden: number }>(
			`SELECT COUNT(*) AS photos, COALESCE(SUM(created_at > ?), 0) AS hidden FROM photo WHERE game_id = ? AND category_id IS NOT NULL`,
			game.revealed_at,
			game.id
		))!
	};
};

export const actions = {
	save: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		const f = await request.formData();
		const name = str(f.get('name'), 80);
		const code = str(f.get('code'), 20).toUpperCase().replace(/[^A-Z0-9-]/g, '');
		if (!name || !code) return fail(400, { error: 'The game needs a name and a code.' });
		if (await get('SELECT 1 FROM game WHERE code = ? AND id != ?', code, game.id))
			return fail(400, { error: 'Another game already uses that code.' });
		await run(
			`UPDATE game SET name = ?, code = ?, visibility = ?, team_mode = ?, max_team_size = ?, submissions_open = ?,
				doubt_limit = ?, bingo = ?, bingo_cols = ?, bingo_line_points = ?, bingo_board_points = ? WHERE id = ?`,
			name,
			code,
			f.get('visibility') === 'open' ? 'open' : 'hidden',
			f.get('team_mode') === 'self' ? 'self' : 'admin',
			intOrNull(f.get('max_team_size')),
			f.get('submissions_open') ? 1 : 0,
			Math.max(0, Math.floor(num(f.get('doubt_limit'), 2))),
			f.get('bingo') ? 1 : 0,
			Math.min(8, Math.max(2, Math.floor(num(f.get('bingo_cols'), 4)))),
			num(f.get('bingo_line_points')),
			num(f.get('bingo_board_points')),
			game.id
		);
		if (code !== game.code) redirect(303, `/g/${code}/admin`);
		return { saved: true };
	},
	reveal: async ({ params, locals }) => {
		await requireHost(locals, params.code);
		await run('UPDATE game SET revealed_at = ? WHERE id = ?', now(), (await gameByCode(params.code)).id);
	},
	unreveal: async ({ params, locals }) => {
		await requireHost(locals, params.code);
		await run('UPDATE game SET revealed_at = 0 WHERE id = ?', (await gameByCode(params.code)).id);
	},
	deleteGame: async ({ request, params, locals }) => {
		const game = await requireHost(locals, params.code);
		if (str((await request.formData()).get('confirm')).toUpperCase() !== game.code)
			return fail(400, { error: 'Type the game code to confirm.' });
		const ids = await all<{ id: number; ext: string }>('SELECT id, ext FROM photo WHERE game_id = ?', game.id);
		await run('DELETE FROM game WHERE id = ?', game.id);
		await remove(ids);
		redirect(303, '/');
	}
};
