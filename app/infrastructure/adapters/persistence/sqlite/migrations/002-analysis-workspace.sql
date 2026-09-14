CREATE TABLE inventory_item (
    item_id INTEGER PRIMARY KEY CHECK (item_id > 0),
    item_type TEXT NOT NULL CHECK (item_type IN ('game', 'analysis', 'source')),
    origin_kind TEXT NOT NULL CHECK (origin_kind IN ('manual', 'structured_import', 'playout', 'live_observed', 'live_played')),
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'archived', 'trashed', 'tombstone')),
    current_revision_id INTEGER,
    created_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at_utc) IS created_at_utc),
    updated_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at_utc) IS updated_at_utc),
    UNIQUE (item_id, current_revision_id),
    FOREIGN KEY (item_id, current_revision_id)
        REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE item_revision (
    revision_id INTEGER PRIMARY KEY CHECK (revision_id > 0),
    item_id INTEGER NOT NULL,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    base_revision_id INTEGER,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 200),
    summary_text TEXT,
    language_tag TEXT NOT NULL CHECK (length(language_tag) BETWEEN 2 AND 35),
    content_fingerprint BLOB NOT NULL CHECK (length(content_fingerprint) = 32),
    creator_role TEXT NOT NULL CHECK (creator_role IN ('user', 'importer', 'playout', 'live')),
    created_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at_utc) IS created_at_utc),
    UNIQUE (item_id, revision_id),
    UNIQUE (item_id, revision_number),
    FOREIGN KEY (item_id) REFERENCES inventory_item (item_id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id, base_revision_id)
        REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE chess_position (
    position_id INTEGER PRIMARY KEY CHECK (position_id > 0),
    rule_set_id TEXT NOT NULL CHECK (rule_set_id = 'standardChess'),
    board_key TEXT NOT NULL CHECK (length(board_key) = 64 AND board_key NOT GLOB '*[^PNBRQKpnbrqk.]*'),
    side_to_move TEXT NOT NULL CHECK (side_to_move IN ('white', 'black')),
    white_king_side INTEGER NOT NULL CHECK (white_king_side IN (0, 1)),
    white_queen_side INTEGER NOT NULL CHECK (white_queen_side IN (0, 1)),
    black_king_side INTEGER NOT NULL CHECK (black_king_side IN (0, 1)),
    black_queen_side INTEGER NOT NULL CHECK (black_queen_side IN (0, 1)),
    effective_en_passant_square INTEGER NOT NULL CHECK (effective_en_passant_square BETWEEN -1 AND 63),
    position_hash BLOB NOT NULL CHECK (length(position_hash) = 32),
    UNIQUE (
        rule_set_id,
        board_key,
        side_to_move,
        white_king_side,
        white_queen_side,
        black_king_side,
        black_queen_side,
        effective_en_passant_square
    )
) STRICT;

CREATE INDEX chess_position_by_hash
    ON chess_position (position_hash);

