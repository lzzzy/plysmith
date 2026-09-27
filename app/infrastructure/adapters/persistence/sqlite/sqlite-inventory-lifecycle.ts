import type Database from 'better-sqlite3';
import {
  inventoryDeletionConflict,
  inventoryItemNotFound,
  type DeleteInventoryItemRequest,
  type DeleteInventoryItemResult,
  type InventoryItemDeletionPreview,
  type PreviewInventoryItemDeletionRequest,
} from '../../../../application/inventory/index.ts';
import { localId } from '../../../../domain/identity/index.ts';
import { removeContextItemUsage } from './sqlite-context-item.ts';
import { readInventoryItemUsage } from './sqlite-revision-impact-state.ts';
import {
  incrementDataRevision,
  readDataRevision,
} from './sqlite-store-helpers.ts';

export function previewInventoryItemDeletion(
  database: Database.Database,
  request: PreviewInventoryItemDeletionRequest,
): InventoryItemDeletionPreview | undefined {
  const item = database
    .prepare(
      `
    SELECT item.current_revision_id AS currentRevisionId, item.item_type AS itemType,
           revision.display_name AS displayName
      FROM inventory_item AS item
      JOIN item_revision AS revision ON revision.revision_id = item.current_revision_id
       AND revision.item_id = item.item_id
     WHERE item.item_id = ? AND item.lifecycle = 'active'
  `,
    )
    .get(request.itemId.value) as
    | {
        currentRevisionId: number;
        itemType: InventoryItemDeletionPreview['itemType'];
        displayName: string;
      }
    | undefined;
  if (item === undefined) return undefined;
  const contexts = database
    .prepare(
      `
    SELECT context.context_id AS contextId, context.display_name AS contextName
      FROM workspace_working_context AS context
     WHERE context.context_id IN (
       SELECT context_id FROM workspace_context_item WHERE item_id = ?
       UNION SELECT context_id FROM workspace_management_resume WHERE selected_item_id = ?
       UNION SELECT context_id FROM workspace_analysis_resume WHERE item_id = ?
       UNION SELECT context_id FROM analysis_scratch_draft WHERE origin_item_id = ? OR edit_item_id = ?
       UNION SELECT contribution.context_id FROM workspace_contribution AS contribution
         JOIN chess_anchor AS anchor ON anchor.anchor_id = contribution.anchor_id
        WHERE contribution.status <> 'archived' AND coalesce(anchor.owner_item_id, anchor.item_id) = ?
     ) ORDER BY context.display_name, context.context_id
  `,
    )
    .all(...Array<number>(6).fill(request.itemId.value)) as {
    contextId: number;
    contextName: string;
  }[];
  const derived = database
    .prepare(
      `
    WITH RECURSIVE origin(item_id, source_item_id) AS (
      SELECT revision.item_id, origin.source_item_id FROM inventory_analysis_origin AS origin
      JOIN item_revision AS revision ON revision.revision_id = origin.analysis_revision_id
      JOIN inventory_item AS item ON item.item_id = revision.item_id AND item.current_revision_id = revision.revision_id
      UNION SELECT revision.item_id, origin.source_item_id FROM inventory_game_origin AS origin
      JOIN item_revision AS revision ON revision.revision_id = origin.game_revision_id
      JOIN inventory_item AS item ON item.item_id = revision.item_id AND item.current_revision_id = revision.revision_id
    ), descendants(item_id) AS (
      SELECT item_id FROM origin WHERE source_item_id = ?
      UNION SELECT origin.item_id FROM origin JOIN descendants ON origin.source_item_id = descendants.item_id
    ) SELECT count(*) AS count FROM descendants JOIN inventory_item AS item USING (item_id)
       WHERE item.lifecycle = 'active'
  `,
    )
    .get(request.itemId.value) as { count: number };
  const playouts = database
    .prepare(
      'SELECT count(*) AS count FROM playout_draft WHERE origin_item_id = ?',
    )
    .get(request.itemId.value) as { count: number };
  return Object.freeze({
    itemId: request.itemId,
    currentRevisionId: localId('item-revision', item.currentRevisionId),
    itemType: item.itemType,
    displayName: item.displayName,
    contexts: Object.freeze(
      contexts.map((context) =>
        Object.freeze({
          contextId: localId('working-context', context.contextId),
          contextName: context.contextName,
          ...readInventoryItemUsage(database, {
            itemId: request.itemId.value,
            contextId: context.contextId,
          }),
        }),
      ),
    ),
    global: readInventoryItemUsage(database, {
      itemId: request.itemId.value,
      contextId: null,
    }),
    retainedDerivedItemCount: derived.count,
    retainedPlayoutCount: playouts.count,
    dataRevision: readDataRevision(database),
  });
}

export function deleteInventoryItem(
  database: Database.Database,
  request: DeleteInventoryItemRequest,
  occurredAt: string,
): DeleteInventoryItemResult {
  const preview = previewInventoryItemDeletion(database, request);
  if (preview === undefined) throw inventoryItemNotFound();
  if (
    preview.dataRevision !== request.expectedDataRevision ||
    preview.currentRevisionId.value !== request.expectedCurrentRevisionId.value
  ) {
    throw inventoryDeletionConflict();
  }
  for (const context of preview.contexts) {
    removeContextItemUsage(database, {
      contextId: context.contextId.value,
      itemId: request.itemId.value,
      occurredAt,
    });
    database
      .prepare(
        'UPDATE workspace_working_context SET updated_at_utc = ? WHERE context_id = ?',
      )
      .run(occurredAt, context.contextId.value);
  }
  removeContextItemUsage(database, {
    contextId: null,
    itemId: request.itemId.value,
    occurredAt,
  });
  database
    .prepare(
      `DELETE FROM workspace_revision_impact_entry
    WHERE impact_id IN (SELECT impact_id FROM workspace_pending_revision_impact WHERE item_id = ?)`,
    )
    .run(request.itemId.value);
  database
    .prepare('DELETE FROM workspace_pending_revision_impact WHERE item_id = ?')
    .run(request.itemId.value);
  database
    .prepare('DELETE FROM workspace_context_item WHERE item_id = ?')
    .run(request.itemId.value);
  database
    .prepare(
      `DELETE FROM search_document WHERE item_id = ? OR contribution_id IN (
    SELECT contribution.contribution_id FROM workspace_contribution AS contribution
    JOIN chess_anchor AS anchor ON anchor.anchor_id = contribution.anchor_id
    WHERE coalesce(anchor.owner_item_id, anchor.item_id) = ?)`,
    )
    .run(request.itemId.value, request.itemId.value);
  database
    .prepare(
      `UPDATE workspace_contribution
    SET status = 'archived', contribution_version = contribution_version + 1, updated_at_utc = ?
    WHERE status <> 'archived' AND anchor_id IN (SELECT anchor_id FROM chess_anchor
      WHERE coalesce(owner_item_id, item_id) = ?)`,
    )
    .run(occurredAt, request.itemId.value);
  const updated = database
    .prepare(
      `UPDATE inventory_item SET lifecycle = 'trashed', updated_at_utc = ?
    WHERE item_id = ? AND current_revision_id = ? AND lifecycle = 'active'`,
    )
    .run(
      occurredAt,
      request.itemId.value,
      request.expectedCurrentRevisionId.value,
    );
  if (updated.changes !== 1) throw inventoryDeletionConflict();
  return Object.freeze({
    itemId: request.itemId,
    dataRevision: incrementDataRevision(database, occurredAt),
  });
}
