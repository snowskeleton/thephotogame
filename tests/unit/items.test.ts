import { describe, expect, it } from 'vitest';
import { all, batch, run } from '../../src/lib/server/db.ts';
import { foundItems, itemIn, itemsFor, itemStatements, parseItems } from '../../src/lib/server/items.ts';
import { browseQuery } from '../../src/lib/browse.ts';
import { mkCategory, mkGame, mkMember, mkPhoto, mkTeam, mkUser, useDatabase } from './helpers.ts';

useDatabase();

const save = async (cat: number, labels: string[]) => batch(await itemStatements(cat, labels));

describe('parseItems', () => {
	it('trims, drops blanks and repeats, and keeps order', () => {
		expect(parseItems('  Alabama \r\n\nalaska\nALABAMA\n  New   York ')).toEqual(['Alabama', 'alaska', 'New York']);
		expect(parseItems(['a', ' b ', 'A', 5, null])).toEqual(['a', 'b', '5']);
	});
	it('refuses more than 500', () => {
		expect(parseItems(Array.from({ length: 501 }, (_, i) => `s${i}`))).toHaveProperty('error');
		expect(parseItems(Array.from({ length: 500 }, (_, i) => `s${i}`))).toHaveLength(500);
	});
});

describe('checklist items', () => {
	it('keeps ids for labels that stay, through a reorder, and drops the rest', async () => {
		const g = await mkGame();
		const cat = await mkCategory(g.id);
		await save(cat, ['Ohio', 'Iowa', 'Utah']);
		const first = await itemsFor(cat);
		expect(first.map((i) => i.label)).toEqual(['Ohio', 'Iowa', 'Utah']);
		await save(cat, ['utah', 'Ohio', 'Texas']);
		const second = await itemsFor(cat);
		expect(second.map((i) => i.label)).toEqual(['utah', 'Ohio', 'Texas']);
		expect(second[0].id).toBe(first[2].id);
		expect(second[1].id).toBe(first[0].id);
		expect(second.some((i) => i.id === first[1].id)).toBe(false);
	});

	it('unticks a photo whose item is removed but keeps the photo', async () => {
		const g = await mkGame();
		const team = await mkTeam(g.id);
		const u = await mkUser();
		await mkMember(g.id, u, team);
		const cat = await mkCategory(g.id);
		await save(cat, ['Ohio', 'Iowa']);
		const [ohio] = await itemsFor(cat);
		const photo = await mkPhoto(g, { cat, team, user: u });
		await run('UPDATE photo SET item_id = ? WHERE id = ?', ohio.id, photo);
		expect(await foundItems(cat, team)).toEqual([ohio.id]);
		await save(cat, ['Iowa']);
		expect(await foundItems(cat, team)).toEqual([]);
		expect((await all('SELECT id, item_id FROM photo WHERE id = ?', photo))[0]).toEqual({ id: photo, item_id: null });
	});

	it('only counts the team’s own photos that are not disqualified', async () => {
		const g = await mkGame();
		const reds = await mkTeam(g.id, 'Reds');
		const blues = await mkTeam(g.id, 'Blues');
		const u = await mkUser();
		const cat = await mkCategory(g.id);
		await save(cat, ['A', 'B', 'C']);
		const [a, b, c] = await itemsFor(cat);
		const put = async (team: number, item: number, status = 'ok') => {
			const p = await mkPhoto(g, { cat, team, user: u, status });
			await run('UPDATE photo SET item_id = ? WHERE id = ?', item, p);
		};
		await put(reds, a.id);
		await put(reds, a.id);
		await put(reds, b.id, 'disqualified');
		await put(blues, c.id);
		expect(await foundItems(cat, reds)).toEqual([a.id]);
		expect(await foundItems(cat, null)).toEqual([]);
	});

	it('itemIn only accepts an item of that category', async () => {
		const g = await mkGame();
		const one = await mkCategory(g.id);
		const two = await mkCategory(g.id);
		await save(one, ['A']);
		await save(two, ['B']);
		const [a] = await itemsFor(one);
		expect(await itemIn(one, a.id)).toBe(a.id);
		expect(await itemIn(two, a.id)).toBeNull();
		expect(await itemIn(one, 'junk')).toBeNull();
		expect(await itemIn(one, '')).toBeNull();
	});

	it('goes away with its category', async () => {
		const g = await mkGame();
		const cat = await mkCategory(g.id);
		await save(cat, ['A']);
		await run('DELETE FROM category WHERE id = ?', cat);
		expect(await all('SELECT id FROM category_item WHERE category_id = ?', cat)).toEqual([]);
	});
});

describe('browseQuery item filter', () => {
	it('keeps the item in the URL', () => {
		expect(browseQuery({ cat: 1, item: 7 })).toBe('?cat=1&item=7');
	});
});
