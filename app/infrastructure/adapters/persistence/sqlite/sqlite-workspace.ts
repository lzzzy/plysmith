import type Database from 'better-sqlite3';

import type {
  AddContextReferenceRequest,
  AddContextReferenceResult,
  AnalysisResume,
  ContextReferenceSummary,
  CreateWorkingContextResult,
  UpdateWorkingContextMetadataRequest,
  ManagementResume,
  RemoveContextItemRequest,
  RemoveContextItemResult,
  SetWorkScopeResumeRequest,
  SetWorkScopeResumeResult,
  SetManagementPresentationRequest,
  SetManagementPresentationResult,
  WorkingContextSummary,
  WorkingContextRevisionImpactSummary,
  WorkingContextWorkspace,
  WorkScopeWorkspace,
  StartupResume,
  SetStartupResumeRequest,
  ContextRemovalPreview,
  ContextWorkLosses,
  ContextPlayoutWork,
  DeleteWorkingContextRequest,
  DeleteWorkingContextResult,
} from '../../../../application/workspace/index.ts';
import {
  contextReferenceConflict,
  contextReferenceNotFound,
  invalidResume,
  invalidWorkspacePage,
  resumeRevisionConflict,
  workingContextNotFound,
  workingContextVersionConflict,
} from '../../../../application/workspace/index.ts';
import {
  localId,
  type InventoryItemId,
  type WorkingContextId,
} from '../../../../domain/identity/index.ts';
import type {
  WorkingContextDraft,
  WorkScope,
} from '../../../../domain/workspace/index.ts';
import {
  removalPreviewConflict,
  startupRevisionConflict,
} from '../../../../application/workspace/workspace-problems.ts';
import {
  decodeCursor,
  encodeCursor,
  incrementDataRevision,
  readDataRevision,
} from './sqlite-store-helpers.ts';
import { removeContextItemUsage } from './sqlite-context-item.ts';
import { deleteContextScratch } from './sqlite-context-scratch.ts';
import {
  readContextScratch,
  readScratchHasChanges,
} from './sqlite-analysis-scratch-state.ts';
import {
  assertNoOpenRevisionImpact,
  releaseObsoleteResumeImpact,
} from './sqlite-revision-impact-state.ts';

