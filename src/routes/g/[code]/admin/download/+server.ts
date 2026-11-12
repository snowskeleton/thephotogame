import { ZipArchive } from 'archiver';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { gameByCode, requireAdmin } from '#lib/server/game.ts';
import { all } from '#lib/server/db.ts';
import { photoDir } from '#lib/server/images.ts';

const safe = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 60) || 'untitled';

export const GET = ({ params, locals }) => {
	requireAdmin(locals);
	const game = gameByCode(params.code);
	const photos = all<{ id: number; ext: string; category: string; team: string; who: string }>(
		`SELECT p.id, p.ext, c.name AS category, t.name AS team, u.name AS who
		 FROM photo p JOIN category c ON c.id = p.category_id JOIN team t ON t.id = p.team_id
		 JOIN user u ON u.id = p.user_id WHERE p.game_id = ? ORDER BY c.sort, p.id`,
		game.id
	);
	const zip = new ZipArchive({ store: true });
	const out = new PassThrough();
	zip.on('error', (e: Error) => out.destroy(e));
	zip.pipe(out);
	for (const p of photos) {
		const file = join(photoDir(p.id), `original.${p.ext}`);
		if (existsSync(file))
			zip.file(file, { name: `${safe(p.category)}/${safe(p.team)} - ${safe(p.who)} - ${p.id}.${p.ext}` });
	}
	zip.finalize();
	return new Response(Readable.toWeb(out) as ReadableStream, {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename="${safe(game.name)}.zip"`
		}
	});
};
