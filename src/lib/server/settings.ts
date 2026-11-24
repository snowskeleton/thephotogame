import { all, run } from './db.ts';

// Site-wide settings a site admin changes in the app (Admin → Settings).

export const DEFAULTS = {
	/** '1': anyone can sign up from the sign-in page and host games. '0': only site admins host. */
	signups: '1',
	/** How many games one person may create (site admins have no limit). */
	max_games: '3',
	/** Photos per game; 0 means no limit. A phone photo plus its two copies is ~4–6 MB in R2. */
	max_photos: '0',
	/** Sender for codes and invites, on a domain verified in Resend. Empty: Resend's test sender. */
	mail_from: ''
};
export type Settings = { signups: boolean; maxGames: number; maxPhotos: number; mailFrom: string };

export async function settings(): Promise<Settings> {
	const rows = await all<{ key: string; value: string }>('SELECT key, value FROM setting');
	const v = { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
	return {
		signups: v.signups === '1',
		maxGames: Number(v.max_games) || 0,
		maxPhotos: Number(v.max_photos) || 0,
		mailFrom: v.mail_from
	};
}

export async function saveSettings(s: Partial<Settings>) {
	const values: Record<string, string | undefined> = {
		signups: s.signups === undefined ? undefined : s.signups ? '1' : '0',
		max_games: s.maxGames?.toString(),
		max_photos: s.maxPhotos?.toString(),
		mail_from: s.mailFrom
	};
	for (const [key, value] of Object.entries(values))
		if (value !== undefined)
			await run('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}
