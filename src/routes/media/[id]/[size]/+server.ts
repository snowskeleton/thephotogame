import { error } from '@sveltejs/kit';
import { config, get } from '#lib/server/db.ts';
import { canSee, type Game } from '#lib/server/game.ts';
import { key, TYPES } from '#lib/server/images.ts';

export const GET = async ({ params, locals, request }) => {
	if (!locals.user) error(401, 'Sign in first');
	const id = Number(params.id);
	// One query for the photo, its game and the viewer's place in it: this route runs for every thumbnail.
	const row = await get<{ game_id: number; category_id: number | null; team_id: number; created_at: number; ext: string; m_team: number | null; m_role: string | null }>(
		`SELECT p.game_id, p.category_id, p.team_id, p.created_at, p.ext, m.team_id AS m_team, m.role AS m_role
		 FROM photo p LEFT JOIN member m ON m.game_id = p.game_id AND m.user_id = ? AND m.status = 'active'
		 WHERE p.id = ?`,
		locals.user.id,
		id
	);
	if (!row) error(404, 'Not found');
	const p = row;
	const m = row.m_role ? { team_id: row.m_team, role: row.m_role } : undefined;
	const game = await get<Game>('SELECT * FROM game WHERE id = ?', p.game_id);
	const isHost = !!locals.user.is_admin || m?.role === 'host';
	if (!m && !isHost) error(403, 'Not your game');
	// Unsorted photos stay with their team until they're filed into a category.
	if (p.category_id === null && !isHost && p.team_id !== m?.team_id) error(403, 'Not revealed yet');
	if (!canSee(game!, { user: locals.user, teamId: m?.team_id ?? null, isHost }, p)) error(403, 'Not revealed yet');

	const size = params.size;
	if (size !== 'thumb' && size !== 'large' && size !== 'original') error(404, 'Not found');
	const headers = new Headers({
		'content-type': size === 'original' ? (TYPES[p.ext] ?? 'application/octet-stream') : 'image/jpeg',
		'cache-control': 'private, max-age=604800, immutable'
	});

	const origin = config().PHOTOS_URL;
	if (origin) {
		// Through the bucket's own domain rather than the binding, so every photo passes Cloudflare's
		// cache, which is where the CSAM Scanning Tool looks. A WAF rule keeps that domain closed to
		// everyone but this Worker (README → Photo scanning), so the checks above still decide who sees what.
		const res = await fetch(`${origin.replace(/\/$/, '')}/${key(id, size, p.ext)}`, {
			headers: request.headers.has('if-none-match') ? { 'if-none-match': request.headers.get('if-none-match')! } : {},
			cf: { cacheEverything: true, cacheTtl: 365 * 86400 }
		} as RequestInit);
		const etag = res.headers.get('etag');
		if (etag) headers.set('etag', etag);
		if (res.status === 304) return new Response(null, { status: 304, headers });
		if (!res.ok) error(404, 'Not found');
		const length = res.headers.get('content-length');
		if (length) headers.set('content-length', length);
		return new Response(res.body, { headers });
	}

	const obj = await config().PHOTOS.get(key(id, size, p.ext), { onlyIf: request.headers as any });
	if (!obj) error(404, 'Not found');
	headers.set('etag', obj.httpEtag);
	// R2 returns the object without a body when the browser's copy is still current.
	if (!('body' in obj)) return new Response(null, { status: 304, headers });
	headers.set('content-length', String(obj.size));
	return new Response(obj.body as unknown as ReadableStream, { headers });
};
