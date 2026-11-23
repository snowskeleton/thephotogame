import { describe, expect, it } from 'vitest';
import { bingoLines, scoreGame } from '../../src/lib/server/scoring.ts';
import { get, insert, now, run } from '../../src/lib/server/db.ts';
import { claim, game, mkCategory, mkGame, mkMember, mkOption, mkPhoto, mkTeam, mkUser, teamTotal, useDatabase } from './helpers.ts';

useDatabase();

describe('bingoLines', () => {
	it('has no lines for an empty board', () => {
		expect(bingoLines(0, 3)).toEqual([]);
	});
	it('finds rows, columns and both diagonals on a full square board', () => {
		const lines = bingoLines(9, 3);
		expect(lines).toHaveLength(8);
		expect(lines).toContainEqual([0, 1, 2]);
		expect(lines).toContainEqual([0, 3, 6]);
		expect(lines).toContainEqual([0, 4, 8]);
		expect(lines).toContainEqual([2, 4, 6]);
	});
	it('skips diagonals on a non-square board', () => {
		expect(bingoLines(6, 3)).toHaveLength(2 + 3);
	});
	it('ignores an incomplete last row and the columns that do not reach it', () => {
		// 5 squares in 3 columns: row 1 is short, column 2 has a hole.
		expect(bingoLines(5, 3)).toEqual([[0, 1, 2], [0, 3], [1, 4]]);
	});
});

async function setup(catOpts: Parameters<typeof mkCategory>[1] = {}) {
	const g = await mkGame();
	const team = await mkTeam(g.id);
	const user = await mkUser();
	await mkMember(g.id, user, team);
	const cat = await mkCategory(g.id, catOpts);
	return { g, team, user, cat };
}

