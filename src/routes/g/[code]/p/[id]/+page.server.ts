import { error, fail, redirect } from '@sveltejs/kit';
import { all, get, run } from '#lib/server/db.ts';
import { canSee, enter, num, str } from '#lib/server/game.ts';
import { optionsFor, saveClaims } from '#lib/server/claims.ts';
import { remove } from '#lib/server/images.ts';
import { giveTeamPoints } from '#lib/server/grants.ts';
import { onePhoto } from '#lib/server/photos.ts';
import { scoreGame } from '#lib/server/scoring.ts';
import { categoryIn, fileInto } from '#lib/server/uploads.ts';

async function ctx(event: { params: { code: string; id: string }; locals: App.Locals; url: URL }) {
	const { game, viewer } = await enter(event.locals, event.params.code);
	const photo = await onePhoto(game.id, Number(event.params.id));
	if (!photo) error(404, 'That photo is gone');
	if (!canSee(game, viewer, photo)) error(403, 'This photo hasn’t been revealed yet');
	const mine = photo.user_id === viewer.user.id;
	const ours = photo.team_id === viewer.teamId;
	return { game, viewer, photo, mine, ours };
}
const doubtCount = async (id: number) => (await get<{ n: number }>('SELECT COUNT(*) AS n FROM doubt WHERE photo_id = ?', id))!.n;

export const load = async (event) => {
	const { game, viewer, photo, mine, ours } = await ctx(event);
	const review = await all<{ agree: number; n: number }>(
		'SELECT agree, COUNT(*) AS n FROM review_vote WHERE photo_id = ? GROUP BY agree',
		photo.id
	);
	return {
		photo,
		mine,
		ours,
		score: (await scoreGame(game)).photoScores.get(photo.id)!,
		override: (await get<{ points_override: number | null }>('SELECT points_override FROM photo WHERE id = ?', photo.id))!
			.points_override,
		options: await optionsFor(photo.category_id),
		claims: await all<{ option_id: number; qty: number; label: string; points: number }>(
			`SELECT c.option_id, c.qty, o.label, o.points FROM photo_claim c
			 JOIN score_option o ON o.id = c.option_id WHERE c.photo_id = ? ORDER BY o.sort, o.id`,
			photo.id
		),
		doubts: await doubtCount(photo.id),
		doubted: !!await get('SELECT 1 FROM doubt WHERE photo_id = ? AND user_id = ?', photo.id, viewer.user.id),
		review: {
			agree: review.find((r) => r.agree === 1)?.n ?? 0,
			disagree: review.find((r) => r.agree === 0)?.n ?? 0,
			mine: (await get<{ agree: number }>('SELECT agree FROM review_vote WHERE photo_id = ? AND user_id = ?', photo.id, viewer.user.id))
				?.agree ?? null
		},
		grants: await all<{ title: string; points: number }>(
			`SELECT g.title, g.points FROM grant_photo gp JOIN grant_award g ON g.id = gp.grant_id WHERE gp.photo_id = ?`,
			photo.id
		),
		categories: await all<{ id: number; name: string }>(
			`SELECT id, name FROM category WHERE game_id = ? AND (active = 1 OR ? OR id = ?) ORDER BY sort, id`,
			game.id,
			viewer.isHost ? 1 : 0,
			photo.category_id
		),
		otherTeams: viewer.isHost
			? await all<{ id: number; name: string }>('SELECT id, name FROM team WHERE game_id = ? AND id != ? ORDER BY id', game.id, photo.team_id)
			: [],
		isNew: event.url.searchParams.has('new')
	};
};

