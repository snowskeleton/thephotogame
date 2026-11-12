import { error, fail, redirect } from '@sveltejs/kit';
import { all, get, run, tx } from '#lib/server/db.ts';
import { enter } from '#lib/server/game.ts';
import { listPhotos } from '#lib/server/photos.ts';
import { scoreGame } from '#lib/server/scoring.ts';

type Award = { id: number; name: string; description: string; points: number; scope: string; status: string };

function ctx(event: { params: { code: string; id: string }; locals: App.Locals; url: URL }) {
	const { game, viewer } = enter(event.locals, event.params.code, event.url.pathname);
	const award = get<Award>('SELECT * FROM award WHERE id = ? AND game_id = ?', Number(event.params.id), game.id);
	if (!award || (award.status === 'draft' && !viewer.isAdmin)) error(404, 'No such award');
	const photos = listPhotos(game, viewer, { status: 'ok', oldestFirst: true });
	return { game, viewer, award, photos };
}

export const load = (event) => {
	const { game, viewer, award, photos } = ctx(event);
	const mine = new Set(
		all<{ photo_id: number }>('SELECT photo_id FROM vote WHERE award_id = ? AND user_id = ?', award.id, viewer.user.id).map(
			(v) => v.photo_id
		)
	);
	const winners = award.status === 'closed' ? scoreGame(game).winners.filter((w) => w.award_id === award.id) : [];
	const tally =
		award.status === 'closed'
			? new Map(
					all<{ photo_id: number; n: number }>(
						'SELECT photo_id, COUNT(*) AS n FROM vote WHERE award_id = ? GROUP BY photo_id',
						award.id
					).map((t) => [t.photo_id, t.n])
				)
			: new Map<number, number>();
	return {
		award,
		photos: photos.map((p) => ({
			...p,
			picked: mine.has(p.id),
			ours: p.team_id === viewer.teamId,
			votes: tally.get(p.id) ?? 0,
			won: winners.some((w) => w.photo_id === p.id)
		})),
		voters: get<{ n: number }>('SELECT COUNT(DISTINCT user_id) AS n FROM vote WHERE award_id = ?', award.id)!.n,
		saved: event.url.searchParams.has('saved')
	};
};

export const actions = {
	default: async (event) => {
		const { game, viewer, award, photos } = ctx(event);
		if (award.status !== 'open') return fail(400, { error: 'Voting isn’t open for this award.' });
		const allowed = new Set(photos.filter((p) => p.team_id !== viewer.teamId).map((p) => p.id));
		const picks = (await event.request.formData()).getAll('pick').map(Number).filter((id) => allowed.has(id));
		tx(() => {
			run('DELETE FROM vote WHERE award_id = ? AND user_id = ?', award.id, viewer.user.id);
			for (const id of new Set(picks))
				run('INSERT INTO vote (award_id, photo_id, user_id) VALUES (?, ?, ?)', award.id, id, viewer.user.id);
		});
		redirect(303, `/g/${game.code}/vote/${award.id}?saved=1`);
	}
};
