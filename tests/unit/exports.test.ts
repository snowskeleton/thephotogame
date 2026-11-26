import { describe, expect, it } from 'vitest';
import { insert, run } from '../../src/lib/server/db.ts';
import { exportFiles, fileName, parseSet } from '../../src/lib/server/exports.ts';
import { game, mkCategory, mkGame, mkPhoto, mkTeam, mkUser, useDatabase } from './helpers.ts';

useDatabase();

async function world(status = 'closed') {
	const g = await mkGame();
	const reds = await mkTeam(g.id, 'Reds');
	const blues = await mkTeam(g.id, 'Blues');
	const alice = await mkUser({ name: 'Alice' });
	const bob = await mkUser({ name: 'Bob' });
	const cat = await mkCategory(g.id);
	const cat2 = await mkCategory(g.id);
	const p1 = await mkPhoto(g, { cat, team: reds, user: alice });
	const p2 = await mkPhoto(g, { cat, team: blues, user: bob });
	const p3 = await mkPhoto(g, { cat: cat2, team: blues, user: bob });
	const award = await insert("INSERT INTO award (game_id, name, points, scope, status) VALUES (?, 'Best/Photo', 5, 'game', ?)", g.id, status);
	for (const voter of [alice, bob]) await run('INSERT INTO vote (award_id, photo_id, user_id) VALUES (?, ?, ?)', award, p1, voter);
	return { g: await game(g.id), reds, blues, cat, p1, p2, p3 };
}

describe('parseSet', () => {
	it('accepts known sets and rejects the rest', () => {
		expect(parseSet(null)).toEqual({ kind: 'all', id: 0 });
		expect(parseSet('winners')).toEqual({ kind: 'winners', id: 0 });
		expect(parseSet('team:4')).toEqual({ kind: 'team', id: 4 });
		expect(parseSet('team')).toBeNull();
		expect(parseSet('team:x')).toBeNull();
		expect(parseSet('bogus')).toBeNull();
	});
});

describe('exportFiles', () => {
	it('winners: only photos that won a closed vote, in an award folder', async () => {
		const w = await world();
		const { files } = await exportFiles(w.g, { kind: 'winners', id: 0 });
		expect(files.map((f) => f.id)).toEqual([w.p1]);
		expect(fileName(files[0])).toBe(`BestPhoto/Reds - Alice - ${w.p1}.jpg`);
	});
	it('winners: nothing while voting is open', async () => {
		const w = await world('open');
		expect((await exportFiles(w.g, { kind: 'winners', id: 0 })).files).toEqual([]);
	});
	it('winners: ties all come out, and a disqualified winner does not', async () => {
		const w = await world();
		await run("INSERT INTO vote (award_id, photo_id, user_id) VALUES ((SELECT MAX(id) FROM award), ?, ?)", w.p2, await mkUser());
		await run("INSERT INTO vote (award_id, photo_id, user_id) VALUES ((SELECT MAX(id) FROM award), ?, ?)", w.p2, await mkUser());
		expect((await exportFiles(w.g, { kind: 'winners', id: 0 })).files.map((f) => f.id).sort()).toEqual([w.p1, w.p2].sort());
		await run("UPDATE photo SET status = 'disqualified' WHERE id = ?", w.p2);
		expect((await exportFiles(w.g, { kind: 'winners', id: 0 })).files.map((f) => f.id)).toEqual([w.p1]);
	});
	it('winners: category awards get a folder per category', async () => {
		const w = await world();
		await run("UPDATE award SET scope = 'category'");
		const { files } = await exportFiles(w.g, { kind: 'winners', id: 0 });
		expect(files[0].folder).toBe('BestPhoto - Cat');
	});
	it('superlatives: photos given a photo superlative', async () => {
		const w = await world();
		await run("INSERT INTO superlative (game_id, title, kind, photo_id, created_at) VALUES (?, 'Best hat', 'photo', ?, 1)", w.g.id, w.p3);
		const { files } = await exportFiles(w.g, { kind: 'superlatives', id: 0 });
		expect(files.map((f) => [f.id, f.folder])).toEqual([[w.p3, 'Best hat']]);
	});
	it('team and category: only that team or category, never another game', async () => {
		const w = await world();
		const other = await mkGame();
		await mkPhoto(other, { cat: await mkCategory(other.id), team: await mkTeam(other.id), user: await mkUser() });
		expect((await exportFiles(w.g, { kind: 'team', id: w.blues })).files.map((f) => f.id).sort()).toEqual([w.p2, w.p3].sort());
		expect((await exportFiles(w.g, { kind: 'category', id: w.cat })).files.map((f) => f.id).sort()).toEqual([w.p1, w.p2].sort());
		expect((await exportFiles(other, { kind: 'team', id: w.blues })).files).toEqual([]);
	});
	it('all: every sorted photo', async () => {
		const w = await world();
		expect((await exportFiles(w.g, { kind: 'all', id: 0 })).files).toHaveLength(3);
	});
});
