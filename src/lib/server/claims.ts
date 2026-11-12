import { all, run } from './db.ts';

export type Option = { id: number; label: string; points: number; kind: 'tier' | 'extra' };

export function optionsFor(categoryId: number): Option[] {
	return all<Option>(
		'SELECT id, label, points, kind FROM score_option WHERE category_id = ? ORDER BY sort, id',
		categoryId
	);
}

/** Replaces a photo's claims from a submitted form: `tier` = option id, `extra_<id>` = quantity. */
export function saveClaims(photoId: number, categoryId: number, f: FormData) {
	const options = optionsFor(categoryId);
	run('DELETE FROM photo_claim WHERE photo_id = ?', photoId);
	const tiers = options.filter((o) => o.kind === 'tier');
	const picked = tiers.find((o) => o.id === Number(f.get('tier'))) ?? (tiers.length === 1 ? tiers[0] : undefined);
	if (picked) run('INSERT INTO photo_claim (photo_id, option_id, qty) VALUES (?, ?, 1)', photoId, picked.id);
	for (const o of options.filter((o) => o.kind === 'extra')) {
		const qty = Math.min(99, Math.max(0, Math.floor(Number(f.get(`extra_${o.id}`)) || 0)));
		if (qty > 0) run('INSERT INTO photo_claim (photo_id, option_id, qty) VALUES (?, ?, ?)', photoId, o.id, qty);
	}
}
