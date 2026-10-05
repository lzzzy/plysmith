import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ChessTreeCandidate } from '../../../../domain/inventory/chess-tree-candidate.ts';
import type {
  ChessTree,
  ChessTreeNode,
} from '../../../../domain/inventory/chess-tree.ts';
import type {
  ChessState,
  CanonicalMove,
} from '../../../../domain/chess_graph/index.ts';
import { localId } from '../../../../domain/identity/index.ts';
import { importProblem } from '../../../../application/inventory/import-problems.ts';
import {
  prepareEnsurePosition,
  chessStateFromPositionRow,
  type PositionRow,
} from './sqlite-chess-state.ts';
import { insertAnalysisNoteContribution } from './sqlite-analysis-note.ts';

export function importFingerprint(value: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(value)).digest();
}

export function prepareImportGraph(
  db: Database.Database,
  checkBudget: () => void,
) {
  const ensurePosition = prepareEnsurePosition(db);
  const insertOccurrence = db.prepare(
    'INSERT INTO chess_occurrence_identity(item_id, created_revision_id) VALUES (?, ?)',
  );
  const insertOccurrenceSnapshot = db.prepare(
    'INSERT INTO chess_occurrence_snapshot VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertPlayState = db.prepare(
    'INSERT INTO chess_play_state_snapshot VALUES (?, ?, ?, ?, ?)',
  );
  const insertOccurrenceAnchor = db.prepare(
    "INSERT INTO chess_anchor(anchor_kind, owner_item_id, occurrence_id) VALUES ('occurrence', ?, ?)",
  );
  const insertItemAnchor = db.prepare(
    "INSERT INTO chess_anchor(anchor_kind, item_id) VALUES ('item', ?)",
  );
  const insertAnalysis = db.prepare(
    'INSERT INTO inventory_analysis_revision VALUES (?, ?, ?, ?)',
  );
  const insertMove = db.prepare(
    'INSERT INTO chess_move_node_identity(item_id, created_revision_id) VALUES (?, ?)',
  );
  const insertMoveSnapshot = db.prepare(
    'INSERT INTO chess_move_node_snapshot VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertMoveAnchor = db.prepare(
    "INSERT INTO chess_anchor(anchor_kind, owner_item_id, move_node_id) VALUES ('move_node', ?, ?)",
  );
  return function insertImportGraph(
    item: number,
    revision: number,
    candidate: ChessTreeCandidate,
    languageTag: string,
    occurredAt: string,
    displayName: string,
  ): void {
    if (candidate.status === 'rejected' || candidate.root === undefined)
      throw importProblem('invalid_candidate');
    const occurrence = (state: ChessState, root: boolean) => {
      const id = Number(insertOccurrence.run(item, revision).lastInsertRowid);
      const position = ensurePosition(state.position);
      insertOccurrenceSnapshot.run(
        revision,
        id,
        item,
        position.value,
        Number(root),
        importFingerprint(state),
      );
      insertPlayState.run(
        revision,
        id,
        state.playState.halfmoveClock,
        state.playState.fullmoveNumber,
        state.playState.historyKnowledge,
      );
      const anchor = Number(
        insertOccurrenceAnchor.run(item, id).lastInsertRowid,
      );
      return { id, anchor };
    };
    const root = occurrence(candidate.root, true);
    insertItemAnchor.run(item);
    insertAnalysis.run(
      revision,
      item,
      root.id,
      candidate.root.playState.historyKnowledge === 'complete'
        ? 'initial_position'
        : 'fen',
    );
    const annotate = (anchor: number, values: readonly string[]) =>
      values
        .filter((value) => value.trim().length > 0)
        .forEach((body) => {
          checkBudget();
          insertAnalysisNoteContribution(db, {
            itemId: localId('inventory-item', item),
            anchorId: localId('anchor', anchor),
            note: { body, moves: [] },
            noteScope: { kind: 'global' },
            languageTag,
            occurredAt,
            title: displayName,
          });
        });
    annotate(root.anchor, candidate.initialComments);
    const occurrences = new Map<number, { id: number; anchor: number }>();
    const siblings = new Map<number | null, number>();
    const ancestry: number[] = [];
    for (const [index, node] of candidate.nodes.entries()) {
      if (index % 64 === 0) checkBudget();
      if (
        node.nodeIndex !== index ||
        node.siblingOrder !== (siblings.get(node.parentNodeIndex) ?? 0)
      )
        throw importProblem('invalid_candidate');
      while (ancestry.length && ancestry.at(-1) !== node.parentNodeIndex)
        ancestry.pop();
      if (
        node.parentNodeIndex !== null &&
        ancestry.at(-1) !== node.parentNodeIndex
      )
        throw importProblem('invalid_candidate');
      const parent =
        node.parentNodeIndex === null
          ? root
          : occurrences.get(node.parentNodeIndex);
      if (parent === undefined) throw importProblem('invalid_candidate');
      siblings.set(node.parentNodeIndex, node.siblingOrder + 1);
      ancestry.push(index);
      const child = occurrence(node.after, false);
      occurrences.set(index, child);
      const move = Number(insertMove.run(item, revision).lastInsertRowid);
      insertMoveSnapshot.run(
        revision,
        move,
        item,
        parent.id,
        child.id,
        node.siblingOrder,
        Number(node.siblingOrder === 0),
        node.move.from,
        node.move.to,
        node.move.promotion ?? null,
        node.move.san,
        importFingerprint(node.move),
      );
      insertMoveAnchor.run(item, move);
      annotate(parent.anchor, node.startingComments);
      annotate(child.anchor, node.comments);
    }
  };
}

