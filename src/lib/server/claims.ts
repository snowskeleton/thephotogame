import { all, batch, q } from './db.ts';
import type { Game } from './game.ts';

/** `photo_claim` is the host's scoring; `photo_guess` is the photographer's own estimate (same shape). */
export type Table = 'photo_claim' | 'photo_guess';

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
export async function claimStatements(photoId: number, categoryId: number, f: FormData, table: Table = 'photo_claim') {
	const options = await optionsFor(categoryId);
	// Only this category's own options are replaced; points a photo picked up from other categories stay (see alsoStatements).
	const stmts = [
		q(`DELETE FROM ${table} WHERE photo_id = ? AND option_id IN (SELECT id FROM score_option WHERE category_id = ?)`, photoId, categoryId)
	];
	const tiers = options.filter((o) => o.kind === 'tier');
	const picked = tiers.find((o) => o.id === Number(f.get('tier'))) ?? (tiers.length === 1 ? tiers[0] : undefined);
	if (picked) stmts.push(q(`INSERT INTO ${table} (photo_id, option_id, qty) VALUES (?, ?, 1)`, photoId, picked.id));
	for (const o of options.filter((o) => o.kind === 'extra')) {
		const qty = Math.min(99, Math.max(0, Math.floor(Number(f.get(`extra_${o.id}`)) || 0)));
		if (qty > 0) stmts.push(q(`INSERT INTO ${table} (photo_id, option_id, qty) VALUES (?, ?, ?)`, photoId, o.id, qty));
	}
	// A bonus is a flat add-on that stacks on top of the tier and the extras.
	for (const o of options.filter((o) => o.kind === 'bonus'))
		if (f.get(`bonus_${o.id}`)) stmts.push(q(`INSERT INTO ${table} (photo_id, option_id, qty) VALUES (?, ?, 1)`, photoId, o.id));
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
 * tick for a base line or bonus. They add to the photo's own points and count toward the other category's limits;
 * they don't fill its bingo square.
 */
export async function alsoStatements(photoId: number, game: Game, categoryId: number, f: FormData, table: Table = 'photo_claim') {
	const options = await otherOptionsFor(game.id, categoryId);
	const stmts = [
		q(`DELETE FROM ${table} WHERE photo_id = ? AND option_id IN (SELECT id FROM score_option WHERE category_id != ?)`, photoId, categoryId)
	];
	for (const o of options) {
		const v = f.get(`also_${o.id}`);
		const qty = o.kind === 'extra' ? Math.min(99, Math.max(0, Math.floor(Number(v) || 0))) : v ? 1 : 0;
		if (qty > 0) stmts.push(q(`INSERT INTO ${table} (photo_id, option_id, qty) VALUES (?, ?, ?)`, photoId, o.id, qty));
	}
	return stmts;
}

/** The photographer's guess for a photo, as the claims editor takes it (own options plus `also_` ones). */
export async function guessStatements(photoId: number, game: Game, categoryId: number, f: FormData) {
	const stmts = await claimStatements(photoId, categoryId, f, 'photo_guess');
	// Only when the form had the "also" section, so callers without it can't wipe these by omission.
	if (f.get('also_present')) stmts.push(...(await alsoStatements(photoId, game, categoryId, f, 'photo_guess')));
	return stmts;
}

/** Turns a photo's guess into the host's claims in one step (the host's "Approve"). Returns false when there was no guess. */
export async function adoptGuess(photoId: number) {
	const n = await all<{ n: number }>('SELECT COUNT(*) AS n FROM photo_guess WHERE photo_id = ?', photoId);
	if (!n[0]?.n) return false;
	await batch([
		q('DELETE FROM photo_claim WHERE photo_id = ?', photoId),
		q('INSERT INTO photo_claim (photo_id, option_id, qty) SELECT photo_id, option_id, qty FROM photo_guess WHERE photo_id = ?', photoId)
	]);
	return true;
}
