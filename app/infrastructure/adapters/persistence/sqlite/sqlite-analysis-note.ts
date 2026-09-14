import type Database from 'better-sqlite3';

import {
  analysisScratchNotFound,
  analysisScratchRevisionConflict,
  analysisNoteRevisionConflict,
  invalidAnalysisNote,
  type AnalysisNoteMutationResult,
  type AnalysisNoteScope,
  type CreateAnalysisNoteResult,
  type PersistDeleteAnalysisNoteRequest,
  type PersistAnalysisNoteRequest,
  type PersistPositionNoteRequest,
  type PersistUpdateAnalysisNoteRequest,
} from '../../../../application/analysis/index.ts';
import type { AnalysisNoteDraft } from '../../../../domain/analysis/index.ts';
import type {
  CanonicalMove,
  PromotionPiece,
} from '../../../../domain/chess_graph/index.ts';
import {
  localId,
  type AnchorId,
  type ContributionId,
  type InventoryItemId,
  type WorkingContextId,
} from '../../../../domain/identity/index.ts';
import {
  deleteContextScratch,
  readContextScratch,
} from './sqlite-analysis-scratch.ts';
import { incrementDataRevision } from './sqlite-store-helpers.ts';
import {
  requireActiveContext,
  resolveAnchorPosition,
} from './sqlite-workspace.ts';

export function createAnalysisNote(
  database: Database.Database,
  request: PersistAnalysisNoteRequest,
): CreateAnalysisNoteResult {
  validateSourceScratch(database, request);
  const positionId = resolveAnchorPosition(
    database,
    request.origin.itemId.value,
    request.origin.revisionId.value,
    request.origin.anchorId.value,
  );
  if (positionId === undefined) throw invalidAnalysisNote();
  validateNoteScope(
    database,
    request.noteScope,
    request.sourceContextId,
    request.origin.itemId,
  );

  const contributionId = insertAnalysisNoteContribution(database, {
    itemId: request.origin.itemId,
    anchorId: request.origin.anchorId,
    note: request.note,
    noteScope: request.noteScope,
    languageTag: request.languageTag,
    occurredAt: request.occurredAt,
  });
  const resumeUpdate =
    request.sourceContextId === undefined
      ? undefined
      : restoreContextResume(
          database,
          request.sourceContextId,
          request.origin,
          positionId,
          request.occurredAt,
        );
  if (request.sourceContextId !== undefined) {
    deleteContextScratch(database, request.sourceContextId.value);
  }
  const dataRevision = incrementDataRevision(database, request.occurredAt);
  return Object.freeze({
    contributionId,
    itemId: request.origin.itemId,
    revisionId: request.origin.revisionId,
    anchorId: request.origin.anchorId,
    scopeKind: request.noteScope.kind,
    ...(request.noteScope.kind === 'context'
      ? { contextId: request.noteScope.contextId }
      : {}),
    ...(resumeUpdate === undefined ? {} : { resumeUpdate }),
    dataRevision,
  });
}

export function createPositionNote(
  database: Database.Database,
  request: PersistPositionNoteRequest,
): AnalysisNoteMutationResult {
  if (
    resolveAnchorPosition(
      database,
      request.itemId.value,
      request.revisionId.value,
      request.anchorId.value,
    ) === undefined
  ) {
    throw invalidAnalysisNote();
  }
  validatePositionNoteScope(
    database,
    request.noteScope,
    request.scope,
    request.itemId,
  );
  const contributionId = insertAnalysisNoteContribution(database, {
    itemId: request.itemId,
    anchorId: request.anchorId,
    note: request.note,
    noteScope: request.noteScope,
    languageTag: request.languageTag,
    occurredAt: request.occurredAt,
  });
  return noteMutationResult(
    database,
    contributionId,
    request.itemId,
    request.anchorId,
    1,
    request.occurredAt,
  );
}

