// D1 (Cloudflare's SQLite). The schema lives in migrations/; apply it with `npm run db:migrate`.
// Every call is async. D1 has no BEGIN/COMMIT: anything that must happen together goes through
// `batch`, which runs its statements in one transaction.

import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { env } from 'cloudflare:workers';

type P = string | number | null | boolean | ArrayBuffer;

/** The Worker's bindings and variables (wrangler.jsonc). */
export const config = (): Env => env;

// D1 refuses `undefined`; NaN means a form field held junk, which SQL should see as NULL.
const clean = (params: unknown[]) =>
	params.map((p) => (p === undefined || (typeof p === 'number' && Number.isNaN(p)) ? null : p)) as P[];

/** A prepared statement, for `batch`. */
export function q(sql: string, ...params: unknown[]) {
	return config().DB.prepare(sql).bind(...clean(params));
}

export async function all<T = any>(sql: string, ...params: unknown[]): Promise<T[]> {
	return (await q(sql, ...params).all<T>()).results;
}
export async function get<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined> {
	return (await q(sql, ...params).first<T>()) ?? undefined;
}
export async function run(sql: string, ...params: unknown[]) {
	return (await q(sql, ...params).run()).meta;
}
export async function insert(sql: string, ...params: unknown[]): Promise<number> {
	return (await q(sql, ...params).run()).meta.last_row_id;
}
/** Runs statements in order, all or nothing. */
export async function batch(stmts: D1PreparedStatement[]) {
	return stmts.length ? config().DB.batch(stmts) : [];
}

export const now = () => Date.now();
