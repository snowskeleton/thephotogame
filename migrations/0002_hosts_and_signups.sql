-- Game hosts, email invites, verified emails and site settings.

-- Set when the person proves they own the address (an email code or an emailed invite link).
-- Hosting a game needs it; playing doesn't.
ALTER TABLE user ADD COLUMN email_verified_at INTEGER;

-- role: 'host' runs the game, 'player' plays. status: 'invited' until they accept, then 'active'.
ALTER TABLE member ADD COLUMN role TEXT NOT NULL DEFAULT 'player';
ALTER TABLE member ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE game ADD COLUMN created_by INTEGER REFERENCES user(id) ON DELETE SET NULL;

-- Bytes stored in R2 for the photo (original + thumb + large), for the storage total.
ALTER TABLE photo ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;

-- An emailed invite: opening the link signs that person in and, with a game, makes them a member.
CREATE TABLE IF NOT EXISTS invite (
	token_hash TEXT PRIMARY KEY,
	user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	game_id INTEGER REFERENCES game(id) ON DELETE CASCADE,
	invited_by INTEGER REFERENCES user(id) ON DELETE SET NULL,
	expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS setting (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
