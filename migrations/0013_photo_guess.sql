-- A player's own guess at a photo's points, filed with the photo. It shapes nothing official: the host's
-- claims (photo_claim) or points_override are what score, and the guess only feeds the "pending" totals.
CREATE TABLE IF NOT EXISTS photo_guess (
	photo_id INTEGER NOT NULL REFERENCES photo(id) ON DELETE CASCADE,
	option_id INTEGER NOT NULL REFERENCES score_option(id) ON DELETE CASCADE,
	qty REAL NOT NULL DEFAULT 1,
	PRIMARY KEY (photo_id, option_id)
);
CREATE TRIGGER IF NOT EXISTS score_photo_guess_insert AFTER INSERT ON photo_guess BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM photo WHERE id = NEW.photo_id); END;
CREATE TRIGGER IF NOT EXISTS score_photo_guess_update AFTER UPDATE ON photo_guess BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM photo WHERE id = NEW.photo_id); END;
CREATE TRIGGER IF NOT EXISTS score_photo_guess_delete AFTER DELETE ON photo_guess BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM photo WHERE id = OLD.photo_id); END;
DELETE FROM score_cache;
