import { all, get, q } from './db.ts';
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

async function computeScores(game: Game) {
	const teams = await all<{ id: number; name: string; color: string; members: number }>(
		`SELECT t.*, (SELECT COUNT(*) FROM member m WHERE m.team_id = t.id) AS members
		 FROM team t WHERE t.game_id = ? ORDER BY t.id`,
		game.id
	);
	const cats = await all<{ id: number; scoring_cap: number | null; max_points: number | null }>(
		'SELECT id, scoring_cap, max_points FROM category WHERE game_id = ? AND active = 1 ORDER BY sort, id',
		game.id
	);
	const photos = await all<{
		id: number;
		category_id: number;
		team_id: number;
		user_id: number;
		status: string;
		points_override: number | null;
		has_claim: number;
	}>(
		`SELECT p.id, p.category_id, p.team_id, p.user_id, p.status, p.points_override,
			(SELECT COUNT(*) FROM photo_claim c WHERE c.photo_id = p.id) AS has_claim
		 FROM photo p WHERE p.game_id = ? AND p.category_id IS NOT NULL`,
		game.id
	);
	// What each photo claimed, per category the options belong to (its own category and any it also earns from).
	const claimRows = await all<{ photo_id: number; category_id: number; v: number }>(
		`SELECT c.photo_id, o.category_id, SUM(o.points * c.qty) AS v
		 FROM photo_claim c JOIN score_option o ON o.id = c.option_id JOIN photo p ON p.id = c.photo_id
		 WHERE p.game_id = ? GROUP BY c.photo_id, o.category_id`,
		game.id
	);
	const claimsOf = new Map<number, Map<number, number>>();
	for (const r of claimRows) {
		if (!claimsOf.has(r.photo_id)) claimsOf.set(r.photo_id, new Map());
		claimsOf.get(r.photo_id)!.set(r.category_id, r.v);
	}

	const capOf = new Map(cats.map((c) => [c.id, c.scoring_cap]));
	const maxOf = new Map(cats.map((c) => [c.id, c.max_points]));
	const photoScores = new Map<number, PhotoScore>();
	const teamPhotoPts = new Map<number, number>();
	const teamPhotos = new Map<number, number>();
	const filled = new Map<number, Set<number>>();
	const personPts = new Map<number, number>();
	const personPhotos = new Map<number, number>();
	const give = (p: { id: number; team_id: number; user_id: number }, pts: number) => {
		photoScores.get(p.id)!.points += pts;
		teamPhotoPts.set(p.team_id, (teamPhotoPts.get(p.team_id) ?? 0) + pts);
		personPts.set(p.user_id, (personPts.get(p.user_id) ?? 0) + pts);
	};

	// A category's limits apply per team to everything that scores in it: photos filed there, plus photos from
	// other categories that also earned points from its options (those count as one photo each, at the points
	// they earned from this category). A host override replaces a photo's whole score, so it never stacks.
	type Entry = { photo: (typeof photos)[number]; value: number; own: boolean };
	const pools = new Map<string, Entry[]>();
	for (const p of photos) {
		const total = p.points_override ?? [...(claimsOf.get(p.id)?.values() ?? [])].reduce((a, b) => a + b, 0);
		photoScores.set(p.id, { claimed: total, points: 0, counted: false, pending: p.points_override == null && !p.has_claim });
		teamPhotos.set(p.team_id, (teamPhotos.get(p.team_id) ?? 0) + 1);
		personPhotos.set(p.user_id, (personPhotos.get(p.user_id) ?? 0) + 1);
		if (p.status !== 'ok' || !capOf.has(p.category_id)) continue;
		const add = (cat: number, e: Entry) => {
			const k = `${p.team_id}:${cat}`;
			if (!pools.has(k)) pools.set(k, []);
			pools.get(k)!.push(e);
		};
		add(p.category_id, { photo: p, value: p.points_override ?? claimsOf.get(p.id)?.get(p.category_id) ?? 0, own: true });
		if (p.points_override != null) continue;
		for (const [cat, v] of claimsOf.get(p.id) ?? []) {
			if (cat === p.category_id) continue;
			if (capOf.has(cat)) add(cat, { photo: p, value: v, own: false });
			else give(p, v);
		}
	}
	for (const [k, list] of pools) {
		const cat = Number(k.split(':')[1]);
		const cap = capOf.get(cat);
		const max = maxOf.get(cat);
		// Points add up as normal. The photo cap keeps the best N entries; the point ceiling clamps the team's sum.
		list.sort((a, b) => b.value - a.value || a.photo.id - b.photo.id);
		const kept = cap ? list.slice(0, cap) : list;
		let sum = 0;
		for (const e of kept) {
			sum += e.value;
			if (e.own) photoScores.get(e.photo.id)!.counted = true;
			give(e.photo, e.value);
		}
		if (max && sum > max) {
			const t = list[0].photo.team_id;
			teamPhotoPts.set(t, (teamPhotoPts.get(t) ?? 0) - (sum - max));
		}
		const own = list.find((e) => e.own);
		if (own) {
			if (!filled.has(own.photo.team_id)) filled.set(own.photo.team_id, new Set());
			filled.get(own.photo.team_id)!.add(cat);
		}
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
		`SELECT team_id, user_id, points FROM grant_award g WHERE game_id = ?
		 AND (NOT EXISTS (SELECT 1 FROM grant_photo gp WHERE gp.grant_id = g.id)
			OR EXISTS (SELECT 1 FROM grant_photo gp JOIN photo p ON p.id = gp.photo_id WHERE gp.grant_id = g.id AND p.status = 'ok'))`,
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

type Scores = Awaited<ReturnType<typeof computeScores>>;

// Maps and Sets don't survive JSON, so they're stored as entry lists.
const pack = (s: Scores) =>
	JSON.stringify({
		...s,
		photoScores: [...s.photoScores],
		filled: [...s.filled].map(([k, v]) => [k, [...v]]),
		personPts: [...s.personPts],
		personPhotos: [...s.personPhotos]
	});
const unpack = (json: string): Scores => {
	const s = JSON.parse(json);
	return {
		...s,
		photoScores: new Map(s.photoScores),
		filled: new Map(s.filled.map(([k, v]: [number, number[]]) => [k, new Set(v)])),
		personPts: new Map(s.personPts),
		personPhotos: new Map(s.personPhotos)
	};
};

/**
 * A game's scores, from the stored copy while it's current. The copy is rebuilt on the first read after
 * anything that feeds scoring changes (triggers in migration 0009 bump the game's score_epoch), so most page views cost one small read, not a recount.
 */
export async function scoreGame(game: Game): Promise<Scores> {
	// A broken or missing cache must never break a page: fall back to counting.
	const row = await get<{ n: number; epoch: number | null; json: string | null }>(
		`SELECT g.score_epoch AS n, c.epoch, c.json
		 FROM game g LEFT JOIN score_cache c ON c.game_id = g.id WHERE g.id = ?`,
		game.id
	).catch(() => undefined);
	if (row?.json && row.epoch === row.n) {
		try {
			return unpack(row.json);
		} catch {
			// unreadable copy: rebuild below
		}
	}
	const fresh = await computeScores(game);
	// Stored under the epoch read before computing: if a write lands meanwhile, this copy is already out of date and is ignored.
	if (row) await q('INSERT OR REPLACE INTO score_cache (game_id, epoch, json) VALUES (?, ?, ?)', game.id, row.n, pack(fresh)).run().catch(() => {});
	return fresh;
}
