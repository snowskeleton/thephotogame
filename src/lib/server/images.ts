import sharp from 'sharp';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './db.ts';

export const photoDir = (id: number) => join(DATA_DIR, 'photos', String(id));
export const SIZES = { thumb: 480, large: 2000 } as const;

const EXT: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', heif: 'heic', avif: 'avif' };

/** Reads an uploaded image, rejecting anything sharp can't decode. */
export async function inspect(buf: Buffer) {
	const meta = await sharp(buf).metadata();
	if (!meta.format || !EXT[meta.format]) throw new Error('unsupported');
	// Dimensions as displayed (after EXIF rotation).
	const swap = (meta.orientation ?? 1) >= 5;
	return {
		ext: EXT[meta.format],
		width: (swap ? meta.height : meta.width) ?? 0,
		height: (swap ? meta.width : meta.height) ?? 0
	};
}

export async function store(id: number, buf: Buffer, ext: string) {
	const dir = photoDir(id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, `original.${ext}`), buf);
	for (const [name, size] of Object.entries(SIZES)) {
		await sharp(buf)
			.rotate()
			.resize(size, size, { fit: 'inside', withoutEnlargement: true })
			.jpeg({ quality: name === 'thumb' ? 76 : 84 })
			.toFile(join(dir, `${name}.jpg`));
	}
}

export async function remove(id: number) {
	await rm(photoDir(id), { recursive: true, force: true });
}
