import { all } from './db.ts';
import type { Game } from './game.ts';

/** `pending` means the host hasn't assigned points yet. */
export type PhotoScore = { claimed: number; points: number; counted: boolean; pending: boolean };
export type TeamScore = {
	id: number;
	name: string;
	color: string;
	members: number;
	photos: number;
	filled: number;
	lines: number;
	photoPts: number;
	bingoPts: number;
	awardPts: number;
	grantPts: number;
	total: number;
};
export type Winner = {
	award_id: number;
	photo_id: number;
	team_id: number;
	category_id: number;
	votes: number;
};

/** Which categories sit on which bingo lines, given the board order. */
export function bingoLines(n: number, cols: number): number[][] {
	const lines: number[][] = [];
	if (n === 0 || cols < 1) return lines;
	const rows = Math.ceil(n / cols);
	for (let r = 0; r < rows; r++) {
		const row = [];
		for (let c = 0; c < cols; c++) if (r * cols + c < n) row.push(r * cols + c);
		if (row.length === cols) lines.push(row);
	}
	if (rows > 1)
		for (let c = 0; c < cols; c++) {
			const col = [];
			for (let r = 0; r < rows; r++) if (r * cols + c < n) col.push(r * cols + c);
			if (col.length === rows) lines.push(col);
		}
	if (rows === cols && n === cols * cols && cols > 1) {
		lines.push(Array.from({ length: cols }, (_, i) => i * cols + i));
		lines.push(Array.from({ length: cols }, (_, i) => i * cols + (cols - 1 - i)));
	}
	return lines;
}

