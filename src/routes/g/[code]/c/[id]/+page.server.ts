import { error, fail, redirect } from '@sveltejs/kit';
import { get, insert, now, run } from '#lib/server/db.ts';
import { enter, str } from '#lib/server/game.ts';
import { optionsFor, saveClaims } from '#lib/server/claims.ts';
import { inspect, remove, store } from '#lib/server/images.ts';
import { listPhotos } from '#lib/server/photos.ts';
import { scoreGame } from '#lib/server/scoring.ts';

type Category = {
	id: number; name: string; rules: string; notes: string; day_label: string; scoring_cap: number | null; active: number;
};
const find = (gameId: number, id: string) => {
	const c = get<Category>('SELECT * FROM category WHERE id = ? AND game_id = ?', Number(id), gameId);
	if (!c) error(404, 'No such category');
	return c;
};

export const load = ({ params, locals, url }) => {
	const { game, viewer } = enter(locals, params.code, url.pathname);
	const category = find(game.id, params.id);
	const scores = scoreGame(game).photoScores;
	const photos = listPhotos(game, viewer, { cat: category.id }).map((p) => ({ ...p, score: scores.get(p.id)! }));
	return {
		category,
		options: optionsFor(category.id),
		ours: photos.filter((p) => p.team_id === viewer.teamId),
		theirs: photos.filter((p) => p.team_id !== viewer.teamId)
	};
};

export const actions = {
	default: async ({ request, params, locals, url }) => {
		const { game, viewer } = enter(locals, params.code, url.pathname);
		const category = find(game.id, params.id);
		if (!viewer.teamId) return fail(400, { error: 'You need to be on a team before you can submit photos.' });
		if (!game.submissions_open || !category.active) return fail(400, { error: 'Submissions are closed.' });

		const f = await request.formData();
		const files = f.getAll('photo').filter((x): x is File => x instanceof File && x.size > 0);
		if (!files.length) return fail(400, { error: 'Choose a photo first.' });
		if (files.length > 10) return fail(400, { error: 'Ten photos at a time, please.' });

		let last = 0;
		for (const file of files) {
			const buf = Buffer.from(await file.arrayBuffer());
			const meta = await inspect(buf).catch(() => null);
			if (!meta) return fail(400, { error: `“${file.name}” isn’t a photo we can read. Try a JPEG or PNG.` });
			const id = insert(
				`INSERT INTO photo (game_id, category_id, user_id, team_id, caption, ext, width, height, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				game.id, category.id, viewer.user.id, viewer.teamId, str(f.get('caption'), 200), meta.ext, meta.width, meta.height, now()
			);
			try {
				await store(id, buf, meta.ext);
			} catch {
				run('DELETE FROM photo WHERE id = ?', id);
				await remove(id);
				return fail(400, { error: `“${file.name}” couldn’t be processed. If it’s a HEIC file, send it as a JPEG.` });
			}
			saveClaims(id, category.id, f);
			last = id;
		}
		redirect(303, files.length === 1 ? `/g/${game.code}/p/${last}?new=1` : `/g/${game.code}/c/${category.id}`);
	}
};