describe('photo scoring', () => {
	it('scores a photo as tier points plus extra quantity plus bonus', async () => {
		const { g, team, user, cat } = await setup();
		const tier = await mkOption(cat, 5);
		const extra = await mkOption(cat, 2, 'extra');
		const bonus = await mkOption(cat, 10, 'bonus');
		const p = await mkPhoto(g, { cat, team, user });
		await claim(p, tier);
		await claim(p, extra, 3);
		await claim(p, bonus);
		expect((await teamTotal(g.id, team)).photoPts).toBe(5 + 2 * 3 + 10);
	});

	it('leaves a photo with no claims pending and worth nothing', async () => {
		const { g, team, user, cat } = await setup();
		const p = await mkPhoto(g, { cat, team, user });
		const s = await scoreGame(await game(g.id));
		expect(s.photoScores.get(p)).toMatchObject({ pending: true, points: 0 });
		expect(s.teams[0].total).toBe(0);
	});

	it('lets points_override replace the claims and end the pending state', async () => {
		const { g, team, user, cat } = await setup();
		const tier = await mkOption(cat, 5);
		const p = await mkPhoto(g, { cat, team, user, override: 7 });
		await claim(p, tier);
		const s = await scoreGame(await game(g.id));
		expect(s.photoScores.get(p)).toMatchObject({ pending: false, points: 7 });
	});

	it('does not count disqualified photos', async () => {
		const { g, team, user, cat } = await setup();
		const tier = await mkOption(cat, 5);
		const p = await mkPhoto(g, { cat, team, user, status: 'disqualified' });
		await claim(p, tier);
		expect((await teamTotal(g.id, team)).photoPts).toBe(0);
	});

	it('scores nothing for photos in an inactive category or unsorted photos', async () => {
		const { g, team, user, cat } = await setup({ active: 0 });
		const tier = await mkOption(cat, 5);
		const p = await mkPhoto(g, { cat, team, user });
		await claim(p, tier);
		await mkPhoto(g, { cat: null, team, user });
		expect((await teamTotal(g.id, team)).photoPts).toBe(0);
	});

	it('counts only the best photos up to scoring_cap', async () => {
		const { g, team, user, cat } = await setup({ cap: 2 });
		const ids = [];
		for (const pts of [3, 9, 6]) {
			const o = await mkOption(cat, pts);
			const p = await mkPhoto(g, { cat, team, user });
			await claim(p, o);
			ids.push(p);
		}
		const s = await scoreGame(await game(g.id));
		expect(s.teams[0].photoPts).toBe(9 + 6);
		expect(s.photoScores.get(ids[0])!.counted).toBe(false);
	});

	it('skips a photo that would pass max_points but still fits a smaller one', async () => {
		const { g, team, user, cat } = await setup({ max: 10 });
		for (const pts of [8, 5, 2]) {
			const o = await mkOption(cat, pts);
			await claim(await mkPhoto(g, { cat, team, user }), o);
		}
		// 8 fits, 5 would make 13, 2 still fits.
		expect((await teamTotal(g.id, team)).photoPts).toBe(10);
	});

	it('keeps other categories’ points out of max_points and the ranking for it', async () => {
		const { g, team, user, cat } = await setup({ max: 10 });
		const other = await mkCategory(g.id, { sort: 5 });
		const bonus = await mkOption(other, 6, 'bonus');
		// 8 own + 6 from another category would be 14 against a ceiling of 10, but only the 8 counts toward it.
		const a = await mkPhoto(g, { cat, team, user });
		await claim(a, await mkOption(cat, 8));
		await claim(a, bonus);
		const b = await mkPhoto(g, { cat, team, user });
		await claim(b, await mkOption(cat, 2));
		const s = await scoreGame(await game(g.id));
		expect(s.photoScores.get(a)).toMatchObject({ counted: true, points: 14 });
		expect(s.photoScores.get(b)).toMatchObject({ counted: true, points: 2 });
		expect(s.teams[0].photoPts).toBe(16);
	});

	it('a photo past scoring_cap still keeps its other-category points', async () => {
		const { g, team, user, cat } = await setup({ cap: 1 });
		const other = await mkCategory(g.id, { sort: 5 });
		const bonus = await mkOption(other, 3, 'bonus');
		const a = await mkPhoto(g, { cat, team, user });
		await claim(a, await mkOption(cat, 9));
		const b = await mkPhoto(g, { cat, team, user });
		await claim(b, await mkOption(cat, 4));
		await claim(b, bonus);
		const s = await scoreGame(await game(g.id));
		expect(s.photoScores.get(b)).toMatchObject({ counted: false, points: 3 });
		expect(s.teams[0].photoPts).toBe(9 + 3);
	});

	it('points earned from another category count toward that category’s max_points', async () => {
		const { g, team, user, cat: colors } = await setup({ max: 20 });
		const here = await mkCategory(g.id, { sort: 5 });
		const tc = await mkOption(colors, 8, 'bonus');
		const colorsPhoto = await mkPhoto(g, { cat: colors, team, user });
		await claim(colorsPhoto, tc);
		const ids = [];
		for (let i = 0; i < 3; i++) {
			const p = await mkPhoto(g, { cat: here, team, user });
			await claim(p, tc);
			ids.push(p);
		}
		// 8 + 8 fits; the third 8 would make 24 against 20.
		const s = await scoreGame(await game(g.id));
		expect(s.teams[0].photoPts).toBe(16);
		expect(ids.map((i) => s.photoScores.get(i)!.points)).toEqual([8, 0, 0]);
	});

	it('points earned from another category use up that category’s scoring_cap', async () => {
		const { g, team, user, cat: colors } = await setup({ cap: 2 });
		const here = await mkCategory(g.id, { sort: 5 });
		const tc = await mkOption(colors, 1, 'bonus');
		for (let i = 0; i < 4; i++) await claim(await mkPhoto(g, { cat: here, team, user }), tc);
		expect((await teamTotal(g.id, team)).photoPts).toBe(2);
	});

	it('an override replaces the whole score and does not stack into other categories', async () => {
		const { g, team, user, cat: colors } = await setup({ max: 5 });
		const here = await mkCategory(g.id, { sort: 5 });
		const tc = await mkOption(colors, 4, 'bonus');
		const p = await mkPhoto(g, { cat: here, team, user, override: 10 });
		await claim(p, tc);
		expect((await teamTotal(g.id, team)).photoPts).toBe(10);
	});

	it('applies caps per team, not across teams', async () => {
		const { g, team, user, cat } = await setup({ cap: 1 });
		const team2 = await mkTeam(g.id, 'Other');
		const user2 = await mkUser();
		await mkMember(g.id, user2, team2);
		const o = await mkOption(cat, 4);
		await claim(await mkPhoto(g, { cat, team, user }), o);
		await claim(await mkPhoto(g, { cat, team: team2, user: user2 }), o);
		expect((await teamTotal(g.id, team)).photoPts).toBe(4);
		expect((await teamTotal(g.id, team2)).photoPts).toBe(4);
	});

	it('credits the person who took the photo', async () => {
		const { g, team, user, cat } = await setup();
		const o = await mkOption(cat, 4);
		await claim(await mkPhoto(g, { cat, team, user }), o);
		const s = await scoreGame(await game(g.id));
		expect(s.personPts.get(user)).toBe(4);
		expect(s.personPhotos.get(user)).toBe(1);
	});

	it('ranks teams by total, then filled categories, then name', async () => {
		const { g, team, user, cat } = await setup();
		const b = await mkTeam(g.id, 'Aardvarks');
		const o = await mkOption(cat, 1);
		await claim(await mkPhoto(g, { cat, team, user }), o);
		await run("UPDATE team SET name = 'Zebras' WHERE id = ?", team);
		const s = await scoreGame(await game(g.id));
		expect(s.teams.map((t) => t.name)).toEqual(['Zebras', 'Aardvarks']);
		expect(b).toBeGreaterThan(0);
	});
});

