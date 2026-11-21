-- Most pages ran these lookups as full table scans, which D1 bills as rows read.
CREATE INDEX IF NOT EXISTS team_game ON team(game_id);
CREATE INDEX IF NOT EXISTS member_team ON member(team_id);
CREATE INDEX IF NOT EXISTS category_game ON category(game_id, active, sort);
CREATE INDEX IF NOT EXISTS score_option_category ON score_option(category_id, sort);
CREATE INDEX IF NOT EXISTS photo_team ON photo(team_id, category_id);
CREATE INDEX IF NOT EXISTS grant_award_game ON grant_award(game_id);
CREATE INDEX IF NOT EXISTS grant_photo_photo ON grant_photo(photo_id);
CREATE INDEX IF NOT EXISTS award_game ON award(game_id);
CREATE INDEX IF NOT EXISTS vote_photo ON vote(photo_id);
