import type Database from 'better-sqlite3';
import type {
  ChessState,
  PromotionPiece,
} from '../../../../domain/chess_graph/index.ts';
import {
  localId,
  type InventoryItemId,
  type ItemRevisionId,
} from '../../../../domain/identity/index.ts';
import type { InventoryRevisionLine } from '../../../../domain/inventory/index.ts';
import { invalidAnalysisRecord } from '../../../../application/analysis/index.ts';
import { readChessState } from './sqlite-chess-state.ts';

export interface MainLineRow {
  readonly depth: number;
  readonly occurrenceId: number;
  readonly occurrenceAnchorId: number;
  readonly positionId: number;
  readonly halfmoveClock: number;
  readonly fullmoveNumber: number;
  readonly historyKnowledge: ChessState['playState']['historyKnowledge'];
  readonly moveNodeId: number | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly promotion: PromotionPiece | null;
  readonly san: string | null;
}

export function readMainLine(
  database: Database.Database,
  revisionId: number,
  rootOccurrenceId: number,
): MainLineRow[] {
  return database
    .prepare(
      `WITH RECURSIVE line(depth, occurrence_id) AS (
         VALUES (0, ?)
         UNION ALL
         SELECT line.depth + 1, move.child_occurrence_id
           FROM line
           JOIN chess_move_node_snapshot AS move
             ON move.revision_id = ?
            AND move.parent_occurrence_id = line.occurrence_id
            AND move.is_main_line = 1
       )
       SELECT line.depth,
              occurrence.occurrence_id AS occurrenceId,
              occurrence_anchor.anchor_id AS occurrenceAnchorId,
              occurrence.position_id AS positionId,
              play.halfmove_clock AS halfmoveClock,
              play.fullmove_number AS fullmoveNumber,
              play.history_knowledge AS historyKnowledge,
              move.move_node_id AS moveNodeId,
              move.from_square AS 'from', move.to_square AS 'to',
              move.promotion, move.san
         FROM line
         JOIN chess_occurrence_snapshot AS occurrence
           ON occurrence.revision_id = ?
          AND occurrence.occurrence_id = line.occurrence_id
         JOIN chess_play_state_snapshot AS play
          ON play.revision_id = occurrence.revision_id
         AND play.occurrence_id = occurrence.occurrence_id
         JOIN chess_anchor AS occurrence_anchor
           ON occurrence_anchor.anchor_kind = 'occurrence'
          AND occurrence_anchor.owner_item_id = occurrence.item_id
          AND occurrence_anchor.occurrence_id = occurrence.occurrence_id
         LEFT JOIN chess_move_node_snapshot AS move
           ON move.revision_id = occurrence.revision_id
          AND move.parent_occurrence_id = occurrence.occurrence_id
          AND move.is_main_line = 1
        ORDER BY line.depth`,
    )
    .all(rootOccurrenceId, revisionId, revisionId) as MainLineRow[];
}

export function readInventoryRevisionLine(
  database: Database.Database,
  itemId: InventoryItemId,
  revisionId: ItemRevisionId,
): InventoryRevisionLine | undefined {
  const header = database
    .prepare(
      `SELECT revision.display_name AS displayName, revision.summary_text AS summary,
    COALESCE(analysis.root_occurrence_id, game.root_occurrence_id) AS rootOccurrenceId
    FROM item_revision AS revision
    LEFT JOIN inventory_analysis_revision AS analysis ON analysis.revision_id = revision.revision_id
    LEFT JOIN inventory_game_revision AS game ON game.revision_id = revision.revision_id
    WHERE revision.item_id = ? AND revision.revision_id = ?`,
    )
    .get(itemId.value, revisionId.value) as
    | {
        displayName: string;
        summary: string | null;
        rootOccurrenceId: number | null;
      }
    | undefined;
  if (header?.rootOccurrenceId == null) return undefined;
  const rows = readMainLine(
    database,
    revisionId.value,
    header.rootOccurrenceId,
  );
  const rootRow = rows[0];
  if (rootRow === undefined) throw invalidAnalysisRecord();
  const states = rows.map((row) =>
    readChessState(database, localId('position', row.positionId), {
      halfmoveClock: row.halfmoveClock,
      fullmoveNumber: row.fullmoveNumber,
      historyKnowledge: row.historyKnowledge,
    }),
  );
  const steps = rows.slice(0, -1).map((row, index) => {
    if (
      row.from === null ||
      row.to === null ||
      row.san === null ||
      row.moveNodeId === null
    )
      throw invalidAnalysisRecord();
    return {
      before: states[index]!,
      after: states[index + 1]!,
      anchorId: localId('anchor', rows[index + 1]!.occurrenceAnchorId),
      move: {
        from: row.from,
        to: row.to,
        san: row.san,
        ...(row.promotion === null ? {} : { promotion: row.promotion }),
      },
    };
  });
  return {
    itemId,
    revisionId,
    displayName: header.displayName,
    ...(header.summary === null ? {} : { summary: header.summary }),
    rootAnchorId: localId('anchor', rootRow.occurrenceAnchorId),
    root: states[0]!,
    steps,
  };
}
