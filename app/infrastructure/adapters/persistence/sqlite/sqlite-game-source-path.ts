import type Database from 'better-sqlite3';
import { invalidAnalysisRecord } from '../../../../application/analysis/analysis-problems.ts';
import type {
  HistoryKnowledge,
  PromotionPiece,
} from '../../../../domain/chess_graph/index.ts';
import { localId } from '../../../../domain/identity/index.ts';
import type { PlayoutSourcePath } from '../../../../domain/playout/index.ts';
import { readChessState } from './sqlite-chess-state.ts';

export function persistGameSourcePath(
  database: Database.Database,
  draftId: number,
  revisionId: number,
): void {
  database
    .prepare(
      `INSERT INTO inventory_game_source_path
       (revision_id, display_name, root_position_id, root_halfmove_clock,
        root_fullmove_number, root_history_knowledge)
     SELECT ?, source_display_name, source_root_position_id, source_root_halfmove_clock,
            source_root_fullmove_number, source_root_history_knowledge
       FROM playout_draft WHERE draft_id = ? AND source_display_name IS NOT NULL`,
    )
    .run(revisionId, draftId);
  database
    .prepare(
      `INSERT INTO inventory_game_source_ply
     SELECT ?, ply_index, before_position_id, before_halfmove_clock,
            before_fullmove_number, before_history_knowledge, after_position_id,
            after_halfmove_clock, after_fullmove_number, after_history_knowledge,
            from_square, to_square, promotion, san
       FROM playout_source_ply WHERE draft_id = ?`,
    )
    .run(revisionId, draftId);
}

export function copyGameSourcePath(
  database: Database.Database,
  sourceRevisionId: number,
  targetRevisionId: number,
): void {
  database
    .prepare(
      `INSERT INTO inventory_game_source_path
     SELECT ?, display_name, root_position_id, root_halfmove_clock,
            root_fullmove_number, root_history_knowledge
       FROM inventory_game_source_path WHERE revision_id = ?`,
    )
    .run(targetRevisionId, sourceRevisionId);
  database
    .prepare(
      `INSERT INTO inventory_game_source_ply
     SELECT ?, ply_index, before_position_id, before_halfmove_clock,
            before_fullmove_number, before_history_knowledge, after_position_id,
            after_halfmove_clock, after_fullmove_number, after_history_knowledge,
            from_square, to_square, promotion, san
       FROM inventory_game_source_ply WHERE revision_id = ?`,
    )
    .run(targetRevisionId, sourceRevisionId);
}

export function readGameSourcePath(
  database: Database.Database,
  revisionId: number,
): PlayoutSourcePath | undefined {
  const header = database
    .prepare(
      `SELECT display_name AS displayName, root_position_id AS rootPositionId,
            root_halfmove_clock AS halfmoveClock, root_fullmove_number AS fullmoveNumber,
            root_history_knowledge AS historyKnowledge
       FROM inventory_game_source_path WHERE revision_id = ?`,
    )
    .get(revisionId) as
    | {
        displayName: string;
        rootPositionId: number;
        halfmoveClock: number;
        fullmoveNumber: number;
        historyKnowledge: HistoryKnowledge;
      }
    | undefined;
  if (header === undefined) return undefined;
  const rows = database
    .prepare(
      `SELECT ply_index AS plyIndex, before_position_id AS beforePositionId,
            before_halfmove_clock AS beforeHalfmoveClock, before_fullmove_number AS beforeFullmoveNumber,
            before_history_knowledge AS beforeHistoryKnowledge, after_position_id AS afterPositionId,
            after_halfmove_clock AS afterHalfmoveClock, after_fullmove_number AS afterFullmoveNumber,
            after_history_knowledge AS afterHistoryKnowledge, from_square AS 'from', to_square AS 'to', promotion, san
       FROM inventory_game_source_ply WHERE revision_id = ? ORDER BY ply_index`,
    )
    .all(revisionId) as {
    plyIndex: number;
    beforePositionId: number;
    beforeHalfmoveClock: number;
    beforeFullmoveNumber: number;
    beforeHistoryKnowledge: HistoryKnowledge;
    afterPositionId: number;
    afterHalfmoveClock: number;
    afterFullmoveNumber: number;
    afterHistoryKnowledge: HistoryKnowledge;
    from: string;
    to: string;
    promotion: PromotionPiece | null;
    san: string;
  }[];
  if (rows.some((row, index) => row.plyIndex !== index))
    throw invalidAnalysisRecord();
  return Object.freeze({
    displayName: header.displayName,
    root: readChessState(
      database,
      localId('position', header.rootPositionId),
      header,
    ),
    steps: Object.freeze(
      rows.map((row) =>
        Object.freeze({
          before: readChessState(
            database,
            localId('position', row.beforePositionId),
            {
              halfmoveClock: row.beforeHalfmoveClock,
              fullmoveNumber: row.beforeFullmoveNumber,
              historyKnowledge: row.beforeHistoryKnowledge,
            },
          ),
          move: Object.freeze({
            from: row.from,
            to: row.to,
            san: row.san,
            ...(row.promotion === null ? {} : { promotion: row.promotion }),
          }),
          after: readChessState(
            database,
            localId('position', row.afterPositionId),
            {
              halfmoveClock: row.afterHalfmoveClock,
              fullmoveNumber: row.afterFullmoveNumber,
              historyKnowledge: row.afterHistoryKnowledge,
            },
          ),
        }),
      ),
    ),
  });
}
