import type Database from 'better-sqlite3';
import { assertInventoryWorkAccess } from '../../../../application/workspace/inventory-work-access.ts';
import { workingContextNotFound } from '../../../../application/workspace/workspace-problems.ts';
import { inventoryItemNotFound } from '../../../../application/inventory/inventory-problems.ts';
import type { InventoryItemId } from '../../../../domain/identity/index.ts';
import type { WorkScope } from '../../../../domain/workspace/index.ts';

import { deleteContextScratch } from './sqlite-context-scratch.ts';

export function requireContextInventoryWorkAccess(
  database: Database.Database,
  scope: WorkScope,
  itemId?: InventoryItemId,
): void {
  if (
    itemId !== undefined &&
    database
      .prepare(
        "SELECT 1 FROM inventory_item WHERE item_id = ? AND lifecycle = 'active' AND current_revision_id IS NOT NULL",
      )
      .get(itemId.value) === undefined
  ) {
    throw inventoryItemNotFound();
  }
  if (scope.kind === 'free') return;
  const context = database
    .prepare(
      `SELECT 1 FROM workspace_working_context
      WHERE context_id = ? AND lifecycle = 'active'`,
    )
    .get(scope.contextId.value);
  if (context === undefined) throw workingContextNotFound();
  if (itemId === undefined) return;
  const member = database
    .prepare(
      `SELECT 1 FROM workspace_context_item WHERE context_id = ? AND item_id = ?`,
    )
    .get(scope.contextId.value, itemId.value);
  assertInventoryWorkAccess(scope, member !== undefined);
}

export function removeContextItemUsage(
  database: Database.Database,
  request: {
    readonly contextId: number | null;
    readonly itemId: number;
    readonly occurredAt: string;
    readonly currentPositionId?: number;
  },
): void {
  database
    .prepare(
      `UPDATE playout_completion_receipt SET context_reference_id = NULL
    WHERE context_reference_id IN (SELECT reference_id FROM workspace_context_reference WHERE context_id IS ? AND item_id = ?)`,
    )
    .run(request.contextId, request.itemId);
  database
    .prepare(
      `DELETE FROM workspace_context_reference
        WHERE context_id IS ? AND item_id = ?`,
    )
    .run(request.contextId, request.itemId);

  const contributions = database
    .prepare(
      `SELECT contribution.contribution_id AS contributionId
         FROM workspace_contribution AS contribution
         JOIN chess_anchor AS anchor
           ON anchor.anchor_id = contribution.anchor_id
        WHERE contribution.context_id IS ? AND contribution.status <> 'archived'
          AND coalesce(anchor.owner_item_id, anchor.item_id) = ?`,
    )
    .all(request.contextId, request.itemId) as {
    contributionId: number;
  }[];
  for (const contribution of contributions) {
    database
      .prepare('DELETE FROM search_document WHERE contribution_id = ?')
      .run(contribution.contributionId);
    database
      .prepare(
        `UPDATE workspace_contribution
            SET status = 'archived',
                contribution_version = contribution_version + 1,
                updated_at_utc = ?
          WHERE contribution_id = ?`,
      )
      .run(request.occurredAt, contribution.contributionId);
  }

  database
    .prepare(
      `UPDATE workspace_management_resume
          SET resume_version = resume_version + 1,
              selected_item_id = NULL, selected_anchor_id = NULL,
              updated_at_utc = ?
        WHERE context_id IS ? AND selected_item_id = ?`,
    )
    .run(request.occurredAt, request.contextId, request.itemId);

  const scratch = database
    .prepare(
      `SELECT scratch_draft_id AS scratchId FROM analysis_scratch_draft WHERE context_id IS ? AND (origin_item_id = ? OR edit_item_id = ?)`,
    )
    .get(request.contextId, request.itemId, request.itemId) as
    { scratchId: number } | undefined;
  const analysis = database
    .prepare(
      `SELECT analysis_scratch_draft_id AS scratchId
         FROM workspace_analysis_resume
        WHERE context_id IS ? AND (item_id = ? OR analysis_scratch_draft_id = ?)`,
    )
    .get(request.contextId, request.itemId, scratch?.scratchId ?? null) as
    { readonly scratchId: number | null } | undefined;
  if (analysis !== undefined)
    database
      .prepare(
        `UPDATE workspace_analysis_resume
          SET resume_version = resume_version + 1,
              item_id = NULL, revision_id = NULL, anchor_id = NULL,
              mode = 'analyze', current_position_id = coalesce(?, current_position_id),
              analysis_scratch_draft_id = NULL, updated_at_utc = ?
        WHERE context_id IS ? AND (item_id = ? OR analysis_scratch_draft_id = ?)`,
      )
      .run(
        request.currentPositionId ?? null,
        request.occurredAt,
        request.contextId,
        request.itemId,
        scratch?.scratchId ?? null,
      );
  if (scratch !== undefined) {
    deleteContextScratch(database, request.contextId);
  }
}