export async function scoreGame(game: Game) {
	const teams = await all<{ id: number; name: string; color: string; members: number }>(
		`SELECT t.*, (SELECT COUNT(*) FROM member m WHERE m.team_id = t.id) AS members
		 FROM team t WHERE t.game_id = ? ORDER BY t.id`,
		game.id
	);
	const cats = await all<{ id: number; scoring_cap: number | null }>(
		'SELECT id, scoring_cap FROM category WHERE game_id = ? AND active = 1 ORDER BY sort, id',
		game.id
	);
	const photos = await all<{
		id: number;
		category_id: number;
		team_id: number;
		user_id: number;
		status: string;
		points_override: number | null;
		claimed: number;
		has_claim: number;
	}>(
		`SELECT p.id, p.category_id, p.team_id, p.user_id, p.status, p.points_override,
			COALESCE((SELECT SUM(o.points * c.qty) FROM photo_claim c
				JOIN score_option o ON o.id = c.option_id WHERE c.photo_id = p.id), 0) AS claimed,
			(SELECT COUNT(*) FROM photo_claim c WHERE c.photo_id = p.id) AS has_claim
		 FROM photo p WHERE p.game_id = ? AND p.category_id IS NOT NULL`,
		game.id
	);

	const capOf = new Map(cats.map((c) => [c.id, c.scoring_cap]));
	const photoScores = new Map<number, PhotoScore>();
	const groups = new Map<string, typeof photos>();
	for (const p of photos) {
		const claimed = p.points_override ?? p.claimed;
		photoScores.set(p.id, { claimed, points: 0, counted: false, pending: p.points_override == null && !p.has_claim });
		if (p.status !== 'ok' || !capOf.has(p.category_id)) continue;
		const k = `${p.team_id}:${p.category_id}`;
		if (!groups.has(k)) groups.set(k, []);
		groups.get(k)!.push(p);
	}

	const teamPhotoPts = new Map<number, number>();
	const teamPhotos = new Map<number, number>();
	const filled = new Map<number, Set<number>>();
	const personPts = new Map<number, number>();
	const personPhotos = new Map<number, number>();
	for (const p of photos) {
		teamPhotos.set(p.team_id, (teamPhotos.get(p.team_id) ?? 0) + 1);
		personPhotos.set(p.user_id, (personPhotos.get(p.user_id) ?? 0) + 1);
	}
	for (const list of groups.values()) {
		const cap = capOf.get(list[0].category_id);
		list.sort((a, b) => photoScores.get(b.id)!.claimed - photoScores.get(a.id)!.claimed || a.id - b.id);
		list.forEach((p, i) => {
			const s = photoScores.get(p.id)!;
			if (cap && i >= cap) return;
			s.counted = true;
			s.points = s.claimed;
			teamPhotoPts.set(p.team_id, (teamPhotoPts.get(p.team_id) ?? 0) + s.points);
			personPts.set(p.user_id, (personPts.get(p.user_id) ?? 0) + s.points);
		});
		const t = list[0].team_id;
		if (!filled.has(t)) filled.set(t, new Set());
		filled.get(t)!.add(list[0].category_id);
	}

	// Voted awards: results only exist once voting is closed.
	const awards = await all<{ id: number; points: number; scope: string }>(
		`SELECT id, points, scope FROM award WHERE game_id = ? AND status = 'closed'`,
		game.id
	);
	const winners: Winner[] = [];
	const teamAwardPts = new Map<number, number>();
	const tallies = await all<{ award_id: number; photo_id: number; team_id: number; category_id: number; votes: number }>(
		`SELECT v.award_id, v.photo_id, p.team_id, p.category_id, COUNT(*) AS votes
		 FROM vote v JOIN photo p ON p.id = v.photo_id JOIN award a ON a.id = v.award_id
		 WHERE a.game_id = ? AND a.status = 'closed' AND p.status != 'disqualified'
		 GROUP BY v.award_id, v.photo_id`,
		game.id
	);
	for (const a of awards) {
		const tally = tallies.filter((t) => t.award_id === a.id).map(({ award_id, ...t }) => t);
		const best = new Map<number, number>();
		for (const t of tally) {
			const k = a.scope === 'category' ? t.category_id : 0;
			best.set(k, Math.max(best.get(k) ?? 0, t.votes));
		}
		for (const t of tally) {
			const k = a.scope === 'category' ? t.category_id : 0;
			if (t.votes !== best.get(k)) continue;
			winners.push({ award_id: a.id, ...t });
			teamAwardPts.set(t.team_id, (teamAwardPts.get(t.team_id) ?? 0) + a.points);
		}
	}

	const grants = await all<{ team_id: number; user_id: number | null; points: number }>(
		'SELECT team_id, user_id, points FROM grant_award WHERE game_id = ?',
		game.id
	);
	const teamGrantPts = new Map<number, number>();
	for (const g of grants) {
		teamGrantPts.set(g.team_id, (teamGrantPts.get(g.team_id) ?? 0) + g.points);
		if (g.user_id) personPts.set(g.user_id, (personPts.get(g.user_id) ?? 0) + g.points);
	}

	const lines = game.bingo ? bingoLines(cats.length, game.bingo_cols) : [];
	const scores: TeamScore[] = teams.map((t) => {
		const f = filled.get(t.id) ?? new Set<number>();
		const done = lines.filter((l) => l.every((i) => f.has(cats[i].id))).length;
		const full = game.bingo && cats.length > 0 && cats.every((c) => f.has(c.id));
		const bingoPts = done * game.bingo_line_points + (full ? game.bingo_board_points : 0);
		const photoPts = teamPhotoPts.get(t.id) ?? 0;
		const awardPts = teamAwardPts.get(t.id) ?? 0;
		const grantPts = teamGrantPts.get(t.id) ?? 0;
		return {
			...t,
			photos: teamPhotos.get(t.id) ?? 0,
			filled: f.size,
			lines: done,
			photoPts,
			bingoPts,
			awardPts,
			grantPts,
			total: photoPts + bingoPts + awardPts + grantPts
		};
	});
	scores.sort((a, b) => b.total - a.total || b.filled - a.filled || a.name.localeCompare(b.name));

	return { teams: scores, photoScores, winners, filled, personPts, personPhotos, categoryCount: cats.length };
}
