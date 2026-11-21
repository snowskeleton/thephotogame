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

// Scores are cached (scoring.ts). Writing to any table that feeds them bumps `score_epoch`, in the same
// transaction as the write, so a stored score can never outlive the data behind it. Doing it here means no
// caller can forget. `user` only counts when a row is deleted (that cascades to photos and members); other
// user updates, such as "last seen", don't touch scores.
const SCORING_WRITE =
	/^\s*(?:(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:photo|photo_claim|score_option|category|team|member|grant_award|grant_photo|award|vote|game)\b|DELETE\s+FROM\s+user\b)/i;
const bumps = new WeakSet<D1PreparedStatement>();
const bump = () => config().DB.prepare('UPDATE score_epoch SET n = n + 1');

/** A prepared statement, for `batch`. */
export function q(sql: string, ...params: unknown[]) {
	const stmt = config().DB.prepare(sql).bind(...clean(params));
	if (SCORING_WRITE.test(sql)) bumps.add(stmt);
	return stmt;
}

/** Runs one statement; a scoring write goes out together with the epoch bump. */
async function exec(stmt: D1PreparedStatement) {
	if (!bumps.has(stmt)) return stmt.all();
	return (await config().DB.batch([stmt, bump()]))[0];
}

export async function all<T = any>(sql: string, ...params: unknown[]): Promise<T[]> {
	return (await exec(q(sql, ...params))).results as T[];
}
export async function get<T = any>(sql: string, ...params: unknown[]): Promise<T | undefined> {
	return ((await exec(q(sql, ...params))).results[0] as T | undefined) ?? undefined;
}
export async function run(sql: string, ...params: unknown[]) {
	return (await exec(q(sql, ...params))).meta;
}
export async function insert(sql: string, ...params: unknown[]): Promise<number> {
	return (await exec(q(sql, ...params))).meta.last_row_id;
}
/** Runs statements in order, all or nothing. */
export async function batch(stmts: D1PreparedStatement[]) {
	if (!stmts.length) return [];
	return config().DB.batch(stmts.some((s) => bumps.has(s)) ? [...stmts, bump()] : stmts);
}

export const now = () => Date.now();
