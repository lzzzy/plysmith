CREATE TABLE playout_draft (
    draft_id INTEGER PRIMARY KEY AUTOINCREMENT CHECK (draft_id > 0),
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('free', 'context')),
    context_id INTEGER,
    origin_mode TEXT NOT NULL CHECK (origin_mode IN ('initial_position', 'fen', 'position_setup', 'inventory_anchor')),
    origin_item_id INTEGER,
    origin_revision_id INTEGER,
    origin_anchor_id INTEGER,
    source_display_name TEXT CHECK (source_display_name IS NULL OR length(trim(source_display_name)) BETWEEN 1 AND 200),
    source_root_position_id INTEGER,
    source_root_halfmove_clock INTEGER CHECK (source_root_halfmove_clock IS NULL OR source_root_halfmove_clock >= 0),
    source_root_fullmove_number INTEGER CHECK (source_root_fullmove_number IS NULL OR source_root_fullmove_number > 0),
    source_root_history_knowledge TEXT CHECK (source_root_history_knowledge IS NULL OR source_root_history_knowledge IN ('complete', 'partial', 'unknown')),
    root_position_id INTEGER NOT NULL,
    root_halfmove_clock INTEGER NOT NULL CHECK (root_halfmove_clock >= 0),
    root_fullmove_number INTEGER NOT NULL CHECK (root_fullmove_number > 0),
    root_history_knowledge TEXT NOT NULL CHECK (root_history_knowledge IN ('complete', 'partial', 'unknown')),
    player_side TEXT NOT NULL CHECK (player_side IN ('white', 'black')),
    policy_capability TEXT NOT NULL CHECK (policy_capability IN ('best_move', 'human_profile')),
    provider_instance_id TEXT NOT NULL CHECK (length(trim(provider_instance_id)) > 0),
    provider_fingerprint TEXT NOT NULL CHECK (length(trim(provider_fingerprint)) > 0),
    provider_type TEXT NOT NULL CHECK (length(trim(provider_type)) > 0),
    provider_display_name TEXT NOT NULL CHECK (length(trim(provider_display_name)) > 0),
    profile_model_name TEXT,
    profile_selection_mode TEXT CHECK (profile_selection_mode IN ('most_likely', 'sampled')),
    profile_history_mode TEXT CHECK (profile_history_mode IN ('known_position_history', 'position_only')),
    profile_reproducibility TEXT CHECK (profile_reproducibility IN ('deterministic', 'stochastic')),
    status_kind TEXT NOT NULL CHECK (status_kind IN ('active', 'awaiting_policy', 'paused', 'stopped', 'terminal')),
    terminal_reason TEXT CHECK (terminal_reason IN ('checkmate', 'stalemate', 'insufficient_material', 'threefold_repetition', 'seventy_five_move')),
    outcome_kind TEXT CHECK (outcome_kind IN ('win', 'draw', 'unfinished')),
    winner_side TEXT CHECK (winner_side IN ('white', 'black')),
    draft_revision INTEGER NOT NULL CHECK (draft_revision > 0),
    decision_generation INTEGER NOT NULL CHECK (decision_generation >= 0),
    pending_decision_id INTEGER CHECK (pending_decision_id > 0),
    created_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', created_at_utc) IS created_at_utc),
    updated_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', updated_at_utc) IS updated_at_utc),
    CHECK (
        (scope_kind = 'free' AND context_id IS NULL) OR
        (scope_kind = 'context' AND context_id IS NOT NULL)
    ),
    CHECK (
        (origin_mode IN ('initial_position', 'fen', 'position_setup') AND origin_item_id IS NULL AND origin_revision_id IS NULL AND origin_anchor_id IS NULL) OR
        (origin_mode = 'inventory_anchor' AND origin_item_id IS NOT NULL AND origin_revision_id IS NOT NULL AND origin_anchor_id IS NOT NULL)
    ),
    CHECK (
        (source_display_name IS NULL AND source_root_position_id IS NULL AND source_root_halfmove_clock IS NULL AND source_root_fullmove_number IS NULL AND source_root_history_knowledge IS NULL) OR
        (source_display_name IS NOT NULL AND source_root_position_id IS NOT NULL AND source_root_halfmove_clock IS NOT NULL AND source_root_fullmove_number IS NOT NULL AND source_root_history_knowledge IS NOT NULL)
    ),
    CHECK ((status_kind = 'awaiting_policy') = (pending_decision_id IS NOT NULL)),
    CHECK (
        (policy_capability = 'best_move' AND profile_model_name IS NULL AND profile_selection_mode IS NULL AND profile_history_mode IS NULL AND profile_reproducibility IS NULL) OR
        (policy_capability = 'human_profile' AND profile_model_name IS NOT NULL AND length(trim(profile_model_name)) BETWEEN 1 AND 160 AND profile_selection_mode IS NOT NULL AND profile_history_mode IS NOT NULL AND profile_reproducibility IS NOT NULL)
    ),
    CHECK (
        (status_kind IN ('active', 'awaiting_policy', 'paused') AND terminal_reason IS NULL AND outcome_kind IS NULL AND winner_side IS NULL) OR
        (status_kind = 'stopped' AND terminal_reason IS NULL AND outcome_kind = 'unfinished' AND winner_side IS NULL) OR
        (status_kind = 'terminal' AND terminal_reason IS NOT NULL AND outcome_kind IN ('win', 'draw') AND ((outcome_kind = 'win') = (winner_side IS NOT NULL)))
    ),
    FOREIGN KEY (context_id) REFERENCES workspace_working_context (context_id) ON DELETE RESTRICT,
    FOREIGN KEY (origin_item_id, origin_revision_id) REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (origin_anchor_id) REFERENCES chess_anchor (anchor_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_root_position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT,
    FOREIGN KEY (root_position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX playout_one_context_draft
    ON playout_draft (context_id) WHERE scope_kind = 'context';
CREATE UNIQUE INDEX playout_one_free_draft
    ON playout_draft ((1)) WHERE scope_kind = 'free';

CREATE TABLE playout_source_ply (
    draft_id INTEGER NOT NULL,
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
    PRIMARY KEY (draft_id, ply_index),
    FOREIGN KEY (draft_id) REFERENCES playout_draft (draft_id) ON DELETE RESTRICT,
    FOREIGN KEY (before_position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT,
    FOREIGN KEY (after_position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE playout_ply (
    draft_id INTEGER NOT NULL,
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
    actor TEXT NOT NULL CHECK (actor IN ('user', 'provider')),
    decision_id INTEGER CHECK (decision_id > 0),
    PRIMARY KEY (draft_id, ply_index),
    CHECK ((actor = 'user' AND decision_id IS NULL) OR (actor = 'provider' AND decision_id IS NOT NULL)),
    FOREIGN KEY (draft_id) REFERENCES playout_draft (draft_id) ON DELETE RESTRICT,
    FOREIGN KEY (before_position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT,
    FOREIGN KEY (after_position_id) REFERENCES chess_position (position_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE inventory_game_revision (
    revision_id INTEGER PRIMARY KEY CHECK (revision_id > 0),
    item_id INTEGER NOT NULL,
    root_occurrence_id INTEGER NOT NULL,
    origin_mode TEXT NOT NULL CHECK (origin_mode IN ('initial_position', 'fen', 'position_setup', 'inventory_anchor')),
    player_side TEXT CHECK (player_side IN ('white', 'black')),
    result_kind TEXT CHECK (result_kind IN ('white_win', 'black_win', 'draw', 'unfinished')),
    result_source TEXT CHECK (result_source IN ('manual', 'automatic')),
    result_reason TEXT CHECK (result_reason IN ('checkmate', 'stalemate', 'insufficient_material', 'threefold_repetition', 'seventy_five_move')),
    policy_capability TEXT CHECK (policy_capability IN ('best_move', 'human_profile')),
    provider_instance_id TEXT CHECK (length(trim(provider_instance_id)) > 0),
    provider_fingerprint TEXT CHECK (length(trim(provider_fingerprint)) > 0),
    provider_type TEXT CHECK (length(trim(provider_type)) > 0),
    provider_display_name TEXT CHECK (length(trim(provider_display_name)) > 0),
    profile_model_name TEXT,
    profile_selection_mode TEXT CHECK (profile_selection_mode IN ('most_likely', 'sampled')),
    profile_history_mode TEXT CHECK (profile_history_mode IN ('known_position_history', 'position_only')),
    profile_reproducibility TEXT CHECK (profile_reproducibility IN ('deterministic', 'stochastic')),
    CHECK (
        (player_side IS NULL AND result_kind IS NULL AND result_source IS NULL AND
         result_reason IS NULL AND policy_capability IS NULL AND provider_instance_id IS NULL AND
         provider_fingerprint IS NULL AND provider_type IS NULL AND provider_display_name IS NULL AND
         profile_model_name IS NULL AND profile_selection_mode IS NULL AND profile_history_mode IS NULL AND profile_reproducibility IS NULL) OR
        (player_side IS NOT NULL AND result_kind IS NOT NULL AND result_source IS NOT NULL AND
         policy_capability IS NOT NULL AND provider_instance_id IS NOT NULL AND
         provider_fingerprint IS NOT NULL AND provider_type IS NOT NULL AND provider_display_name IS NOT NULL)
    ),
    CHECK (
        (result_source = 'manual' AND result_reason IS NULL) OR
        (result_source = 'automatic' AND result_reason IS NOT NULL AND (
            (result_kind IN ('white_win', 'black_win') AND result_reason = 'checkmate') OR
            (result_kind = 'draw' AND result_reason IN ('stalemate', 'insufficient_material', 'threefold_repetition', 'seventy_five_move'))
        ))
    ),
    CHECK (
        (policy_capability = 'best_move' AND profile_model_name IS NULL AND profile_selection_mode IS NULL AND profile_history_mode IS NULL AND profile_reproducibility IS NULL) OR
        (policy_capability = 'human_profile' AND profile_model_name IS NOT NULL AND length(trim(profile_model_name)) BETWEEN 1 AND 160 AND profile_selection_mode IS NOT NULL AND profile_history_mode IS NOT NULL AND profile_reproducibility IS NOT NULL)
    ),
    UNIQUE (item_id, revision_id),
    FOREIGN KEY (item_id, revision_id) REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (revision_id, root_occurrence_id) REFERENCES chess_occurrence_snapshot (revision_id, occurrence_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE inventory_game_origin (
    game_revision_id INTEGER PRIMARY KEY,
    source_item_id INTEGER NOT NULL,
    source_revision_id INTEGER NOT NULL,
    source_anchor_id INTEGER NOT NULL,
    FOREIGN KEY (game_revision_id) REFERENCES inventory_game_revision (revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_item_id, source_revision_id) REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (source_anchor_id) REFERENCES chess_anchor (anchor_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE playout_completion_receipt (
    completion_id TEXT PRIMARY KEY CHECK (length(trim(completion_id)) BETWEEN 1 AND 160),
    draft_id INTEGER NOT NULL UNIQUE,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('free', 'context')),
    context_id INTEGER,
    expected_draft_revision INTEGER NOT NULL CHECK (expected_draft_revision > 0),
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 240),
    language_tag TEXT NOT NULL CHECK (length(trim(language_tag)) BETWEEN 2 AND 35),
    target_context_id INTEGER,
    item_id INTEGER NOT NULL,
    revision_id INTEGER NOT NULL,
    root_anchor_id INTEGER NOT NULL,
    context_reference_id INTEGER,
    data_revision INTEGER NOT NULL CHECK (data_revision > 0),
    completed_at_utc TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ', completed_at_utc) IS completed_at_utc),
    CHECK (
        (scope_kind = 'free' AND context_id IS NULL) OR
        (scope_kind = 'context' AND context_id IS NOT NULL)
    ),
    FOREIGN KEY (context_id) REFERENCES workspace_working_context (context_id) ON DELETE RESTRICT,
    FOREIGN KEY (target_context_id) REFERENCES workspace_working_context (context_id) ON DELETE RESTRICT,
    FOREIGN KEY (item_id, revision_id) REFERENCES item_revision (item_id, revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (root_anchor_id) REFERENCES chess_anchor (anchor_id) ON DELETE RESTRICT,
    FOREIGN KEY (context_reference_id) REFERENCES workspace_context_reference (reference_id) ON DELETE RESTRICT
) STRICT;
