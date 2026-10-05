ALTER TABLE analysis_scratch_draft
    ADD COLUMN scratch_mode TEXT NOT NULL DEFAULT 'exploration'
    CHECK (scratch_mode IN ('exploration', 'inventory_revision'));
ALTER TABLE analysis_scratch_draft ADD COLUMN edit_mode TEXT
    CHECK (edit_mode IN ('extend', 'truncate_after', 'replace_move', 'metadata', 'add_variation'));
ALTER TABLE analysis_scratch_draft ADD COLUMN edit_item_id INTEGER
    REFERENCES inventory_item (item_id) ON DELETE RESTRICT;
ALTER TABLE analysis_scratch_draft ADD COLUMN base_revision_id INTEGER
    REFERENCES item_revision (revision_id) ON DELETE RESTRICT;
ALTER TABLE analysis_scratch_draft ADD COLUMN cut_anchor_id INTEGER
    REFERENCES chess_anchor (anchor_id) ON DELETE RESTRICT;
ALTER TABLE analysis_scratch_draft ADD COLUMN return_anchor_id INTEGER
    REFERENCES chess_anchor (anchor_id) ON DELETE RESTRICT;
ALTER TABLE analysis_scratch_draft ADD COLUMN candidate_display_name TEXT;
ALTER TABLE analysis_scratch_draft ADD COLUMN candidate_summary_text TEXT;

ALTER TABLE workspace_context_item ADD COLUMN pinned_revision_id INTEGER
    REFERENCES item_revision (revision_id) ON DELETE RESTRICT;
ALTER TABLE workspace_context_item ADD COLUMN pin_reason TEXT
    CHECK (pin_reason IS NULL OR pin_reason = 'pending_revision_impact');

ALTER TABLE item_revision ADD COLUMN revision_change_kind TEXT NOT NULL DEFAULT 'created'
    CHECK (revision_change_kind IN ('created', 'extend', 'truncate_after', 'replace_move', 'metadata', 'add_variation'));

CREATE TABLE workspace_pending_revision_impact (
    impact_id INTEGER PRIMARY KEY CHECK (impact_id > 0),
    context_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    pinned_revision_id INTEGER NOT NULL,
    target_revision_id INTEGER NOT NULL,
    target_anchor_id INTEGER NOT NULL,
    impact_version INTEGER NOT NULL CHECK (impact_version > 0),
    created_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at_utc) IS created_at_utc),
    updated_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at_utc) IS updated_at_utc),
    FOREIGN KEY (context_id)
        REFERENCES workspace_working_context (context_id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id)
        REFERENCES inventory_item (item_id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id, pinned_revision_id)
        REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id, target_revision_id)
        REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (target_anchor_id)
        REFERENCES chess_anchor (anchor_id) ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX workspace_one_open_revision_impact
    ON workspace_pending_revision_impact (context_id, item_id);

CREATE INDEX workspace_revision_impact_target
    ON workspace_pending_revision_impact (item_id, target_revision_id);

CREATE TABLE workspace_revision_impact_entry (
    impact_entry_id INTEGER PRIMARY KEY CHECK (impact_entry_id > 0),
    impact_id INTEGER NOT NULL,
    entry_kind TEXT NOT NULL CHECK (entry_kind IN ('reference', 'contribution', 'management_resume', 'analysis_resume')),
    subject_id INTEGER NOT NULL CHECK (subject_id > 0),
    old_anchor_id INTEGER NOT NULL,
    FOREIGN KEY (impact_id)
        REFERENCES workspace_pending_revision_impact (impact_id) ON DELETE RESTRICT,
    FOREIGN KEY (old_anchor_id)
        REFERENCES chess_anchor (anchor_id) ON DELETE RESTRICT,
    UNIQUE (impact_id, entry_kind, subject_id)
) STRICT;

CREATE INDEX workspace_revision_impact_entries
    ON workspace_revision_impact_entry (impact_id, impact_entry_id);

