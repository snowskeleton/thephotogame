import { all } from '#lib/server/db.ts';
import { canSee, enter } from '#lib/server/game.ts';
import { scoreGame } from '#lib/server/scoring.ts';
import { listSuperlatives } from '#lib/server/superlatives.ts';

export const load = async ({ params, locals, url }) => {
	const { game, viewer } = await enter(locals, params.code);
	const s = await scoreGame(game);
	const people = (await all<{ id: number; name: string; team: string | null; color: string | null }>(
		`SELECT u.id, u.name, t.name AS team, t.color FROM member m JOIN user u ON u.id = m.user_id
		 LEFT JOIN team t ON t.id = m.team_id WHERE m.game_id = ?`,
		game.id
	))
		.map((p) => ({ ...p, points: s.personPts.get(p.id) ?? 0, pending: s.personPending.get(p.id) ?? 0, over: s.personOver.get(p.id) ?? 0, photos: s.personPhotos.get(p.id) ?? 0 }))
		.sort((a, b) => b.points - a.points || b.photos - a.photos || a.name.localeCompare(b.name));

	const awards = await all<{ id: number; name: string; points: number; scope: string }>(
		`SELECT id, name, points, scope FROM award WHERE game_id = ? AND status = 'closed' ORDER BY sort, id`,
		game.id
	);
	const info = new Map(
		(await all<{ id: number; team_id: number; created_at: number; category: string; team: string; color: string; who: string }>(
			`SELECT p.id, p.team_id, p.created_at, c.name AS category, t.name AS team, t.color, u.name AS who
			 FROM photo p JOIN category c ON c.id = p.category_id JOIN team t ON t.id = p.team_id
			 JOIN user u ON u.id = p.user_id WHERE p.game_id = ?`,
			game.id
		)).map((p) => [p.id, p])
	);
	const grants = (await all<{ id: number; title: string; note: string; points: number; team: string; color: string; who: string | null }>(
		`SELECT g.id, g.title, g.note, g.points, t.name AS team, t.color, u.name AS who
		 FROM grant_award g JOIN team t ON t.id = g.team_id LEFT JOIN user u ON u.id = g.user_id
		 WHERE g.game_id = ? ORDER BY g.created_at DESC`,
		game.id
	));
	const grantPhotos = await all<{ grant_id: number; photo_id: number }>(
		'SELECT gp.grant_id, gp.photo_id FROM grant_photo gp JOIN grant_award g ON g.id = gp.grant_id WHERE g.game_id = ?',
		game.id
	);
	const withPhotos = grants.map((g) => ({
		...g,
		photos: grantPhotos
			.filter((x) => x.grant_id === g.id)
			.map((x) => info.get(x.photo_id))
			.filter((p) => p && canSee(game, viewer, p))
			.map((p) => ({ id: p!.id, color: p!.color }))
	}));

	// A photo's superlative is shown only to people who may see the photo, as with awards.
	const superlatives = (await listSuperlatives(game.id))
		.filter((x) => x.kind !== 'photo' || canSee(game, viewer, { team_id: x.photo_team_id!, created_at: x.photo_created_at! }))
		.map((x) => ({ id: x.id, title: x.title, note: x.note, kind: x.kind, who: x.who, team: x.team, color: x.color, photo: x.photo_id ? { id: x.photo_id, color: x.color ?? '', status: x.photo_status ?? 'ok' } : null }));

	// Who piled up the most points past a category limit, for the fun of it.
	const beyond = {
		people: people.filter((p) => p.over > 0).sort((a, b) => b.over - a.over).slice(0, 5),
		teams: s.teams.filter((t) => t.overPts > 0).sort((a, b) => b.overPts - a.overPts).slice(0, 5).map((t) => ({ id: t.id, name: t.name, color: t.color, over: t.overPts }))
	};
	return {
		beyond,
		superlatives,
		teams: s.teams,
		categoryCount: s.categoryCount,
		people,
		grants: withPhotos,
		awards: awards.map((a) => ({
			...a,
			winners: s.winners
				.filter((w) => w.award_id === a.id)
				.map((w) => {
					const p = info.get(w.photo_id)!;
					return { ...p, votes: w.votes, visible: canSee(game, viewer, p) };
				})
		}))
	};
};
