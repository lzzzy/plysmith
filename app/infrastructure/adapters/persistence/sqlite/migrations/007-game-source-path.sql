CREATE TABLE inventory_game_source_path (
    revision_id INTEGER PRIMARY KEY,
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 200),
    root_position_id INTEGER NOT NULL,
    root_halfmove_clock INTEGER NOT NULL CHECK (root_halfmove_clock >= 0),
    root_fullmove_number INTEGER NOT NULL CHECK (root_fullmove_number > 0),
    root_history_knowledge TEXT NOT NULL CHECK (root_history_knowledge IN ('complete', 'partial', 'unknown')),
    FOREIGN KEY (revision_id) REFERENCES inventory_game_revision (revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (root_position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE inventory_game_source_ply (
    revision_id INTEGER NOT NULL,
    ply_index INTEGER NOT NULL CHECK (ply_index >= 0),
    before_position_id INTEGER NOT NULL,
    before_halfmove_clock INTEGER NOT NULL CHECK (before_halfmove_clock >= 0),
    before_fullmove_number INTEGER NOT NULL CHECK (before_fullmove_number > 0),
    before_history_knowledge TEXT NOT NULL CHECK (before_history_knowledge IN ('complete', 'partial', 'unknown')),
    after_position_id INTEGER NOT NULL,
    after_halfmove_clock INTEGER NOT NULL CHECK (after_halfmove_clock >= 0),
    after_fullmove_number INTEGER NOT NULL CHECK (after_fullmove_number > 0),
    after_history_knowledge TEXT NOT NULL CHECK (after_history_knowledge IN ('complete', 'partial', 'unknown')),
    from_square TEXT NOT NULL CHECK (from_square GLOB '[a-h][1-8]'),
    to_square TEXT NOT NULL CHECK (to_square GLOB '[a-h][1-8]'),
    promotion TEXT CHECK (promotion IN ('queen', 'rook', 'bishop', 'knight')),
    san TEXT NOT NULL CHECK (length(san) BETWEEN 1 AND 32),
    PRIMARY KEY (revision_id, ply_index),
    FOREIGN KEY (revision_id) REFERENCES inventory_game_source_path (revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (before_position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT,
    FOREIGN KEY (after_position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT
) STRICT;
