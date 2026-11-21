import { config } from './db.ts';

// The app brings its own database up to date: every file in migrations/ is bundled in, and any not yet
// applied runs on the first request an instance of the Worker serves. So a fresh deploy needs no
// migrate step. It keeps wrangler's own bookkeeping table (d1_migrations), so
// `wrangler d1 migrations list` still shows the truth.

const files = Object.entries(
	import.meta.glob('/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
)
	.map(([path, sql]) => ({ name: path.split('/').pop()!, sql }))
	.sort((a, b) => a.name.localeCompare(b.name));

/** One statement per entry: comments dropped, split on semicolons (our migrations have none inside strings). */
const statements = (sql: string) =>
	sql
		.replace(/--[^\n]*/g, '')
		.split(';')
		.map((s) => s.trim())
		.filter(Boolean);

async function pending(): Promise<typeof files> {
	const db = config().DB;
	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS d1_migrations (
				id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`
		)
		.run();
	const done = new Set((await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>()).results.map((r) => r.name));
	return files.filter((f) => !done.has(f.name));
}

async function migrate() {
	const db = config().DB;
	for (const f of await pending()) {
		try {
			// One batch per file, so a file applies completely or not at all.
			await db.batch([
				...statements(f.sql).map((s) => db.prepare(s)),
				db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(f.name)
			]);
		} catch (e) {
			// Another instance may have applied it at the same moment; that's fine.
			if ((await pending()).some((p) => p.name === f.name)) throw e;
		}
	}
}

let ready: Promise<void> | null = null;

/** Resolves once the database is up to date. Checked once per Worker instance; retried if it failed. */
export function databaseReady(): Promise<void> {
	return (ready ??= migrate().catch((e) => {
		ready = null;
		throw e;
	}));
}
