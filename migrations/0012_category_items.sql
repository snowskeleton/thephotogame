-- Category checklists: a host can list the things a category is after (every US state for license plates).
-- A photo may name the one item it ticks off. Deleting an item leaves its photos in the category, just unticked.
CREATE TABLE IF NOT EXISTS category_item (
	id INTEGER PRIMARY KEY,
	category_id INTEGER NOT NULL REFERENCES category(id) ON DELETE CASCADE,
	label TEXT NOT NULL,
	sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS category_item_category ON category_item(category_id);
ALTER TABLE photo ADD COLUMN item_id INTEGER REFERENCES category_item(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS photo_item ON photo(item_id);
