import { describe, expect, it } from 'vitest';
import { get, run } from '../../src/lib/server/db.ts';
import { addSuperlative, listSuperlatives, removeSuperlative } from '../../src/lib/server/superlatives.ts';
import { mkCategory, mkGame, mkMember, mkPhoto, mkTeam, mkUser, useDatabase } from './helpers.ts';

useDatabase();

async function world() {
	const game = await mkGame();
	const reds = await mkTeam(game.id, 'Reds');
	const alice = await mkUser({ name: 'Alice' });
	await mkMember(game.id, alice, reds);
	const cat = await mkCategory(game.id);
	const photo = await mkPhoto(game, { cat, team: reds, user: alice });
	const unsorted = await mkPhoto(game, { cat: null, team: reds, user: alice });
	return { game, reds, alice, photo, unsorted };
}

describe('superlatives', () => {
	it('gives one to a player, a team and a photo, and lists who got it', async () => {
		const w = await world();
		expect(await addSuperlative(w.game.id, { title: 'Most likely to nap', kind: 'person', to: w.alice })).toHaveProperty('id');
		expect(await addSuperlative(w.game.id, { title: 'Loudest', kind: 'team', to: w.reds })).toHaveProperty('id');
		expect(await addSuperlative(w.game.id, { title: 'Best hat', kind: 'photo', to: w.photo, note: 'wow' })).toHaveProperty('id');
		const list = await listSuperlatives(w.game.id);
		const by = (t: string) => list.find((s) => s.title === t)!;
		expect(by('Most likely to nap')).toMatchObject({ kind: 'person', who: 'Alice', team: 'Reds', user_id: w.alice, photo_id: null });
		expect(by('Loudest')).toMatchObject({ kind: 'team', who: 'Reds', team_id: w.reds });
		expect(by('Best hat')).toMatchObject({ kind: 'photo', who: 'Alice', team: 'Reds', photo_id: w.photo, note: 'wow' });
	});

	it('refuses blank titles, strangers, other games’ rows and unsorted photos', async () => {
		const w = await world();
		const other = await mkGame();
		const stranger = await mkUser();
		expect(await addSuperlative(w.game.id, { title: '  ', kind: 'person', to: w.alice })).toHaveProperty('error');
		expect(await addSuperlative(w.game.id, { title: 'x', kind: 'person', to: stranger })).toHaveProperty('error');
		expect(await addSuperlative(other.id, { title: 'x', kind: 'team', to: w.reds })).toHaveProperty('error');
		expect(await addSuperlative(other.id, { title: 'x', kind: 'photo', to: w.photo })).toHaveProperty('error');
		expect(await addSuperlative(w.game.id, { title: 'x', kind: 'photo', to: w.unsorted })).toHaveProperty('error');
		expect(await listSuperlatives(w.game.id)).toEqual([]);
	});

	it('goes away with its photo, and can only be removed from its own game', async () => {
		const w = await world();
		const r = (await addSuperlative(w.game.id, { title: 'Best hat', kind: 'photo', to: w.photo })) as { id: number };
		const other = await mkGame();
		await removeSuperlative(other.id, r.id);
		expect(await get('SELECT 1 AS x FROM superlative WHERE id = ?', r.id)).toBeTruthy();
		await run('DELETE FROM photo WHERE id = ?', w.photo);
		expect(await get('SELECT 1 AS x FROM superlative WHERE id = ?', r.id)).toBeUndefined();
	});
});
