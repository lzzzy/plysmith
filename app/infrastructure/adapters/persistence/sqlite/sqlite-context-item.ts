import type Database from 'better-sqlite3';

import { deleteContextScratch } from './sqlite-context-scratch.ts';

export function removeContextItemUsage(
  database: Database.Database,
  request: {
    readonly contextId: number;
    readonly itemId: number;
    readonly occurredAt: string;
    readonly currentPositionId?: number;
  },
): void {
  database
    .prepare(
      `DELETE FROM workspace_context_reference
        WHERE context_id = ? AND item_id = ?`,
    )
    .run(request.contextId, request.itemId);

  const contributions = database
    .prepare(
      `SELECT contribution.contribution_id AS contributionId
         FROM workspace_contribution AS contribution
         JOIN chess_anchor AS anchor
           ON anchor.anchor_id = contribution.anchor_id
        WHERE contribution.scope_kind = 'context'
          AND contribution.context_id = ? AND contribution.status = 'active'
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
        WHERE context_id = ? AND selected_item_id = ?`,
    )
    .run(request.occurredAt, request.contextId, request.itemId);

  const analysis = database
    .prepare(
      `SELECT analysis_scratch_draft_id AS scratchId
         FROM workspace_analysis_resume
        WHERE context_id = ? AND item_id = ?`,
    )
    .get(request.contextId, request.itemId) as
    { readonly scratchId: number | null } | undefined;
  if (analysis === undefined) return;

  database
    .prepare(
      `UPDATE workspace_analysis_resume
          SET resume_version = resume_version + 1,
              item_id = NULL, revision_id = NULL, anchor_id = NULL,
              mode = 'analyze', current_position_id = coalesce(?, current_position_id),
              analysis_scratch_draft_id = NULL, updated_at_utc = ?
        WHERE context_id = ? AND item_id = ?`,
    )
    .run(
      request.currentPositionId ?? null,
      request.occurredAt,
      request.contextId,
      request.itemId,
    );
  if (analysis.scratchId !== null) {
    deleteContextScratch(database, request.contextId);
  }
}
