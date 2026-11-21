-- Outgoing webhooks, set up by a game's hosts. `kind` is 'ember' (posts photos and threaded comments to an Ember or
-- Campfire chat room through its bot API) or 'json' (a signed JSON POST for anything else). `events` is a
-- comma-separated list of event names. The url holds the room's bot key, so it is only ever shown masked.
CREATE TABLE IF NOT EXISTS webhook (
	id INTEGER PRIMARY KEY,
	game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	kind TEXT NOT NULL DEFAULT 'ember',
	url TEXT NOT NULL,
	secret TEXT NOT NULL DEFAULT '',
	events TEXT NOT NULL DEFAULT '',
	active INTEGER NOT NULL DEFAULT 1,
	hidden_ok INTEGER NOT NULL DEFAULT 0,
	last_at INTEGER,
	last_status TEXT,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS webhook_game ON webhook(game_id);

-- What a webhook already told its receiver about a photo: the chat message that starts the photo's thread, and the
-- points last announced, so a save that changes nothing stays quiet.
CREATE TABLE IF NOT EXISTS webhook_post (
	webhook_id INTEGER NOT NULL REFERENCES webhook(id) ON DELETE CASCADE,
	photo_id INTEGER NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
	root_id TEXT NOT NULL DEFAULT '',
	points REAL,
	PRIMARY KEY (webhook_id, photo_id)
);
CREATE INDEX IF NOT EXISTS webhook_post_photo ON webhook_post(photo_id);
