import { describe, expect, it } from 'vitest';
import { all, batch } from '../../src/lib/server/db.ts';
import { alsoStatements, claimStatements, optionsFor, otherOptionsFor, saveClaims } from '../../src/lib/server/claims.ts';
import { claim, game, mkCategory, mkGame, mkOption, mkPhoto, mkTeam, mkUser, teamTotal, useDatabase } from './helpers.ts';

useDatabase();

const form = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.set(k, v);
	return f;
};
const claims = (photo: number) => all<{ option_id: number; qty: number }>('SELECT option_id, qty FROM photo_claim WHERE photo_id = ? ORDER BY option_id', photo);

async function setup() {
	const g = await mkGame();
	const team = await mkTeam(g.id);
	const user = await mkUser();
	const cat = await mkCategory(g.id);
	const photo = await mkPhoto(g, { cat, team, user });
	return { g, team, cat, photo };
}

describe('saveClaims', () => {
	it('saves the chosen tier', async () => {
		const { cat, photo } = await setup();
		const a = await mkOption(cat, 1);
		const b = await mkOption(cat, 5);
		await saveClaims(photo, cat, form({ tier: String(b) }));
		expect(await claims(photo)).toEqual([{ option_id: b, qty: 1 }]);
		expect(a).not.toBe(b);
	});

	it('picks the only tier when there is just one', async () => {
		const { cat, photo } = await setup();
		const only = await mkOption(cat, 3);
		await saveClaims(photo, cat, form({}));
		expect(await claims(photo)).toEqual([{ option_id: only, qty: 1 }]);
	});

	it('saves nothing when there are several tiers and none is chosen', async () => {
		const { cat, photo } = await setup();
		await mkOption(cat, 1);
		await mkOption(cat, 2);
		await saveClaims(photo, cat, form({}));
		expect(await claims(photo)).toEqual([]);
	});

	it('ignores a tier id from another category', async () => {
		const { g, cat, photo } = await setup();
		await mkOption(cat, 1);
		await mkOption(cat, 2);
		const other = await mkOption(await mkCategory(g.id), 100);
		await saveClaims(photo, cat, form({ tier: String(other) }));
		expect(await claims(photo)).toEqual([]);
	});

	it('clamps extra quantities to 0..99 and whole numbers', async () => {
		const { cat, photo } = await setup();
		const e1 = await mkOption(cat, 1, 'extra');
		const e2 = await mkOption(cat, 1, 'extra');
		const e3 = await mkOption(cat, 1, 'extra');
		const e4 = await mkOption(cat, 1, 'extra');
		await saveClaims(photo, cat, form({ [`extra_${e1}`]: '500', [`extra_${e2}`]: '-4', [`extra_${e3}`]: '2.9', [`extra_${e4}`]: 'abc' }));
		expect(await claims(photo)).toEqual([
			{ option_id: e1, qty: 99 },
			{ option_id: e3, qty: 2 }
		]);
	});

	it('stacks a checked bonus with the tier', async () => {
		const { g, team, cat, photo } = await setup();
		const tier = await mkOption(cat, 5);
		const bonus = await mkOption(cat, 2, 'bonus');
		await saveClaims(photo, cat, form({ tier: String(tier), [`bonus_${bonus}`]: 'on' }));
		expect((await teamTotal(g.id, team)).photoPts).toBe(7);
	});

	it('replaces earlier claims', async () => {
		const { cat, photo } = await setup();
		const a = await mkOption(cat, 1);
		const b = await mkOption(cat, 2);
		await claim(photo, a);
		await saveClaims(photo, cat, form({ tier: String(b) }));
		expect(await claims(photo)).toEqual([{ option_id: b, qty: 1 }]);
	});

	it('keeps points the photo earned from other categories’ options when its own are replaced', async () => {
		const { cat, photo, g } = await setup();
		const own = await mkOption(cat, 4);
		const stray = await mkOption(await mkCategory(g.id), 4);
		await claim(photo, stray);
		await claim(photo, own);
		await saveClaims(photo, cat, form({}));
		// The only tier of this category is picked again; the other category's claim is untouched.
		expect((await claims(photo)).map((c) => c.option_id).sort()).toEqual([own, stray].sort());
	});

	it('clears its own claims when no tier is chosen among several', async () => {
		const { cat, photo } = await setup();
		const a = await mkOption(cat, 1);
		await mkOption(cat, 2);
		await claim(photo, a);
		await saveClaims(photo, cat, form({}));
		expect(await claims(photo)).toEqual([]);
	});
});

