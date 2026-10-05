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
  readonly isMainLine?: number;
}

export function readMainLine(
  database: Database.Database,
  revisionId: number,
  rootOccurrenceId: number,
  selectedAnchorId?: number,
): MainLineRow[] {
  const visible = database
    .prepare(
      `SELECT 1 FROM item_revision r JOIN inventory_item i ON i.item_id = r.item_id
    WHERE r.revision_id = ? AND i.current_revision_id IS NOT NULL`,
    )
    .get(revisionId);
  if (visible === undefined) return [];
  // Walk backwards from the selected anchor, then follow that branch's main continuation.
  const selected =
    selectedAnchorId === undefined
      ? undefined
      : (database
          .prepare(
            `
    SELECT COALESCE(a.occurrence_id, m.child_occurrence_id,
      (SELECT occurrence_id FROM chess_occurrence_snapshot WHERE revision_id = ? AND position_id = a.position_id ORDER BY occurrence_id LIMIT 1)) AS occurrenceId
    FROM chess_anchor a LEFT JOIN chess_move_node_snapshot m ON m.move_node_id = a.move_node_id AND m.revision_id = ?
    WHERE a.anchor_id = ?`,
          )
          .get(revisionId, revisionId, selectedAnchorId) as
          { occurrenceId: number | null } | undefined);
  const overrides =
    selected?.occurrenceId == null
      ? []
      : (database
          .prepare(
            `
    WITH RECURSIVE path(occurrence_id) AS (VALUES (?) UNION ALL
      SELECT m.parent_occurrence_id FROM chess_move_node_snapshot m JOIN path ON path.occurrence_id = m.child_occurrence_id WHERE m.revision_id = ?)
    SELECT m.parent_occurrence_id AS parent, m.move_node_id AS move FROM chess_move_node_snapshot m JOIN path ON path.occurrence_id = m.child_occurrence_id WHERE m.revision_id = ?`,
          )
          .all(selected.occurrenceId, revisionId, revisionId) as {
          parent: number;
          move: number;
        }[]);
  const branch = new Map(overrides.map((row) => [row.parent, row.move]));
  const rows = database
    .prepare(
      `WITH RECURSIVE line(depth, occurrence_id) AS (
         VALUES (0, ?)
         UNION ALL
         SELECT line.depth + 1, move.child_occurrence_id
           FROM line
           JOIN chess_move_node_snapshot AS move
             ON move.revision_id = ?
            AND move.parent_occurrence_id = line.occurrence_id
       )
       SELECT line.depth,
              occurrence.occurrence_id AS occurrenceId,
              occurrence_anchor.anchor_id AS occurrenceAnchorId,
              occurrence.position_id AS positionId,
              play.halfmove_clock AS halfmoveClock,
              play.fullmove_number AS fullmoveNumber,
              play.history_knowledge AS historyKnowledge,
              move.move_node_id AS moveNodeId,
              move.is_main_line AS isMainLine,
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
        ORDER BY line.depth, move.sibling_order`,
    )
    .all(rootOccurrenceId, revisionId, revisionId) as MainLineRow[];
  // The SQL materializes all occurrences once; each row describes its outgoing edge.
  const byOccurrence = new Map<number, MainLineRow[]>();
  for (const row of rows) {
    const edges = byOccurrence.get(row.occurrenceId) ?? [];
    edges.push(row);
    byOccurrence.set(row.occurrenceId, edges);
  }
  const childRows = database
    .prepare(
      'SELECT move_node_id AS move, child_occurrence_id AS child FROM chess_move_node_snapshot WHERE revision_id = ?',
    )
    .all(revisionId) as { move: number; child: number }[];
  const childByMove = new Map(childRows.map((row) => [row.move, row.child]));
  const line: MainLineRow[] = [];
  let current: number | undefined = rootOccurrenceId;
  const visited = new Set<number>();
  while (current !== undefined) {
    if (visited.has(current)) throw invalidAnalysisRecord();
    visited.add(current);
    const edges: MainLineRow[] | undefined = byOccurrence.get(current);
    const selectedMove = branch.get(current);
    const row: MainLineRow | undefined =
      edges?.find((edge) => edge.moveNodeId === selectedMove) ??
      edges?.find((edge) => edge.isMainLine === 1 || edge.moveNodeId === null);
    if (!row && edges?.[0]) {
      line.push({
        ...edges[0],
        depth: line.length,
        moveNodeId: null,
        from: null,
        to: null,
        promotion: null,
        san: null,
      });
      break;
    }
    if (!row) throw invalidAnalysisRecord();
    line.push({ ...row, depth: line.length });
    current =
      row.moveNodeId === null ? undefined : childByMove.get(row.moveNodeId);
  }
  return line;
}

export function readInventoryRevisionLine(
  database: Database.Database,
  itemId: InventoryItemId,
  revisionId: ItemRevisionId,
): InventoryRevisionLine | undefined {
  const header = database
    .prepare(
      `SELECT revision.display_name AS displayName, revision.summary_text AS summary,
    graph.root_occurrence_id AS rootOccurrenceId
    FROM item_revision AS revision
    JOIN inventory_item item ON item.item_id = revision.item_id AND item.current_revision_id IS NOT NULL
    JOIN inventory_chess_revision graph ON graph.revision_id = revision.revision_id
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
