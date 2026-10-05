import type Database from 'better-sqlite3';

import {
  invalidRevisionImpactResolution,
  inventoryDisplayNameConflict,
  revisionImpactConflict,
  revisionImpactNotFound,
  type InventoryRevisionContextImpactSummary,
  type InventoryRevisionFollowingContextSummary,
  type PendingRevisionImpact,
  type ResolvePendingRevisionImpactRequest,
  type ResolvePendingRevisionImpactResult,
} from '../../../../application/inventory/index.ts';
import {
  localId,
  type AnchorId,
  type InventoryItemId,
  type ItemRevisionId,
  type RevisionImpactId,
  type WorkingContextId,
} from '../../../../domain/identity/index.ts';
import { analysisContentFingerprint } from './sqlite-analysis-content-fingerprint.ts';
import { readAnalysisRecordView } from './sqlite-analysis-record.ts';
import {
  readContextScratch,
  readScratchHasChanges,
} from './sqlite-analysis-scratch-state.ts';
import { deleteContextScratch } from './sqlite-context-scratch.ts';
import { inventoryDisplayNameIsAvailable } from './sqlite-inventory-display-name.ts';
import { creationFolder } from './sqlite-inventory-organization.ts';
import { removeContextItemUsage } from './sqlite-context-item.ts';
import { readInventoryItemUsage } from './sqlite-revision-impact-state.ts';
import {
  incrementDataRevision,
  readDataRevision,
} from './sqlite-store-helpers.ts';
import { resolveAnchorPosition } from './sqlite-workspace.ts';

export type RevisionImpactEntryDraftKind =
  'reference' | 'contribution' | 'management_resume' | 'analysis_resume';

export interface RevisionImpactEntryDraft {
  readonly kind: RevisionImpactEntryDraftKind;
  readonly subjectId: number;
  readonly oldAnchorId: number;
}

export interface RevisionImpactContextDraft {
  readonly contextId: WorkingContextId;
  readonly contextName: string;
  readonly entries: readonly RevisionImpactEntryDraft[];
}

export interface RevisionImpactInspection {
  readonly historicalGlobalContributionCount: number;
  readonly affectedContexts: readonly InventoryRevisionContextImpactSummary[];
  readonly followingContexts: readonly InventoryRevisionFollowingContextSummary[];
  readonly contexts: readonly RevisionImpactContextDraft[];
  readonly automaticContexts: readonly RevisionImpactContextDraft[];
  readonly fingerprintValue: unknown;
}

