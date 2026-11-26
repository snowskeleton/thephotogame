import { error, json } from '@sveltejs/kit';
import { requireHost } from '#lib/server/game.ts';
import { exportFiles, fileName, parseSet, safe } from '#lib/server/exports.ts';
import { get } from '#lib/server/db.ts';

/**
 * The list of originals and their names inside the zip. The admin page fetches each one and builds the
 * zip in the browser: zipping hundreds of MB would blow through a Worker's CPU limit.
 * `?set=` picks the subset: all (default), winners, voted, superlatives, team:<id>, category:<id>.
 */
export const GET = async ({ params, locals, url }) => {
	const game = await requireHost(locals, params.code);
	const set = parseSet(url.searchParams.get('set'));
	if (!set) error(400, 'Unknown set');
	const { files } = await exportFiles(game, set);
	let suffix = '';
	if (set.kind !== 'all') {
		const label =
			set.kind === 'team'
				? (await get<{ name: string }>('SELECT name FROM team WHERE id = ? AND game_id = ?', set.id, game.id))?.name
				: set.kind === 'category'
					? (await get<{ name: string }>('SELECT name FROM category WHERE id = ? AND game_id = ?', set.id, game.id))?.name
					: set.kind;
		if (!label) error(404, 'Not found');
		suffix = ` - ${label}`;
	}
	return json({
		zip: `${safe(game.name + suffix)}.zip`,
		files: files.map((f) => ({ url: `/media/${f.id}/original`, name: fileName(f) }))
	});
};
