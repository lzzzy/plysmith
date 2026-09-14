import type Database from 'better-sqlite3';

import type {
  AddContextReferenceRequest,
  AddContextReferenceResult,
  AnalysisResume,
  ContextReferenceSummary,
  CreateWorkingContextResult,
  ManagementResume,
  SetWorkScopeResumeRequest,
  SetWorkScopeResumeResult,
  WorkingContextSummary,
  WorkingContextWorkspace,
} from '../../../../application/workspace/index.ts';
import {
  contextReferenceConflict,
  contextReferenceNotFound,
  invalidResume,
  invalidWorkspacePage,
  resumeRevisionConflict,
  workingContextNotFound,
} from '../../../../application/workspace/index.ts';
import {
  localId,
  type WorkingContextId,
} from '../../../../domain/identity/index.ts';
import type { WorkingContextDraft } from '../../../../domain/workspace/index.ts';
import {
  decodeCursor,
  encodeCursor,
  incrementDataRevision,
  readDataRevision,
} from './sqlite-store-helpers.ts';

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
  if (context === undefined) return undefined;
  const references = database
    .prepare(
      `SELECT r.reference_id AS referenceId,
              r.item_id AS itemId,
              i.current_revision_id AS currentRevisionId,
              i.item_type AS itemType,
              v.display_name AS displayName,
              r.anchor_id AS anchorId,
              a.anchor_kind AS anchorKind,
              r.created_at_utc AS createdAt
         FROM workspace_context_reference AS r
         JOIN inventory_item AS i ON i.item_id = r.item_id
         JOIN item_revision AS v ON v.revision_id = i.current_revision_id
         JOIN chess_anchor AS a ON a.anchor_id = r.anchor_id
        WHERE r.context_id = ?
        ORDER BY r.created_at_utc, r.reference_id`,
    )
    .all(contextId.value) as ContextReferenceRow[];
  const managementResume = readManagementResume(database, contextId);
  const analysisResume = readAnalysisResume(database, contextId);
  return Object.freeze({
    context,
    references: Object.freeze(references.map(mapContextReference)),
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

export function setWorkScopeResume(
  database: Database.Database,
  request: SetWorkScopeResumeRequest,
  occurredAt: string,
): SetWorkScopeResumeResult {
  requireActiveContext(database, request.contextId);
  if (request.area === 'manage') {
    const currentVersion = currentResumeVersion(
      database,
      'workspace_management_resume',
      request.contextId.value,
    );
    assertResumeRevision(request.expectedResumeVersion, currentVersion);
    if (
      request.selectedItemId !== undefined &&
      request.selectedAnchorId !== undefined
    ) {
      requireContextSelection(
        database,
        request.contextId.value,
        request.selectedItemId.value,
        request.selectedAnchorId.value,
      );
    }
    const resumeVersion = (currentVersion ?? 0) + 1;
    database
      .prepare(
        `INSERT INTO workspace_management_resume
           (context_id, resume_version, presentation, selected_item_id,
            selected_anchor_id, updated_at_utc)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(context_id) DO UPDATE SET
           resume_version = excluded.resume_version,
           presentation = excluded.presentation,
           selected_item_id = excluded.selected_item_id,
           selected_anchor_id = excluded.selected_anchor_id,
           updated_at_utc = excluded.updated_at_utc`,
      )
      .run(
        request.contextId.value,
        resumeVersion,
        request.presentation,
        request.selectedItemId?.value ?? null,
        request.selectedAnchorId?.value ?? null,
        occurredAt,
      );
    const dataRevision = incrementDataRevision(database, occurredAt);
    const resume = readManagementResume(database, request.contextId);
    if (resume === undefined) throw invalidResume();
    return Object.freeze({ area: 'manage', resume, dataRevision });
  }

  const currentVersion = currentResumeVersion(
    database,
    'workspace_analysis_resume',
    request.contextId.value,
  );
  assertResumeRevision(request.expectedResumeVersion, currentVersion);
  const openScratch = database
    .prepare(`SELECT 1 FROM analysis_scratch_draft WHERE context_id = ?`)
    .get(request.contextId.value);
  if (openScratch !== undefined) throw invalidResume();
  if (
    request.itemId === undefined ||
    request.revisionId === undefined ||
    request.anchorId === undefined
  ) {
    throw invalidResume();
  }
  requireContextItem(database, request.contextId.value, request.itemId.value);
  const currentPositionId = resolveAnchorPosition(
    database,
    request.itemId.value,
    request.revisionId.value,
    request.anchorId.value,
  );
  if (currentPositionId === undefined) throw invalidResume();
  const resumeVersion = (currentVersion ?? 0) + 1;
  database
    .prepare(
      `INSERT INTO workspace_analysis_resume
         (context_id, resume_version, item_id, revision_id, anchor_id,
          mode, current_position_id, analysis_scratch_draft_id, updated_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(context_id) DO UPDATE SET
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
      request.contextId.value,
      resumeVersion,
      request.itemId.value,
      request.revisionId.value,
      request.anchorId.value,
      request.mode,
      currentPositionId,
      occurredAt,
    );
  const dataRevision = incrementDataRevision(database, occurredAt);
  const resume = readAnalysisResume(database, request.contextId);
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
         LEFT JOIN chess_occurrence_snapshot AS root
           ON root.revision_id = analysis.revision_id
          AND root.occurrence_id = analysis.root_occurrence_id
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

function requireContextItem(
  database: Database.Database,
  contextId: number,
  itemId: number,
): void {
  const row = database
    .prepare(
      `SELECT 1 FROM workspace_context_item
        WHERE context_id = ? AND item_id = ?`,
    )
    .get(contextId, itemId);
  if (row === undefined) throw contextReferenceNotFound();
}

function currentResumeVersion(
  database: Database.Database,
  table: 'workspace_management_resume' | 'workspace_analysis_resume',
  contextId: number,
): number | null {
  const row = database
    .prepare(
      `SELECT resume_version AS resumeVersion FROM ${table} WHERE context_id = ?`,
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

function readManagementResume(
  database: Database.Database,
  contextId: WorkingContextId,
): ManagementResume | undefined {
  const row = database
    .prepare(
      `SELECT resume_version AS resumeVersion,
              presentation,
              selected_item_id AS selectedItemId,
              selected_anchor_id AS selectedAnchorId,
              updated_at_utc AS updatedAt
         FROM workspace_management_resume WHERE context_id = ?`,
    )
    .get(contextId.value) as
    | {
        resumeVersion: number;
        presentation: 'list' | 'atlas';
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

function readAnalysisResume(
  database: Database.Database,
  contextId: WorkingContextId,
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
        WHERE resume.context_id = ?`,
    )
    .get(contextId.value) as
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
         management.resume_version AS managementResumeVersion,
         analysis.resume_version AS analysisResumeVersion,
         c.created_at_utc AS createdAt,
         c.updated_at_utc AS updatedAt
    FROM workspace_working_context AS c
    LEFT JOIN workspace_management_resume AS management
      ON management.context_id = c.context_id
    LEFT JOIN workspace_analysis_resume AS analysis
      ON analysis.context_id = c.context_id`;