export function inspectRevisionImpact(
  database: Database.Database,
  request: {
    readonly itemId: InventoryItemId;
    readonly removedAnchorIds: ReadonlySet<number>;
    readonly publishingScratch?: {
      readonly contextId: WorkingContextId;
      readonly scratchId: string;
    };
  },
): RevisionImpactInspection {
  const removed = [...request.removedAnchorIds];
  const dependencies: {
    kind: RevisionImpactEntryDraftKind | 'global_contribution';
    contextId: number | null;
    contextName: string | null;
    subjectId: number;
    oldAnchorId: number;
    version: number;
  }[] = [];

  if (removed.length > 0) {
    const placeholders = removed.map(() => '?').join(', ');
    const references = database
      .prepare(
        `SELECT 'reference' AS kind, reference.context_id AS contextId,
              context.display_name AS contextName,
              reference.reference_id AS subjectId,
              reference.anchor_id AS oldAnchorId,
              item.relationship_version AS version
         FROM workspace_context_reference AS reference
         JOIN workspace_context_item AS item
           ON item.context_id = reference.context_id
          AND item.item_id = reference.item_id
         JOIN workspace_working_context AS context
           ON context.context_id = reference.context_id
        WHERE reference.item_id = ?
          AND reference.anchor_id IN (${placeholders})`,
      )
      .all(request.itemId.value, ...removed) as typeof dependencies;
    dependencies.push(...references);

    const contributions = database
      .prepare(
        `SELECT CASE contribution.scope_kind
                WHEN 'global' THEN 'global_contribution'
                ELSE 'contribution'
              END AS kind,
              contribution.context_id AS contextId,
              context.display_name AS contextName,
              contribution.contribution_id AS subjectId,
              contribution.anchor_id AS oldAnchorId,
              contribution.contribution_version AS version
         FROM workspace_contribution AS contribution
         JOIN chess_anchor AS anchor
           ON anchor.anchor_id = contribution.anchor_id
         LEFT JOIN workspace_working_context AS context
           ON context.context_id = contribution.context_id
        WHERE contribution.status = 'active'
          AND coalesce(anchor.owner_item_id, anchor.item_id) = ?
          AND contribution.anchor_id IN (${placeholders})`,
      )
      .all(request.itemId.value, ...removed) as typeof dependencies;
    dependencies.push(...contributions);

    const managementResumes = database
      .prepare(
        `SELECT 'management_resume' AS kind, resume.context_id AS contextId,
              context.display_name AS contextName,
              resume.context_id AS subjectId,
              resume.selected_anchor_id AS oldAnchorId,
              resume.resume_version AS version
         FROM workspace_management_resume AS resume
         JOIN workspace_working_context AS context
           ON context.context_id = resume.context_id
        WHERE resume.selected_item_id = ?
          AND resume.selected_anchor_id IN (${placeholders})`,
      )
      .all(request.itemId.value, ...removed) as typeof dependencies;
    dependencies.push(...managementResumes);

    const analysisResumes = database
      .prepare(
        `SELECT 'analysis_resume' AS kind, resume.context_id AS contextId,
              context.display_name AS contextName,
              resume.context_id AS subjectId,
              resume.anchor_id AS oldAnchorId,
              resume.resume_version AS version
         FROM workspace_analysis_resume AS resume
         JOIN workspace_working_context AS context
           ON context.context_id = resume.context_id
        WHERE resume.item_id = ?
          AND resume.anchor_id IN (${placeholders})`,
      )
      .all(request.itemId.value, ...removed) as typeof dependencies;
    dependencies.push(...analysisResumes);
  }

  const competingRevisionScratches = database
    .prepare(
      `SELECT 'analysis_resume' AS kind, scratch.context_id AS contextId,
              context.display_name AS contextName,
              resume.context_id AS subjectId,
              resume.anchor_id AS oldAnchorId,
              resume.resume_version AS version,
              scratch.scratch_key AS scratchKey
         FROM analysis_scratch_draft AS scratch
         JOIN workspace_analysis_resume AS resume
           ON resume.context_id = scratch.context_id
          AND resume.analysis_scratch_draft_id = scratch.scratch_draft_id
         JOIN workspace_working_context AS context
           ON context.context_id = scratch.context_id
        WHERE scratch.scratch_mode = 'inventory_revision'
          AND scratch.edit_item_id = ?`,
    )
    .all(request.itemId.value) as ((typeof dependencies)[number] & {
    scratchKey: string;
  })[];
  for (const dependency of competingRevisionScratches) {
    if (
      request.publishingScratch?.contextId.value === dependency.contextId &&
      request.publishingScratch.scratchId === dependency.scratchKey
    ) {
      continue;
    }
    if (
      dependencies.some(
        (current) =>
          current.kind === dependency.kind &&
          current.contextId === dependency.contextId &&
          current.subjectId === dependency.subjectId,
      )
    ) {
      continue;
    }
    dependencies.push(dependency);
  }

  dependencies.sort((left, right) =>
    `${left.kind}:${left.contextId ?? 0}:${left.subjectId}`.localeCompare(
      `${right.kind}:${right.contextId ?? 0}:${right.subjectId}`,
    ),
  );
  const contextRows = new Map<
    number,
    { contextName: string; entries: RevisionImpactEntryDraft[] }
  >();
  for (const dependency of dependencies) {
    if (
      dependency.kind === 'global_contribution' ||
      dependency.contextId === null ||
      dependency.contextName === null
    ) {
      continue;
    }
    const current = contextRows.get(dependency.contextId) ?? {
      contextName: dependency.contextName,
      entries: [],
    };
    current.entries.push({
      kind: dependency.kind,
      subjectId: dependency.subjectId,
      oldAnchorId: dependency.oldAnchorId,
    });
    contextRows.set(dependency.contextId, current);
  }
  const dependencyContexts = Object.freeze(
    [...contextRows]
      .sort(([left], [right]) => left - right)
      .map(([contextId, value]) =>
        Object.freeze({
          contextId: localId('working-context', contextId),
          contextName: value.contextName,
          entries: Object.freeze(value.entries),
        }),
      ),
  );
  const existingImpacts = database
    .prepare(
      `SELECT impact.context_id AS contextId,
              impact.impact_id AS impactId,
              impact.impact_version AS impactVersion,
              impact.pinned_revision_id AS pinnedRevisionId,
              impact.target_revision_id AS targetRevisionId,
              impact.target_anchor_id AS targetAnchorId,
              context.display_name AS contextName,
              sum(CASE entry.entry_kind WHEN 'reference' THEN 1 ELSE 0 END) AS referenceCount,
              sum(CASE entry.entry_kind WHEN 'contribution' THEN 1 ELSE 0 END) AS contributionCount,
              sum(CASE entry.entry_kind WHEN 'management_resume' THEN 1 ELSE 0 END) AS managementResumeCount,
              sum(CASE entry.entry_kind WHEN 'analysis_resume' THEN 1 ELSE 0 END) AS analysisResumeCount
         FROM workspace_pending_revision_impact AS impact
         JOIN workspace_working_context AS context
           ON context.context_id = impact.context_id
         JOIN workspace_revision_impact_entry AS entry
           ON entry.impact_id = impact.impact_id
        WHERE impact.item_id = ?
        GROUP BY impact.impact_id, context.display_name
        ORDER BY impact.context_id`,
    )
    .all(request.itemId.value) as {
    contextId: number;
    impactId: number;
    impactVersion: number;
    pinnedRevisionId: number;
    targetRevisionId: number;
    targetAnchorId: number;
    contextName: string;
    referenceCount: number;
    contributionCount: number;
    managementResumeCount: number;
    analysisResumeCount: number;
  }[];
  const affectedContexts = new Map<
    number,
    InventoryRevisionContextImpactSummary
  >();
  const contextMemberships = database
    .prepare(
      `SELECT item.context_id AS contextId, context.display_name AS contextName,
              context.lifecycle AS lifecycle,
              item.pinned_revision_id AS pinnedRevisionId,
              item.pin_reason AS pinReason
         FROM workspace_context_item AS item
         JOIN workspace_working_context AS context
           ON context.context_id = item.context_id
        WHERE item.item_id = ?
        ORDER BY item.context_id`,
    )
    .all(request.itemId.value) as {
    contextId: number;
    contextName: string;
    lifecycle: string;
    pinnedRevisionId: number | null;
    pinReason: string | null;
  }[];
  const activeContexts = contextMemberships.filter(
    (context) => context.lifecycle === 'active',
  );
  // Unassigned metadata drafts remain stale drafts, never membership pins.
  const memberContextIds = new Set(
    contextMemberships.map((context) => context.contextId),
  );
  const memberDependencies = dependencyContexts.filter((context) =>
    memberContextIds.has(context.contextId.value),
  );
  const automaticContextIds = new Set<number>();
  if (request.publishingScratch !== undefined) {
    automaticContextIds.add(request.publishingScratch.contextId.value);
  }
  if (activeContexts.length === 1 && activeContexts[0] !== undefined) {
    automaticContextIds.add(activeContexts[0].contextId);
  }
  for (const existing of existingImpacts) {
    automaticContextIds.delete(existing.contextId);
  }
  const automaticContexts = Object.freeze(
    memberDependencies.filter((context) =>
      automaticContextIds.has(context.contextId.value),
    ),
  );
  const automaticContextById = new Map(
    automaticContexts.map((context) => [context.contextId.value, context]),
  );
  const contexts = Object.freeze(
    memberDependencies.filter(
      (context) => !automaticContextIds.has(context.contextId.value),
    ),
  );
  for (const context of contexts) {
    affectedContexts.set(
      context.contextId.value,
      Object.freeze({
        contextId: context.contextId,
        contextName: context.contextName,
        referenceCount: countEntries(context.entries, 'reference'),
        contributionCount: countEntries(context.entries, 'contribution'),
        managementResumeCount: countEntries(
          context.entries,
          'management_resume',
        ),
        analysisResumeCount: countEntries(context.entries, 'analysis_resume'),
      }),
    );
  }
  for (const context of existingImpacts) {
    if (affectedContexts.has(context.contextId)) continue;
    affectedContexts.set(
      context.contextId,
      Object.freeze({
        contextId: localId('working-context', context.contextId),
        contextName: context.contextName,
        referenceCount: context.referenceCount,
        contributionCount: context.contributionCount,
        managementResumeCount: context.managementResumeCount,
        analysisResumeCount: context.analysisResumeCount,
      }),
    );
  }
  return Object.freeze({
    historicalGlobalContributionCount: dependencies.filter(
      (dependency) => dependency.kind === 'global_contribution',
    ).length,
    affectedContexts: Object.freeze(
      [...affectedContexts.values()].sort(
        (left, right) => left.contextId.value - right.contextId.value,
      ),
    ),
    followingContexts: Object.freeze(
      activeContexts
        .filter((context) => !affectedContexts.has(context.contextId))
        .map((context) => {
          const automatic = automaticContextById.get(context.contextId);
          // Publishing consumes its own draft; only automatic resume replacement loses work.
          const losesScratch =
            request.publishingScratch?.contextId.value !== context.contextId &&
            automatic?.entries.some(
              (entry) => entry.kind === 'analysis_resume',
            );
          return Object.freeze({
            contextId: localId('working-context', context.contextId),
            contextName: context.contextName,
            updatedAutomatically: automatic !== undefined,
            referenceCount:
              automatic === undefined
                ? 0
                : countEntries(automatic.entries, 'reference'),
            contributionCount:
              automatic === undefined
                ? 0
                : countEntries(automatic.entries, 'contribution'),
            changedScratchCount: losesScratch
              ? Number(
                  readScratchHasChanges(
                    database,
                    readContextScratch(
                      database,
                      localId('working-context', context.contextId),
                    ),
                  ),
                )
              : 0,
            managementResumeCount:
              automatic === undefined
                ? 0
                : countEntries(automatic.entries, 'management_resume'),
            analysisResumeCount:
              automatic === undefined
                ? 0
                : countEntries(automatic.entries, 'analysis_resume'),
          });
        }),
    ),
    contexts,
    automaticContexts,
    fingerprintValue: Object.freeze({
      dependencies: Object.freeze(dependencies.map(Object.freeze)),
      contextMemberships: Object.freeze(contextMemberships.map(Object.freeze)),
      existingImpacts: Object.freeze(existingImpacts.map(Object.freeze)),
    }),
  });
}

