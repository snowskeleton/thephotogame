import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || './data';
mkdirSync(join(DATA_DIR, 'photos'), { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, 'photogame.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS user (
	id INTEGER PRIMARY KEY,
	email TEXT NOT NULL UNIQUE COLLATE NOCASE,
	name TEXT NOT NULL,
	is_admin INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
	token TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_code (
	id INTEGER PRIMARY KEY,
	email TEXT NOT NULL COLLATE NOCASE,
	code_hash TEXT NOT NULL,
	name TEXT,
	expires_at INTEGER NOT NULL,
	attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS passkey (
	id TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	public_key BLOB NOT NULL,
	counter INTEGER NOT NULL DEFAULT 0,
	transports TEXT,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS handoff (
	token_hash TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS game (
	id INTEGER PRIMARY KEY,
	code TEXT NOT NULL UNIQUE COLLATE NOCASE,
	name TEXT NOT NULL,
	visibility TEXT NOT NULL DEFAULT 'hidden',
	revealed_at INTEGER NOT NULL DEFAULT 0,
	team_mode TEXT NOT NULL DEFAULT 'admin',
	max_team_size INTEGER,
	submissions_open INTEGER NOT NULL DEFAULT 1,
	doubt_limit INTEGER NOT NULL DEFAULT 2,
	bingo INTEGER NOT NULL DEFAULT 0,
	bingo_cols INTEGER NOT NULL DEFAULT 4,
	bingo_line_points REAL NOT NULL DEFAULT 0,
	bingo_board_points REAL NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS team (
	id INTEGER PRIMARY KEY,
	game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	color TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS member (
	game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
	user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	team_id INTEGER REFERENCES team(id) ON DELETE SET NULL,
	PRIMARY KEY (game_id, user_id)
);
CREATE TABLE IF NOT EXISTS category (
	id INTEGER PRIMARY KEY,
	game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	rules TEXT NOT NULL DEFAULT '',
	notes TEXT NOT NULL DEFAULT '',
	day_label TEXT NOT NULL DEFAULT '',
	scoring_cap INTEGER,
	sort INTEGER NOT NULL DEFAULT 0,
	active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS score_option (
	id INTEGER PRIMARY KEY,
	category_id INTEGER NOT NULL REFERENCES category(id) ON DELETE CASCADE,
	label TEXT NOT NULL,
	points REAL NOT NULL,
	kind TEXT NOT NULL DEFAULT 'tier',
	sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS photo (
	id INTEGER PRIMARY KEY,
	game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
	category_id INTEGER NOT NULL REFERENCES category(id) ON DELETE CASCADE,
	user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	team_id INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE,
	caption TEXT NOT NULL DEFAULT '',
	ext TEXT NOT NULL,
	width INTEGER NOT NULL,
	height INTEGER NOT NULL,
	status TEXT NOT NULL DEFAULT 'ok',
	points_override REAL,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS photo_claim (
	photo_id INTEGER NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
	option_id INTEGER NOT NULL REFERENCES score_option(id) ON DELETE CASCADE,
	qty REAL NOT NULL DEFAULT 1,
	PRIMARY KEY (photo_id, option_id)
);
CREATE TABLE IF NOT EXISTS doubt (
	photo_id INTEGER NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
	user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	PRIMARY KEY (photo_id, user_id)
);
CREATE TABLE IF NOT EXISTS review_vote (
	photo_id INTEGER NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
	user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	agree INTEGER NOT NULL,
	PRIMARY KEY (photo_id, user_id)
);
CREATE TABLE IF NOT EXISTS award (
	id INTEGER PRIMARY KEY,
	game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	points REAL NOT NULL DEFAULT 0,
	scope TEXT NOT NULL DEFAULT 'game',
	status TEXT NOT NULL DEFAULT 'draft',
	sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS vote (
	award_id INTEGER NOT NULL REFERENCES award(id) ON DELETE CASCADE,
	photo_id INTEGER NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
	user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	PRIMARY KEY (award_id, photo_id, user_id)
);
CREATE TABLE IF NOT EXISTS grant_award (
	id INTEGER PRIMARY KEY,
	game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
	team_id INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE,
	user_id INTEGER REFERENCES user(id) ON DELETE SET NULL,
	title TEXT NOT NULL,
	note TEXT NOT NULL DEFAULT '',
	points REAL NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS grant_photo (
	grant_id INTEGER NOT NULL REFERENCES grant_award(id) ON DELETE CASCADE,
	photo_id INTEGER NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
	PRIMARY KEY (grant_id, photo_id)
);
CREATE INDEX IF NOT EXISTS photo_game ON photo(game_id, category_id);
CREATE INDEX IF NOT EXISTS member_user ON member(user_id);
`);

// Columns added after the first release.
const hasColumn = (table: string, col: string) =>
	(db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
if (!hasColumn('user', 'last_seen_at')) db.exec('ALTER TABLE user ADD COLUMN last_seen_at INTEGER');

type P = SQLInputValue;
const cache = new Map<string, ReturnType<typeof db.prepare>>();
function stmt(sql: string) {
	let s = cache.get(sql);
	if (!s) cache.set(sql, (s = db.prepare(sql)));
	return s;
}

export function all<T = any>(sql: string, ...params: P[]): T[] {
	return stmt(sql).all(...params) as T[];
}
export function get<T = any>(sql: string, ...params: P[]): T | undefined {
	return stmt(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: P[]) {
	return stmt(sql).run(...params);
}
export function insert(sql: string, ...params: P[]): number {
	return Number(stmt(sql).run(...params).lastInsertRowid);
}
export function tx<T>(fn: () => T): T {
	db.exec('BEGIN IMMEDIATE');
	try {
		const r = fn();
		db.exec('COMMIT');
		return r;
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	}
}
export const now = () => Date.now();