describe('bingo scoring', () => {
	it('awards line points and a full-board bonus', async () => {
		const g = await mkGame({ bingo: 1, bingo_cols: 2, bingo_line_points: 3, bingo_board_points: 10 });
		const team = await mkTeam(g.id);
		const user = await mkUser();
		const cats = [];
		for (let i = 0; i < 4; i++) cats.push(await mkCategory(g.id, { sort: i }));
		const fill = async (c: number) => claim(await mkPhoto(g, { cat: c, team, user }), await mkOption(c, 0.5));
		await fill(cats[0]);
		await fill(cats[1]);
		let t = await teamTotal(g.id, team);
		expect(t).toMatchObject({ lines: 1, bingoPts: 3, filled: 2 });
		await fill(cats[2]);
		await fill(cats[3]);
		t = await teamTotal(g.id, team);
		// 2 rows + 2 columns + 2 diagonals, plus the board bonus.
		expect(t).toMatchObject({ lines: 6, bingoPts: 6 * 3 + 10 });
	});

	it('gives nothing when bingo is off', async () => {
		const g = await mkGame({ bingo: 0, bingo_line_points: 3 });
		const team = await mkTeam(g.id);
		const user = await mkUser();
		const cat = await mkCategory(g.id);
		await claim(await mkPhoto(g, { cat, team, user }), await mkOption(cat, 1));
		expect((await teamTotal(g.id, team)).bingoPts).toBe(0);
	});
});

describe('voted awards', () => {
	async function award(status: string, scope = 'game') {
		const { g, team, user, cat } = await setup();
		const team2 = await mkTeam(g.id, 'B');
		const user2 = await mkUser();
		const p1 = await mkPhoto(g, { cat, team, user });
		const p2 = await mkPhoto(g, { cat, team: team2, user: user2 });
		const a = await insert('INSERT INTO award (game_id, name, points, scope, status) VALUES (?, ?, 5, ?, ?)', g.id, 'Best', scope, status);
		const voter = await mkUser();
		const voter2 = await mkUser();
		await run('INSERT INTO vote (award_id, photo_id, user_id) VALUES (?, ?, ?)', a, p1, voter);
		await run('INSERT INTO vote (award_id, photo_id, user_id) VALUES (?, ?, ?)', a, p1, voter2);
		await run('INSERT INTO vote (award_id, photo_id, user_id) VALUES (?, ?, ?)', a, p2, user);
		return { g, team, team2, p2 };
	}

	it('pays the winning team once voting is closed', async () => {
		const { g, team, team2 } = await award('closed');
		expect((await teamTotal(g.id, team)).awardPts).toBe(5);
		expect((await teamTotal(g.id, team2)).awardPts).toBe(0);
	});

	it('pays nothing while voting is open', async () => {
		const { g, team } = await award('open');
		expect((await teamTotal(g.id, team)).awardPts).toBe(0);
	});

	it('pays every tied winner', async () => {
		const { g, team, team2, p2 } = await award('closed');
		await run('INSERT INTO vote (award_id, photo_id, user_id) VALUES ((SELECT MAX(id) FROM award), ?, ?)', p2, await mkUser());
		expect((await teamTotal(g.id, team)).awardPts).toBe(5);
		expect((await teamTotal(g.id, team2)).awardPts).toBe(5);
	});

	it('ignores votes for disqualified photos', async () => {
		const { g, team, team2, p2 } = await award('closed');
		await run("UPDATE photo SET status = 'disqualified' WHERE team_id = ?", team);
		expect((await teamTotal(g.id, team)).awardPts).toBe(0);
		expect((await teamTotal(g.id, team2)).awardPts).toBe(5);
		expect(p2).toBeGreaterThan(0);
	});
});

