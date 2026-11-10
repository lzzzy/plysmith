import type Database from 'better-sqlite3';

import { invalidAnalysisNote } from '../../../../application/analysis/index.ts';
import {
  localId,
  type AnchorId,
  type InventoryItemId,
  type ItemRevisionId,
} from '../../../../domain/identity/index.ts';

export function resolveAnalysisNoteTarget(
  database: Database.Database,
  origin: {
    readonly itemId: InventoryItemId;
    readonly revisionId: ItemRevisionId;
    readonly anchorId: AnchorId;
  },
): { readonly anchorId: AnchorId; readonly positionId: number } {
  // Follow only this occurrence's primary continuation in the source revision.
  // Side branches alone do not turn a line end into a replaced halfmove.
  const targets = database
    .prepare(
      `SELECT target_anchor.anchor_id AS anchorId, target.position_id AS positionId
         FROM item_revision revision
         JOIN inventory_chess_revision graph ON graph.revision_id = revision.revision_id
         JOIN chess_anchor source ON source.anchor_id = ?
         LEFT JOIN chess_move_node_snapshot source_move
           ON source_move.revision_id = revision.revision_id
          AND source_move.move_node_id = source.move_node_id
         JOIN chess_occurrence_snapshot occurrence
           ON occurrence.revision_id = revision.revision_id
          AND occurrence.item_id = revision.item_id
          AND (
            (source.anchor_kind = 'occurrence' AND occurrence.occurrence_id = source.occurrence_id)
            OR (source.anchor_kind = 'move_node' AND occurrence.occurrence_id = source_move.child_occurrence_id)
            OR (source.anchor_kind = 'item' AND occurrence.occurrence_id = graph.root_occurrence_id)
            OR (source.anchor_kind = 'position' AND occurrence.position_id = source.position_id)
          )
         LEFT JOIN chess_move_node_snapshot continuation
           ON continuation.revision_id = revision.revision_id
          AND continuation.parent_occurrence_id = occurrence.occurrence_id
          AND continuation.is_main_line = 1
         JOIN chess_occurrence_snapshot target
           ON target.revision_id = revision.revision_id
          AND target.occurrence_id = COALESCE(continuation.child_occurrence_id, occurrence.occurrence_id)
         JOIN chess_anchor target_anchor
           ON target_anchor.anchor_kind = 'occurrence'
          AND target_anchor.owner_item_id = revision.item_id
          AND target_anchor.occurrence_id = target.occurrence_id
        WHERE revision.item_id = ? AND revision.revision_id = ?
          AND COALESCE(source.owner_item_id, source.item_id) = revision.item_id
        LIMIT 2`,
    )
    .all(
      origin.anchorId.value,
      origin.itemId.value,
      origin.revisionId.value,
    ) as {
    anchorId: number;
    positionId: number;
  }[];
  // A position-only anchor must identify one occurrence, never an arbitrary
  // transposition with the same position or move notation.
  if (targets.length !== 1) throw invalidAnalysisNote();
  return {
    anchorId: localId('anchor', targets[0]!.anchorId),
    positionId: targets[0]!.positionId,
  };
}
