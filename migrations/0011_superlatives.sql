-- Superlatives: a host's free-text title ("Most likely to nap") given to one person, one team or one photo.
-- Exactly one of user_id, team_id, photo_id is set, matching kind. They carry no points (use a team award for that).
CREATE TABLE IF NOT EXISTS superlative (
	id INTEGER PRIMARY KEY,
	game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
	title TEXT NOT NULL,
	note TEXT NOT NULL DEFAULT '',
	kind TEXT NOT NULL,
	user_id INTEGER REFERENCES user(id) ON DELETE CASCADE,
	team_id INTEGER REFERENCES team(id) ON DELETE CASCADE,
	photo_id INTEGER REFERENCES photo(id) ON DELETE CASCADE,
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS superlative_game ON superlative(game_id);

-- Webhooks that already listen to every earlier event also get the new one. Ones with a hand-picked list are left alone.
UPDATE webhook SET events = events || ',superlative.awarded'
WHERE events LIKE '%photo.added%' AND events LIKE '%photo.filed%' AND events LIKE '%photo.scored%' AND events LIKE '%photo.disqualified%'
	AND events LIKE '%photo.restored%' AND events LIKE '%photo.review%' AND events LIKE '%points.granted%' AND events NOT LIKE '%superlative.awarded%';
