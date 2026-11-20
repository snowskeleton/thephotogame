import { all, get, now, run } from './db.ts';

/**
 * A small in-app event log (table `event`), so a site admin or an API key with `logs:read` can see what went wrong
 * without opening the Cloudflare dashboard. It never throws: logging must not break the request it describes.
 * Don't put email addresses, codes or message bodies in here.
 */
export type Level = 'error' | 'warn' | 'info';
export type EventRow = {
	id: number; at: number; level: Level; kind: string; message: string; method: string | null; path: string | null;
	status: number | null; user_id: number | null; agent: string | null; detail: string | null;
};

const KEEP_DAYS = 30;
const MAX_ROWS = 5000;
const cut = (v: unknown, n: number) => (v == null ? null : String(v).slice(0, n));

export async function logEvent(
	level: Level,
	kind: string,
	message: string,
	o: { request?: Request; path?: string; status?: number; userId?: number | null; detail?: unknown } = {}
) {
	try {
		const url = o.request ? new URL(o.request.url) : null;
		await run(
			'INSERT INTO event (at, level, kind, message, method, path, status, user_id, agent, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
			now(), level, kind, cut(message, 500), o.request?.method ?? null, cut(o.path ?? url?.pathname, 200), o.status ?? null,
			o.userId ?? null, cut(o.request?.headers.get('user-agent'), 200),
			o.detail === undefined ? null : cut(typeof o.detail === 'string' ? o.detail : JSON.stringify(o.detail), 2000)
		);
		if (Math.random() < 0.02) {
			await run('DELETE FROM event WHERE at < ?', now() - KEEP_DAYS * 86400_000);
			await run('DELETE FROM event WHERE id <= (SELECT MAX(id) FROM event) - ?', MAX_ROWS);
		}
	} catch (e) {
		console.error('[log] could not record event', e);
	}
}

/** Newest first. */
export function listEvents(f: { level?: string; kind?: string; since?: number; limit?: number }) {
	const where = ['1=1'];
	const params: (string | number)[] = [];
	if (f.level) (where.push('level = ?'), params.push(f.level));
	if (f.kind) (where.push('kind = ?'), params.push(f.kind));
	if (f.since) (where.push('at >= ?'), params.push(f.since));
	const limit = Math.min(500, Math.max(1, f.limit || 100));
	return all<EventRow>(`SELECT * FROM event WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${limit}`, ...params);
}

/** Counts per kind over the last day, for a quick look at what's happening. */
export const summary = () =>
	all<{ kind: string; level: string; n: number; last: number }>(
		'SELECT kind, level, COUNT(*) AS n, MAX(at) AS last FROM event WHERE at >= ? GROUP BY kind, level ORDER BY n DESC',
		now() - 86400_000
	);

/** Client errors can be posted by anyone, so only accept a modest number a minute. */
export async function clientErrorRoom(): Promise<boolean> {
	const n = (await get<{ n: number }>("SELECT COUNT(*) AS n FROM event WHERE kind = 'client_error' AND at > ?", now() - 60_000))!.n;
	return n < 30;
}
