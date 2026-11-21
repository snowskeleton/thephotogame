import { fail, redirect } from '@sveltejs/kit';
import { qrDataUrl } from '#lib/server/qr.ts';
import { get, now, run } from '#lib/server/db.ts';
import { cleanCode, gameByCode, intOrNull, num, randomCode, requireHost, str } from '#lib/server/game.ts';
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
		if (!name) return fail(400, { error: 'The game needs a name.' });
		await run(
			`UPDATE game SET name = ?, visibility = ?, team_mode = ?, max_team_size = ?, submissions_open = ?,
				doubt_limit = ?, bingo = ?, bingo_cols = ?, bingo_line_points = ?, bingo_board_points = ? WHERE id = ?`,
			name,
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
		return { saved: true };
	},
	// A fresh code and join link, for when the old one got out. Old links stop working.
	newCode: async ({ params, locals }) => {
		const game = await requireHost(locals, params.code);
		const code = await randomCode();
		await run('UPDATE game SET code = ? WHERE id = ?', code, game.id);
		redirect(303, `/g/${code}/admin?newcode=1`);
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
		if (cleanCode((await request.formData()).get('confirm')) !== game.code)
			return fail(400, { error: 'Type the game code to confirm.' });
		const ids = await all<{ id: number; ext: string }>('SELECT id, ext FROM photo WHERE game_id = ?', game.id);
		await run('DELETE FROM game WHERE id = ?', game.id);
		await remove(ids);
		redirect(303, '/');
	}
};