CREATE TABLE chess_occurrence_identity (
    occurrence_id INTEGER PRIMARY KEY CHECK (occurrence_id > 0),
    item_id INTEGER NOT NULL,
    created_revision_id INTEGER NOT NULL,
    UNIQUE (item_id, occurrence_id),
    FOREIGN KEY (item_id, created_revision_id)
        REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE chess_move_node_identity (
    move_node_id INTEGER PRIMARY KEY CHECK (move_node_id > 0),
    item_id INTEGER NOT NULL,
    created_revision_id INTEGER NOT NULL,
    UNIQUE (item_id, move_node_id),
    FOREIGN KEY (item_id, created_revision_id)
        REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE chess_occurrence_snapshot (
    revision_id INTEGER NOT NULL,
    occurrence_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    position_id INTEGER NOT NULL,
    is_root INTEGER NOT NULL CHECK (is_root IN (0, 1)),
    content_fingerprint BLOB NOT NULL CHECK (length(content_fingerprint) = 32),
    PRIMARY KEY (revision_id, occurrence_id),
    FOREIGN KEY (item_id, revision_id)
        REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id, occurrence_id)
        REFERENCES chess_occurrence_identity (item_id, occurrence_id) ON DELETE RESTRICT,
    FOREIGN KEY (position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX chess_occurrence_one_root
    ON chess_occurrence_snapshot (revision_id)
    WHERE is_root = 1;

CREATE INDEX chess_occurrence_by_position
    ON chess_occurrence_snapshot (position_id, revision_id, occurrence_id);

CREATE INDEX chess_occurrence_history
    ON chess_occurrence_snapshot (occurrence_id, revision_id);

CREATE TABLE chess_play_state_snapshot (
    revision_id INTEGER NOT NULL,
    occurrence_id INTEGER NOT NULL,
    halfmove_clock INTEGER NOT NULL CHECK (halfmove_clock >= 0),
    fullmove_number INTEGER NOT NULL CHECK (fullmove_number > 0),
    history_knowledge TEXT NOT NULL CHECK (history_knowledge IN ('complete', 'partial', 'unknown')),
    PRIMARY KEY (revision_id, occurrence_id),
    FOREIGN KEY (revision_id, occurrence_id)
        REFERENCES chess_occurrence_snapshot (revision_id, occurrence_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE chess_move_node_snapshot (
    revision_id INTEGER NOT NULL,
    move_node_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    parent_occurrence_id INTEGER NOT NULL,
    child_occurrence_id INTEGER NOT NULL,
    sibling_order INTEGER NOT NULL CHECK (sibling_order >= 0),
    is_main_line INTEGER NOT NULL CHECK (is_main_line IN (0, 1)),
    from_square TEXT NOT NULL CHECK (from_square GLOB '[a-h][1-8]'),
    to_square TEXT NOT NULL CHECK (to_square GLOB '[a-h][1-8]'),
    promotion TEXT CHECK (promotion IN ('queen', 'rook', 'bishop', 'knight')),
    san TEXT NOT NULL CHECK (length(san) BETWEEN 1 AND 32),
    content_fingerprint BLOB NOT NULL CHECK (length(content_fingerprint) = 32),
    PRIMARY KEY (revision_id, move_node_id),
    UNIQUE (revision_id, parent_occurrence_id, sibling_order),
    UNIQUE (revision_id, child_occurrence_id),
    FOREIGN KEY (item_id, revision_id)
        REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id, move_node_id)
        REFERENCES chess_move_node_identity (item_id, move_node_id) ON DELETE RESTRICT,
    FOREIGN KEY (revision_id, parent_occurrence_id)
        REFERENCES chess_occurrence_snapshot (revision_id, occurrence_id) ON DELETE RESTRICT,
    FOREIGN KEY (revision_id, child_occurrence_id)
        REFERENCES chess_occurrence_snapshot (revision_id, occurrence_id) ON DELETE RESTRICT,
    CHECK (parent_occurrence_id <> child_occurrence_id)
) STRICT;

CREATE INDEX chess_move_node_history
    ON chess_move_node_snapshot (move_node_id, revision_id);

CREATE TABLE inventory_analysis_revision (
    revision_id INTEGER PRIMARY KEY CHECK (revision_id > 0),
    item_id INTEGER NOT NULL,
    root_occurrence_id INTEGER NOT NULL,
    origin_mode TEXT NOT NULL CHECK (origin_mode IN ('initial_position', 'fen', 'inventory_anchor')),
    UNIQUE (item_id, revision_id),
    FOREIGN KEY (item_id, revision_id)
        REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (revision_id, root_occurrence_id)
        REFERENCES chess_occurrence_snapshot (revision_id, occurrence_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE chess_anchor (
    anchor_id INTEGER PRIMARY KEY CHECK (anchor_id > 0),
    anchor_kind TEXT NOT NULL CHECK (anchor_kind IN ('item', 'position', 'occurrence', 'move_node')),
    owner_item_id INTEGER,
    item_id INTEGER,
    position_id INTEGER,
    occurrence_id INTEGER,
    move_node_id INTEGER,
    CHECK (
        (anchor_kind = 'item' AND item_id IS NOT NULL AND position_id IS NULL AND occurrence_id IS NULL AND move_node_id IS NULL) OR
        (anchor_kind = 'position' AND item_id IS NULL AND position_id IS NOT NULL AND occurrence_id IS NULL AND move_node_id IS NULL) OR
        (anchor_kind = 'occurrence' AND item_id IS NULL AND position_id IS NULL AND occurrence_id IS NOT NULL AND move_node_id IS NULL) OR
        (anchor_kind = 'move_node' AND item_id IS NULL AND position_id IS NULL AND occurrence_id IS NULL AND move_node_id IS NOT NULL)
    ),
    CHECK (
        (anchor_kind IN ('item', 'position') AND owner_item_id IS NULL) OR
        (anchor_kind IN ('occurrence', 'move_node') AND owner_item_id IS NOT NULL)
    ),
    FOREIGN KEY (item_id) REFERENCES inventory_item (item_id) ON DELETE RESTRICT,
    FOREIGN KEY (position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT,
    FOREIGN KEY (owner_item_id, occurrence_id)
        REFERENCES chess_occurrence_identity (item_id, occurrence_id) ON DELETE RESTRICT,
    FOREIGN KEY (owner_item_id, move_node_id)
        REFERENCES chess_move_node_identity (item_id, move_node_id) ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX chess_anchor_for_item
    ON chess_anchor (item_id) WHERE anchor_kind = 'item';
CREATE UNIQUE INDEX chess_anchor_for_position
    ON chess_anchor (position_id) WHERE anchor_kind = 'position';
CREATE UNIQUE INDEX chess_anchor_for_occurrence
    ON chess_anchor (occurrence_id) WHERE anchor_kind = 'occurrence';
CREATE UNIQUE INDEX chess_anchor_for_move_node
    ON chess_anchor (move_node_id) WHERE anchor_kind = 'move_node';

CREATE TABLE workspace_working_context (
    context_id INTEGER PRIMARY KEY CHECK (context_id > 0),
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 160),
    purpose TEXT,
    boundary_text TEXT,
    next_step TEXT,
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'archived')),
    pinned_order INTEGER CHECK (pinned_order IS NULL OR pinned_order >= 0),
    context_version INTEGER NOT NULL CHECK (context_version > 0),
    created_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at_utc) IS created_at_utc),
    updated_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at_utc) IS updated_at_utc)
) STRICT;

CREATE INDEX workspace_context_list
    ON workspace_working_context (lifecycle, pinned_order, updated_at_utc DESC, context_id DESC);

CREATE TABLE workspace_context_item (
    context_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    relationship_version INTEGER NOT NULL CHECK (relationship_version > 0),
    created_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at_utc) IS created_at_utc),
    PRIMARY KEY (context_id, item_id),
    FOREIGN KEY (context_id) REFERENCES workspace_working_context (context_id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id) REFERENCES inventory_item (item_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX workspace_context_item_reverse
    ON workspace_context_item (item_id, context_id);

CREATE TABLE workspace_context_reference (
    reference_id INTEGER PRIMARY KEY CHECK (reference_id > 0),
    context_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    anchor_id INTEGER NOT NULL,
    created_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at_utc) IS created_at_utc),
    UNIQUE (context_id, anchor_id),
    FOREIGN KEY (context_id, item_id)
        REFERENCES workspace_context_item (context_id, item_id) ON DELETE RESTRICT,
    FOREIGN KEY (anchor_id) REFERENCES chess_anchor (anchor_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX workspace_context_reference_reverse
    ON workspace_context_reference (anchor_id, context_id);

CREATE TABLE workspace_contribution (
    contribution_id INTEGER PRIMARY KEY CHECK (contribution_id > 0),
    contribution_type TEXT NOT NULL CHECK (contribution_type IN ('note', 'question', 'decision', 'machine_finding', 'source_statement')),
    author_role TEXT NOT NULL CHECK (author_role IN ('user', 'engine', 'source')),
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'context')),
    context_id INTEGER,
    anchor_id INTEGER NOT NULL,
    body TEXT NOT NULL CHECK (length(trim(body)) > 0),
    rationale TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'resolved', 'archived')),
    contribution_version INTEGER NOT NULL CHECK (contribution_version > 0),
    language_tag TEXT NOT NULL CHECK (length(language_tag) BETWEEN 2 AND 35),
    created_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at_utc) IS created_at_utc),
    updated_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at_utc) IS updated_at_utc),
    CHECK (
        (scope_kind = 'global' AND context_id IS NULL) OR
        (scope_kind = 'context' AND context_id IS NOT NULL)
    ),
    FOREIGN KEY (context_id) REFERENCES workspace_working_context (context_id) ON DELETE RESTRICT,
    FOREIGN KEY (anchor_id) REFERENCES chess_anchor (anchor_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX workspace_contribution_by_anchor
    ON workspace_contribution (anchor_id, scope_kind, context_id, contribution_type, updated_at_utc DESC, contribution_id DESC);

CREATE TABLE workspace_management_resume (
    context_id INTEGER PRIMARY KEY,
    resume_version INTEGER NOT NULL CHECK (resume_version > 0),
    presentation TEXT NOT NULL CHECK (presentation IN ('list', 'atlas')),
    selected_item_id INTEGER,
    selected_anchor_id INTEGER,
    updated_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at_utc) IS updated_at_utc),
    FOREIGN KEY (context_id) REFERENCES workspace_working_context (context_id) ON DELETE RESTRICT,
    FOREIGN KEY (selected_item_id) REFERENCES inventory_item (item_id) ON DELETE RESTRICT,
    FOREIGN KEY (selected_anchor_id) REFERENCES chess_anchor (anchor_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE analysis_scratch_draft (
    scratch_draft_id INTEGER PRIMARY KEY CHECK (scratch_draft_id > 0),
    context_id INTEGER NOT NULL UNIQUE,
    origin_mode TEXT NOT NULL CHECK (origin_mode IN ('initial_position', 'fen', 'inventory_anchor')),
    origin_item_id INTEGER,
    origin_revision_id INTEGER,
    origin_anchor_id INTEGER,
    root_position_id INTEGER NOT NULL,
    root_halfmove_clock INTEGER NOT NULL CHECK (root_halfmove_clock >= 0),
    root_fullmove_number INTEGER NOT NULL CHECK (root_fullmove_number > 0),
    root_history_knowledge TEXT NOT NULL CHECK (root_history_knowledge IN ('complete', 'partial', 'unknown')),
    cursor_index INTEGER NOT NULL CHECK (cursor_index >= 0),
    scratch_revision INTEGER NOT NULL CHECK (scratch_revision > 0),
    note_body TEXT,
    created_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at_utc) IS created_at_utc),
    updated_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at_utc) IS updated_at_utc),
    CHECK (
        (origin_mode IN ('initial_position', 'fen') AND origin_item_id IS NULL AND origin_revision_id IS NULL AND origin_anchor_id IS NULL) OR
        (origin_mode = 'inventory_anchor' AND origin_item_id IS NOT NULL AND origin_revision_id IS NOT NULL AND origin_anchor_id IS NOT NULL)
    ),
    FOREIGN KEY (context_id) REFERENCES workspace_working_context (context_id) ON DELETE RESTRICT,
    FOREIGN KEY (origin_item_id, origin_revision_id)
        REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (origin_anchor_id) REFERENCES chess_anchor (anchor_id) ON DELETE RESTRICT,
    FOREIGN KEY (root_position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE analysis_scratch_step (
    scratch_draft_id INTEGER NOT NULL,
    step_index INTEGER NOT NULL CHECK (step_index >= 0),
    before_position_id INTEGER NOT NULL,
    before_halfmove_clock INTEGER NOT NULL CHECK (before_halfmove_clock >= 0),
    before_fullmove_number INTEGER NOT NULL CHECK (before_fullmove_number > 0),
    after_position_id INTEGER NOT NULL,
    after_halfmove_clock INTEGER NOT NULL CHECK (after_halfmove_clock >= 0),
    after_fullmove_number INTEGER NOT NULL CHECK (after_fullmove_number > 0),
    from_square TEXT NOT NULL CHECK (from_square GLOB '[a-h][1-8]'),
    to_square TEXT NOT NULL CHECK (to_square GLOB '[a-h][1-8]'),
    promotion TEXT CHECK (promotion IN ('queen', 'rook', 'bishop', 'knight')),
    san TEXT NOT NULL CHECK (length(san) BETWEEN 1 AND 32),
    PRIMARY KEY (scratch_draft_id, step_index),
    FOREIGN KEY (scratch_draft_id) REFERENCES analysis_scratch_draft (scratch_draft_id) ON DELETE RESTRICT,
    FOREIGN KEY (before_position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT,
    FOREIGN KEY (after_position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE workspace_analysis_resume (
    context_id INTEGER PRIMARY KEY,
    resume_version INTEGER NOT NULL CHECK (resume_version > 0),
    item_id INTEGER,
    revision_id INTEGER,
    anchor_id INTEGER,
    mode TEXT NOT NULL CHECK (mode IN ('analyze', 'edit_inventory', 'edit_overlay')),
    current_position_id INTEGER NOT NULL,
    analysis_scratch_draft_id INTEGER,
    updated_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at_utc) IS updated_at_utc),
    CHECK (
        (item_id IS NULL AND revision_id IS NULL AND anchor_id IS NULL) OR
        (item_id IS NOT NULL AND revision_id IS NOT NULL AND anchor_id IS NOT NULL)
    ),
    FOREIGN KEY (context_id) REFERENCES workspace_working_context (context_id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id, revision_id) REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (anchor_id) REFERENCES chess_anchor (anchor_id) ON DELETE RESTRICT,
    FOREIGN KEY (current_position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT,
    FOREIGN KEY (analysis_scratch_draft_id) REFERENCES analysis_scratch_draft (scratch_draft_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE search_document (
    search_document_id INTEGER PRIMARY KEY CHECK (search_document_id > 0),
    projection_version INTEGER NOT NULL CHECK (projection_version > 0),
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('item_revision', 'contribution')),
    item_id INTEGER,
    item_revision_id INTEGER,
    contribution_id INTEGER,
    anchor_id INTEGER,
    context_id INTEGER,
    language_tag TEXT NOT NULL CHECK (length(language_tag) BETWEEN 2 AND 35),
    evidence_class TEXT NOT NULL CHECK (evidence_class IN ('personal', 'source', 'machine')),
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('global', 'context')),
    stable_sort_value TEXT NOT NULL,
    title TEXT NOT NULL,
    aliases_concepts TEXT NOT NULL,
    metadata TEXT NOT NULL,
    body TEXT NOT NULL,
    CHECK (
        (subject_kind = 'item_revision' AND item_id IS NOT NULL AND item_revision_id IS NOT NULL AND contribution_id IS NULL) OR
        (subject_kind = 'contribution' AND item_id IS NULL AND item_revision_id IS NULL AND contribution_id IS NOT NULL)
    ),
    FOREIGN KEY (item_id, item_revision_id) REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (contribution_id) REFERENCES workspace_contribution (contribution_id) ON DELETE RESTRICT,
    FOREIGN KEY (anchor_id) REFERENCES chess_anchor (anchor_id) ON DELETE RESTRICT,
    FOREIGN KEY (context_id) REFERENCES workspace_working_context (context_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX search_document_by_item
    ON search_document (item_id, item_revision_id, search_document_id);
CREATE INDEX search_document_by_contribution
    ON search_document (contribution_id, search_document_id);

CREATE VIRTUAL TABLE search_document_fts USING fts5(
    title,
    aliases_concepts,
    metadata,
    body,
    content = 'search_document',
    content_rowid = 'search_document_id',
    tokenize = 'unicode61 remove_diacritics 2',
    prefix = '2 3'
);

CREATE TRIGGER search_document_after_insert AFTER INSERT ON search_document BEGIN
    INSERT INTO search_document_fts(rowid, title, aliases_concepts, metadata, body)
    VALUES (new.search_document_id, new.title, new.aliases_concepts, new.metadata, new.body);
END;

CREATE TRIGGER search_document_after_delete AFTER DELETE ON search_document BEGIN
    INSERT INTO search_document_fts(search_document_fts, rowid, title, aliases_concepts, metadata, body)
    VALUES ('delete', old.search_document_id, old.title, old.aliases_concepts, old.metadata, old.body);
END;

CREATE TRIGGER search_document_after_update AFTER UPDATE ON search_document BEGIN
    INSERT INTO search_document_fts(search_document_fts, rowid, title, aliases_concepts, metadata, body)
    VALUES ('delete', old.search_document_id, old.title, old.aliases_concepts, old.metadata, old.body);
    INSERT INTO search_document_fts(rowid, title, aliases_concepts, metadata, body)
    VALUES (new.search_document_id, new.title, new.aliases_concepts, new.metadata, new.body);
END;

CREATE INDEX inventory_active_list
    ON inventory_item (lifecycle, item_type, updated_at_utc DESC, item_id DESC)
    WHERE current_revision_id IS NOT NULL AND lifecycle <> 'tombstone';

CREATE INDEX inventory_active_by_origin
    ON inventory_item (lifecycle, origin_kind, updated_at_utc DESC, item_id DESC)
    WHERE current_revision_id IS NOT NULL AND lifecycle <> 'tombstone';
