import { describe, expect, it } from 'vitest';
import { all } from '../../src/lib/server/db.ts';
import { claimStatements, optionsFor, saveClaims } from '../../src/lib/server/claims.ts';
import { claim, mkCategory, mkGame, mkOption, mkPhoto, mkTeam, mkUser, teamTotal, useDatabase } from './helpers.ts';

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

	it('clears claims when nothing is submitted for a category with no options', async () => {
		const { cat, photo, g } = await setup();
		const stray = await mkOption(await mkCategory(g.id), 4);
		await claim(photo, stray);
		await saveClaims(photo, cat, form({}));
		expect(await claims(photo)).toEqual([]);
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