CREATE TRIGGER analysis_revision_scratch_insert_guard
BEFORE INSERT ON analysis_scratch_draft
WHEN NEW.scratch_mode = 'inventory_revision'
BEGIN
    SELECT CASE WHEN
        NEW.edit_mode IS NULL OR NEW.edit_item_id IS NULL OR
        NEW.base_revision_id IS NULL OR NEW.cut_anchor_id IS NULL OR
        NEW.return_anchor_id IS NULL OR NEW.candidate_display_name IS NULL OR
        NEW.origin_mode <> 'inventory_anchor' OR
        NEW.origin_item_id <> NEW.edit_item_id OR
        NEW.origin_revision_id <> NEW.base_revision_id OR
        NEW.origin_anchor_id <> NEW.cut_anchor_id
    THEN RAISE(ABORT, 'invalid inventory revision scratch') END;
END;

CREATE TRIGGER analysis_revision_scratch_update_guard
BEFORE UPDATE ON analysis_scratch_draft
WHEN NEW.scratch_mode = 'inventory_revision'
BEGIN
    SELECT CASE WHEN
        NEW.edit_mode IS NULL OR NEW.edit_item_id IS NULL OR
        NEW.base_revision_id IS NULL OR NEW.cut_anchor_id IS NULL OR
        NEW.return_anchor_id IS NULL OR NEW.candidate_display_name IS NULL OR
        NEW.origin_mode <> 'inventory_anchor' OR
        NEW.origin_item_id <> NEW.edit_item_id OR
        NEW.origin_revision_id <> NEW.base_revision_id OR
        NEW.origin_anchor_id <> NEW.cut_anchor_id
    THEN RAISE(ABORT, 'invalid inventory revision scratch') END;
END;

CREATE TRIGGER analysis_exploration_scratch_insert_guard
BEFORE INSERT ON analysis_scratch_draft
WHEN NEW.scratch_mode = 'exploration'
BEGIN
    SELECT CASE WHEN
        NEW.edit_mode IS NOT NULL OR NEW.edit_item_id IS NOT NULL OR
        NEW.base_revision_id IS NOT NULL OR NEW.cut_anchor_id IS NOT NULL OR
        NEW.return_anchor_id IS NOT NULL OR NEW.candidate_display_name IS NOT NULL OR
        NEW.candidate_summary_text IS NOT NULL
    THEN RAISE(ABORT, 'invalid exploration scratch') END;
END;

CREATE TRIGGER analysis_exploration_scratch_update_guard
BEFORE UPDATE ON analysis_scratch_draft
WHEN NEW.scratch_mode = 'exploration'
BEGIN
    SELECT CASE WHEN
        NEW.edit_mode IS NOT NULL OR NEW.edit_item_id IS NOT NULL OR
        NEW.base_revision_id IS NOT NULL OR NEW.cut_anchor_id IS NOT NULL OR
        NEW.return_anchor_id IS NOT NULL OR NEW.candidate_display_name IS NOT NULL OR
        NEW.candidate_summary_text IS NOT NULL
    THEN RAISE(ABORT, 'invalid exploration scratch') END;
END;

CREATE TRIGGER workspace_context_pin_guard_insert
BEFORE INSERT ON workspace_context_item
BEGIN
    SELECT CASE WHEN
        (NEW.pinned_revision_id IS NULL) <> (NEW.pin_reason IS NULL) OR
        (NEW.pinned_revision_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM item_revision AS revision
         WHERE revision.item_id = NEW.item_id
           AND revision.revision_id = NEW.pinned_revision_id
    )) THEN RAISE(ABORT, 'invalid context revision pin') END;
END;

CREATE TRIGGER workspace_context_pin_guard_update
BEFORE UPDATE OF pinned_revision_id, pin_reason ON workspace_context_item
BEGIN
    SELECT CASE WHEN
        (NEW.pinned_revision_id IS NULL) <> (NEW.pin_reason IS NULL) OR
        (NEW.pinned_revision_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM item_revision AS revision
         WHERE revision.item_id = NEW.item_id
           AND revision.revision_id = NEW.pinned_revision_id
    )) THEN RAISE(ABORT, 'invalid context revision pin') END;
END;