export const actions = {
	doubt: async (event) => {
		const { game, viewer, photo, ours } = await ctx(event);
		if (ours || !viewer.teamId) return fail(400, { error: 'You can only doubt another team’s photo.' });
		if (photo.status === 'disqualified') return;
		const on = (await event.request.formData()).get('on') === '1';
		if (on) await run('INSERT OR IGNORE INTO doubt (photo_id, user_id) VALUES (?, ?)', photo.id, viewer.user.id);
		else await run('DELETE FROM doubt WHERE photo_id = ? AND user_id = ?', photo.id, viewer.user.id);
		const over = await doubtCount(photo.id) > game.doubt_limit;
		if (over && photo.status === 'ok') await run(`UPDATE photo SET status = 'review' WHERE id = ?`, photo.id);
		if (!over && photo.status === 'review') {
			await run(`UPDATE photo SET status = 'ok' WHERE id = ?`, photo.id);
			await run('DELETE FROM review_vote WHERE photo_id = ?', photo.id);
		}
	},
	review: async (event) => {
		const { viewer, photo } = await ctx(event);
		if (photo.status !== 'review') return;
		const agree = (await event.request.formData()).get('agree') === '1' ? 1 : 0;
		await run('INSERT OR REPLACE INTO review_vote (photo_id, user_id, agree) VALUES (?, ?, ?)', photo.id, viewer.user.id, agree);
	},
	claims: async (event) => {
		const { game, viewer, photo, mine } = await ctx(event);
		if (!mine && !viewer.isHost) return fail(403, { error: 'Only the photographer can change this.' });
		const f = await event.request.formData();
		const cat = Number(f.get('category'));
		if (cat && cat !== photo.category_id) {
			const target = await categoryIn(game.id, cat);
			if (!target) return fail(400, { error: 'That category is gone.' });
			if (!viewer.isHost) {
				if (!game.submissions_open || !target.active) return fail(400, { error: 'Submissions are closed.' });
				if (photo.status !== 'ok') return fail(400, { error: 'A photo under review or disqualified can’t be moved.' });
			}
			await run('UPDATE photo SET caption = ? WHERE id = ?', str(f.get('caption'), 200), photo.id);
			// The claim belonged to the old category's options, so it's cleared for the host to redo.
			await fileInto(photo.id, target.id, false);
			return { saved: true, moved: target.name };
		}
		// Players keep their caption; points are assigned by the host only.
		if (viewer.isHost) await saveClaims(photo.id, photo.category_id, f);
		await run('UPDATE photo SET caption = ? WHERE id = ?', str(f.get('caption'), 200), photo.id);
		return { saved: true };
	},
	delete: async (event) => {
		const { game, viewer, photo, mine } = await ctx(event);
		if (!mine && !viewer.isHost) return fail(403, { error: 'Only the photographer can delete this.' });
		const gone = await get<{ id: number; ext: string }>('DELETE FROM photo WHERE id = ? RETURNING id, ext', photo.id);
		if (gone) await remove([gone]);
		redirect(303, `/g/${game.code}/c/${photo.category_id}`);
	},
	// Admin only below.
	settle: async (event) => {
		const { viewer, photo } = await ctx(event);
		if (!viewer.isHost) return fail(403, { error: 'Admins only' });
		const to = (await event.request.formData()).get('to') === 'disqualified' ? 'disqualified' : 'ok';
		await run('UPDATE photo SET status = ? WHERE id = ?', to, photo.id);
		// Clearing doubts means an approved photo doesn't bounce straight back into review.
		await run('DELETE FROM doubt WHERE photo_id = ?', photo.id);
		await run('DELETE FROM review_vote WHERE photo_id = ?', photo.id);
	},
	give: async (event) => {
		const { game, viewer, photo } = await ctx(event);
		if (!viewer.isHost) return fail(403, { error: 'Admins only' });
		const err = await giveTeamPoints(game, await event.request.formData(), [photo.id]);
		if (err) return fail(400, { giveError: err });
		return { gave: true };
	},
	adjust: async (event) => {
		const { viewer, photo } = await ctx(event);
		if (!viewer.isHost) return fail(403, { error: 'Admins only' });
		const f = await event.request.formData();
		const raw = String(f.get('points') ?? '').trim();
		await run('UPDATE photo SET points_override = ? WHERE id = ?', raw === '' ? null : num(raw), photo.id);
		return { saved: true };
	}
};
