import { all, get, q } from './db.ts';

export type Item = { id: number; label: string };

export const MAX_ITEMS = 500;
const MAX_LABEL = 80;

export const itemsFor = (categoryId: number) =>
	all<Item>('SELECT id, label FROM category_item WHERE category_id = ? ORDER BY sort, id', categoryId);

/** An item id from a form, if it belongs to that category (else null, so a stray id never links across categories). */
export async function itemIn(categoryId: number, raw: unknown): Promise<number | null> {
	const id = Number(raw);
	if (!id) return null;
	const row = await get<{ id: number }>('SELECT id FROM category_item WHERE id = ? AND category_id = ?', id, categoryId);
	return row?.id ?? null;
}

/** The labels in a textarea or JSON array: trimmed, blanks dropped, repeats (ignoring case) dropped. */
export function parseItems(input: unknown): string[] | { error: string } {
	const raw = Array.isArray(input) ? input : String(input ?? '').split(/\r?\n/);
	const seen = new Set<string>();
	const out: string[] = [];
	for (const v of raw) {
		const label = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
		if (!label || seen.has(label.toLowerCase())) continue;
		seen.add(label.toLowerCase());
		out.push(label);
	}
	if (out.length > MAX_ITEMS) return { error: `A checklist can hold at most ${MAX_ITEMS} items.` };
	return out;
}

/**
 * Statements that make a category's checklist match `labels`, in that order. An item whose label is still
 * there keeps its id (so photos stay ticked through a reorder or a typo fix elsewhere); the rest are added or removed.
 */
export async function itemStatements(categoryId: number, labels: string[]) {
	const have = await itemsFor(categoryId);
	const byLabel = new Map(have.map((i) => [i.label.toLowerCase(), i.id]));
	const keep = labels.map((l) => byLabel.get(l.toLowerCase())).filter((id): id is number => !!id);
	return [
		q('DELETE FROM category_item WHERE category_id = ? AND id NOT IN (SELECT value FROM json_each(?))', categoryId, JSON.stringify(keep)),
		...labels.map((label, i) => {
			const id = byLabel.get(label.toLowerCase());
			return id
				? q('UPDATE category_item SET label = ?, sort = ? WHERE id = ? AND category_id = ?', label, i, id, categoryId)
				: q('INSERT INTO category_item (category_id, label, sort) VALUES (?, ?, ?)', categoryId, label, i);
		})
	];
}

/** Ids of the items a team has a (non-disqualified) photo for. */
export async function foundItems(categoryId: number, teamId: number | null): Promise<number[]> {
	if (!teamId) return [];
	return (
		await all<{ item_id: number }>(
			`SELECT DISTINCT item_id FROM photo WHERE category_id = ? AND team_id = ? AND item_id IS NOT NULL AND status != 'disqualified'`,
			categoryId,
			teamId
		)
	).map((r) => r.item_id);
}
