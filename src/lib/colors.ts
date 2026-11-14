/** Team colors. A team's color is stored as "#rrggbb" or as the key of a special finish below. */

export type Finish = { name: string; base: string; bg: string };

const metal = (dark: string, mid: string, light: string) =>
	`linear-gradient(135deg, ${dark} 0%, ${light} 22%, ${mid} 42%, ${light} 60%, ${dark} 78%, ${mid} 100%)`;

export const FINISHES: Record<string, Finish> = {
	gold: { name: 'Gold', base: '#c9a227', bg: metal('#8f6b0e', '#d4af37', '#fff2a8') },
	silver: { name: 'Silver', base: '#a9b0b8', bg: metal('#6f7780', '#b8bfc7', '#ffffff') },
	bronze: { name: 'Bronze', base: '#a8692d', bg: metal('#6e3f14', '#b87333', '#f3c08a') },
	copper: { name: 'Copper', base: '#c5673f', bg: metal('#8a3a1b', '#d2754a', '#ffc7a6') },
	'rose-gold': { name: 'Rose gold', base: '#d9919b', bg: metal('#a85a68', '#e0a0a8', '#ffe1e1') },
	platinum: { name: 'Platinum', base: '#cfd4d6', bg: metal('#9aa3a6', '#dfe3e4', '#ffffff') },
	gunmetal: { name: 'Gunmetal', base: '#4b5560', bg: metal('#23292f', '#56616d', '#a9b4bf') },
	cobalt: { name: 'Cobalt steel', base: '#2f5fd0', bg: metal('#14307c', '#3a6be0', '#b3ccff') },
	emerald: { name: 'Emerald foil', base: '#1f9d63', bg: metal('#0b5a36', '#27b072', '#b5f5d3') },
	ruby: { name: 'Ruby foil', base: '#c8233f', bg: metal('#7a0d20', '#d83450', '#ffb3c0') },
	amethyst: { name: 'Amethyst foil', base: '#8a4fd3', bg: metal('#4d2390', '#9a62e0', '#e2ccff') },
	holo: {
		name: 'Holographic',
		base: '#9b8cf2',
		bg: 'linear-gradient(120deg, #ff9ecb 0%, #ffd58a 18%, #b8f7a1 36%, #8ee6ff 54%, #b3a4ff 72%, #ff9ecb 100%)'
	},
	sunset: { name: 'Sunset', base: '#f2643d', bg: 'linear-gradient(135deg, #ffb347 0%, #ff5e62 50%, #9b3fbf 100%)' },
	ocean: { name: 'Ocean', base: '#1b8fc4', bg: 'linear-gradient(135deg, #5ee7df 0%, #1b8fc4 50%, #1d3f8f 100%)' },
	aurora: { name: 'Aurora', base: '#2bb88a', bg: 'linear-gradient(135deg, #7df0a8 0%, #2bb8b0 40%, #5a6ff0 75%, #a55fe0 100%)' },
	lava: { name: 'Lava', base: '#d4380d', bg: 'linear-gradient(135deg, #ffd000 0%, #ff6a00 40%, #c21500 80%, #5c0a00 100%)' },
	galaxy: { name: 'Galaxy', base: '#4b2f9e', bg: 'linear-gradient(135deg, #12063b 0%, #4b2f9e 40%, #c04ad6 75%, #ff8ad8 100%)' },
	candy: { name: 'Candy', base: '#ff5fa2', bg: 'linear-gradient(135deg, #ff9a9e 0%, #ff5fa2 45%, #a06bff 100%)' },
	rainbow: {
		name: 'Rainbow',
		base: '#e5484d',
		bg: 'linear-gradient(120deg, #e5484d 0%, #f76b15 18%, #f5b800 36%, #46a758 54%, #0090ff 72%, #8a4fd3 90%, #e5484d 100%)'
	}
};

export const PALETTES: { name: string; colors: string[] }[] = [
	{
		name: 'Classic',
		colors: ['#e5484d', '#f76b15', '#f5b800', '#46a758', '#12a594', '#0090ff', '#6e56cf', '#d6409f', '#8d6e63', '#687076']
	},
	{ name: 'Metallic', colors: ['gold', 'silver', 'bronze', 'copper', 'rose-gold', 'platinum', 'gunmetal', 'cobalt', 'emerald', 'ruby', 'amethyst'] },
	{ name: 'Shimmer', colors: ['holo', 'rainbow', 'sunset', 'ocean', 'aurora', 'lava', 'galaxy', 'candy'] },
	{
		name: 'Neon',
		colors: ['#ff2d55', '#ff6b00', '#ffe600', '#39ff14', '#00f5d4', '#00b3ff', '#7a5cff', '#ff3df2']
	},
	{
		name: 'Pastel',
		colors: ['#f4a6a6', '#f7c59f', '#f6e3a1', '#b5e2b0', '#a5dcd6', '#a9c9f5', '#c7b6f2', '#f1b3d8']
	},
	{
		name: 'Jewel',
		colors: ['#9b1b30', '#c2570c', '#b8860b', '#0b6e4f', '#0e7c86', '#1f4e9c', '#5b2a86', '#a01a7d']
	},
	{
		name: 'Beach',
		colors: ['#ff6f59', '#ffb400', '#f2d0a4', '#43aa8b', '#00a6a6', '#1c7fc2', '#254441', '#ef476f']
	},
	{
		name: 'Earth',
		colors: ['#a23e2a', '#c9772b', '#c2a14a', '#6b8e23', '#2f6f4f', '#3d6b82', '#6d4c41', '#55606b']
	}
];

/** The first palette, for callers that just need a default. */
export const DEFAULT_COLORS = PALETTES[0].colors;

const HEX = /^#[0-9a-f]{6}$/i;

/** Returns the stored form of a color, or null if it isn't one we accept. */
export function validColor(v: unknown): string | null {
	const s = String(v ?? '').trim().toLowerCase();
	return HEX.test(s) || s in FINISHES ? s : null;
}

export function colorName(color: string): string {
	return FINISHES[color]?.name ?? 'Custom color';
}

/** Black or white, whichever reads better on this color. */
function inkFor(hex: string): string {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? '#1b1a17' : '#fff';
}

/**
 * CSS variables for a team color, for use in a style attribute:
 * --team (solid, for borders), --team-bg (fill, may be a gradient) and --team-ink (text on the fill).
 * All three are always set so a nested team never inherits part of an outer one.
 */
export function tv(color: string | null | undefined): string {
	const c = (color ?? '').toLowerCase();
	const f = FINISHES[c];
	if (f) return `--team:${f.base};--team-bg:${f.bg};--team-ink:${inkFor(f.base)}`;
	if (HEX.test(c)) return `--team:${c};--team-bg:${c};--team-ink:${inkFor(c)}`;
	const v = color || 'var(--accent)';
	return `--team:${v};--team-bg:${v};--team-ink:#fff`;
}
