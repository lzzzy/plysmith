import type Database from 'better-sqlite3';

import {
  revisionImpactConflict,
  type InventoryItemUsageSummary,
} from '../../../../application/inventory/index.ts';

export function readInventoryItemUsage(
  database: Database.Database,
  request: {
    readonly itemId: number;
    readonly contextId: number | null;
    readonly impactId?: number;
  },
): InventoryItemUsageSummary {
  const { itemId, contextId } = request;
  const impactId = request.impactId ?? null;
  const notes = database
    .prepare(
      `
    SELECT count(*) AS activeNoteCount,
           coalesce(sum((SELECT count(*) FROM workspace_analysis_note_path_step AS step
                          WHERE step.contribution_id = contribution.contribution_id)), 0) AS noteMoveCount
      FROM workspace_contribution AS contribution
      JOIN chess_anchor AS anchor ON anchor.anchor_id = contribution.anchor_id
     WHERE contribution.status <> 'archived' AND contribution.contribution_type = 'note'
       AND contribution.context_id IS ?
       AND coalesce(anchor.owner_item_id, anchor.item_id) = ?
       AND (? IS NULL OR EXISTS (SELECT 1 FROM workspace_revision_impact_entry AS entry
              WHERE entry.impact_id = ? AND entry.entry_kind = 'contribution'
                AND entry.subject_id = contribution.contribution_id))
  `,
    )
    .get(contextId, itemId, impactId, impactId) as {
    activeNoteCount: number;
    noteMoveCount: number;
  };
  const references = database
    .prepare(
      `
    SELECT count(*) AS count FROM workspace_context_reference AS reference
     WHERE context_id = ? AND item_id = ?
       AND (? IS NULL OR EXISTS (SELECT 1 FROM workspace_revision_impact_entry AS entry
              WHERE entry.impact_id = ? AND entry.entry_kind = 'reference'
                AND entry.subject_id = reference.reference_id))
  `,
    )
    .get(contextId, itemId, impactId, impactId) as { count: number };
  const management = database
    .prepare(
      `
    SELECT 1 FROM workspace_management_resume AS resume
     WHERE context_id IS ? AND selected_item_id = ?
       AND (? IS NULL OR EXISTS (SELECT 1 FROM workspace_revision_impact_entry AS entry
              WHERE entry.impact_id = ? AND entry.entry_kind = 'management_resume'
                AND entry.subject_id = resume.context_id))
  `,
    )
    .get(contextId, itemId, impactId, impactId);
  const analysis = database
    .prepare(
      `
    SELECT 1 FROM workspace_analysis_resume AS resume
     WHERE context_id IS ? AND item_id = ?
       AND (? IS NULL OR EXISTS (SELECT 1 FROM workspace_revision_impact_entry AS entry
              WHERE entry.impact_id = ? AND entry.entry_kind = 'analysis_resume'
                AND entry.subject_id = resume.context_id))
  `,
    )
    .get(contextId, itemId, impactId, impactId);
  const scratch = database
    .prepare(
      `
    SELECT count(*) AS scratchCount,
           coalesce(sum((SELECT count(*) FROM analysis_scratch_step AS step
                          WHERE step.scratch_draft_id = scratch.scratch_draft_id)), 0) AS scratchMoveCount,
           coalesce(sum(CASE WHEN length(trim(coalesce(scratch.note_body, ''))) > 0 THEN 1 ELSE 0 END), 0) AS scratchNoteCount
      FROM analysis_scratch_draft AS scratch
     WHERE scratch.context_id IS ? AND (scratch.origin_item_id = ? OR scratch.edit_item_id = ?)
       AND (? IS NULL OR EXISTS (
         SELECT 1 FROM workspace_analysis_resume AS resume
         JOIN workspace_revision_impact_entry AS entry ON entry.subject_id = resume.context_id
          AND entry.entry_kind = 'analysis_resume' AND entry.impact_id = ?
        WHERE resume.context_id = scratch.context_id AND resume.analysis_scratch_draft_id = scratch.scratch_draft_id))
  `,
    )
    .get(contextId, itemId, itemId, impactId, impactId) as {
    scratchCount: number;
    scratchMoveCount: number;
    scratchNoteCount: number;
  };
  return Object.freeze({
    ...notes,
    ...scratch,
    referenceCount: references.count,
    managementResumeAffected: management !== undefined,
    analysisResumeAffected: analysis !== undefined,
  });
}

export function assertNoOpenRevisionImpact(
  database: Database.Database,
  contextId: number,
  itemId?: number,
): void {
  const impact = database
    .prepare(
      `SELECT 1
         FROM workspace_pending_revision_impact
        WHERE context_id = ? AND (? IS NULL OR item_id = ?)
        LIMIT 1`,
    )
    .get(contextId, itemId ?? null, itemId ?? null);
  if (impact !== undefined) throw revisionImpactConflict();
}

export function releaseObsoleteResumeImpact(
  database: Database.Database,
  contextId: number,
  entryKind: 'management_resume' | 'analysis_resume',
): void {
  const impacts = database
    .prepare(
      `SELECT impact.impact_id AS impactId,
              impact.item_id AS itemId,
              impact.pinned_revision_id AS pinnedRevisionId
         FROM workspace_pending_revision_impact AS impact
         JOIN workspace_revision_impact_entry AS entry
           ON entry.impact_id = impact.impact_id
        WHERE impact.context_id = ? AND entry.entry_kind = ?
          AND entry.subject_id = ?`,
    )
    .all(contextId, entryKind, contextId) as {
    impactId: number;
    itemId: number;
    pinnedRevisionId: number;
  }[];
  for (const impact of impacts) {
    database
      .prepare(
        `DELETE FROM workspace_revision_impact_entry
          WHERE impact_id = ? AND entry_kind = ? AND subject_id = ?`,
      )
      .run(impact.impactId, entryKind, contextId);
    const remaining = database
      .prepare(
        `SELECT 1 FROM workspace_revision_impact_entry
          WHERE impact_id = ? LIMIT 1`,
      )
      .get(impact.impactId);
    if (remaining !== undefined) continue;
    const unpinned = database
      .prepare(
        `UPDATE workspace_context_item
            SET pinned_revision_id = NULL, pin_reason = NULL,
                relationship_version = relationship_version + 1
          WHERE context_id = ? AND item_id = ?
            AND pinned_revision_id = ?
            AND pin_reason = 'pending_revision_impact'`,
      )
      .run(contextId, impact.itemId, impact.pinnedRevisionId);
    if (unpinned.changes !== 1) throw revisionImpactConflict();
    const deleted = database
      .prepare(
        `DELETE FROM workspace_pending_revision_impact
          WHERE impact_id = ? AND context_id = ? AND item_id = ?`,
      )
      .run(impact.impactId, contextId, impact.itemId);
    if (deleted.changes !== 1) throw revisionImpactConflict();
  }
}
