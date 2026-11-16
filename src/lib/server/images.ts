import { config } from './db.ts';

// Photos live in R2 under photos/<id>/: the original as uploaded, plus thumb.jpg and large.jpg, which
// the browser makes before uploading (see Uploader.svelte). Workers can't run sharp.

export const TYPES: Record<string, string> = {
	jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', avif: 'image/avif'
};

export const key = (id: number, size: 'thumb' | 'large' | 'original', ext: string) =>
	`photos/${id}/${size}.${size === 'original' ? ext : 'jpg'}`;

/** The image format from a file's first bytes, or null if it isn't one we take. */
export function sniff(b: Uint8Array): string | null {
	const at = (i: number, s: string) => [...s].every((c, j) => b[i + j] === c.charCodeAt(0));
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
	if (b[0] === 0x89 && at(1, 'PNG')) return 'png';
	if (at(0, 'RIFF') && at(8, 'WEBP')) return 'webp';
	if (at(0, 'GIF8')) return 'gif';
	if (at(4, 'ftyp')) {
		const brand = String.fromCharCode(...b.slice(8, 12));
		if (/^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return 'heic';
		if (/^avi[fs]$/.test(brand)) return 'avif';
	}
	return null;
}

export async function store(id: number, ext: string, files: { original: ArrayBuffer; thumb: ArrayBuffer; large: ArrayBuffer }) {
	const bucket = config().PHOTOS;
	await Promise.all([
		bucket.put(key(id, 'original', ext), files.original, { httpMetadata: { contentType: TYPES[ext] } }),
		bucket.put(key(id, 'thumb', ext), files.thumb, { httpMetadata: { contentType: 'image/jpeg' } }),
		bucket.put(key(id, 'large', ext), files.large, { httpMetadata: { contentType: 'image/jpeg' } })
	]);
}

/** Deletes the files of these photos (their rows are already gone or going). */
export async function remove(photos: { id: number; ext: string }[]) {
	const keys = photos.flatMap((p) => (['original', 'thumb', 'large'] as const).map((s) => key(p.id, s, p.ext)));
	// R2 deletes up to 1000 keys per call.
	for (let i = 0; i < keys.length; i += 1000) await config().PHOTOS.delete(keys.slice(i, i + 1000));
}
