-- API keys: minted by a site admin or a game host for scripts and assistants.
-- Only a SHA-256 hash of the token is stored. game_id limits a key to one game (required for hosts).
CREATE TABLE IF NOT EXISTS api_key (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	token_hash TEXT NOT NULL UNIQUE,
	hint TEXT NOT NULL,
	scopes TEXT NOT NULL,
	game_id INTEGER REFERENCES game(id) ON DELETE CASCADE,
	expires_at INTEGER,
	last_used_at INTEGER,
	revoked_at INTEGER,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS api_key_user ON api_key(user_id);
