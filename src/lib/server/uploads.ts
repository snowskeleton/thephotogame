import { fail } from '@sveltejs/kit';
import { all, batch, get, insert, now, q, run } from './db.ts';
import { str, type Game, type Viewer } from './game.ts';
import { claimStatements, optionsFor } from './claims.ts';
import { remove, sniff, store } from './images.ts';

export type Category = { id: number; name: string; active: number };

export const categoryIn = (gameId: number, id: unknown) =>
	get<Category>('SELECT id, name, active FROM category WHERE id = ? AND game_id = ?', Number(id), gameId);

const file = (v: FormDataEntryValue | null) => (v instanceof File && v.size > 0 ? v : null);
const dim = (v: FormDataEntryValue | null) => Math.min(100_000, Math.max(1, Math.floor(Number(v)) || 0));

/**
 * Saves the one photo in a submitted form. The browser sends the original plus a thumbnail and a
 * screen-sized JPEG it made itself, and the original's displayed width and height (Uploader.svelte).
 * With a category the photo is filed straight away (claims and caption come from the same form);
 * without one it lands in the photographer's unsorted pile.
 */
export async function savePhotos(game: Game, viewer: Viewer, f: FormData, category: Category | null) {
	if (!viewer.teamId) return fail(400, { error: 'You need to be on a team before you can submit photos.' });
	if (!game.submissions_open || (category && !category.active)) return fail(400, { error: 'Submissions are closed.' });
	const original = file(f.get('photo'));
	const thumb = file(f.get('thumb'));
	const large = file(f.get('large'));
	if (!original) return fail(400, { error: 'Choose a photo first.' });
	if (!thumb || !large) return fail(400, { error: 'Uploading needs JavaScript turned on.' });

	const bytes = {
		original: await original.arrayBuffer(),
		thumb: await thumb.arrayBuffer(),
		large: await large.arrayBuffer()
	};
	const ext = sniff(new Uint8Array(bytes.original, 0, Math.min(16, bytes.original.byteLength)));
	const jpeg = (b: ArrayBuffer) => sniff(new Uint8Array(b, 0, Math.min(16, b.byteLength))) === 'jpg';
	if (!ext || !jpeg(bytes.thumb) || !jpeg(bytes.large))
		return fail(400, { added: 0, error: `“${original.name}” isn’t a photo we can read. Try a JPEG or PNG.` });

	const id = await insert(
		`INSERT INTO photo (game_id, category_id, user_id, team_id, caption, ext, width, height, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		game.id, category?.id ?? null, viewer.user.id, viewer.teamId, str(f.get('caption'), 200),
		ext, dim(f.get('width')), dim(f.get('height')), now()
	);
	try {
		await store(id, ext, bytes);
	} catch {
		await run('DELETE FROM photo WHERE id = ?', id);
		await remove([{ id, ext }]);
		return fail(400, { added: 0, error: `“${original.name}” couldn’t be saved. Try it again.` });
	}
	if (category) await batch(await claimStatements(id, category.id, f));
	return { added: 1 };
}

/** Moves a photo into a category with that category's default claim (its first tier). */
export async function fileInto(photoId: number, categoryId: number, wasUnsorted: boolean) {
	const tier = (await optionsFor(categoryId)).find((o) => o.kind === 'tier');
	await batch([
		q('UPDATE photo SET category_id = ? WHERE id = ?', categoryId, photoId),
		// "Submitted" means filed: in hidden mode a photo filed after a reveal waits for the next one.
		...(wasUnsorted ? [q('UPDATE photo SET created_at = ? WHERE id = ?', now(), photoId)] : []),
		q('DELETE FROM photo_claim WHERE photo_id = ?', photoId),
		...(tier ? [q('INSERT INTO photo_claim (photo_id, option_id, qty) VALUES (?, ?, 1)', photoId, tier.id)] : [])
	]);
}

export function unsortedFor(gameId: number, userId: number) {
	return all<{ id: number; width: number; height: number; caption: string }>(
		`SELECT id, width, height, caption FROM photo
		 WHERE game_id = ? AND user_id = ? AND category_id IS NULL ORDER BY created_at, id`,
		gameId,
		userId
	);
}