describe('extra team credits (grants)', () => {
	it('counts a grant with no photo', async () => {
		const { g, team } = await setup();
		await run("INSERT INTO grant_award (game_id, team_id, title, points, created_at) VALUES (?, ?, 'x', 4, ?)", g.id, team, now());
		expect((await teamTotal(g.id, team)).grantPts).toBe(4);
	});

	it('counts a photo-linked grant only while the photo is ok', async () => {
		const { g, team, user, cat } = await setup();
		const p = await mkPhoto(g, { cat, team, user });
		const gr = await insert("INSERT INTO grant_award (game_id, team_id, title, points, created_at) VALUES (?, ?, 'x', 4, ?)", g.id, team, now());
		await run('INSERT INTO grant_photo (grant_id, photo_id) VALUES (?, ?)', gr, p);
		expect((await teamTotal(g.id, team)).grantPts).toBe(4);
		await run("UPDATE photo SET status = 'disqualified' WHERE id = ?", p);
		expect((await teamTotal(g.id, team)).grantPts).toBe(0);
	});

	it('allows negative points', async () => {
		const { g, team } = await setup();
		await run("INSERT INTO grant_award (game_id, team_id, title, points, created_at) VALUES (?, ?, 'penalty', -3, ?)", g.id, team, now());
		expect((await teamTotal(g.id, team)).total).toBe(-3);
	});
});

describe('score cache', () => {
	const cached = (id: number) => get<{ epoch: number; json: string }>('SELECT epoch, json FROM score_cache WHERE game_id = ?', id);
	const epoch = async (id: number) => (await get<{ n: number }>('SELECT score_epoch AS n FROM game WHERE id = ?', id))!.n;

	it('stores a copy under the current epoch', async () => {
		const { g } = await setup();
		await scoreGame(await game(g.id));
		expect((await cached(g.id))!.epoch).toBe(await epoch(g.id));
	});

	it('serves the stored copy while nothing changed', async () => {
		const { g, team } = await setup();
		await scoreGame(await game(g.id));
		// Poison the copy without touching a scoring table: a hit returns it, a recount would not.
		const row = (await cached(g.id))!;
		const poisoned = JSON.parse(row.json);
		poisoned.teams[0].name = 'FROM CACHE';
		await run('UPDATE score_cache SET json = ? WHERE game_id = ?', JSON.stringify(poisoned), g.id);
		expect((await scoreGame(await game(g.id))).teams[0].name).toBe('FROM CACHE');
		expect(team).toBeGreaterThan(0);
	});

	it.each([
		['a claim', async (x: Awaited<ReturnType<typeof setup>>) => claim(await mkPhoto(x.g, x), await mkOption(x.cat, 1))],
		['a points override', async (x: Awaited<ReturnType<typeof setup>>) => run('UPDATE photo SET points_override = 3 WHERE id = ?', await mkPhoto(x.g, { ...x, cat: x.cat }))],
		['a team rename', async (x: Awaited<ReturnType<typeof setup>>) => run("UPDATE team SET name = 'New' WHERE id = ?", x.team)],
		['a grant', async (x: Awaited<ReturnType<typeof setup>>) => run("INSERT INTO grant_award (game_id, team_id, title, points, created_at) VALUES (?, ?, 'x', 1, ?)", x.g.id, x.team, now())],
		['a bingo setting', async (x: Awaited<ReturnType<typeof setup>>) => run('UPDATE game SET bingo_line_points = 9 WHERE id = ?', x.g.id)]
	])('is invalidated by %s', async (_name, change) => {
		const x = await setup();
		await scoreGame(await game(x.g.id));
		const before = await epoch(x.g.id);
		await change(x);
		expect(await epoch(x.g.id)).toBeGreaterThan(before);
	});

	it('only bumps the epoch of the game that changed', async () => {
		const a = await setup();
		const b = await setup();
		const before = await epoch(b.g.id);
		await mkPhoto(a.g, a);
		expect(await epoch(b.g.id)).toBe(before);
	});

	it('shows new points right after a claim is saved', async () => {
		const { g, team, user, cat } = await setup();
		const o = await mkOption(cat, 5);
		const p = await mkPhoto(g, { cat, team, user });
		expect((await teamTotal(g.id, team)).total).toBe(0);
		await claim(p, o);
		expect((await teamTotal(g.id, team)).total).toBe(5);
	});

	it('falls back to counting when the stored copy is unreadable', async () => {
		const { g } = await setup();
		await scoreGame(await game(g.id));
		await run("UPDATE score_cache SET json = 'not json' WHERE game_id = ?", g.id);
		await expect(scoreGame(await game(g.id))).resolves.toHaveProperty('teams');
	});
});