export function readChessTree(
  db: Database.Database,
  revision: number,
): ChessTree | undefined {
  const rows = db
    .prepare(
      `SELECT m.parent_occurrence_id AS parent, m.child_occurrence_id AS child,
    m.sibling_order AS siblingOrder, m.is_main_line AS isMainLine,
    m.from_square AS 'from', m.to_square AS 'to', m.san, m.promotion,
    a.anchor_id AS anchorId, o.position_id AS positionId, p.halfmove_clock AS halfmoveClock,
    p.fullmove_number AS fullmoveNumber, p.history_knowledge AS historyKnowledge,
    cp.board_key AS boardKey, cp.side_to_move AS sideToMove,
    cp.white_king_side AS whiteKingSide, cp.white_queen_side AS whiteQueenSide,
    cp.black_king_side AS blackKingSide, cp.black_queen_side AS blackQueenSide,
    cp.effective_en_passant_square AS effectiveEnPassantSquare
    FROM chess_move_node_snapshot m JOIN chess_occurrence_snapshot o ON o.revision_id = m.revision_id AND o.occurrence_id = m.child_occurrence_id
    JOIN chess_play_state_snapshot p ON p.revision_id = o.revision_id AND p.occurrence_id = o.occurrence_id
    JOIN chess_position cp ON cp.position_id = o.position_id
    JOIN chess_anchor a ON a.occurrence_id = o.occurrence_id AND a.anchor_kind = 'occurrence'
    WHERE m.revision_id = ? ORDER BY m.is_main_line DESC, m.sibling_order`,
    )
    .all(revision) as (PositionRow & {
    parent: number;
    child: number;
    siblingOrder: number;
    isMainLine: number;
    from: string;
    to: string;
    san: string;
    promotion: CanonicalMove['promotion'] | null;
    anchorId: number;
    positionId: number;
    halfmoveClock: number;
    fullmoveNumber: number;
    historyKnowledge: ChessState['playState']['historyKnowledge'];
  })[];
  const root = db
    .prepare(
      `SELECT c.root_occurrence_id AS occurrenceId FROM inventory_chess_revision c
       JOIN inventory_item i ON i.item_id = c.item_id
       WHERE c.revision_id = ? AND i.current_revision_id IS NOT NULL`,
    )
    .get(revision) as { occurrenceId: number } | undefined;
  if (!root || !rows.some((row) => row.isMainLine === 0)) return undefined;
  const children = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = children.get(row.parent) ?? [];
    list.push(row);
    children.set(row.parent, list);
  }
  for (const [parent, siblings] of children) {
    let alternativeOrder = 1;
    children.set(
      parent,
      siblings.map((row) => ({
        ...row,
        siblingOrder: row.isMainLine === 1 ? 0 : alternativeOrder++,
      })),
    );
  }
  const nodes: ChessTreeNode[] = [];
  const pending = (children.get(root.occurrenceId) ?? [])
    .map((row) => ({ row, parentNodeIndex: null as number | null }))
    .reverse();
  while (pending.length) {
    const { row, parentNodeIndex } = pending.pop()!;
    const nodeIndex = nodes.length;
    nodes.push({
      nodeIndex,
      parentNodeIndex,
      siblingOrder: row.siblingOrder,
      anchorId: localId('anchor', row.anchorId),
      move: {
        from: row.from,
        to: row.to,
        san: row.san,
        ...(row.promotion == null ? {} : { promotion: row.promotion }),
      },
      after: chessStateFromPositionRow(row, row),
    });
    for (const child of [...(children.get(row.child) ?? [])].reverse())
      pending.push({ row: child, parentNodeIndex: nodeIndex });
  }
  return { nodes };
}