export function updateAnalysisNote(
  database: Database.Database,
  request: PersistUpdateAnalysisNoteRequest,
): AnalysisNoteMutationResult {
  const note = readEditableNote(database, request.contributionId);
  validateMutationScope(database, note, request.scope);
  assertContributionVersion(note, request.expectedContributionVersion);
  const contributionVersion = note.contributionVersion + 1;
  const changed = database
    .prepare(
      `UPDATE workspace_contribution
          SET body = ?, contribution_version = ?, updated_at_utc = ?
        WHERE contribution_id = ? AND status = 'active'
          AND contribution_version = ?`,
    )
    .run(
      request.body,
      contributionVersion,
      request.occurredAt,
      request.contributionId.value,
      request.expectedContributionVersion,
    );
  if (changed.changes !== 1) throw invalidAnalysisNote();
  database
    .prepare(
      `UPDATE search_document SET body = ?, stable_sort_value = ?
        WHERE contribution_id = ?`,
    )
    .run(request.body, request.occurredAt, request.contributionId.value);
  return noteMutationResult(
    database,
    request.contributionId,
    note.itemId,
    note.anchorId,
    contributionVersion,
    request.occurredAt,
  );
}

export function deleteAnalysisNote(
  database: Database.Database,
  request: PersistDeleteAnalysisNoteRequest,
): AnalysisNoteMutationResult {
  const note = readEditableNote(database, request.contributionId);
  validateMutationScope(database, note, request.scope);
  assertContributionVersion(note, request.expectedContributionVersion);
  const contributionVersion = note.contributionVersion + 1;
  const changed = database
    .prepare(
      `UPDATE workspace_contribution
          SET status = 'archived', contribution_version = ?, updated_at_utc = ?
        WHERE contribution_id = ? AND status = 'active'
          AND contribution_version = ?`,
    )
    .run(
      contributionVersion,
      request.occurredAt,
      request.contributionId.value,
      request.expectedContributionVersion,
    );
  if (changed.changes !== 1) throw invalidAnalysisNote();
  database
    .prepare(`DELETE FROM search_document WHERE contribution_id = ?`)
    .run(request.contributionId.value);
  return noteMutationResult(
    database,
    request.contributionId,
    note.itemId,
    note.anchorId,
    contributionVersion,
    request.occurredAt,
  );
}