export function applyAutomaticRevisionFollow(
  database: Database.Database,
  request: {
    readonly itemId: InventoryItemId;
    readonly targetRevisionId: ItemRevisionId;
    readonly targetAnchorId: AnchorId;
    readonly contexts: readonly RevisionImpactContextDraft[];
    readonly publishingContextId?: WorkingContextId;
    readonly occurredAt: string;
  },
): void {
  const targetPositionId = resolveAnchorPosition(
    database,
    request.itemId.value,
    request.targetRevisionId.value,
    request.targetAnchorId.value,
  );
  if (targetPositionId === undefined) throw revisionImpactConflict();
  for (const context of request.contexts) {
    useTargetEntries(database, {
      contextId: context.contextId,
      itemId: request.itemId,
      targetRevisionId: request.targetRevisionId,
      targetAnchorId: request.targetAnchorId,
      targetPositionId,
      entries: context.entries.filter(
        (entry) =>
          entry.kind !== 'analysis_resume' ||
          request.publishingContextId?.value !== context.contextId.value,
      ),
      occurredAt: request.occurredAt,
    });
  }
}

export function persistRevisionImpacts(
  database: Database.Database,
  request: {
    readonly itemId: InventoryItemId;
    readonly pinnedRevisionId: ItemRevisionId;
    readonly targetRevisionId: ItemRevisionId;
    readonly targetAnchorId: AnchorId;
    readonly inspection: RevisionImpactInspection;
    readonly occurredAt: string;
  },
): readonly {
  readonly impactId: RevisionImpactId;
  readonly contextId: WorkingContextId;
}[] {
  const changed: {
    impactId: RevisionImpactId;
    contextId: WorkingContextId;
  }[] = [];
  const existing = database
    .prepare(
      `SELECT impact_id AS impactId, context_id AS contextId,
              impact_version AS impactVersion
         FROM workspace_pending_revision_impact
        WHERE item_id = ?`,
    )
    .all(request.itemId.value) as {
    impactId: number;
    contextId: number;
    impactVersion: number;
  }[];
  const insertEntry = database.prepare(
    `INSERT OR IGNORE INTO workspace_revision_impact_entry
       (impact_id, entry_kind, subject_id, old_anchor_id)
     VALUES (?, ?, ?, ?)`,
  );
  for (const impact of existing) {
    database
      .prepare(
        `UPDATE workspace_pending_revision_impact
            SET target_revision_id = ?, target_anchor_id = ?,
                impact_version = ?, updated_at_utc = ?
          WHERE impact_id = ?`,
      )
      .run(
        request.targetRevisionId.value,
        request.targetAnchorId.value,
        impact.impactVersion + 1,
        request.occurredAt,
        impact.impactId,
      );
    const context = request.inspection.contexts.find(
      (candidate) => candidate.contextId.value === impact.contextId,
    );
    for (const entry of context?.entries ?? []) {
      insertEntry.run(
        impact.impactId,
        entry.kind,
        entry.subjectId,
        entry.oldAnchorId,
      );
    }
    changed.push({
      impactId: localId('revision-impact', impact.impactId),
      contextId: localId('working-context', impact.contextId),
    });
  }

  const existingContexts = new Set(existing.map((impact) => impact.contextId));
  for (const context of request.inspection.contexts) {
    if (existingContexts.has(context.contextId.value)) continue;
    const pinned = database
      .prepare(
        `UPDATE workspace_context_item
            SET pinned_revision_id = ?, pin_reason = 'pending_revision_impact',
                relationship_version = relationship_version + 1
          WHERE context_id = ? AND item_id = ? AND pinned_revision_id IS NULL`,
      )
      .run(
        request.pinnedRevisionId.value,
        context.contextId.value,
        request.itemId.value,
      );
    if (pinned.changes !== 1) throw revisionImpactConflict();
    const inserted = database
      .prepare(
        `INSERT INTO workspace_pending_revision_impact
           (context_id, item_id, pinned_revision_id, target_revision_id,
            target_anchor_id, impact_version, created_at_utc, updated_at_utc)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        context.contextId.value,
        request.itemId.value,
        request.pinnedRevisionId.value,
        request.targetRevisionId.value,
        request.targetAnchorId.value,
        request.occurredAt,
        request.occurredAt,
      );
    const impactId = Number(inserted.lastInsertRowid);
    for (const entry of context.entries) {
      insertEntry.run(impactId, entry.kind, entry.subjectId, entry.oldAnchorId);
    }
    changed.push({
      impactId: localId('revision-impact', impactId),
      contextId: context.contextId,
    });
  }
  return Object.freeze(changed.map((entry) => Object.freeze(entry)));
}

export function readPendingRevisionImpact(
  database: Database.Database,
  impactId: RevisionImpactId,
): PendingRevisionImpact | undefined {
  const row = database
    .prepare(
      `SELECT impact.impact_id AS impactId, impact.context_id AS contextId,
              context.display_name AS contextName, impact.item_id AS itemId,
              impact.pinned_revision_id AS pinnedRevisionId,
              impact.target_revision_id AS targetRevisionId,
              impact.target_anchor_id AS targetAnchorId,
              impact.impact_version AS impactVersion,
              sum(CASE entry.entry_kind WHEN 'reference' THEN 1 ELSE 0 END) AS referenceCount,
              sum(CASE entry.entry_kind WHEN 'contribution' THEN 1 ELSE 0 END) AS contributionCount,
              max(CASE entry.entry_kind WHEN 'management_resume' THEN 1 ELSE 0 END) AS managementResumeAffected,
              max(CASE entry.entry_kind WHEN 'analysis_resume' THEN 1 ELSE 0 END) AS analysisResumeAffected,
              impact.created_at_utc AS createdAt,
              impact.updated_at_utc AS updatedAt
         FROM workspace_pending_revision_impact AS impact
         JOIN workspace_working_context AS context
           ON context.context_id = impact.context_id
         JOIN workspace_revision_impact_entry AS entry
           ON entry.impact_id = impact.impact_id
        WHERE impact.impact_id = ?
        GROUP BY impact.impact_id, impact.context_id, context.display_name,
                 impact.item_id, impact.pinned_revision_id,
                 impact.target_revision_id, impact.target_anchor_id,
                 impact.impact_version, impact.created_at_utc,
                 impact.updated_at_utc`,
    )
    .get(impactId.value) as
    | {
        impactId: number;
        contextId: number;
        contextName: string;
        itemId: number;
        pinnedRevisionId: number;
        targetRevisionId: number;
        targetAnchorId: number;
        impactVersion: number;
        referenceCount: number;
        contributionCount: number;
        managementResumeAffected: number;
        analysisResumeAffected: number;
        createdAt: string;
        updatedAt: string;
      }
    | undefined;
  if (row === undefined) return undefined;
  return Object.freeze({
    impactId,
    contextId: localId('working-context', row.contextId),
    contextName: row.contextName,
    itemId: localId('inventory-item', row.itemId),
    pinnedRevisionId: localId('item-revision', row.pinnedRevisionId),
    targetRevisionId: localId('item-revision', row.targetRevisionId),
    targetAnchorId: localId('anchor', row.targetAnchorId),
    impactVersion: row.impactVersion,
    dataRevision: readDataRevision(database),
    referenceCount: row.referenceCount,
    contributionCount: row.contributionCount,
    managementResumeAffected: row.managementResumeAffected === 1,
    analysisResumeAffected: row.analysisResumeAffected === 1,
    useTargetLoss: readInventoryItemUsage(database, {
      itemId: row.itemId,
      contextId: row.contextId,
      impactId: impactId.value,
    }),
    removeFromContextLoss: readInventoryItemUsage(database, {
      itemId: row.itemId,
      contextId: row.contextId,
    }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function resolvePendingRevisionImpact(
  database: Database.Database,
  request: ResolvePendingRevisionImpactRequest,
  occurredAt: string,
): ResolvePendingRevisionImpactResult {
  const impact = readPendingRevisionImpact(database, request.impactId);
  if (impact === undefined) throw revisionImpactNotFound();
  if (
    impact.impactVersion !== request.expectedImpactVersion ||
    impact.dataRevision !== request.expectedDataRevision
  ) {
    throw revisionImpactConflict();
  }
  const currentRevision = database
    .prepare(
      `SELECT current_revision_id AS revisionId FROM inventory_item
        WHERE item_id = ? AND lifecycle = 'active'`,
    )
    .get(impact.itemId.value) as { revisionId: number } | undefined;
  if (currentRevision?.revisionId !== impact.targetRevisionId.value) {
    throw revisionImpactConflict();
  }
  const targetPositionId = resolveAnchorPosition(
    database,
    impact.itemId.value,
    impact.targetRevisionId.value,
    impact.targetAnchorId.value,
  );
  if (targetPositionId === undefined) throw revisionImpactConflict();

  let contextItemId: InventoryItemId | undefined;
  let contextRevisionId: ItemRevisionId | undefined;
  if (request.resolution.kind === 'use_target') {
    useTargetRevision(database, impact, targetPositionId, occurredAt);
    rebaseRemainingAnalysisState(database, impact, occurredAt);
    contextItemId = impact.itemId;
    contextRevisionId = impact.targetRevisionId;
  } else if (request.resolution.kind === 'keep_copy') {
    const displayName = request.resolution.displayName.trim();
    if (!inventoryDisplayNameIsAvailable(database, displayName)) {
      throw inventoryDisplayNameConflict();
    }
    const copy = clonePinnedRevision(database, impact, displayName, occurredAt);
    moveContextToCopy(database, impact, copy, occurredAt);
    contextItemId = copy.itemId;
    contextRevisionId = copy.revisionId;
  } else {
    removeItemFromContext(database, impact, occurredAt);
  }

  database
    .prepare('DELETE FROM workspace_revision_impact_entry WHERE impact_id = ?')
    .run(impact.impactId.value);
  const deleted = database
    .prepare(
      `DELETE FROM workspace_pending_revision_impact
        WHERE impact_id = ? AND impact_version = ?`,
    )
    .run(impact.impactId.value, impact.impactVersion);
  if (deleted.changes !== 1) throw revisionImpactConflict();
  finishContextRelationship(database, impact, request.resolution.kind);
  database
    .prepare(
      `UPDATE workspace_working_context SET updated_at_utc = ?
        WHERE context_id = ?`,
    )
    .run(occurredAt, impact.contextId.value);
  return Object.freeze({
    impactId: impact.impactId,
    contextId: impact.contextId,
    itemId: impact.itemId,
    resolution: request.resolution.kind,
    ...(contextItemId === undefined ? {} : { contextItemId }),
    ...(contextRevisionId === undefined ? {} : { contextRevisionId }),
    dataRevision: incrementDataRevision(database, occurredAt),
  });
}

function rebaseRemainingAnalysisState(
  database: Database.Database,
  impact: PendingRevisionImpact,
  occurredAt: string,
): void {
  const state = database
    .prepare(
      `SELECT resume.revision_id AS revisionId, resume.anchor_id AS anchorId,
              resume.analysis_scratch_draft_id AS scratchId,
              scratch.scratch_mode AS scratchMode,
              scratch.origin_item_id AS originItemId,
              scratch.origin_revision_id AS originRevisionId,
              scratch.origin_anchor_id AS originAnchorId
         FROM workspace_analysis_resume AS resume
         LEFT JOIN analysis_scratch_draft AS scratch
           ON scratch.scratch_draft_id = resume.analysis_scratch_draft_id
        WHERE resume.context_id = ? AND resume.item_id = ?`,
    )
    .get(impact.contextId.value, impact.itemId.value) as
    | {
        revisionId: number | null;
        anchorId: number | null;
        scratchId: number | null;
        scratchMode: 'exploration' | 'inventory_revision' | null;
        originItemId: number | null;
        originRevisionId: number | null;
        originAnchorId: number | null;
      }
    | undefined;
  if (
    state === undefined ||
    state.revisionId !== impact.pinnedRevisionId.value ||
    state.anchorId === null
  ) {
    return;
  }
  const positionId = resolveAnchorPosition(
    database,
    impact.itemId.value,
    impact.targetRevisionId.value,
    state.anchorId,
  );
  if (positionId === undefined) throw revisionImpactConflict();
  if (state.scratchMode === 'inventory_revision') {
    throw invalidRevisionImpactResolution();
  }
  if (state.scratchId !== null) {
    const scratchRebased = database
      .prepare(
        `UPDATE analysis_scratch_draft
            SET origin_revision_id = ?, updated_at_utc = ?
          WHERE scratch_draft_id = ? AND scratch_mode = 'exploration'
            AND origin_item_id = ? AND origin_revision_id = ?
            AND origin_anchor_id = ?`,
      )
      .run(
        impact.targetRevisionId.value,
        occurredAt,
        state.scratchId,
        impact.itemId.value,
        impact.pinnedRevisionId.value,
        state.originAnchorId,
      );
    if (scratchRebased.changes !== 1) throw revisionImpactConflict();
  }
  const resumeRebased = database
    .prepare(
      `UPDATE workspace_analysis_resume
          SET revision_id = ?, current_position_id = ?,
              resume_version = resume_version + 1, updated_at_utc = ?
        WHERE context_id = ? AND item_id = ? AND revision_id = ?
          AND anchor_id = ?`,
    )
    .run(
      impact.targetRevisionId.value,
      positionId,
      occurredAt,
      impact.contextId.value,
      impact.itemId.value,
      impact.pinnedRevisionId.value,
      state.anchorId,
    );
  if (resumeRebased.changes !== 1) throw revisionImpactConflict();
}

interface StoredImpactEntry {
  readonly kind: RevisionImpactEntryDraftKind;
  readonly subjectId: number;
  readonly oldAnchorId: number;
}

interface ClonedRevision {
  readonly itemId: InventoryItemId;
  readonly revisionId: ItemRevisionId;
  readonly anchorMap: ReadonlyMap<number, number>;
}

function readImpactEntries(
  database: Database.Database,
  impactId: RevisionImpactId,
): readonly StoredImpactEntry[] {
  return database
    .prepare(
      `SELECT entry_kind AS kind, subject_id AS subjectId,
              old_anchor_id AS oldAnchorId
         FROM workspace_revision_impact_entry
        WHERE impact_id = ? ORDER BY impact_entry_id`,
    )
    .all(impactId.value) as StoredImpactEntry[];
}

function useTargetRevision(
  database: Database.Database,
  impact: PendingRevisionImpact,
  targetPositionId: number,
  occurredAt: string,
): void {
  useTargetEntries(database, {
    contextId: impact.contextId,
    itemId: impact.itemId,
    targetRevisionId: impact.targetRevisionId,
    targetAnchorId: impact.targetAnchorId,
    targetPositionId,
    entries: readImpactEntries(database, impact.impactId),
    occurredAt,
  });
}

function useTargetEntries(
  database: Database.Database,
  request: {
    readonly contextId: WorkingContextId;
    readonly itemId: InventoryItemId;
    readonly targetRevisionId: ItemRevisionId;
    readonly targetAnchorId: AnchorId;
    readonly targetPositionId: number;
    readonly entries: readonly StoredImpactEntry[];
    readonly occurredAt: string;
  },
): void {
  for (const entry of request.entries) {
    if (entry.kind === 'reference') {
      const duplicate = database
        .prepare(
          `SELECT 1 FROM workspace_context_reference
            WHERE context_id = ? AND item_id = ? AND anchor_id = ?
              AND reference_id <> ?`,
        )
        .get(
          request.contextId.value,
          request.itemId.value,
          request.targetAnchorId.value,
          entry.subjectId,
        );
      const result =
        duplicate === undefined
          ? database
              .prepare(
                `UPDATE workspace_context_reference SET anchor_id = ?
                WHERE reference_id = ? AND context_id = ? AND item_id = ?
                  AND anchor_id = ?`,
              )
              .run(
                request.targetAnchorId.value,
                entry.subjectId,
                request.contextId.value,
                request.itemId.value,
                entry.oldAnchorId,
              )
          : database
              .prepare(
                `DELETE FROM workspace_context_reference
                WHERE reference_id = ? AND context_id = ? AND item_id = ?
                  AND anchor_id = ?`,
              )
              .run(
                entry.subjectId,
                request.contextId.value,
                request.itemId.value,
                entry.oldAnchorId,
              );
      if (result.changes !== 1) throw revisionImpactConflict();
      continue;
    }
    if (entry.kind === 'contribution') {
      database
        .prepare('DELETE FROM search_document WHERE contribution_id = ?')
        .run(entry.subjectId);
      const result = database
        .prepare(
          `UPDATE workspace_contribution
              SET status = 'archived',
                  contribution_version = contribution_version + 1,
                  updated_at_utc = ?
            WHERE contribution_id = ? AND context_id = ?
              AND anchor_id = ? AND status = 'active'`,
        )
        .run(
          request.occurredAt,
          entry.subjectId,
          request.contextId.value,
          entry.oldAnchorId,
        );
      if (result.changes !== 1) throw revisionImpactConflict();
      continue;
    }
    if (entry.kind === 'management_resume') {
      const result = database
        .prepare(
          `UPDATE workspace_management_resume
              SET resume_version = resume_version + 1,
                  selected_anchor_id = ?, updated_at_utc = ?
            WHERE context_id = ? AND selected_item_id = ?
              AND selected_anchor_id = ?`,
        )
        .run(
          request.targetAnchorId.value,
          request.occurredAt,
          request.contextId.value,
          request.itemId.value,
          entry.oldAnchorId,
        );
      if (result.changes !== 1) throw revisionImpactConflict();
      continue;
    }
    const state = database
      .prepare(
        `SELECT analysis_scratch_draft_id AS scratchId
           FROM workspace_analysis_resume
          WHERE context_id = ? AND item_id = ? AND anchor_id = ?`,
      )
      .get(request.contextId.value, request.itemId.value, entry.oldAnchorId) as
      { scratchId: number | null } | undefined;
    if (state === undefined) throw revisionImpactConflict();
    const result = database
      .prepare(
        `UPDATE workspace_analysis_resume
            SET resume_version = resume_version + 1,
                revision_id = ?, anchor_id = ?, mode = 'analyze',
                current_position_id = ?, analysis_scratch_draft_id = NULL,
                updated_at_utc = ?
          WHERE context_id = ? AND item_id = ? AND anchor_id = ?`,
      )
      .run(
        request.targetRevisionId.value,
        request.targetAnchorId.value,
        request.targetPositionId,
        request.occurredAt,
        request.contextId.value,
        request.itemId.value,
        entry.oldAnchorId,
      );
    if (result.changes !== 1) throw revisionImpactConflict();
    if (state.scratchId !== null) {
      deleteContextScratch(database, request.contextId.value);
    }
  }
}

function clonePinnedRevision(
  database: Database.Database,
  impact: PendingRevisionImpact,
  displayName: string,
  occurredAt: string,
): ClonedRevision {
  const source = database
    .prepare(
      `SELECT item.origin_kind AS originKind,
              revision.summary_text AS summary,
              revision.language_tag AS languageTag,
              analysis.root_occurrence_id AS rootOccurrenceId,
              analysis.origin_mode AS originMode
         FROM inventory_item AS item
         JOIN item_revision AS revision
           ON revision.item_id = item.item_id
          AND revision.revision_id = ?
         JOIN inventory_chess_revision AS analysis
           ON analysis.item_id = item.item_id
          AND analysis.revision_id = revision.revision_id
        WHERE item.item_id = ? AND item.item_type IN ('analysis', 'game')`,
    )
    .get(impact.pinnedRevisionId.value, impact.itemId.value) as
    | {
        originKind: string;
        summary: string | null;
        languageTag: string;
        rootOccurrenceId: number;
        originMode: string;
      }
    | undefined;
  if (source === undefined) throw revisionImpactConflict();
  const itemInsert = database
    .prepare(
      `INSERT INTO inventory_item
         (item_type, origin_kind, lifecycle, current_revision_id,
          created_at_utc, updated_at_utc, folder_id)
       VALUES ('analysis', ?, 'active', NULL, ?, ?, ?)`,
    )
    .run(
      source.originKind,
      occurredAt,
      occurredAt,
      creationFolder(database, undefined, impact.itemId),
    );
  const itemId = localId('inventory-item', Number(itemInsert.lastInsertRowid));
  const revisionInsert = database
    .prepare(
      `INSERT INTO item_revision
         (item_id, revision_number, base_revision_id, display_name,
          summary_text, language_tag, content_fingerprint, creator_role,
          created_at_utc, revision_change_kind)
       VALUES (?, 1, NULL, ?, ?, ?, ?, 'user', ?, 'created')`,
    )
    .run(
      itemId.value,
      displayName,
      source.summary,
      source.languageTag,
      Buffer.alloc(32),
      occurredAt,
    );
  const revisionId = localId(
    'item-revision',
    Number(revisionInsert.lastInsertRowid),
  );
  const anchorMap = new Map<number, number>();
  const oldItemAnchor = database
    .prepare(
      `SELECT anchor_id AS anchorId FROM chess_anchor
        WHERE anchor_kind = 'item' AND item_id = ?`,
    )
    .get(impact.itemId.value) as { anchorId: number } | undefined;
  if (oldItemAnchor !== undefined) {
    const newItemAnchor = database
      .prepare(
        `INSERT INTO chess_anchor
           (anchor_kind, owner_item_id, item_id, position_id,
            occurrence_id, move_node_id)
         VALUES ('item', NULL, ?, NULL, NULL, NULL)`,
      )
      .run(itemId.value);
    anchorMap.set(
      oldItemAnchor.anchorId,
      Number(newItemAnchor.lastInsertRowid),
    );
  }
  const occurrences = database
    .prepare(
      `SELECT occurrence.occurrence_id AS occurrenceId,
              occurrence.position_id AS positionId,
              occurrence.is_root AS isRoot,
              occurrence.content_fingerprint AS contentFingerprint,
              play.halfmove_clock AS halfmoveClock,
              play.fullmove_number AS fullmoveNumber,
              play.history_knowledge AS historyKnowledge,
              anchor.anchor_id AS anchorId
         FROM chess_occurrence_snapshot AS occurrence
         JOIN chess_play_state_snapshot AS play
           ON play.revision_id = occurrence.revision_id
          AND play.occurrence_id = occurrence.occurrence_id
         JOIN chess_anchor AS anchor
           ON anchor.anchor_kind = 'occurrence'
          AND anchor.owner_item_id = occurrence.item_id
          AND anchor.occurrence_id = occurrence.occurrence_id
        WHERE occurrence.revision_id = ?
        ORDER BY occurrence.occurrence_id`,
    )
    .all(impact.pinnedRevisionId.value) as {
    occurrenceId: number;
    positionId: number;
    isRoot: number;
    contentFingerprint: Buffer;
    halfmoveClock: number;
    fullmoveNumber: number;
    historyKnowledge: string;
    anchorId: number;
  }[];
  const occurrenceMap = new Map<number, number>();
  for (const occurrence of occurrences) {
    const identity = database
      .prepare(
        `INSERT INTO chess_occurrence_identity (item_id, created_revision_id)
         VALUES (?, ?)`,
      )
      .run(itemId.value, revisionId.value);
    const occurrenceId = Number(identity.lastInsertRowid);
    occurrenceMap.set(occurrence.occurrenceId, occurrenceId);
    database
      .prepare(
        `INSERT INTO chess_occurrence_snapshot
           (revision_id, occurrence_id, item_id, position_id, is_root,
            content_fingerprint)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId.value,
        occurrenceId,
        itemId.value,
        occurrence.positionId,
        occurrence.isRoot,
        occurrence.contentFingerprint,
      );
    database
      .prepare(
        `INSERT INTO chess_play_state_snapshot
           (revision_id, occurrence_id, halfmove_clock, fullmove_number,
            history_knowledge)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId.value,
        occurrenceId,
        occurrence.halfmoveClock,
        occurrence.fullmoveNumber,
        occurrence.historyKnowledge,
      );
    const anchor = database
      .prepare(
        `INSERT INTO chess_anchor
           (anchor_kind, owner_item_id, item_id, position_id,
            occurrence_id, move_node_id)
         VALUES ('occurrence', ?, NULL, NULL, ?, NULL)`,
      )
      .run(itemId.value, occurrenceId);
    anchorMap.set(occurrence.anchorId, Number(anchor.lastInsertRowid));
  }
  const moves = database
    .prepare(
      `SELECT move.move_node_id AS moveNodeId,
              move.parent_occurrence_id AS parentOccurrenceId,
              move.child_occurrence_id AS childOccurrenceId,
              move.sibling_order AS siblingOrder,
              move.is_main_line AS isMainLine,
              move.from_square AS fromSquare, move.to_square AS toSquare,
              move.promotion, move.san,
              move.content_fingerprint AS contentFingerprint,
              anchor.anchor_id AS anchorId
         FROM chess_move_node_snapshot AS move
         JOIN chess_anchor AS anchor
           ON anchor.anchor_kind = 'move_node'
          AND anchor.owner_item_id = move.item_id
          AND anchor.move_node_id = move.move_node_id
        WHERE move.revision_id = ?
        ORDER BY move.move_node_id`,
    )
    .all(impact.pinnedRevisionId.value) as {
    moveNodeId: number;
    parentOccurrenceId: number;
    childOccurrenceId: number;
    siblingOrder: number;
    isMainLine: number;
    fromSquare: string;
    toSquare: string;
    promotion: string | null;
    san: string;
    contentFingerprint: Buffer;
    anchorId: number;
  }[];
  for (const move of moves) {
    const parentOccurrenceId = occurrenceMap.get(move.parentOccurrenceId);
    const childOccurrenceId = occurrenceMap.get(move.childOccurrenceId);
    if (parentOccurrenceId === undefined || childOccurrenceId === undefined) {
      throw revisionImpactConflict();
    }
    const identity = database
      .prepare(
        `INSERT INTO chess_move_node_identity (item_id, created_revision_id)
         VALUES (?, ?)`,
      )
      .run(itemId.value, revisionId.value);
    const moveNodeId = Number(identity.lastInsertRowid);
    database
      .prepare(
        `INSERT INTO chess_move_node_snapshot
           (revision_id, move_node_id, item_id, parent_occurrence_id,
            child_occurrence_id, sibling_order, is_main_line,
            from_square, to_square, promotion, san, content_fingerprint)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId.value,
        moveNodeId,
        itemId.value,
        parentOccurrenceId,
        childOccurrenceId,
        move.siblingOrder,
        move.isMainLine,
        move.fromSquare,
        move.toSquare,
        move.promotion,
        move.san,
        move.contentFingerprint,
      );
    const anchor = database
      .prepare(
        `INSERT INTO chess_anchor
           (anchor_kind, owner_item_id, item_id, position_id,
            occurrence_id, move_node_id)
         VALUES ('move_node', ?, NULL, NULL, NULL, ?)`,
      )
      .run(itemId.value, moveNodeId);
    anchorMap.set(move.anchorId, Number(anchor.lastInsertRowid));
  }
  const rootOccurrenceId = occurrenceMap.get(source.rootOccurrenceId);
  if (rootOccurrenceId === undefined) throw revisionImpactConflict();
  database
    .prepare(
      `INSERT INTO inventory_analysis_revision
         (revision_id, item_id, root_occurrence_id, origin_mode)
       VALUES (?, ?, ?, ?)`,
    )
    .run(revisionId.value, itemId.value, rootOccurrenceId, 'inventory_anchor');
  database
    .prepare(
      `INSERT INTO inventory_analysis_origin
         (analysis_revision_id, source_item_id, source_revision_id,
          source_anchor_id)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      revisionId.value,
      impact.itemId.value,
      impact.pinnedRevisionId.value,
      rootAnchorForRevision(database, impact.itemId, impact.pinnedRevisionId),
    );
  const rootAnchorId = mapAnchor(
    database,
    anchorMap,
    rootAnchorForRevision(database, impact.itemId, impact.pinnedRevisionId),
  );
  database
    .prepare(
      `INSERT INTO search_document
         (projection_version, subject_kind, item_id, item_revision_id,
          contribution_id, anchor_id, context_id, language_tag,
          evidence_class, scope_kind, stable_sort_value, title,
          aliases_concepts, metadata, body)
       VALUES (1, 'item_revision', ?, ?, NULL, ?, NULL, ?, 'personal',
               'global', ?, ?, '', 'analysis manual', ?)`,
    )
    .run(
      itemId.value,
      revisionId.value,
      rootAnchorId,
      source.languageTag,
      occurredAt,
      displayName,
      source.summary ?? '',
    );
  database
    .prepare(
      `UPDATE inventory_item SET current_revision_id = ? WHERE item_id = ?`,
    )
    .run(revisionId.value, itemId.value);
  const cloned = readAnalysisRecordView(database, {
    itemId,
    revisionId,
    anchorId: localId('anchor', rootAnchorId),
  });
  if (cloned === undefined) throw revisionImpactConflict();
  database
    .prepare(
      `UPDATE item_revision SET content_fingerprint = ?
        WHERE item_id = ? AND revision_id = ?`,
    )
    .run(
      analysisContentFingerprint({
        displayName: cloned.displayName,
        ...(cloned.summary === undefined ? {} : { summary: cloned.summary }),
        languageTag: cloned.languageTag,
        originMode: cloned.origin.kind,
        root: cloned.root,
        steps: cloned.steps,
      }),
      itemId.value,
      revisionId.value,
    );
  return Object.freeze({ itemId, revisionId, anchorMap });
}

function moveContextToCopy(
  database: Database.Database,
  impact: PendingRevisionImpact,
  copy: ClonedRevision,
  occurredAt: string,
): void {
  database
    .prepare(
      `INSERT INTO workspace_context_item
         (context_id, item_id, relationship_version, created_at_utc)
       VALUES (?, ?, 1, ?)`,
    )
    .run(impact.contextId.value, copy.itemId.value, occurredAt);
  const references = database
    .prepare(
      `SELECT reference_id AS referenceId, anchor_id AS anchorId
         FROM workspace_context_reference
        WHERE context_id = ? AND item_id = ?`,
    )
    .all(impact.contextId.value, impact.itemId.value) as {
    referenceId: number;
    anchorId: number;
  }[];
  for (const reference of references) {
    database
      .prepare(
        `UPDATE workspace_context_reference SET item_id = ?, anchor_id = ?
          WHERE reference_id = ? AND context_id = ? AND item_id = ?`,
      )
      .run(
        copy.itemId.value,
        mapAnchor(database, copy.anchorMap, reference.anchorId),
        reference.referenceId,
        impact.contextId.value,
        impact.itemId.value,
      );
  }
  const contributions = database
    .prepare(
      `SELECT contribution.contribution_id AS contributionId,
              contribution.anchor_id AS anchorId
        FROM workspace_contribution AS contribution
         JOIN chess_anchor AS anchor
           ON anchor.anchor_id = contribution.anchor_id
        WHERE contribution.scope_kind = 'context'
          AND contribution.status = 'active'
          AND contribution.context_id = ?
          AND coalesce(anchor.owner_item_id, anchor.item_id) = ?`,
    )
    .all(impact.contextId.value, impact.itemId.value) as {
    contributionId: number;
    anchorId: number;
  }[];
  for (const contribution of contributions) {
    const anchorId = mapAnchor(database, copy.anchorMap, contribution.anchorId);
    database
      .prepare(
        `UPDATE workspace_contribution SET anchor_id = ?,
                contribution_version = contribution_version + 1,
                updated_at_utc = ?
          WHERE contribution_id = ?`,
      )
      .run(anchorId, occurredAt, contribution.contributionId);
    database
      .prepare(
        `UPDATE search_document SET anchor_id = ?
          WHERE contribution_id = ?`,
      )
      .run(anchorId, contribution.contributionId);
  }
  const management = database
    .prepare(
      `SELECT selected_anchor_id AS anchorId
         FROM workspace_management_resume
        WHERE context_id = ? AND selected_item_id = ?`,
    )
    .get(impact.contextId.value, impact.itemId.value) as
    { anchorId: number | null } | undefined;
  if (management !== undefined) {
    database
      .prepare(
        `UPDATE workspace_management_resume
            SET resume_version = resume_version + 1,
                selected_item_id = ?, selected_anchor_id = ?,
                updated_at_utc = ?
          WHERE context_id = ? AND selected_item_id = ?`,
      )
      .run(
        copy.itemId.value,
        management.anchorId === null
          ? null
          : mapAnchor(database, copy.anchorMap, management.anchorId),
        occurredAt,
        impact.contextId.value,
        impact.itemId.value,
      );
  }
  const analysis = database
    .prepare(
      `SELECT anchor_id AS anchorId,
              analysis_scratch_draft_id AS scratchId
         FROM workspace_analysis_resume
        WHERE context_id = ? AND item_id = ?`,
    )
    .get(impact.contextId.value, impact.itemId.value) as
    { anchorId: number; scratchId: number | null } | undefined;
  if (analysis !== undefined) {
    if (analysis.scratchId !== null) {
      remapContextScratch(
        database,
        impact,
        copy,
        analysis.scratchId,
        occurredAt,
      );
    }
    database
      .prepare(
        `UPDATE workspace_analysis_resume
            SET resume_version = resume_version + 1,
                item_id = ?, revision_id = ?, anchor_id = ?,
                updated_at_utc = ?
          WHERE context_id = ? AND item_id = ?`,
      )
      .run(
        copy.itemId.value,
        copy.revisionId.value,
        mapAnchor(database, copy.anchorMap, analysis.anchorId),
        occurredAt,
        impact.contextId.value,
        impact.itemId.value,
      );
  }
}

function remapContextScratch(
  database: Database.Database,
  impact: PendingRevisionImpact,
  copy: ClonedRevision,
  scratchId: number,
  occurredAt: string,
): void {
  const scratch = database
    .prepare(
      `SELECT scratch_mode AS scratchMode,
              origin_item_id AS originItemId,
              origin_revision_id AS originRevisionId,
              origin_anchor_id AS originAnchorId,
              cut_anchor_id AS cutAnchorId,
              return_anchor_id AS returnAnchorId
         FROM analysis_scratch_draft WHERE scratch_draft_id = ?`,
    )
    .get(scratchId) as
    | {
        scratchMode: 'exploration' | 'inventory_revision';
        originItemId: number | null;
        originRevisionId: number | null;
        originAnchorId: number | null;
        cutAnchorId: number | null;
        returnAnchorId: number | null;
      }
    | undefined;
  if (
    scratch === undefined ||
    scratch.originItemId !== impact.itemId.value ||
    scratch.originRevisionId !== impact.pinnedRevisionId.value ||
    scratch.originAnchorId === null
  ) {
    throw revisionImpactConflict();
  }
  if (scratch.scratchMode === 'exploration') {
    database
      .prepare(
        `UPDATE analysis_scratch_draft
            SET origin_item_id = ?, origin_revision_id = ?,
                origin_anchor_id = ?, updated_at_utc = ?
          WHERE scratch_draft_id = ?`,
      )
      .run(
        copy.itemId.value,
        copy.revisionId.value,
        mapAnchor(database, copy.anchorMap, scratch.originAnchorId),
        occurredAt,
        scratchId,
      );
    return;
  }
  if (scratch.cutAnchorId === null || scratch.returnAnchorId === null) {
    throw revisionImpactConflict();
  }
  database
    .prepare(
      `UPDATE analysis_scratch_draft
          SET origin_item_id = ?, origin_revision_id = ?,
              origin_anchor_id = ?, edit_item_id = ?, base_revision_id = ?,
              cut_anchor_id = ?, return_anchor_id = ?,
              candidate_display_name = ?, updated_at_utc = ?
        WHERE scratch_draft_id = ?`,
    )
    .run(
      copy.itemId.value,
      copy.revisionId.value,
      mapAnchor(database, copy.anchorMap, scratch.originAnchorId),
      copy.itemId.value,
      copy.revisionId.value,
      mapAnchor(database, copy.anchorMap, scratch.cutAnchorId),
      mapAnchor(database, copy.anchorMap, scratch.returnAnchorId),
      currentDisplayName(database, copy.revisionId),
      occurredAt,
      scratchId,
    );
}

function removeItemFromContext(
  database: Database.Database,
  impact: PendingRevisionImpact,
  occurredAt: string,
): void {
  removeContextItemUsage(database, {
    contextId: impact.contextId.value,
    itemId: impact.itemId.value,
    occurredAt,
    currentPositionId: rootPosition(
      database,
      impact.itemId,
      impact.targetRevisionId,
    ),
  });
}

function finishContextRelationship(
  database: Database.Database,
  impact: PendingRevisionImpact,
  resolution: ResolvePendingRevisionImpactRequest['resolution']['kind'],
): void {
  const result =
    resolution === 'use_target'
      ? database
          .prepare(
            `UPDATE workspace_context_item
              SET pinned_revision_id = NULL, pin_reason = NULL,
                  relationship_version = relationship_version + 1
            WHERE context_id = ? AND item_id = ?
              AND pinned_revision_id = ?
              AND pin_reason = 'pending_revision_impact'`,
          )
          .run(
            impact.contextId.value,
            impact.itemId.value,
            impact.pinnedRevisionId.value,
          )
      : database
          .prepare(
            `DELETE FROM workspace_context_item
            WHERE context_id = ? AND item_id = ?
              AND pinned_revision_id = ?
              AND pin_reason = 'pending_revision_impact'`,
          )
          .run(
            impact.contextId.value,
            impact.itemId.value,
            impact.pinnedRevisionId.value,
          );
  if (result.changes !== 1) throw revisionImpactConflict();
}

function mapAnchor(
  database: Database.Database,
  anchorMap: ReadonlyMap<number, number>,
  anchorId: number,
): number {
  const mapped = anchorMap.get(anchorId);
  if (mapped !== undefined) return mapped;
  const position = database
    .prepare(
      `SELECT 1 FROM chess_anchor
        WHERE anchor_id = ? AND anchor_kind = 'position'`,
    )
    .get(anchorId);
  if (position !== undefined) return anchorId;
  throw revisionImpactConflict();
}

function rootAnchorForRevision(
  database: Database.Database,
  itemId: InventoryItemId,
  revisionId: ItemRevisionId,
): number {
  const row = database
    .prepare(
      `SELECT anchor.anchor_id AS anchorId
         FROM inventory_chess_revision AS analysis
         JOIN chess_anchor AS anchor
           ON anchor.anchor_kind = 'occurrence'
          AND anchor.owner_item_id = analysis.item_id
          AND anchor.occurrence_id = analysis.root_occurrence_id
        WHERE analysis.item_id = ? AND analysis.revision_id = ?`,
    )
    .get(itemId.value, revisionId.value) as { anchorId: number } | undefined;
  if (row === undefined) throw revisionImpactConflict();
  return row.anchorId;
}

function currentDisplayName(
  database: Database.Database,
  revisionId: ItemRevisionId,
): string {
  const row = database
    .prepare(
      `SELECT display_name AS displayName FROM item_revision
        WHERE revision_id = ?`,
    )
    .get(revisionId.value) as { displayName: string } | undefined;
  if (row === undefined) throw revisionImpactConflict();
  return row.displayName;
}

function rootPosition(
  database: Database.Database,
  itemId: InventoryItemId,
  revisionId: ItemRevisionId,
): number {
  const row = database
    .prepare(
      `SELECT occurrence.position_id AS positionId
         FROM inventory_chess_revision AS analysis
         JOIN chess_occurrence_snapshot AS occurrence
           ON occurrence.revision_id = analysis.revision_id
          AND occurrence.occurrence_id = analysis.root_occurrence_id
        WHERE analysis.item_id = ? AND analysis.revision_id = ?`,
    )
    .get(itemId.value, revisionId.value) as { positionId: number } | undefined;
  if (row === undefined) throw revisionImpactConflict();
  return row.positionId;
}

function countEntries(
  entries: readonly RevisionImpactEntryDraft[],
  kind: RevisionImpactEntryDraftKind,
): number {
  return entries.filter((entry) => entry.kind === kind).length;
}
