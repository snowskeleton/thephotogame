import { all, run } from './db.ts';

// Site-wide settings a site admin changes in the app (Admin → Settings).

export const DEFAULTS = {
	/** '1': anyone can sign up from the sign-in page and host games. '0': only site admins host. */
	signups: '1',
	/** How many games one person may create (site admins have no limit). */
	max_games: '3',
	/** Photos per game. R2's free tier is 10 GB; a phone photo plus its two copies is ~4–6 MB. */
	max_photos: '1000'
};
export type Settings = { signups: boolean; maxGames: number; maxPhotos: number };

export async function settings(): Promise<Settings> {
	const rows = await all<{ key: string; value: string }>('SELECT key, value FROM setting');
	const v = { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
	return { signups: v.signups === '1', maxGames: Number(v.max_games) || 0, maxPhotos: Number(v.max_photos) || 0 };
}

export async function saveSettings(s: Settings) {
	for (const [key, value] of Object.entries({
		signups: s.signups ? '1' : '0',
		max_games: String(s.maxGames),
		max_photos: String(s.maxPhotos)
	}))
		await run('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}
