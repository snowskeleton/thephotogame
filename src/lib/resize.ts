// Makes the thumbnail and screen-sized copies of a photo in the browser, so the server never has to
// decode images (Workers can't run sharp). Sizes and qualities match what the server used to make.

export const SIZES = { thumb: { px: 480, quality: 0.76 }, large: { px: 2000, quality: 0.84 } } as const;

function draw(src: CanvasImageSource, w: number, h: number, max: number) {
	const scale = Math.min(1, max / Math.max(w, h));
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(w * scale));
	canvas.height = Math.max(1, Math.round(h * scale));
	const ctx = canvas.getContext('2d')!;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
	return canvas;
}

const jpeg = (canvas: HTMLCanvasElement, quality: number) =>
	new Promise<Blob>((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error('encode'))), 'image/jpeg', quality));

/** Throws if the browser can't decode the file. Width and height are as displayed (EXIF rotation applied). */
export async function prepare(file: File) {
	const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	try {
		const { width, height } = bitmap;
		const large = draw(bitmap, width, height, SIZES.large.px);
		// Scaling down from the large copy looks better than one big jump from a 12 MP original.
		const thumb = draw(large, large.width, large.height, SIZES.thumb.px);
		return {
			width,
			height,
			large: await jpeg(large, SIZES.large.quality),
			thumb: await jpeg(thumb, SIZES.thumb.quality)
		};
	} finally {
		bitmap.close();
	}
}
