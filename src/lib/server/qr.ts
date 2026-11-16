import QRCode from 'qrcode';

/**
 * A QR code as an SVG data URL. On Workers the qrcode package loads its browser build, whose PNG
 * output needs a <canvas>; its SVG output doesn't.
 */
export async function qrDataUrl(text: string) {
	const svg = await QRCode.toString(text, { type: 'svg', margin: 2, width: 320 });
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
