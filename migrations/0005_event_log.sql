-- A small log of server errors and sign-up trouble, readable by site admins and the API (logs:read).
-- No email addresses or message bodies are stored. Old rows are pruned automatically.
CREATE TABLE IF NOT EXISTS event (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	at INTEGER NOT NULL,
	level TEXT NOT NULL,
	kind TEXT NOT NULL,
	message TEXT NOT NULL,
	method TEXT,
	path TEXT,
	status INTEGER,
	user_id INTEGER,
	agent TEXT,
	detail TEXT
);
CREATE INDEX IF NOT EXISTS event_at ON event(at);
CREATE INDEX IF NOT EXISTS event_kind ON event(kind, at);