export function insertAnalysisNoteContribution(
  database: Database.Database,
  request: {
    readonly itemId: InventoryItemId;
    readonly anchorId: AnchorId;
    readonly note: AnalysisNoteDraft;
    readonly noteScope: AnalysisNoteScope;
    readonly languageTag: string;
    readonly occurredAt: string;
    readonly title?: string;
  },
) {
  const inserted = database
    .prepare(
      `INSERT INTO workspace_contribution
         (contribution_type, author_role, scope_kind, context_id, anchor_id,
          body, rationale, status, contribution_version, language_tag,
          created_at_utc, updated_at_utc)
       VALUES ('note', 'user', ?, ?, ?, ?, NULL, 'active', 1, ?, ?, ?)`,
    )
    .run(
      request.noteScope.kind,
      request.noteScope.kind === 'context'
        ? request.noteScope.contextId.value
        : null,
      request.anchorId.value,
      request.note.body,
      request.languageTag,
      request.occurredAt,
      request.occurredAt,
    );
  const contributionId = localId(
    'contribution',
    Number(inserted.lastInsertRowid),
  );
  const insertStep = database.prepare(
    `INSERT INTO workspace_analysis_note_path_step
       (contribution_id, step_index, from_square, to_square, promotion, san)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const [index, move] of request.note.moves.entries()) {
    insertStep.run(
      contributionId.value,
      index,
      move.from,
      move.to,
      move.promotion ?? null,
      move.san,
    );
  }
  database
    .prepare(
      `INSERT INTO search_document
         (projection_version, subject_kind, item_id, item_revision_id,
          contribution_id, anchor_id, context_id, language_tag,
          evidence_class, scope_kind, stable_sort_value, title,
          aliases_concepts, metadata, body)
       VALUES (1, 'contribution', NULL, NULL, ?, ?, ?, ?,
               'personal', ?, ?, ?, '', 'analysis note', ?)`,
    )
    .run(
      contributionId.value,
      request.anchorId.value,
      request.noteScope.kind === 'context'
        ? request.noteScope.contextId.value
        : null,
      request.languageTag,
      request.noteScope.kind,
      request.occurredAt,
      request.title ?? '',
      request.note.body,
    );
  return contributionId;
}

export function readAnalysisNoteMoves(
  database: Database.Database,
  contributionIds: readonly number[],
): ReadonlyMap<number, readonly CanonicalMove[]> {
  if (contributionIds.length === 0) return new Map();
  const placeholders = contributionIds.map(() => '?').join(', ');
  const rows = database
    .prepare(
      `SELECT contribution_id AS contributionId, from_square AS 'from',
              to_square AS 'to', promotion, san
         FROM workspace_analysis_note_path_step
        WHERE contribution_id IN (${placeholders})
        ORDER BY contribution_id, step_index`,
    )
    .all(...contributionIds) as {
    contributionId: number;
    from: string;
    to: string;
    promotion: PromotionPiece | null;
    san: string;
  }[];
  const byContribution = new Map<number, CanonicalMove[]>();
  for (const row of rows) {
    const moves = byContribution.get(row.contributionId) ?? [];
    moves.push(
      Object.freeze({
        from: row.from,
        to: row.to,
        ...(row.promotion === null ? {} : { promotion: row.promotion }),
        san: row.san,
      }),
    );
    byContribution.set(row.contributionId, moves);
  }
  return new Map(
    [...byContribution].map(([contributionId, moves]) => [
      contributionId,
      Object.freeze(moves),
    ]),
  );
}

function validateSourceScratch(
  database: Database.Database,
  request: PersistAnalysisNoteRequest,
): void {
  if (request.sourceContextId === undefined) return;
  if (
    request.expectedScratchId === undefined ||
    request.expectedScratchRevision === undefined
  ) {
    throw invalidAnalysisNote();
  }
  requireActiveContext(database, request.sourceContextId);
  const scratch = readContextScratch(database, request.sourceContextId);
  if (scratch === undefined) throw analysisScratchNotFound();
  if (
    scratch.scratchId !== request.expectedScratchId ||
    scratch.scratchRevision !== request.expectedScratchRevision
  ) {
    throw analysisScratchRevisionConflict(
      request.expectedScratchRevision,
      scratch.scratchRevision,
    );
  }
  if (
    scratch.origin.kind !== 'inventory_anchor' ||
    scratch.origin.itemId.value !== request.origin.itemId.value ||
    scratch.origin.revisionId.value !== request.origin.revisionId.value ||
    scratch.origin.anchorId.value !== request.origin.anchorId.value
  ) {
    throw invalidAnalysisNote();
  }
}

function validateNoteScope(
  database: Database.Database,
  noteScope: AnalysisNoteScope,
  sourceContextId: WorkingContextId | undefined,
  itemId: InventoryItemId,
): void {
  if (sourceContextId !== undefined) {
    requireContextItemAccess(database, sourceContextId, itemId);
  }
  if (noteScope.kind === 'global') return;
  if (
    sourceContextId === undefined ||
    noteScope.contextId.value !== sourceContextId.value
  ) {
    throw invalidAnalysisNote();
  }
}

function validatePositionNoteScope(
  database: Database.Database,
  noteScope: AnalysisNoteScope,
  scope: PersistPositionNoteRequest['scope'],
  itemId: InventoryItemId,
): void {
  if (scope.kind === 'context') {
    requireContextItemAccess(database, scope.contextId, itemId);
  }
  if (noteScope.kind === 'global') return;
  if (
    scope.kind !== 'context' ||
    noteScope.contextId.value !== scope.contextId.value
  ) {
    throw invalidAnalysisNote();
  }
}

interface EditableNote {
  readonly itemId: InventoryItemId;
  readonly anchorId: AnchorId;
  readonly scopeKind: 'global' | 'context';
  readonly contextId: WorkingContextId | undefined;
  readonly contributionVersion: number;
}

function readEditableNote(
  database: Database.Database,
  contributionId: ContributionId,
): EditableNote {
  const row = database
    .prepare(
      `SELECT coalesce(anchor.owner_item_id, anchor.item_id) AS itemId,
              contribution.anchor_id AS anchorId,
              contribution.scope_kind AS scopeKind,
              contribution.context_id AS contextId,
              contribution.contribution_version AS contributionVersion
         FROM workspace_contribution AS contribution
         JOIN chess_anchor AS anchor
           ON anchor.anchor_id = contribution.anchor_id
        WHERE contribution.contribution_id = ?
          AND contribution.contribution_type = 'note'
          AND contribution.author_role = 'user'
          AND contribution.status = 'active'`,
    )
    .get(contributionId.value) as
    | {
        itemId: number;
        anchorId: number;
        scopeKind: 'global' | 'context';
        contextId: number | null;
        contributionVersion: number;
      }
    | undefined;
  if (row === undefined) throw invalidAnalysisNote();
  return Object.freeze({
    itemId: localId('inventory-item', row.itemId),
    anchorId: localId('anchor', row.anchorId),
    scopeKind: row.scopeKind,
    contextId:
      row.contextId === null
        ? undefined
        : localId('working-context', row.contextId),
    contributionVersion: row.contributionVersion,
  });
}

function validateMutationScope(
  database: Database.Database,
  note: EditableNote,
  scope: PersistUpdateAnalysisNoteRequest['scope'],
): void {
  if (scope.kind === 'context') {
    requireContextItemAccess(database, scope.contextId, note.itemId);
  }
  if (note.scopeKind === 'global') return;
  if (
    scope.kind !== 'context' ||
    note.contextId?.value !== scope.contextId.value
  ) {
    throw invalidAnalysisNote();
  }
}

function requireContextItemAccess(
  database: Database.Database,
  contextId: WorkingContextId,
  itemId: InventoryItemId,
): void {
  requireActiveContext(database, contextId);
  const membership = database
    .prepare(
      `SELECT 1 FROM workspace_context_item
        WHERE context_id = ? AND item_id = ?`,
    )
    .get(contextId.value, itemId.value);
  if (membership === undefined) throw invalidAnalysisNote();
}

function assertContributionVersion(
  note: EditableNote,
  expectedContributionVersion: number,
): void {
  if (note.contributionVersion !== expectedContributionVersion) {
    throw analysisNoteRevisionConflict(
      expectedContributionVersion,
      note.contributionVersion,
    );
  }
}

function noteMutationResult(
  database: Database.Database,
  contributionId: ContributionId,
  itemId: InventoryItemId,
  anchorId: AnchorId,
  contributionVersion: number,
  occurredAt: string,
): AnalysisNoteMutationResult {
  return Object.freeze({
    contributionId,
    itemId,
    anchorId,
    contributionVersion,
    dataRevision: incrementDataRevision(database, occurredAt),
  });
}

function restoreContextResume(
  database: Database.Database,
  contextId: WorkingContextId,
  origin: PersistAnalysisNoteRequest['origin'],
  positionId: number,
  occurredAt: string,
) {
  const current = database
    .prepare(
      `SELECT resume_version AS resumeVersion
         FROM workspace_analysis_resume
        WHERE context_id = ? AND analysis_scratch_draft_id IS NOT NULL`,
    )
    .get(contextId.value) as { resumeVersion: number } | undefined;
  if (current === undefined) throw invalidAnalysisNote();
  const resumeVersion = current.resumeVersion + 1;
  const changed = database
    .prepare(
      `UPDATE workspace_analysis_resume
          SET resume_version = ?, item_id = ?, revision_id = ?, anchor_id = ?,
              mode = 'analyze', current_position_id = ?,
              analysis_scratch_draft_id = NULL, updated_at_utc = ?
        WHERE context_id = ? AND analysis_scratch_draft_id IS NOT NULL`,
    )
    .run(
      resumeVersion,
      origin.itemId.value,
      origin.revisionId.value,
      origin.anchorId.value,
      positionId,
      occurredAt,
      contextId.value,
    );
  if (changed.changes !== 1) throw invalidAnalysisNote();
  return Object.freeze({ contextId, resumeVersion });
}
