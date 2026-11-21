import { describe, expect, it } from 'vitest';
import { all } from '../../src/lib/server/db.ts';
import { giveTeamPoints } from '../../src/lib/server/grants.ts';
import { game, mkCategory, mkGame, mkPhoto, mkTeam, mkUser, teamTotal, useDatabase } from './helpers.ts';

useDatabase();

const form = (o: Record<string, string | string[]>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x);
	return f;
};

async function setup() {
	const g = await mkGame();
	const a = await mkTeam(g.id, 'A');
	const b = await mkTeam(g.id, 'B');
	const c = await mkTeam(g.id, 'C');
	const user = await mkUser();
	const cat = await mkCategory(g.id);
	const photo = await mkPhoto(g, { cat, team: a, user });
	return { g: await game(g.id), a, b, c, photo };
}

describe('giveTeamPoints', () => {
	it('credits several teams at once, each with its own grant tied to the photo', async () => {
		const { g, b, c, photo } = await setup();
		const err = await giveTeamPoints(g, form({ team: [String(b), String(c)], title: 'In the shot', points: '2' }), [photo]);
		expect(err).toBeNull();
		const rows = await all<{ team_id: number; photo_id: number }>('SELECT g.team_id, gp.photo_id FROM grant_award g JOIN grant_photo gp ON gp.grant_id = g.id ORDER BY g.team_id');
		expect(rows).toEqual([{ team_id: b, photo_id: photo }, { team_id: c, photo_id: photo }]);
		expect((await teamTotal(g.id, b)).grantPts).toBe(2);
		expect((await teamTotal(g.id, c)).grantPts).toBe(2);
	});

	it('credits a team once when its id is repeated', async () => {
		const { g, b, photo } = await setup();
		await giveTeamPoints(g, form({ team: [String(b), String(b)], title: 'x', points: '1' }), [photo]);
		expect((await teamTotal(g.id, b)).grantPts).toBe(1);
	});

	it('refuses points that do not come from a photo', async () => {
		const { g, b } = await setup();
		expect(await giveTeamPoints(g, form({ team: String(b), title: 'x', points: '1' }), [])).toBe('Points have to come from a photo.');
	});

	it.each([
		['no reason', { title: '', points: '1' }, 'Give it a short reason.'],
		['zero points', { title: 'x', points: '0' }, 'Enter how many points.'],
		['junk points', { title: 'x', points: 'lots' }, 'Enter how many points.']
	])('refuses %s', async (_n, fields, message) => {
		const { g, b, photo } = await setup();
		expect(await giveTeamPoints(g, form({ team: String(b), ...fields }), [photo])).toBe(message);
	});

	it('refuses a team from another game', async () => {
		const { g, photo } = await setup();
		const other = await mkTeam((await mkGame()).id);
		expect(await giveTeamPoints(g, form({ team: String(other), title: 'x', points: '1' }), [photo])).toBe('Choose a team.');
	});

	it('refuses when no team is chosen', async () => {
		const { g, photo } = await setup();
		expect(await giveTeamPoints(g, form({ title: 'x', points: '1' }), [photo])).toBe('Choose at least one team.');
	});

	it('accepts negative points', async () => {
		const { g, b, photo } = await setup();
		await giveTeamPoints(g, form({ team: String(b), title: 'Penalty', points: '-2' }), [photo]);
		expect((await teamTotal(g.id, b)).grantPts).toBe(-2);
	});

	it('does not link photos from another game', async () => {
		const { g, b } = await setup();
		const og = await mkGame();
		const ot = await mkTeam(og.id);
		const foreign = await mkPhoto(og, { cat: await mkCategory(og.id), team: ot, user: await mkUser() });
		await giveTeamPoints(g, form({ team: String(b), title: 'x', points: '1' }), [foreign]);
		// The grant exists but has no photo link, so it would float free. Pinned so a change here is a conscious one.
		expect(await all('SELECT 1 FROM grant_photo WHERE photo_id = ?', foreign)).toEqual([]);
	});

	it('stops counting when the photo is disqualified', async () => {
		const { g, b, photo } = await setup();
		await giveTeamPoints(g, form({ team: String(b), title: 'x', points: '3' }), [photo]);
		const { run } = await import('../../src/lib/server/db.ts');
		await run("UPDATE photo SET status = 'disqualified' WHERE id = ?", photo);
		expect((await teamTotal(g.id, b)).grantPts).toBe(0);
	});
});
