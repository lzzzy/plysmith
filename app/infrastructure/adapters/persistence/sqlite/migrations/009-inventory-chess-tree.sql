CREATE VIEW inventory_chess_revision AS
SELECT revision_id, item_id, root_occurrence_id, origin_mode FROM inventory_analysis_revision
UNION ALL
SELECT revision_id, item_id, root_occurrence_id, origin_mode FROM inventory_game_revision;
