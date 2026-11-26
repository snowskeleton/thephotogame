import { all } from './db.ts';
import type { Game } from './game.ts';
import { scoreGame } from './scoring.ts';

export type ExportFile = { id: number; ext: string; folder: string; team: string; who: string };

const safe = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 60) || 'untitled';

/** Which subset of photos to export. `team:<id>` and `category:<id>` carry an id. */
export function parseSet(raw: string | null): { kind: 'all' | 'winners' | 'voted' | 'superlatives' | 'team' | 'category'; id: number } | null {
	const [kind, id] = (raw ?? 'all').split(':');
	if (kind === 'all' || kind === 'winners' || kind === 'voted' || kind === 'superlatives') return { kind, id: 0 };
	if ((kind === 'team' || kind === 'category') && Number(id) > 0) return { kind, id: Number(id) };
	return null;
}

const BASE = `SELECT p.id, p.ext, c.name AS category, t.name AS team, u.name AS who
	FROM photo p JOIN category c ON c.id = p.category_id JOIN team t ON t.id = p.team_id JOIN user u ON u.id = p.user_id`;

type Row = { id: number; ext: string; category: string; team: string; who: string };
const byCategory = (rows: Row[]): ExportFile[] => rows.map((r) => ({ ...r, folder: safe(r.category) }));

/**
 * The originals to put in a zip, with their folder. Winners are the photos that won a closed vote (ties included),
 * one folder per award (per category for category awards). A photo that won twice appears in both folders.
 * Disqualified photos are never exported in a subset; the full export keeps its old behaviour.
 */
export async function exportFiles(game: Game, set: NonNullable<ReturnType<typeof parseSet>>): Promise<{ label: string; files: ExportFile[] }> {
	if (set.kind === 'all') return { label: '', files: byCategory(await all<Row>(`${BASE} WHERE p.game_id = ? ORDER BY c.sort, p.id`, game.id)) };
	if (set.kind === 'team')
		return { label: 'team', files: byCategory(await all<Row>(`${BASE} WHERE p.game_id = ? AND p.team_id = ? AND p.status != 'disqualified' ORDER BY c.sort, p.id`, game.id, set.id)) };
	if (set.kind === 'category')
		return { label: 'category', files: byCategory(await all<Row>(`${BASE} WHERE p.game_id = ? AND p.category_id = ? AND p.status != 'disqualified' ORDER BY p.id`, game.id, set.id)) };
	if (set.kind === 'superlatives') {
		const rows = await all<Row & { title: string }>(
			`SELECT p.id, p.ext, c.name AS category, t.name AS team, u.name AS who, s.title
			 FROM superlative s JOIN photo p ON p.id = s.photo_id JOIN category c ON c.id = p.category_id
			 JOIN team t ON t.id = p.team_id JOIN user u ON u.id = p.user_id
			 WHERE s.game_id = ? AND s.kind = 'photo' AND p.status != 'disqualified' ORDER BY s.id`,
			game.id
		);
		return { label: 'superlatives', files: rows.map((r) => ({ ...r, folder: safe(r.title) })) };
	}
	if (set.kind === 'voted') {
		// Any vote counts, whatever the award's status. A photo with votes in two awards lands in both folders.
		const rows = await all<Row & { award: string }>(
			`SELECT p.id, p.ext, c.name AS category, t.name AS team, u.name AS who, a.name AS award
			 FROM photo p JOIN category c ON c.id = p.category_id JOIN team t ON t.id = p.team_id JOIN user u ON u.id = p.user_id
			 JOIN award a ON a.game_id = p.game_id
			 WHERE p.game_id = ? AND p.status != 'disqualified' AND EXISTS (SELECT 1 FROM vote v WHERE v.award_id = a.id AND v.photo_id = p.id)
			 ORDER BY a.sort, a.id, p.id`,
			game.id
		);
		return { label: 'voted', files: rows.map((r) => ({ ...r, folder: safe(r.award) })) };
	}
	const { winners } = await scoreGame(game);
	if (!winners.length) return { label: 'winners', files: [] };
	const awards = new Map((await all<{ id: number; name: string }>('SELECT id, name FROM award WHERE game_id = ?', game.id)).map((a) => [a.id, a.name]));
	const cats = new Map((await all<{ id: number; name: string }>('SELECT id, name FROM category WHERE game_id = ?', game.id)).map((c) => [c.id, c.name]));
	const photos = new Map(
		(await all<Row & { category_id: number | null }>(
			`SELECT p.id, p.ext, c.name AS category, t.name AS team, u.name AS who FROM photo p
			 JOIN category c ON c.id = p.category_id JOIN team t ON t.id = p.team_id JOIN user u ON u.id = p.user_id WHERE p.game_id = ?`,
			game.id
		)).map((p) => [p.id, p])
	);
	const scoped = new Set((await all<{ id: number }>("SELECT id FROM award WHERE game_id = ? AND scope = 'category'", game.id)).map((a) => a.id));
	const files: ExportFile[] = [];
	for (const w of winners) {
		const p = photos.get(w.photo_id);
		if (!p) continue;
		const name = awards.get(w.award_id) ?? 'Award';
		files.push({ ...p, folder: safe(scoped.has(w.award_id) ? `${name} - ${cats.get(w.category_id) ?? ''}` : name) });
	}
	return { label: 'winners', files };
}

export const fileName = (f: ExportFile) => `${f.folder}/${safe(f.team)} - ${safe(f.who)} - ${f.id}.${f.ext}`;
export { safe };
