import { error } from '@sveltejs/kit';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { get } from '#lib/server/db.ts';
import { canSee, type Game } from '#lib/server/game.ts';
import { photoDir } from '#lib/server/images.ts';

const TYPES: Record<string, string> = {
	jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', avif: 'image/avif'
};

export const GET = ({ params, locals }) => {
	if (!locals.user) error(401, 'Sign in first');
	const id = Number(params.id);
	const p = get<{ game_id: number; category_id: number | null; team_id: number; created_at: number; ext: string }>(
		'SELECT game_id, category_id, team_id, created_at, ext FROM photo WHERE id = ?',
		id
	);
	if (!p) error(404, 'Not found');
	const game = get<Game>('SELECT * FROM game WHERE id = ?', p.game_id)!;
	const m = get<{ team_id: number | null }>(
		'SELECT team_id FROM member WHERE game_id = ? AND user_id = ?',
		p.game_id,
		locals.user.id
	);
	const isAdmin = !!locals.user.is_admin;
	if (!m && !isAdmin) error(403, 'Not your game');
	// Unsorted photos stay with their team until they're filed into a category.
	if (p.category_id === null && !isAdmin && p.team_id !== m?.team_id) error(403, 'Not revealed yet');
	if (!canSee(game, { user: locals.user, teamId: m?.team_id ?? null, isAdmin }, p)) error(403, 'Not revealed yet');

	const size = params.size;
	if (size !== 'thumb' && size !== 'large' && size !== 'original') error(404, 'Not found');
	const ext = size === 'original' ? p.ext : 'jpg';
	const file = join(photoDir(id), `${size}.${ext}`);
	if (!existsSync(file)) error(404, 'Not found');
	return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
		headers: {
			'content-type': TYPES[ext] ?? 'application/octet-stream',
			'content-length': String(statSync(file).size),
			'cache-control': 'private, max-age=604800, immutable'
		}
	});
};
