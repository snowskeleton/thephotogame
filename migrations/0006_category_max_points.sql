-- Optional ceiling on the points one team can count in a category. NULL (the default) means no ceiling.
ALTER TABLE category ADD COLUMN max_points REAL;
