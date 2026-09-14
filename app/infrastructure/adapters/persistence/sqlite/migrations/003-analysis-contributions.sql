CREATE TABLE inventory_analysis_origin (
    analysis_revision_id INTEGER PRIMARY KEY CHECK (analysis_revision_id > 0),
    source_item_id INTEGER NOT NULL,
    source_revision_id INTEGER NOT NULL,
    source_anchor_id INTEGER NOT NULL,
    FOREIGN KEY (analysis_revision_id)
        REFERENCES inventory_analysis_revision (revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_item_id, source_revision_id)
        REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_anchor_id)
        REFERENCES chess_anchor (anchor_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX inventory_analysis_by_source
    ON inventory_analysis_origin (source_item_id, source_revision_id, source_anchor_id);

CREATE TABLE workspace_analysis_note_path_step (
    contribution_id INTEGER NOT NULL,
    step_index INTEGER NOT NULL CHECK (step_index >= 0),
    from_square TEXT NOT NULL CHECK (length(from_square) = 2),
    to_square TEXT NOT NULL CHECK (length(to_square) = 2),
    promotion TEXT CHECK (promotion IN ('queen', 'rook', 'bishop', 'knight')),
    san TEXT NOT NULL CHECK (length(trim(san)) BETWEEN 1 AND 32),
    PRIMARY KEY (contribution_id, step_index),
    FOREIGN KEY (contribution_id)
        REFERENCES workspace_contribution (contribution_id) ON DELETE RESTRICT
) STRICT;
