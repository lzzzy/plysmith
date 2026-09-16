import type Database from 'better-sqlite3';

import { revisionImpactConflict } from '../../../../application/inventory/index.ts';

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