interface WorkingContextRow {
  readonly contextId: number;
  readonly displayName: string;
  readonly purpose: string | null;
  readonly boundary: string | null;
  readonly nextStep: string | null;
  readonly lifecycle: 'active' | 'archived';
  readonly pinnedOrder: number | null;
  readonly contextVersion: number;
  readonly referenceCount: number;
  readonly itemCount: number;
  readonly pendingRevisionImpactCount: number;
  readonly managementResumeVersion: number | null;
  readonly analysisResumeVersion: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ContextCursor {
  readonly version: 1;
  readonly pinGroup: number;
  readonly pinOrder: number;
  readonly updatedAt: string;
  readonly contextId: number;
}

interface WorkingContextRevisionImpactRow {
  readonly impactId: number;
  readonly itemId: number;
  readonly pinnedRevisionId: number;
  readonly targetRevisionId: number;
  readonly impactVersion: number;
  readonly entryCount: number;
  readonly updatedAt: string;
}

export function createWorkingContext(
  database: Database.Database,
  draft: WorkingContextDraft,
  occurredAt: string,
): CreateWorkingContextResult {
  const inserted = database
    .prepare(
      `INSERT INTO workspace_working_context
         (display_name, purpose, boundary_text, next_step, lifecycle,
          pinned_order, context_version, created_at_utc, updated_at_utc)
       VALUES (?, ?, ?, ?, 'active', NULL, 1, ?, ?)`,
    )
    .run(
      draft.displayName,
      draft.purpose ?? null,
      draft.boundary ?? null,
      draft.nextStep ?? null,
      occurredAt,
      occurredAt,
    );
  const contextId = localId(
    'working-context',
    Number(inserted.lastInsertRowid),
  );
  const dataRevision = incrementDataRevision(database, occurredAt);
  const context = readWorkingContextSummary(database, contextId);
  if (context === undefined) throw workingContextNotFound();
  return Object.freeze({ context, dataRevision });
}

export function updateWorkingContextMetadata(
  database: Database.Database,
  request: UpdateWorkingContextMetadataRequest,
  occurredAt: string,
): CreateWorkingContextResult {
  const current = readWorkingContextSummary(database, request.contextId);
  if (current?.lifecycle !== 'active') throw workingContextNotFound();
  const changed = database
    .prepare(
      `UPDATE workspace_working_context
        SET display_name = ?, purpose = ?, context_version = context_version + 1,
            updated_at_utc = ?
      WHERE context_id = ? AND context_version = ?`,
    )
    .run(
      request.displayName,
      request.purpose === undefined
        ? (current.purpose ?? null)
        : request.purpose,
      occurredAt,
      request.contextId.value,
      request.expectedContextVersion,
    );
  if (changed.changes !== 1) throw workingContextVersionConflict();
  const dataRevision = incrementDataRevision(database, occurredAt);
  const context = readWorkingContextSummary(database, request.contextId);
  if (context === undefined) throw workingContextNotFound();
  return Object.freeze({ context, dataRevision });
}

export function listWorkingContexts(
  database: Database.Database,
  request: { readonly pageSize: number; readonly cursor?: string },
): {
  readonly contexts: readonly WorkingContextSummary[];
  readonly nextCursor?: string;
  readonly dataRevision: number;
} {
  const cursor =
    request.cursor === undefined
      ? undefined
      : decodeContextCursor(request.cursor);
  if (request.cursor !== undefined && cursor === undefined) {
    throw invalidWorkspacePage();
  }
  const rows = database
    .prepare(
      `${workingContextSelect}
       WHERE c.lifecycle = 'active'
         AND (
           ? IS NULL
           OR CASE WHEN c.pinned_order IS NULL THEN 1 ELSE 0 END > ?
           OR (CASE WHEN c.pinned_order IS NULL THEN 1 ELSE 0 END = ?
               AND COALESCE(c.pinned_order, 2147483647) > ?)
           OR (CASE WHEN c.pinned_order IS NULL THEN 1 ELSE 0 END = ?
               AND COALESCE(c.pinned_order, 2147483647) = ?
               AND c.updated_at_utc < ?)
           OR (CASE WHEN c.pinned_order IS NULL THEN 1 ELSE 0 END = ?
               AND COALESCE(c.pinned_order, 2147483647) = ?
               AND c.updated_at_utc = ? AND c.context_id < ?)
         )
       ORDER BY CASE WHEN c.pinned_order IS NULL THEN 1 ELSE 0 END,
                COALESCE(c.pinned_order, 2147483647),
                c.updated_at_utc DESC, c.context_id DESC
       LIMIT ?`,
    )
    .all(
      cursor?.version ?? null,
      cursor?.pinGroup ?? 0,
      cursor?.pinGroup ?? 0,
      cursor?.pinOrder ?? 0,
      cursor?.pinGroup ?? 0,
      cursor?.pinOrder ?? 0,
      cursor?.updatedAt ?? '',
      cursor?.pinGroup ?? 0,
      cursor?.pinOrder ?? 0,
      cursor?.updatedAt ?? '',
      cursor?.contextId ?? 0,
      request.pageSize + 1,
    ) as WorkingContextRow[];
  const hasMore = rows.length > request.pageSize;
  const page = rows.slice(0, request.pageSize);
  const contexts = Object.freeze(page.map(mapWorkingContext));
  const last = page.at(-1);
  return Object.freeze({
    contexts,
    ...(hasMore && last !== undefined
      ? { nextCursor: encodeCursor(contextCursor(last)) }
      : {}),
    dataRevision: readDataRevision(database),
  });
}

export function readWorkingContextWorkspace(
  database: Database.Database,
  contextId: WorkingContextId,
): WorkingContextWorkspace | undefined {
  const context = readWorkingContextSummary(database, contextId);
  if (context?.lifecycle !== 'active') return undefined;
  const members = database
    .prepare(
      `SELECT i.item_id AS itemId,
              v.revision_id AS currentRevisionId,
              i.item_type AS itemType,
              v.display_name AS displayName
         FROM workspace_context_item AS context_item
         JOIN inventory_item AS i ON i.item_id = context_item.item_id
         JOIN item_revision AS v
           ON v.item_id = i.item_id
          AND v.revision_id = coalesce(context_item.pinned_revision_id,
                                       i.current_revision_id)
        WHERE context_item.context_id = ?
        ORDER BY context_item.created_at_utc, i.item_id`,
    )
    .all(contextId.value) as Pick<
    ContextReferenceRow,
    'itemId' | 'currentRevisionId' | 'itemType' | 'displayName'
  >[];
  const references = database
    .prepare(
      `SELECT r.reference_id AS referenceId,
              r.item_id AS itemId,
              coalesce(context_item.pinned_revision_id,
                       i.current_revision_id) AS currentRevisionId,
              i.item_type AS itemType,
              v.display_name AS displayName,
              r.anchor_id AS anchorId,
              a.anchor_kind AS anchorKind,
              r.created_at_utc AS createdAt
         FROM workspace_context_reference AS r
         JOIN workspace_context_item AS context_item
           ON context_item.context_id = r.context_id
          AND context_item.item_id = r.item_id
         JOIN inventory_item AS i ON i.item_id = r.item_id
         JOIN item_revision AS v
           ON v.item_id = i.item_id
          AND v.revision_id = coalesce(context_item.pinned_revision_id,
                                       i.current_revision_id)
         JOIN chess_anchor AS a ON a.anchor_id = r.anchor_id
        WHERE r.context_id = ?
        ORDER BY r.created_at_utc, r.reference_id`,
    )
    .all(contextId.value) as ContextReferenceRow[];
  const managementResume = readManagementResume(database, contextId);
  const analysisResume = readAnalysisResume(database, contextId);
  const pendingRevisionImpacts = database
    .prepare(
      `SELECT impact.impact_id AS impactId,
              impact.item_id AS itemId,
              impact.pinned_revision_id AS pinnedRevisionId,
              impact.target_revision_id AS targetRevisionId,
              impact.impact_version AS impactVersion,
              (SELECT count(*) FROM workspace_revision_impact_entry AS entry
                WHERE entry.impact_id = impact.impact_id) AS entryCount,
              impact.updated_at_utc AS updatedAt
         FROM workspace_pending_revision_impact AS impact
        WHERE impact.context_id = ?
        ORDER BY impact.updated_at_utc, impact.impact_id`,
    )
    .all(contextId.value) as WorkingContextRevisionImpactRow[];
  return Object.freeze({
    context,
    members: Object.freeze(
      members.map((member) =>
        Object.freeze({
          itemId: localId('inventory-item', member.itemId),
          currentRevisionId: localId('item-revision', member.currentRevisionId),
          itemType: member.itemType,
          displayName: member.displayName,
        }),
      ),
    ),
    references: Object.freeze(references.map(mapContextReference)),
    pendingRevisionImpacts: Object.freeze(
      pendingRevisionImpacts.map(mapWorkingContextRevisionImpact),
    ),
    ...(managementResume === undefined ? {} : { managementResume }),
    ...(analysisResume === undefined ? {} : { analysisResume }),
    dataRevision: readDataRevision(database),
  });
}

export function addContextReference(
  database: Database.Database,
  request: AddContextReferenceRequest,
  occurredAt: string,
): AddContextReferenceResult {
  requireActiveContext(database, request.contextId);
  assertNoOpenRevisionImpact(
    database,
    request.contextId.value,
    request.itemId.value,
  );
  const currentRevisionId = currentItemRevision(database, request.itemId.value);
  if (
    currentRevisionId === undefined ||
    !anchorBelongsToItem(
      database,
      request.anchorId.value,
      request.itemId.value,
      currentRevisionId,
    )
  ) {
    throw contextReferenceNotFound();
  }
  const duplicate = database
    .prepare(
      `SELECT reference_id FROM workspace_context_reference
        WHERE context_id = ? AND anchor_id = ?`,
    )
    .get(request.contextId.value, request.anchorId.value);
  if (duplicate !== undefined) throw contextReferenceConflict();

  database
    .prepare(
      `INSERT OR IGNORE INTO workspace_context_item
         (context_id, item_id, relationship_version, created_at_utc)
       VALUES (?, ?, 1, ?)`,
    )
    .run(request.contextId.value, request.itemId.value, occurredAt);
  const inserted = database
    .prepare(
      `INSERT INTO workspace_context_reference
         (context_id, item_id, anchor_id, created_at_utc)
       VALUES (?, ?, ?, ?)`,
    )
    .run(
      request.contextId.value,
      request.itemId.value,
      request.anchorId.value,
      occurredAt,
    );
  database
    .prepare(
      `UPDATE workspace_working_context SET updated_at_utc = ?
        WHERE context_id = ?`,
    )
    .run(occurredAt, request.contextId.value);
  const dataRevision = incrementDataRevision(database, occurredAt);
  const reference = readContextReference(
    database,
    Number(inserted.lastInsertRowid),
  );
  if (reference === undefined) throw contextReferenceNotFound();
  return Object.freeze({ reference, dataRevision });
}

export function removeContextItem(
  database: Database.Database,
  request: RemoveContextItemRequest,
  occurredAt: string,
): RemoveContextItemResult {
  requireActiveContext(database, request.contextId);
  assertRemovalVersions(database, request);
  assertNoOpenRevisionImpact(
    database,
    request.contextId.value,
    request.itemId.value,
  );
  const relationship = database
    .prepare(
      `SELECT 1 FROM workspace_context_item
        WHERE context_id = ? AND item_id = ? AND pinned_revision_id IS NULL`,
    )
    .get(request.contextId.value, request.itemId.value);
  if (relationship === undefined) throw contextReferenceNotFound();

  removeContextItemUsage(database, {
    contextId: request.contextId.value,
    itemId: request.itemId.value,
    occurredAt,
  });
  const removed = database
    .prepare(
      `DELETE FROM workspace_context_item
        WHERE context_id = ? AND item_id = ? AND pinned_revision_id IS NULL`,
    )
    .run(request.contextId.value, request.itemId.value);
  if (removed.changes !== 1) throw contextReferenceNotFound();
  database
    .prepare(
      `UPDATE workspace_working_context SET updated_at_utc = ?
        WHERE context_id = ?`,
    )
    .run(occurredAt, request.contextId.value);
  return Object.freeze({
    contextId: request.contextId,
    itemId: request.itemId,
    dataRevision: incrementDataRevision(database, occurredAt),
  });
}

export function setManagementPresentation(
  database: Database.Database,
  request: SetManagementPresentationRequest,
  occurredAt: string,
): SetManagementPresentationResult & { readonly changed: boolean } {
  if (
    (request.presentation !== 'folders' &&
      request.presentation !== 'origins') ||
    (request.expectedResumeVersion !== null &&
      (!Number.isSafeInteger(request.expectedResumeVersion) ||
        request.expectedResumeVersion < 1))
  )
    throw invalidResume();
  const contextId =
    request.scope.kind === 'context' ? request.scope.contextId.value : null;
  if (request.scope.kind === 'context')
    requireActiveContext(database, request.scope.contextId);
  const current = readManagementResume(database, contextId);
  assertResumeRevision(
    request.expectedResumeVersion,
    current?.resumeVersion ?? null,
  );
  if (current?.presentation === request.presentation) {
    return Object.freeze({
      area: 'manage',
      resume: current,
      dataRevision: readDataRevision(database),
      changed: false,
    });
  }
  database
    .prepare(
      `
    INSERT INTO workspace_management_resume
      (context_id, resume_version, presentation, updated_at_utc)
    VALUES (?, ?, ?, ?)
    ON CONFLICT DO UPDATE SET
      resume_version = excluded.resume_version,
      presentation = excluded.presentation,
      updated_at_utc = excluded.updated_at_utc
  `,
    )
    .run(
      contextId,
      (current?.resumeVersion ?? 0) + 1,
      request.presentation,
      occurredAt,
    );
  const dataRevision = incrementDataRevision(database, occurredAt);
  const resume = readManagementResume(database, contextId);
  if (resume === undefined) throw invalidResume();
  return Object.freeze({ area: 'manage', resume, dataRevision, changed: true });
}

export function setWorkScopeResume(
  database: Database.Database,
  request: SetWorkScopeResumeRequest,
  occurredAt: string,
): SetWorkScopeResumeResult {
  const contextId =
    request.scope.kind === 'context' ? request.scope.contextId.value : null;
  if (request.scope.kind === 'context')
    requireActiveContext(database, request.scope.contextId);
  if (request.area === 'manage') {
    if (request.selectedItemId !== undefined && contextId !== null) {
      assertNoOpenRevisionImpact(
        database,
        contextId,
        request.selectedItemId.value,
      );
    }
    const currentVersion = currentResumeVersion(
      database,
      'workspace_management_resume',
      contextId,
    );
    assertResumeRevision(request.expectedResumeVersion, currentVersion);
    if (
      request.selectedItemId !== undefined &&
      request.selectedAnchorId !== undefined
    ) {
      if (contextId !== null) {
        requireContextSelection(
          database,
          contextId,
          request.selectedItemId.value,
          request.selectedAnchorId.value,
        );
      } else {
        const revision = currentItemRevision(
          database,
          request.selectedItemId.value,
        );
        if (
          revision === undefined ||
          !anchorBelongsToItem(
            database,
            request.selectedAnchorId.value,
            request.selectedItemId.value,
            revision,
          )
        )
          throw contextReferenceNotFound();
      }
    }
    if (contextId !== null)
      releaseObsoleteResumeImpact(database, contextId, 'management_resume');
    const resumeVersion = (currentVersion ?? 0) + 1;
    database
      .prepare(
        `INSERT INTO workspace_management_resume
           (context_id, resume_version, presentation, selected_item_id,
            selected_anchor_id, updated_at_utc)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT DO UPDATE SET
           resume_version = excluded.resume_version,
           presentation = excluded.presentation,
           selected_item_id = excluded.selected_item_id,
           selected_anchor_id = excluded.selected_anchor_id,
           updated_at_utc = excluded.updated_at_utc`,
      )
      .run(
        contextId,
        resumeVersion,
        request.presentation,
        request.selectedItemId?.value ?? null,
        request.selectedAnchorId?.value ?? null,
        occurredAt,
      );
    const dataRevision = incrementDataRevision(database, occurredAt);
    const resume = readManagementResume(database, contextId);
    if (resume === undefined) throw invalidResume();
    return Object.freeze({ area: 'manage', resume, dataRevision });
  }

  const currentVersion = currentResumeVersion(
    database,
    'workspace_analysis_resume',
    contextId,
  );
  assertResumeRevision(request.expectedResumeVersion, currentVersion);
  const openScratch = database
    .prepare(`SELECT 1 FROM analysis_scratch_draft WHERE context_id IS ?`)
    .get(contextId);
  if (openScratch !== undefined) throw invalidResume();
  if (
    request.itemId === undefined ||
    request.revisionId === undefined ||
    request.anchorId === undefined
  ) {
    throw invalidResume();
  }
  if (contextId !== null)
    assertNoOpenRevisionImpact(database, contextId, request.itemId.value);
  if (contextId !== null) {
    requireEffectiveContextRevision(
      database,
      contextId,
      request.itemId.value,
      request.revisionId.value,
    );
  } else if (
    request.mode === 'edit_overlay' ||
    currentItemRevision(database, request.itemId.value) !==
      request.revisionId.value
  ) {
    throw invalidResume();
  }
  const currentPositionId = resolveAnchorPosition(
    database,
    request.itemId.value,
    request.revisionId.value,
    request.anchorId.value,
  );
  if (currentPositionId === undefined) throw invalidResume();
  if (contextId !== null)
    releaseObsoleteResumeImpact(database, contextId, 'analysis_resume');
  const resumeVersion = (currentVersion ?? 0) + 1;
  database
    .prepare(
      `INSERT INTO workspace_analysis_resume
         (context_id, resume_version, item_id, revision_id, anchor_id,
          mode, current_position_id, analysis_scratch_draft_id, updated_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT DO UPDATE SET
         resume_version = excluded.resume_version,
         item_id = excluded.item_id,
         revision_id = excluded.revision_id,
         anchor_id = excluded.anchor_id,
         mode = excluded.mode,
         current_position_id = excluded.current_position_id,
         analysis_scratch_draft_id = NULL,
         updated_at_utc = excluded.updated_at_utc`,
    )
    .run(
      contextId,
      resumeVersion,
      request.itemId.value,
      request.revisionId.value,
      request.anchorId.value,
      request.mode,
      currentPositionId,
      occurredAt,
    );
  const dataRevision = incrementDataRevision(database, occurredAt);
  const resume = readAnalysisResume(database, contextId);
  if (resume === undefined) throw invalidResume();
  return Object.freeze({ area: 'analyze', resume, dataRevision });
}

export function readWorkingContextSummary(
  database: Database.Database,
  contextId: WorkingContextId,
): WorkingContextSummary | undefined {
  const row = database
    .prepare(`${workingContextSelect} WHERE c.context_id = ?`)
    .get(contextId.value) as WorkingContextRow | undefined;
  return row === undefined ? undefined : mapWorkingContext(row);
}

export function requireActiveContext(
  database: Database.Database,
  contextId: WorkingContextId,
): void {
  const row = database
    .prepare(
      `SELECT lifecycle FROM workspace_working_context WHERE context_id = ?`,
    )
    .get(contextId.value) as { lifecycle: string } | undefined;
  if (row?.lifecycle !== 'active') throw workingContextNotFound();
}

export function readWorkScopeWorkspace(
  database: Database.Database,
  scope: WorkScope,
): WorkScopeWorkspace | undefined {
  if (scope.kind === 'context') {
    const context = readWorkingContextSummary(database, scope.contextId);
    if (context?.lifecycle !== 'active') return undefined;
  }
  const contextId = scope.kind === 'context' ? scope.contextId.value : null;
  const managementResume = readManagementResume(database, contextId);
  const analysisResume = readAnalysisResume(database, contextId);
  return Object.freeze({
    scope,
    ...(managementResume === undefined ? {} : { managementResume }),
    ...(analysisResume === undefined ? {} : { analysisResume }),
    dataRevision: readDataRevision(database),
  });
}

export function readStartupResume(database: Database.Database): StartupResume {
  const row = database
    .prepare(
      `SELECT context_id AS contextId, area, startup_version AS startupVersion FROM workspace_startup_resume WHERE startup_id = 1`,
    )
    .get() as
    | {
        contextId: number | null;
        area: StartupResume['area'];
        startupVersion: number;
      }
    | undefined;
  const dataRevision = readDataRevision(database);
  if (row === undefined)
    return Object.freeze({
      scope: { kind: 'free' as const },
      area: 'manage',
      startupVersion: null,
      dataRevision,
    });
  if (row.contextId === null)
    return Object.freeze({
      scope: { kind: 'free' as const },
      area: row.area,
      startupVersion: row.startupVersion,
      dataRevision,
    });
  const contextId = localId('working-context', row.contextId);
  const context = readWorkingContextSummary(database, contextId);
  return Object.freeze({
    scope:
      context?.lifecycle === 'active'
        ? { kind: 'context' as const, contextId }
        : { kind: 'free' as const },
    area: row.area,
    startupVersion: row.startupVersion,
    dataRevision,
    ...(context?.lifecycle === 'active'
      ? {}
      : {
          unavailableContext: {
            contextId,
            reason:
              context === undefined
                ? ('missing' as const)
                : ('deleted' as const),
            ...(context === undefined
              ? {}
              : { displayName: context.displayName }),
          },
        }),
  });
}

export function setStartupResume(
  database: Database.Database,
  request: SetStartupResumeRequest,
  occurredAt: string,
): StartupResume {
  if (request.scope.kind === 'context')
    requireActiveContext(database, request.scope.contextId);
  const current = readStartupResume(database);
  if (current.startupVersion !== request.expectedStartupVersion)
    throw startupRevisionConflict();
  database
    .prepare(
      `INSERT INTO workspace_startup_resume (startup_id, context_id, area, startup_version, updated_at_utc)
    VALUES (1, ?, ?, ?, ?) ON CONFLICT(startup_id) DO UPDATE SET context_id = excluded.context_id, area = excluded.area, startup_version = excluded.startup_version, updated_at_utc = excluded.updated_at_utc`,
    )
    .run(
      request.scope.kind === 'context' ? request.scope.contextId.value : null,
      request.area,
      (current.startupVersion ?? 0) + 1,
      occurredAt,
    );
  incrementDataRevision(database, occurredAt);
  return readStartupResume(database);
}

export function assertRemovalVersions(
  database: Database.Database,
  request: {
    readonly contextId: WorkingContextId;
    readonly expectedContextVersion: number;
    readonly expectedDataRevision: number;
  },
): void {
  const context = readWorkingContextSummary(database, request.contextId);
  if (context?.lifecycle !== 'active') throw workingContextNotFound();
  if (
    context.contextVersion !== request.expectedContextVersion ||
    readDataRevision(database) !== request.expectedDataRevision
  )
    throw removalPreviewConflict();
}

export function previewContextItemRemoval(
  database: Database.Database,
  request: {
    readonly contextId: WorkingContextId;
    readonly itemId: InventoryItemId;
  },
): ContextRemovalPreview {
  return previewContextRemoval(
    database,
    request.contextId,
    request.itemId.value,
  );
}

export function previewWorkingContextDeletion(
  database: Database.Database,
  request: { readonly contextId: WorkingContextId },
): ContextRemovalPreview {
  return previewContextRemoval(database, request.contextId);
}

function previewContextRemoval(
  database: Database.Database,
  contextId: WorkingContextId,
  itemId?: number,
): ContextRemovalPreview {
  requireActiveContext(database, contextId);
  const context = readWorkingContextSummary(database, contextId)!;
  const rows = database
    .prepare(
      `SELECT member.item_id AS itemId, revision.display_name AS displayName
    FROM workspace_context_item AS member JOIN inventory_item AS item ON item.item_id = member.item_id
    JOIN item_revision AS revision ON revision.revision_id = coalesce(member.pinned_revision_id, item.current_revision_id)
    WHERE member.context_id = ? AND (? IS NULL OR member.item_id = ?) ORDER BY member.item_id`,
    )
    .all(contextId.value, itemId ?? null, itemId ?? null) as {
    itemId: number;
    displayName: string;
  }[];
  if (itemId !== undefined && rows.length === 0)
    throw contextReferenceNotFound();
  const referenceCount = (
    database
      .prepare(
        `SELECT count(*) AS count FROM workspace_context_reference WHERE context_id = ? AND (? IS NULL OR item_id = ?)`,
      )
      .get(contextId.value, itemId ?? null, itemId ?? null) as { count: number }
  ).count;
  const notes = database
    .prepare(
      `SELECT note.contribution_id AS contributionId, note.body,
    coalesce(anchor.owner_item_id, anchor.item_id) AS itemId,
    (SELECT count(*) FROM workspace_analysis_note_path_step AS step WHERE step.contribution_id = note.contribution_id) AS moveCount
    FROM workspace_contribution AS note JOIN chess_anchor AS anchor ON anchor.anchor_id = note.anchor_id
    WHERE note.context_id = ? AND note.scope_kind = 'context' AND note.status <> 'archived'
    AND (? IS NULL OR coalesce(anchor.owner_item_id, anchor.item_id) = ?) ORDER BY note.contribution_id`,
    )
    .all(contextId.value, itemId ?? null, itemId ?? null) as {
    contributionId: number;
    body: string;
    itemId: number | null;
    moveCount: number;
  }[];
  const scratch = database
    .prepare(
      `SELECT scratch.scratch_key AS scratchId, scratch.scratch_revision AS scratchRevision,
    scratch.note_body AS noteBody, scratch.scratch_mode AS intent,
    coalesce(scratch.edit_item_id, scratch.origin_item_id) AS itemId,
    (SELECT count(*) FROM analysis_scratch_step AS step WHERE step.scratch_draft_id = scratch.scratch_draft_id) AS stepCount
    FROM analysis_scratch_draft AS scratch WHERE scratch.context_id = ?
    AND (? IS NULL OR scratch.origin_item_id = ? OR scratch.edit_item_id = ?)`,
    )
    .get(contextId.value, itemId ?? null, itemId ?? null, itemId ?? null) as
    | {
        scratchId: string;
        scratchRevision: number;
        noteBody: string | null;
        intent: NonNullable<ContextWorkLosses['scratch']>['intent'];
        itemId: number | null;
        stepCount: number;
      }
    | undefined;
  const management = readManagementResume(database, contextId);
  const managementResume =
    itemId === undefined || management?.selectedItemId?.value === itemId
      ? management
      : undefined;
  const analysis = readAnalysisResume(database, contextId);
  const analysisResume =
    itemId === undefined ||
    analysis?.itemId?.value === itemId ||
    (scratch !== undefined && analysis?.scratchId === scratch.scratchId)
      ? analysis
      : undefined;
  const playoutRow = database
    .prepare(
      `SELECT draft_id AS draftId, draft_revision AS draftRevision, status_kind AS status, origin_item_id AS sourceItemId,
    (SELECT count(*) FROM playout_ply AS ply WHERE ply.draft_id = draft.draft_id) AS moveCount
    FROM playout_draft AS draft WHERE context_id = ?`,
    )
    .get(contextId.value) as
    | {
        draftId: number;
        draftRevision: number;
        status: ContextPlayoutWork['status'];
        sourceItemId: number | null;
        moveCount: number;
      }
    | undefined;
  const playout: ContextPlayoutWork | undefined =
    playoutRow === undefined
      ? undefined
      : Object.freeze({
          draftId: localId('playout-draft', playoutRow.draftId),
          draftRevision: playoutRow.draftRevision,
          status: playoutRow.status,
          moveCount: playoutRow.moveCount,
          ...(playoutRow.sourceItemId === null
            ? {}
            : {
                sourceItemId: localId(
                  'inventory-item',
                  playoutRow.sourceItemId,
                ),
              }),
        });
  return Object.freeze({
    contextId,
    contextName: context.displayName,
    contextVersion: context.contextVersion,
    dataRevision: readDataRevision(database),
    referenceCount,
    items: Object.freeze(
      rows.map((row) =>
        Object.freeze({
          itemId: localId('inventory-item', row.itemId),
          displayName: row.displayName,
        }),
      ),
    ),
    losses: Object.freeze({
      notes: Object.freeze(
        notes.map((row) =>
          Object.freeze({
            contributionId: localId('contribution', row.contributionId),
            body: row.body,
            moveCount: row.moveCount,
            ...(row.itemId === null
              ? {}
              : { itemId: localId('inventory-item', row.itemId) }),
          }),
        ),
      ),
      ...(scratch === undefined
        ? {}
        : {
            scratch: Object.freeze({
              scratchId: scratch.scratchId,
              scratchRevision: scratch.scratchRevision,
              hasChanges: readScratchHasChanges(
                database,
                readContextScratch(database, contextId),
              ),
              intent: scratch.intent,
              stepCount: scratch.stepCount,
              ...(scratch.noteBody === null
                ? {}
                : { noteBody: scratch.noteBody }),
              ...(scratch.itemId === null
                ? {}
                : { itemId: localId('inventory-item', scratch.itemId) }),
            }),
          }),
      ...(managementResume === undefined ? {} : { managementResume }),
      ...(analysisResume === undefined ? {} : { analysisResume }),
      ...(playout === undefined || itemId !== undefined ? {} : { playout }),
    }),
    ...(playout === undefined || itemId === undefined
      ? {}
      : { retainedPlayout: playout }),
  });
}

export function deleteWorkingContext(
  database: Database.Database,
  request: DeleteWorkingContextRequest,
  occurredAt: string,
  removePlayout: (contextId: WorkingContextId) => void,
): DeleteWorkingContextResult {
  assertRemovalVersions(database, request);
  const contextId = request.contextId.value;
  removePlayout(request.contextId);
  if (
    database
      .prepare('SELECT 1 FROM playout_draft WHERE context_id = ?')
      .get(contextId) !== undefined
  )
    throw invalidResume();
  database
    .prepare(
      'DELETE FROM workspace_revision_impact_entry WHERE impact_id IN (SELECT impact_id FROM workspace_pending_revision_impact WHERE context_id = ?)',
    )
    .run(contextId);
  database
    .prepare(
      'DELETE FROM workspace_pending_revision_impact WHERE context_id = ?',
    )
    .run(contextId);
  database
    .prepare(
      'UPDATE playout_completion_receipt SET context_reference_id = NULL WHERE context_reference_id IN (SELECT reference_id FROM workspace_context_reference WHERE context_id = ?)',
    )
    .run(contextId);
  database
    .prepare('DELETE FROM workspace_context_reference WHERE context_id = ?')
    .run(contextId);
  database
    .prepare('DELETE FROM workspace_context_item WHERE context_id = ?')
    .run(contextId);
  database
    .prepare('DELETE FROM workspace_management_resume WHERE context_id = ?')
    .run(contextId);
  database
    .prepare('DELETE FROM workspace_analysis_resume WHERE context_id = ?')
    .run(contextId);
  deleteContextScratch(database, contextId);
  database
    .prepare('DELETE FROM search_document WHERE context_id = ?')
    .run(contextId);
  database
    .prepare(
      `UPDATE workspace_contribution SET status = 'archived', contribution_version = contribution_version + 1, updated_at_utc = ? WHERE context_id = ? AND status <> 'archived'`,
    )
    .run(occurredAt, contextId);
  database
    .prepare(
      `UPDATE workspace_working_context SET lifecycle = 'archived', context_version = context_version + 1, updated_at_utc = ? WHERE context_id = ?`,
    )
    .run(occurredAt, contextId);
  return Object.freeze({
    contextId: request.contextId,
    dataRevision: incrementDataRevision(database, occurredAt),
  });
}

export function resolveAnchorPosition(
  database: Database.Database,
  itemId: number,
  revisionId: number,
  anchorId: number,
): number | undefined {
  const row = database
    .prepare(
      `SELECT CASE a.anchor_kind
                WHEN 'item' THEN root.position_id
                WHEN 'position' THEN a.position_id
                WHEN 'occurrence' THEN occurrence.position_id
                WHEN 'move_node' THEN child.position_id
              END AS positionId
         FROM chess_anchor AS a
         LEFT JOIN inventory_analysis_revision AS analysis
           ON analysis.item_id = ? AND analysis.revision_id = ?
         LEFT JOIN inventory_game_revision AS game
           ON game.item_id = ? AND game.revision_id = ?
         LEFT JOIN chess_occurrence_snapshot AS root
           ON root.revision_id = ?
          AND root.occurrence_id = COALESCE(
                analysis.root_occurrence_id,
                game.root_occurrence_id
              )
         LEFT JOIN chess_occurrence_snapshot AS occurrence
           ON occurrence.revision_id = ?
          AND occurrence.occurrence_id = a.occurrence_id
          AND occurrence.item_id = ?
         LEFT JOIN chess_move_node_snapshot AS move
           ON move.revision_id = ?
          AND move.move_node_id = a.move_node_id
          AND move.item_id = ?
         LEFT JOIN chess_occurrence_snapshot AS child
           ON child.revision_id = move.revision_id
          AND child.occurrence_id = move.child_occurrence_id
        WHERE a.anchor_id = ?
          AND (
            (a.anchor_kind = 'item' AND a.item_id = ?)
            OR (a.anchor_kind = 'position' AND EXISTS (
              SELECT 1 FROM chess_occurrence_snapshot AS member
               WHERE member.revision_id = ? AND member.item_id = ?
                 AND member.position_id = a.position_id
            ))
            OR (a.anchor_kind IN ('occurrence', 'move_node')
                AND a.owner_item_id = ?)
          )`,
    )
    .get(
      itemId,
      revisionId,
      itemId,
      revisionId,
      revisionId,
      revisionId,
      itemId,
      revisionId,
      itemId,
      anchorId,
      itemId,
      revisionId,
      itemId,
      itemId,
    ) as { positionId: number | null } | undefined;
  return row?.positionId ?? undefined;
}

function anchorBelongsToItem(
  database: Database.Database,
  anchorId: number,
  itemId: number,
  revisionId: number,
): boolean {
  return (
    resolveAnchorPosition(database, itemId, revisionId, anchorId) !== undefined
  );
}

function currentItemRevision(
  database: Database.Database,
  itemId: number,
): number | undefined {
  const row = database
    .prepare(
      `SELECT current_revision_id AS currentRevisionId
         FROM inventory_item
        WHERE item_id = ? AND lifecycle = 'active'
          AND current_revision_id IS NOT NULL`,
    )
    .get(itemId) as { currentRevisionId: number } | undefined;
  return row?.currentRevisionId;
}

function requireContextSelection(
  database: Database.Database,
  contextId: number,
  itemId: number,
  anchorId: number,
): void {
  const row = database
    .prepare(
      `SELECT 1 FROM workspace_context_reference
        WHERE context_id = ? AND item_id = ? AND anchor_id = ?`,
    )
    .get(contextId, itemId, anchorId);
  if (row === undefined) throw contextReferenceNotFound();
}

function requireEffectiveContextRevision(
  database: Database.Database,
  contextId: number,
  itemId: number,
  revisionId: number,
): void {
  const row = database
    .prepare(
      `SELECT coalesce(member.pinned_revision_id, item.current_revision_id)
                AS effectiveRevisionId
         FROM workspace_context_item AS member
         JOIN inventory_item AS item ON item.item_id = member.item_id
        WHERE member.context_id = ? AND member.item_id = ?
          AND item.lifecycle = 'active'`,
    )
    .get(contextId, itemId) as { effectiveRevisionId: number } | undefined;
  if (row?.effectiveRevisionId !== revisionId) throw invalidResume();
}

function currentResumeVersion(
  database: Database.Database,
  table: 'workspace_management_resume' | 'workspace_analysis_resume',
  contextId: number | null,
): number | null {
  const row = database
    .prepare(
      `SELECT resume_version AS resumeVersion FROM ${table} WHERE context_id IS ?`,
    )
    .get(contextId) as { resumeVersion: number } | undefined;
  return row?.resumeVersion ?? null;
}

function assertResumeRevision(
  expected: number | null,
  current: number | null,
): void {
  if (expected !== current) throw resumeRevisionConflict(expected, current);
}

export function readManagementResume(
  database: Database.Database,
  contextId: WorkingContextId | number | null,
): ManagementResume | undefined {
  const row = database
    .prepare(
      `SELECT resume_version AS resumeVersion,
              presentation,
              selected_item_id AS selectedItemId,
              selected_anchor_id AS selectedAnchorId,
              updated_at_utc AS updatedAt
         FROM workspace_management_resume WHERE context_id IS ?`,
    )
    .get(
      typeof contextId === 'object' ? (contextId?.value ?? null) : contextId,
    ) as
    | {
        resumeVersion: number;
        presentation: ManagementResume['presentation'];
        selectedItemId: number | null;
        selectedAnchorId: number | null;
        updatedAt: string;
      }
    | undefined;
  if (row === undefined) return undefined;
  return Object.freeze({
    resumeVersion: row.resumeVersion,
    presentation: row.presentation,
    ...(row.selectedItemId === null
      ? {}
      : { selectedItemId: localId('inventory-item', row.selectedItemId) }),
    ...(row.selectedAnchorId === null
      ? {}
      : { selectedAnchorId: localId('anchor', row.selectedAnchorId) }),
    updatedAt: row.updatedAt,
  });
}

export function readAnalysisResume(
  database: Database.Database,
  contextId: WorkingContextId | number | null,
): AnalysisResume | undefined {
  const row = database
    .prepare(
      `SELECT resume_version AS resumeVersion, mode,
              item_id AS itemId, revision_id AS revisionId,
              anchor_id AS anchorId, current_position_id AS currentPositionId,
              scratch.scratch_key AS scratchId,
              resume.updated_at_utc AS updatedAt
         FROM workspace_analysis_resume AS resume
         LEFT JOIN analysis_scratch_draft AS scratch
           ON scratch.scratch_draft_id = resume.analysis_scratch_draft_id
        WHERE resume.context_id IS ?`,
    )
    .get(
      typeof contextId === 'object' ? (contextId?.value ?? null) : contextId,
    ) as
    | {
        resumeVersion: number;
        mode: AnalysisResume['mode'];
        itemId: number | null;
        revisionId: number | null;
        anchorId: number | null;
        currentPositionId: number;
        scratchId: string | null;
        updatedAt: string;
      }
    | undefined;
  if (row === undefined) return undefined;
  return Object.freeze({
    resumeVersion: row.resumeVersion,
    mode: row.mode,
    ...(row.itemId === null
      ? {}
      : { itemId: localId('inventory-item', row.itemId) }),
    ...(row.revisionId === null
      ? {}
      : { revisionId: localId('item-revision', row.revisionId) }),
    ...(row.anchorId === null
      ? {}
      : { anchorId: localId('anchor', row.anchorId) }),
    currentPositionId: localId('position', row.currentPositionId),
    ...(row.scratchId === null ? {} : { scratchId: row.scratchId }),
    updatedAt: row.updatedAt,
  });
}

interface ContextReferenceRow {
  readonly referenceId: number;
  readonly itemId: number;
  readonly currentRevisionId: number;
  readonly itemType: ContextReferenceSummary['itemType'];
  readonly displayName: string;
  readonly anchorId: number;
  readonly anchorKind: ContextReferenceSummary['anchorKind'];
  readonly createdAt: string;
}

function readContextReference(
  database: Database.Database,
  referenceId: number,
): ContextReferenceSummary | undefined {
  const row = database
    .prepare(
      `SELECT r.reference_id AS referenceId, r.item_id AS itemId,
              i.current_revision_id AS currentRevisionId,
              i.item_type AS itemType, v.display_name AS displayName,
              r.anchor_id AS anchorId, a.anchor_kind AS anchorKind,
              r.created_at_utc AS createdAt
         FROM workspace_context_reference AS r
         JOIN inventory_item AS i ON i.item_id = r.item_id
         JOIN item_revision AS v ON v.revision_id = i.current_revision_id
         JOIN chess_anchor AS a ON a.anchor_id = r.anchor_id
        WHERE r.reference_id = ?`,
    )
    .get(referenceId) as ContextReferenceRow | undefined;
  return row === undefined ? undefined : mapContextReference(row);
}

function mapContextReference(
  row: ContextReferenceRow,
): ContextReferenceSummary {
  return Object.freeze({
    referenceId: localId('context-reference', row.referenceId),
    itemId: localId('inventory-item', row.itemId),
    currentRevisionId: localId('item-revision', row.currentRevisionId),
    itemType: row.itemType,
    displayName: row.displayName,
    anchorId: localId('anchor', row.anchorId),
    anchorKind: row.anchorKind,
    createdAt: row.createdAt,
  });
}

function mapWorkingContext(row: WorkingContextRow): WorkingContextSummary {
  return Object.freeze({
    contextId: localId('working-context', row.contextId),
    displayName: row.displayName,
    ...(row.purpose === null ? {} : { purpose: row.purpose }),
    ...(row.boundary === null ? {} : { boundary: row.boundary }),
    ...(row.nextStep === null ? {} : { nextStep: row.nextStep }),
    lifecycle: row.lifecycle,
    ...(row.pinnedOrder === null ? {} : { pinnedOrder: row.pinnedOrder }),
    contextVersion: row.contextVersion,
    referenceCount: row.referenceCount,
    itemCount: row.itemCount,
    pendingRevisionImpactCount: row.pendingRevisionImpactCount,
    ...(row.managementResumeVersion === null
      ? {}
      : { managementResumeVersion: row.managementResumeVersion }),
    ...(row.analysisResumeVersion === null
      ? {}
      : { analysisResumeVersion: row.analysisResumeVersion }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapWorkingContextRevisionImpact(
  row: WorkingContextRevisionImpactRow,
): WorkingContextRevisionImpactSummary {
  return Object.freeze({
    impactId: localId('revision-impact', row.impactId),
    itemId: localId('inventory-item', row.itemId),
    pinnedRevisionId: localId('item-revision', row.pinnedRevisionId),
    targetRevisionId: localId('item-revision', row.targetRevisionId),
    impactVersion: row.impactVersion,
    entryCount: row.entryCount,
    updatedAt: row.updatedAt,
  });
}

function contextCursor(row: WorkingContextRow): ContextCursor {
  return {
    version: 1,
    pinGroup: row.pinnedOrder === null ? 1 : 0,
    pinOrder: row.pinnedOrder ?? 2_147_483_647,
    updatedAt: row.updatedAt,
    contextId: row.contextId,
  };
}

function decodeContextCursor(cursor: string): ContextCursor | undefined {
  const value = decodeCursor<Partial<ContextCursor>>(cursor);
  return value?.version === 1 &&
    (value.pinGroup === 0 || value.pinGroup === 1) &&
    Number.isSafeInteger(value.pinOrder) &&
    typeof value.updatedAt === 'string' &&
    Number.isSafeInteger(value.contextId) &&
    (value.contextId ?? 0) > 0
    ? (value as ContextCursor)
    : undefined;
}

const workingContextSelect = `
  SELECT c.context_id AS contextId,
         c.display_name AS displayName,
         c.purpose,
         c.boundary_text AS boundary,
         c.next_step AS nextStep,
         c.lifecycle,
         c.pinned_order AS pinnedOrder,
         c.context_version AS contextVersion,
         (SELECT count(*) FROM workspace_context_reference AS r
            WHERE r.context_id = c.context_id) AS referenceCount,
         (SELECT count(*) FROM workspace_context_item AS member
            WHERE member.context_id = c.context_id) AS itemCount,
         (SELECT count(*) FROM workspace_pending_revision_impact AS impact
            WHERE impact.context_id = c.context_id) AS pendingRevisionImpactCount,
         management.resume_version AS managementResumeVersion,
         analysis.resume_version AS analysisResumeVersion,
         c.created_at_utc AS createdAt,
         c.updated_at_utc AS updatedAt
    FROM workspace_working_context AS c
    LEFT JOIN workspace_management_resume AS management
      ON management.context_id = c.context_id
    LEFT JOIN workspace_analysis_resume AS analysis
      ON analysis.context_id = c.context_id`;
