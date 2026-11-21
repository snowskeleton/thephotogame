import { all, batch, q } from './db.ts';
import type { Game } from './game.ts';

export type Option = { id: number; label: string; points: number; kind: 'tier' | 'extra' | 'bonus' };

export function optionsFor(categoryId: number): Promise<Option[]> {
	return all<Option>(
		'SELECT id, label, points, kind FROM score_option WHERE category_id = ? ORDER BY sort, id',
		categoryId
	);
}

/** Replaces a photo's claims from a submitted form: `tier` = option id, `extra_<id>` = quantity, `bonus_<id>` = checked. */
export async function saveClaims(photoId: number, categoryId: number, f: FormData) {
	await batch(await claimStatements(photoId, categoryId, f));
}

/** The statements behind `saveClaims`, for callers that batch them with other writes. */
export async function claimStatements(photoId: number, categoryId: number, f: FormData) {
	const options = await optionsFor(categoryId);
	// Only this category's own options are replaced; points a photo picked up from other categories stay (see alsoStatements).
	const stmts = [
		q('DELETE FROM photo_claim WHERE photo_id = ? AND option_id IN (SELECT id FROM score_option WHERE category_id = ?)', photoId, categoryId)
	];
	const tiers = options.filter((o) => o.kind === 'tier');
	const picked = tiers.find((o) => o.id === Number(f.get('tier'))) ?? (tiers.length === 1 ? tiers[0] : undefined);
	if (picked) stmts.push(q('INSERT INTO photo_claim (photo_id, option_id, qty) VALUES (?, ?, 1)', photoId, picked.id));
	for (const o of options.filter((o) => o.kind === 'extra')) {
		const qty = Math.min(99, Math.max(0, Math.floor(Number(f.get(`extra_${o.id}`)) || 0)));
		if (qty > 0) stmts.push(q('INSERT INTO photo_claim (photo_id, option_id, qty) VALUES (?, ?, ?)', photoId, o.id, qty));
	}
	// A bonus is a flat add-on that stacks on top of the tier and the extras.
	for (const o of options.filter((o) => o.kind === 'bonus'))
		if (f.get(`bonus_${o.id}`)) stmts.push(q('INSERT INTO photo_claim (photo_id, option_id, qty) VALUES (?, ?, 1)', photoId, o.id));
	return stmts;
}

export type AlsoOption = Option & { category_id: number; category: string };

/** Scoring options of the game's other categories, which a photo can also earn (a fit-check photo that has a hidden Mickey). */
export function otherOptionsFor(gameId: number, categoryId: number): Promise<AlsoOption[]> {
	return all<AlsoOption>(
		`SELECT o.id, o.label, o.points, o.kind, o.category_id, c.name AS category
		 FROM score_option o JOIN category c ON c.id = o.category_id
		 WHERE c.game_id = ? AND c.id != ? ORDER BY c.sort, c.id, o.sort, o.id`,
		gameId,
		categoryId
	);
}

/**
 * Replaces the points a photo earns from other categories: `also_<id>` is a quantity for an extra and a
 * tick for a base line or bonus. They add to the photo's own points; they don't fill the other category's
 * bingo square or count toward its limits.
 */
export async function alsoStatements(photoId: number, game: Game, categoryId: number, f: FormData) {
	const options = await otherOptionsFor(game.id, categoryId);
	const stmts = [
		q('DELETE FROM photo_claim WHERE photo_id = ? AND option_id IN (SELECT id FROM score_option WHERE category_id != ?)', photoId, categoryId)
	];
	for (const o of options) {
		const v = f.get(`also_${o.id}`);
		const qty = o.kind === 'extra' ? Math.min(99, Math.max(0, Math.floor(Number(v) || 0))) : v ? 1 : 0;
		if (qty > 0) stmts.push(q('INSERT INTO photo_claim (photo_id, option_id, qty) VALUES (?, ?, ?)', photoId, o.id, qty));
	}
	return stmts;
}
