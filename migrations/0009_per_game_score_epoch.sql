-- Each game keeps its own score_epoch. Triggers bump it whenever a row that feeds scoring changes, in the
-- same transaction as the change, so cascades (deleting a category, a user, ...) are covered too. A stored
-- score in score_cache is used only while its epoch matches the game's.
ALTER TABLE game ADD COLUMN score_epoch INTEGER NOT NULL DEFAULT 0;
DROP TABLE IF EXISTS score_epoch;
DELETE FROM score_cache;
CREATE TRIGGER IF NOT EXISTS score_photo_insert AFTER INSERT ON photo BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = NEW.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_photo_update AFTER UPDATE ON photo BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = NEW.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_photo_delete AFTER DELETE ON photo BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = OLD.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_photo_claim_insert AFTER INSERT ON photo_claim BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM photo WHERE id = NEW.photo_id); END;
CREATE TRIGGER IF NOT EXISTS score_photo_claim_update AFTER UPDATE ON photo_claim BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM photo WHERE id = NEW.photo_id); END;
CREATE TRIGGER IF NOT EXISTS score_photo_claim_delete AFTER DELETE ON photo_claim BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM photo WHERE id = OLD.photo_id); END;
CREATE TRIGGER IF NOT EXISTS score_score_option_insert AFTER INSERT ON score_option BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM category WHERE id = NEW.category_id); END;
CREATE TRIGGER IF NOT EXISTS score_score_option_update AFTER UPDATE ON score_option BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM category WHERE id = NEW.category_id); END;
CREATE TRIGGER IF NOT EXISTS score_score_option_delete AFTER DELETE ON score_option BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM category WHERE id = OLD.category_id); END;
CREATE TRIGGER IF NOT EXISTS score_category_insert AFTER INSERT ON category BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = NEW.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_category_update AFTER UPDATE ON category BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = NEW.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_category_delete AFTER DELETE ON category BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = OLD.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_team_insert AFTER INSERT ON team BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = NEW.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_team_update AFTER UPDATE ON team BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = NEW.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_team_delete AFTER DELETE ON team BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = OLD.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_member_insert AFTER INSERT ON member BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = NEW.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_member_update AFTER UPDATE ON member BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = NEW.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_member_delete AFTER DELETE ON member BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = OLD.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_grant_award_insert AFTER INSERT ON grant_award BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = NEW.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_grant_award_update AFTER UPDATE ON grant_award BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = NEW.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_grant_award_delete AFTER DELETE ON grant_award BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = OLD.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_grant_photo_insert AFTER INSERT ON grant_photo BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM grant_award WHERE id = NEW.grant_id); END;
CREATE TRIGGER IF NOT EXISTS score_grant_photo_update AFTER UPDATE ON grant_photo BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM grant_award WHERE id = NEW.grant_id); END;
CREATE TRIGGER IF NOT EXISTS score_grant_photo_delete AFTER DELETE ON grant_photo BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM grant_award WHERE id = OLD.grant_id); END;
CREATE TRIGGER IF NOT EXISTS score_award_insert AFTER INSERT ON award BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = NEW.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_award_update AFTER UPDATE ON award BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = NEW.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_award_delete AFTER DELETE ON award BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = OLD.game_id; END;
CREATE TRIGGER IF NOT EXISTS score_vote_insert AFTER INSERT ON vote BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM award WHERE id = NEW.award_id); END;
CREATE TRIGGER IF NOT EXISTS score_vote_update AFTER UPDATE ON vote BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM award WHERE id = NEW.award_id); END;
CREATE TRIGGER IF NOT EXISTS score_vote_delete AFTER DELETE ON vote BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = (SELECT game_id FROM award WHERE id = OLD.award_id); END;
-- Only the settings that change scores; the bump itself must not retrigger this.
CREATE TRIGGER IF NOT EXISTS score_game_update AFTER UPDATE OF bingo, bingo_cols, bingo_line_points, bingo_board_points ON game BEGIN UPDATE game SET score_epoch = score_epoch + 1 WHERE id = NEW.id; END;
