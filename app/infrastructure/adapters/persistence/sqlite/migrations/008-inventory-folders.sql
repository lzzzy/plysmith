CREATE TABLE inventory_folder (
  folder_id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_folder_id INTEGER REFERENCES inventory_folder(folder_id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  CHECK (parent_folder_id IS NULL OR parent_folder_id <> folder_id)
) STRICT;
CREATE UNIQUE INDEX inventory_folder_sibling_name ON inventory_folder(coalesce(parent_folder_id, 0), name_key);

ALTER TABLE inventory_item ADD COLUMN folder_id INTEGER REFERENCES inventory_folder(folder_id) ON DELETE SET NULL;
CREATE INDEX inventory_item_folder ON inventory_item(folder_id);

-- Retain the requested destination as immutable receipt input, even after deletion.
ALTER TABLE playout_completion_receipt ADD COLUMN requested_folder_mode TEXT NOT NULL DEFAULT 'inherit' CHECK (requested_folder_mode IN ('inherit', 'unfiled', 'folder'));
ALTER TABLE playout_completion_receipt ADD COLUMN requested_folder_id INTEGER;

CREATE TABLE workspace_context_folder (
  context_id INTEGER NOT NULL REFERENCES workspace_working_context(context_id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES inventory_folder(folder_id) ON DELETE CASCADE,
  PRIMARY KEY (context_id, folder_id)
) STRICT;
