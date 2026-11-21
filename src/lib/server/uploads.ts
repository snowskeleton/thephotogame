import { fail } from '@sveltejs/kit';
import { all, get, insert, now, run } from './db.ts';
import { str, type Game, type Viewer } from './game.ts';
import { saveClaims } from './claims.ts';
import { inspect, remove, store } from './images.ts';

/** The page sends one photo per request; this cap only matters for a browser without JavaScript. */
const MAX_PER_REQUEST = 30;

export type Category = { id: number; name: string; active: number };

export const categoryIn = (gameId: number, id: unknown) =>
	get<Category>('SELECT id, name, active FROM category WHERE id = ? AND game_id = ?', Number(id), gameId);

/**
 * Saves the photos in a submitted form. With a category they're filed straight away (claims and
 * caption come from the same form); without one they land in the photographer's unsorted pile.
 */
export async function savePhotos(game: Game, viewer: Viewer, f: FormData, category: Category | null) {
	if (!viewer.teamId) return fail(400, { error: 'You need to be on a team before you can submit photos.' });
	if (!game.submissions_open || (category && !category.active)) return fail(400, { error: 'Submissions are closed.' });
	const files = f.getAll('photo').filter((x): x is File => x instanceof File && x.size > 0);
	if (!files.length) return fail(400, { error: 'Choose a photo first.' });
	if (files.length > MAX_PER_REQUEST) return fail(400, { error: `${MAX_PER_REQUEST} photos at a time, please.` });

	let added = 0;
	for (const file of files) {
		const buf = Buffer.from(await file.arrayBuffer());
		const meta = await inspect(buf).catch(() => null);
		if (!meta) return fail(400, { added, error: `“${file.name}” isn’t a photo we can read. Try a JPEG or PNG.` });
		const id = insert(
			`INSERT INTO photo (game_id, category_id, user_id, team_id, caption, ext, width, height, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			game.id, category?.id ?? null, viewer.user.id, viewer.teamId, str(f.get('caption'), 200),
			meta.ext, meta.width, meta.height, now()
		);
		try {
			await store(id, buf, meta.ext);
		} catch {
			run('DELETE FROM photo WHERE id = ?', id);
			await remove(id);
			return fail(400, { added, error: `“${file.name}” couldn’t be processed. If it’s a HEIC file, send it as a JPEG.` });
		}
		// Points are the showrunner's call; a player's own claim is never stored.
		if (category && viewer.isAdmin) saveClaims(id, category.id, f);
		added++;
	}
	return { added };
}

/** Moves a photo into a category. Claims belong to the old category's options, so they are cleared and the showrunner scores it again. */
export function fileInto(photoId: number, categoryId: number, wasUnsorted: boolean) {
	run('UPDATE photo SET category_id = ? WHERE id = ?', categoryId, photoId);
	// "Submitted" means filed: in hidden mode a photo filed after a reveal waits for the next one.
	if (wasUnsorted) run('UPDATE photo SET created_at = ? WHERE id = ?', now(), photoId);
	run('DELETE FROM photo_claim WHERE photo_id = ?', photoId);
}

export function unsortedFor(gameId: number, userId: number) {
	return all<{ id: number; width: number; height: number; caption: string }>(
		`SELECT id, width, height, caption FROM photo
		 WHERE game_id = ? AND user_id = ? AND category_id IS NULL ORDER BY created_at, id`,
		gameId,
		userId
	);
}
