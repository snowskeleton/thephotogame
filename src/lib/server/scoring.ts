import { all, get, q } from './db.ts';
import type { Game } from './game.ts';

/** `pending` means the host hasn't assigned points yet. */
/**
 * `claimed`/`points`/`counted` are the host-confirmed result. `guess` is the photographer's own estimate while
 * the photo awaits the host, `projected` what the photo would earn if every guess were confirmed, and `over`
 * how many confirmed points were lost to a category limit.
 */
export type PhotoScore = { claimed: number; points: number; counted: boolean; pending: boolean; guess: number; projected: number; over: number };
/** One team's standing in one category: confirmed points and what they would be with every pending guess confirmed. */
export type Pool = { confirmed: number; projected: number; count: number; projectedCount: number };
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
	/** Photo points still waiting on the host, from players' guesses. Not part of `total`. */
	pendingPts: number;
	/** Confirmed points lost to category limits. */
	overPts: number;
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
		 FROM photo p WHERE p.game_id = ? AND p.category_id IS NOT NULL ORDER BY p.created_at, p.id`,
		game.id
	);
	type Totals = Map<number, Map<number, number>>;
	const totalsOf = async (table: 'photo_claim' | 'photo_guess'): Promise<Totals> => {
		// What each photo claimed, per category the options belong to (its own category and any it also earns from).
		const rows = await all<{ photo_id: number; category_id: number; v: number }>(
			`SELECT c.photo_id, o.category_id, SUM(o.points * c.qty) AS v
			 FROM ${table} c JOIN score_option o ON o.id = c.option_id JOIN photo p ON p.id = c.photo_id
			 WHERE p.game_id = ? GROUP BY c.photo_id, o.category_id`,
			game.id
		);
		const out: Totals = new Map();
		for (const r of rows) {
			if (!out.has(r.photo_id)) out.set(r.photo_id, new Map());
			out.get(r.photo_id)!.set(r.category_id, r.v);
		}
		return out;
	};
	const claimsOf = await totalsOf('photo_claim');
	const guessOf = await totalsOf('photo_guess');
	const sumOf = (m?: Map<number, number>) => [...(m?.values() ?? [])].reduce((a, b) => a + b, 0);

	const capOf = new Map(cats.map((c) => [c.id, c.scoring_cap]));
	const maxOf = new Map(cats.map((c) => [c.id, c.max_points]));
	type P = (typeof photos)[number];
	type Entry = { photo: P; cat: number; value: number; own: boolean };
	const confirmed = (p: P) => p.points_override != null || p.has_claim > 0;

	/**
	 * Settles every entry in submission order, first come first served. A category limit is per team and covers
	 * everything that scores in it: photos filed there, plus photos from other categories that also earned points
	 * from its options (one entry each, at the points earned from this category). A later entry only fills what
	 * room is left (a 6 into 5 left earns 5), and the rest is its overage. A host override replaces a photo's
	 * whole score, so it only ever sits in the photo's own category.
	 */
	const settle = (entries: Entry[]) => {
		const photoPts = new Map<number, number>();
		const photoOver = new Map<number, number>();
		const counted = new Set<number>();
		const teamPts = new Map<number, number>();
		const personPts = new Map<number, number>();
		const pools = new Map<string, { total: number; count: number }>();
		for (const e of entries) {
			const { photo: p } = e;
			let pts = e.value;
			if (capOf.has(e.cat)) {
				const k = `${p.team_id}:${e.cat}`;
				const pool = pools.get(k) ?? { total: 0, count: 0 };
				pools.set(k, pool);
				const cap = capOf.get(e.cat);
				const max = maxOf.get(e.cat);
				pts = cap && pool.count >= cap ? 0 : Math.max(0, max ? Math.min(e.value, max - pool.total) : e.value);
				if (e.value > 0 && pts > 0) pool.count++;
				pool.total += pts;
			}
			if (e.own && (pts > 0 || e.value <= 0)) counted.add(p.id);
			photoPts.set(p.id, (photoPts.get(p.id) ?? 0) + pts);
			photoOver.set(p.id, (photoOver.get(p.id) ?? 0) + (e.value - pts));
			teamPts.set(p.team_id, (teamPts.get(p.team_id) ?? 0) + pts);
			personPts.set(p.user_id, (personPts.get(p.user_id) ?? 0) + pts);
		}
		return { photoPts, photoOver, counted, teamPts, personPts, pools };
	};
	const entriesFor = (p: P, byCat: Map<number, number> | undefined, override: number | null): Entry[] => {
		if (override != null) return [{ photo: p, cat: p.category_id, value: override, own: true }];
		const out: Entry[] = [{ photo: p, cat: p.category_id, value: byCat?.get(p.category_id) ?? 0, own: true }];
		for (const [cat, value] of byCat ?? []) if (cat !== p.category_id) out.push({ photo: p, cat, value, own: false });
		return out;
	};
	const live = photos.filter((p) => p.status === 'ok' && capOf.has(p.category_id));
	const confirmedEntries = live.filter(confirmed).flatMap((p) => entriesFor(p, claimsOf.get(p.id), p.points_override));
	// Projected: the same, with every unconfirmed photo that has a guess slotted in at its own submission time.
	const later = live.flatMap((p) =>
		confirmed(p) ? entriesFor(p, claimsOf.get(p.id), p.points_override) : guessOf.has(p.id) ? entriesFor(p, guessOf.get(p.id), null) : []
	);
	const real = settle(confirmedEntries);
	const proj = settle(later);

	const photoScores = new Map<number, PhotoScore>();
	const teamPhotos = new Map<number, number>();
	const personPhotos = new Map<number, number>();
	const filled = new Map<number, Set<number>>();
	const teamOver = new Map<number, number>();
	const personOver = new Map<number, number>();
	for (const p of photos) {
		const done = confirmed(p);
		photoScores.set(p.id, {
			claimed: p.points_override ?? sumOf(claimsOf.get(p.id)),
			points: real.photoPts.get(p.id) ?? 0,
			counted: real.counted.has(p.id),
			pending: !done,
			guess: done ? 0 : sumOf(guessOf.get(p.id)),
			projected: proj.photoPts.get(p.id) ?? 0,
			over: real.photoOver.get(p.id) ?? 0
		});
		teamPhotos.set(p.team_id, (teamPhotos.get(p.team_id) ?? 0) + 1);
		personPhotos.set(p.user_id, (personPhotos.get(p.user_id) ?? 0) + 1);
		const o = real.photoOver.get(p.id) ?? 0;
		if (o) {
			teamOver.set(p.team_id, (teamOver.get(p.team_id) ?? 0) + o);
			personOver.set(p.user_id, (personOver.get(p.user_id) ?? 0) + o);
		}
		// A square is filled by any good photo filed there, scored or not.
		if (p.status === 'ok' && capOf.has(p.category_id)) {
			if (!filled.has(p.team_id)) filled.set(p.team_id, new Set());
			filled.get(p.team_id)!.add(p.category_id);
		}
	}
	const teamPhotoPts = real.teamPts;
	const personPts = real.personPts;
	const teamPending = new Map<number, number>();
	const personPending = new Map<number, number>();
	for (const [t, v] of proj.teamPts) teamPending.set(t, Math.max(0, v - (real.teamPts.get(t) ?? 0)));
	for (const [u, v] of proj.personPts) personPending.set(u, Math.max(0, v - (real.personPts.get(u) ?? 0)));
	const poolState = new Map<string, Pool>();
	for (const k of new Set([...real.pools.keys(), ...proj.pools.keys()]))
		poolState.set(k, {
			confirmed: real.pools.get(k)?.total ?? 0,
			projected: proj.pools.get(k)?.total ?? 0,
			count: real.pools.get(k)?.count ?? 0,
			projectedCount: proj.pools.get(k)?.count ?? 0
		});

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
			pendingPts: teamPending.get(t.id) ?? 0,
			overPts: teamOver.get(t.id) ?? 0,
			total: photoPts + bingoPts + awardPts + grantPts
		};
	});
	scores.sort((a, b) => b.total - a.total || b.filled - a.filled || a.name.localeCompare(b.name));

	return { teams: scores, photoScores, winners, filled, personPts, personPhotos, personPending, personOver, pools: poolState, categoryCount: cats.length };
}

type Scores = Awaited<ReturnType<typeof computeScores>>;

// Maps and Sets don't survive JSON, so they're stored as entry lists.
const pack = (s: Scores) =>
	JSON.stringify({
		...s,
		photoScores: [...s.photoScores],
		filled: [...s.filled].map(([k, v]) => [k, [...v]]),
		personPts: [...s.personPts],
		personPhotos: [...s.personPhotos],
		personPending: [...s.personPending],
		personOver: [...s.personOver],
		pools: [...s.pools]
	});
const unpack = (json: string): Scores => {
	const s = JSON.parse(json);
	return {
		...s,
		photoScores: new Map(s.photoScores),
		filled: new Map(s.filled.map(([k, v]: [number, number[]]) => [k, new Set(v)])),
		personPts: new Map(s.personPts),
		personPhotos: new Map(s.personPhotos),
		personPending: new Map(s.personPending),
		personOver: new Map(s.personOver),
		pools: new Map(s.pools)
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