describe('points from other categories (alsoStatements)', () => {
	async function twoCategories() {
		const g = await mkGame();
		const team = await mkTeam(g.id);
		const user = await mkUser();
		const here = await mkCategory(g.id, { sort: 1 });
		const there = await mkCategory(g.id, { sort: 2 });
		const photo = await mkPhoto(g, { cat: here, team, user });
		return { g, team, here, there, photo };
	}

	it('lists the options of the game’s other categories only', async () => {
		const { g, here, there } = await twoCategories();
		const mine = await mkOption(here, 1);
		const theirs = await mkOption(there, 2, 'bonus');
		const elsewhere = await mkOption(await mkCategory((await mkGame()).id), 9);
		const ids = (await otherOptionsFor(g.id, here)).map((o) => o.id);
		expect(ids).toEqual([theirs]);
		expect(ids).not.toContain(mine);
		expect(ids).not.toContain(elsewhere);
	});

	it('stores ticks and quantities, and replaces only other categories’ claims', async () => {
		const { g, here, there, photo } = await twoCategories();
		const own = await mkOption(here, 1);
		const tier = await mkOption(there, 3);
		const extra = await mkOption(there, 1, 'extra');
		const old = await mkOption(there, 7, 'bonus');
		await claim(photo, own);
		await claim(photo, old);
		await batch(await alsoStatements(photo, await game(g.id), here, form({ [`also_${tier}`]: 'on', [`also_${extra}`]: '3' })));
		expect(await claims(photo)).toEqual([
			{ option_id: own, qty: 1 },
			{ option_id: tier, qty: 1 },
			{ option_id: extra, qty: 3 }
		].sort((a, b) => a.option_id - b.option_id));
	});

	it('adds the other categories’ points to the photo’s score', async () => {
		const { g, team, here, there, photo } = await twoCategories();
		const own = await mkOption(here, 5);
		const bonus = await mkOption(there, 2, 'bonus');
		await claim(photo, own);
		await batch(await alsoStatements(photo, await game(g.id), here, form({ [`also_${bonus}`]: 'on' })));
		expect((await teamTotal(g.id, team)).photoPts).toBe(7);
	});

	it('clamps extra quantities and ignores options from other games', async () => {
		const { g, here, there, photo } = await twoCategories();
		const extra = await mkOption(there, 1, 'extra');
		const foreign = await mkOption(await mkCategory((await mkGame()).id), 50);
		await batch(await alsoStatements(photo, await game(g.id), here, form({ [`also_${extra}`]: '500', [`also_${foreign}`]: 'on' })));
		expect(await claims(photo)).toEqual([{ option_id: extra, qty: 99 }]);
	});
});

describe('optionsFor / claimStatements', () => {
	it('lists options in sort order', async () => {
		const { cat } = await setup();
		const a = await mkOption(cat, 1);
		const b = await mkOption(cat, 2, 'bonus');
		expect((await optionsFor(cat)).map((o) => o.id)).toEqual([a, b]);
	});
	it('returns statements without running them', async () => {
		const { cat, photo } = await setup();
		await mkOption(cat, 1);
		const stmts = await claimStatements(photo, cat, form({}));
		expect(stmts.length).toBeGreaterThan(0);
		expect(await claims(photo)).toEqual([]);
	});
});
