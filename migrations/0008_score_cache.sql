-- Scores are computed once and stored. Any write to the tables that feed scoring bumps `score_epoch`,
-- and a stored result is only used while its epoch still matches.
CREATE TABLE IF NOT EXISTS score_epoch (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	n INTEGER NOT NULL
);
INSERT OR IGNORE INTO score_epoch (id, n) VALUES (1, 0);
CREATE TABLE IF NOT EXISTS score_cache (
	game_id INTEGER PRIMARY KEY REFERENCES game(id) ON DELETE CASCADE,
	epoch INTEGER NOT NULL,
	json TEXT NOT NULL
);
