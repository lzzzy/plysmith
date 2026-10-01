import type Database from 'better-sqlite3';

import {
  currentAnalysisState,
  type AnalysisScratch,
  type AnalysisScratchIntent,
  type AnalysisScratchOrigin,
  type AnalysisScratchStep,
} from '../../../../domain/analysis/index.ts';
import {
  localId,
  type WorkingContextId,
} from '../../../../domain/identity/index.ts';
import {
  analysisScratchNotFound,
  analysisScratchRevisionConflict,
  type ContextAnalysisWriter,
} from '../../../../application/analysis/index.ts';
import { invalidAnalysisUpdate } from '../../../../application/analysis/index.ts';
import { readContextScratch } from './sqlite-analysis-scratch-state.ts';
import {
  deleteUnreferencedPositions,
  ensurePosition,
} from './sqlite-chess-state.ts';
import {
  deleteContextScratch,
  readScratchPositionIds,
} from './sqlite-context-scratch.ts';
import { incrementDataRevision } from './sqlite-store-helpers.ts';
import {
  assertNoOpenRevisionImpact,
  releaseObsoleteResumeImpact,
} from './sqlite-revision-impact-state.ts';
import {
  requireActiveContext,
  resolveAnchorPosition,
} from './sqlite-workspace.ts';
import { requireContextInventoryWorkAccess } from './sqlite-context-item.ts';

export function replaceContextAnalysisScratch(
  database: Database.Database,
  request: Omit<
    Parameters<ContextAnalysisWriter['replaceContextAnalysisScratch']>[0],
    'contextId'
  > & { readonly contextId: WorkingContextId | null },
): Awaited<ReturnType<ContextAnalysisWriter['replaceContextAnalysisScratch']>> {
  if (request.contextId !== null)
    requireActiveContext(database, request.contextId);
  const itemId = scratchItemId(request.scratch);
  if (itemId !== undefined) {
    requireContextInventoryWorkAccess(
      database,
      request.contextId === null ||
        (request.scratch.intent.kind === 'inventory_revision' &&
          request.scratch.intent.mode === 'metadata')
        ? { kind: 'free' }
        : { kind: 'context', contextId: request.contextId },
      localId('inventory-item', itemId),
    );
  }
  if (itemId !== undefined && request.contextId !== null) {
    assertNoOpenRevisionImpact(database, request.contextId.value, itemId);
    requireEffectiveContextRevision(
      database,
      request.contextId.value,
      request.scratch,
    );
  }
  const current = currentScratchIdentity(
    database,
    request.contextId?.value ?? null,
  );
  assertExpectedScratch(
    request.expectedScratchId,
    request.expectedScratchRevision,
    current,
  );
  if (
    current !== undefined &&
    request.scratch.scratchId !== current.scratchKey
  ) {
    throw invalidAnalysisUpdate();
  }
  validateScratchOrigin(database, request.scratch);
  const intentValues = scratchIntentValues(request.scratch.intent);
  const replacedPositionIds =
    current === undefined
      ? []
      : readScratchPositionIds(database, current.scratchId);

  const rootPositionId = ensurePosition(
    database,
    request.scratch.root.position,
  ).value;
  let scratchId = current?.scratchId;
  if (scratchId === undefined) {
    const inserted = database
      .prepare(
        `INSERT INTO analysis_scratch_draft
           (scratch_key, context_id, origin_mode, origin_item_id, origin_revision_id,
            origin_anchor_id, root_position_id, root_halfmove_clock,
            root_fullmove_number, root_history_knowledge, cursor_index,
            scratch_revision, note_body, scratch_mode, edit_mode, edit_item_id,
            base_revision_id, cut_anchor_id, return_anchor_id,
            candidate_display_name, candidate_summary_text,
            created_at_utc, updated_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        request.scratch.scratchId,
        request.contextId?.value ?? null,
        request.scratch.origin.kind,
        request.scratch.origin.kind === 'inventory_anchor'
          ? request.scratch.origin.itemId.value
          : null,
        request.scratch.origin.kind === 'inventory_anchor'
          ? request.scratch.origin.revisionId.value
          : null,
        request.scratch.origin.kind === 'inventory_anchor'
          ? request.scratch.origin.anchorId.value
          : null,
        rootPositionId,
        request.scratch.root.playState.halfmoveClock,
        request.scratch.root.playState.fullmoveNumber,
        request.scratch.root.playState.historyKnowledge,
        request.scratch.cursor,
        request.scratch.scratchRevision,
        request.scratch.noteDraft?.body ?? null,
        ...intentValues,
        request.occurredAt,
        request.occurredAt,
      );
    scratchId = Number(inserted.lastInsertRowid);
  } else {
    database
      .prepare(
        `UPDATE analysis_scratch_draft
            SET root_position_id = ?, cursor_index = ?, scratch_revision = ?,
                note_body = ?, scratch_mode = ?, edit_mode = ?,
                edit_item_id = ?, base_revision_id = ?, cut_anchor_id = ?,
                return_anchor_id = ?, candidate_display_name = ?,
                candidate_summary_text = ?, updated_at_utc = ?
          WHERE scratch_draft_id = ?`,
      )
      .run(
        rootPositionId,
        request.scratch.cursor,
        request.scratch.scratchRevision,
        request.scratch.noteDraft?.body ?? null,
        ...intentValues,
        request.occurredAt,
        scratchId,
      );
    database
      .prepare('DELETE FROM analysis_scratch_step WHERE scratch_draft_id = ?')
      .run(scratchId);
  }
  writeScratchSteps(database, scratchId, request.scratch.steps);

  const currentState = currentAnalysisState(request.scratch);
  const currentPositionId = ensurePosition(
    database,
    currentState.position,
  ).value;
  const resumeVersion = upsertScratchResume(
    database,
    request.contextId?.value ?? null,
    scratchId,
    request.scratch.origin,
    request.scratch.intent,
    currentPositionId,
    request.occurredAt,
  );
  if (request.contextId !== null)
    releaseObsoleteResumeImpact(
      database,
      request.contextId.value,
      'analysis_resume',
    );
  deleteUnreferencedPositions(database, replacedPositionIds);
  const dataRevision = incrementDataRevision(database, request.occurredAt);
  const scratch = readContextScratch(database, request.contextId);
  if (scratch === undefined) throw analysisScratchNotFound();
  return Object.freeze({ scratch, dataRevision, resumeVersion });
}

export function discardContextAnalysisScratch(
  database: Database.Database,
  request: Omit<
    Parameters<ContextAnalysisWriter['discardContextAnalysisScratch']>[0],
    'contextId'
  > & { readonly contextId: WorkingContextId | null },
): Awaited<ReturnType<ContextAnalysisWriter['discardContextAnalysisScratch']>> {
  if (request.contextId !== null)
    requireActiveContext(database, request.contextId);
  const current = currentScratchIdentity(
    database,
    request.contextId?.value ?? null,
  );
  if (current === undefined) throw analysisScratchNotFound();
  assertExpectedScratch(
    request.expectedScratchId,
    request.expectedScratchRevision,
    current,
  );
  const resumeVersion = clearScratchResume(
    database,
    request.contextId?.value ?? null,
    current,
    request.occurredAt,
  );
  deleteContextScratch(database, request.contextId?.value ?? null);
  return Object.freeze({
    dataRevision: incrementDataRevision(database, request.occurredAt),
    resumeVersion,
  });
}

function writeScratchSteps(
  database: Database.Database,
  scratchId: number,
  steps: readonly AnalysisScratchStep[],
): void {
  const insert = database.prepare(
    `INSERT INTO analysis_scratch_step
       (scratch_draft_id, step_index,
        before_position_id, before_halfmove_clock, before_fullmove_number,
        after_position_id, after_halfmove_clock, after_fullmove_number,
        from_square, to_square, promotion, san)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [index, step] of steps.entries()) {
    insert.run(
      scratchId,
      index,
      ensurePosition(database, step.before.position).value,
      step.before.playState.halfmoveClock,
      step.before.playState.fullmoveNumber,
      ensurePosition(database, step.after.position).value,
      step.after.playState.halfmoveClock,
      step.after.playState.fullmoveNumber,
      step.move.from,
      step.move.to,
      step.move.promotion ?? null,
      step.move.san,
    );
  }
}

function upsertScratchResume(
  database: Database.Database,
  contextId: number | null,
  scratchId: number,
  origin: AnalysisScratchOrigin,
  intent: AnalysisScratchIntent,
  currentPositionId: number,
  occurredAt: string,
): number {
  const current = database
    .prepare(
      `SELECT resume_version AS resumeVersion
         FROM workspace_analysis_resume WHERE context_id IS ?`,
    )
    .get(contextId) as { resumeVersion: number } | undefined;
  const resumeVersion = (current?.resumeVersion ?? 0) + 1;
  database
    .prepare(
      `INSERT INTO workspace_analysis_resume
         (context_id, resume_version, item_id, revision_id, anchor_id,
          mode, current_position_id, analysis_scratch_draft_id, updated_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO UPDATE SET
         resume_version = excluded.resume_version,
         item_id = excluded.item_id,
         revision_id = excluded.revision_id,
         anchor_id = excluded.anchor_id,
         mode = excluded.mode,
         current_position_id = excluded.current_position_id,
         analysis_scratch_draft_id = excluded.analysis_scratch_draft_id,
         updated_at_utc = excluded.updated_at_utc`,
    )
    .run(
      contextId,
      resumeVersion,
      origin.kind === 'inventory_anchor' ? origin.itemId.value : null,
      origin.kind === 'inventory_anchor' ? origin.revisionId.value : null,
      origin.kind === 'inventory_anchor' ? origin.anchorId.value : null,
      intent.kind === 'inventory_revision' ? 'edit_inventory' : 'analyze',
      currentPositionId,
      scratchId,
      occurredAt,
    );
  return resumeVersion;
}

function validateScratchOrigin(
  database: Database.Database,
  scratch: AnalysisScratch,
): void {
  if (scratch.origin.kind !== 'inventory_anchor') return;
  const positionId = resolveAnchorPosition(
    database,
    scratch.origin.itemId.value,
    scratch.origin.revisionId.value,
    scratch.origin.anchorId.value,
  );
  if (positionId === undefined) throw invalidAnalysisUpdate();
  const rootPositionId = ensurePosition(database, scratch.root.position).value;
  if (positionId !== rootPositionId) throw invalidAnalysisUpdate();
  if (
    scratch.intent.kind === 'inventory_revision' &&
    (scratch.origin.itemId.value !== scratch.intent.itemId.value ||
      scratch.origin.revisionId.value !== scratch.intent.baseRevisionId.value ||
      scratch.origin.anchorId.value !== scratch.intent.cutAnchorId.value)
  ) {
    throw invalidAnalysisUpdate();
  }
}

function scratchItemId(scratch: AnalysisScratch): number | undefined {
  if (scratch.intent.kind === 'inventory_revision') {
    return scratch.intent.itemId.value;
  }
  return scratch.origin.kind === 'inventory_anchor'
    ? scratch.origin.itemId.value
    : undefined;
}

function requireEffectiveContextRevision(
  database: Database.Database,
  contextId: number,
  scratch: AnalysisScratch,
): void {
  if (scratch.origin.kind !== 'inventory_anchor') return;
  if (
    scratch.intent.kind === 'inventory_revision' &&
    scratch.intent.mode === 'metadata'
  )
    return;
  const row = database
    .prepare(
      `SELECT coalesce(member.pinned_revision_id, item.current_revision_id)
                AS effectiveRevisionId
         FROM workspace_context_item AS member
         JOIN inventory_item AS item ON item.item_id = member.item_id
        WHERE member.context_id = ? AND member.item_id = ?
          AND item.lifecycle = 'active'`,
    )
    .get(contextId, scratch.origin.itemId.value) as
    { effectiveRevisionId: number } | undefined;
  if (row?.effectiveRevisionId !== scratch.origin.revisionId.value) {
    throw invalidAnalysisUpdate();
  }
}

function scratchIntentValues(
  intent: AnalysisScratchIntent,
): readonly (string | number | null)[] {
  return intent.kind === 'exploration'
    ? ['exploration', null, null, null, null, null, null, null]
    : [
        intent.kind,
        intent.mode,
        intent.itemId.value,
        intent.baseRevisionId.value,
        intent.cutAnchorId.value,
        intent.returnAnchorId.value,
        intent.displayName,
        intent.summary ?? null,
      ];
}

function currentScratchIdentity(
  database: Database.Database,
  contextId: number | null,
):
  | {
      readonly scratchId: number;
      readonly scratchKey: string;
      readonly scratchRevision: number;
      readonly rootPositionId: number;
      readonly originItemId: number | null;
      readonly originRevisionId: number | null;
      readonly originAnchorId: number | null;
      readonly returnAnchorId: number | null;
    }
  | undefined {
  return database
    .prepare(
      `SELECT scratch_draft_id AS scratchId,
              scratch_key AS scratchKey,
              scratch_revision AS scratchRevision,
              root_position_id AS rootPositionId,
              origin_item_id AS originItemId,
              origin_revision_id AS originRevisionId,
              origin_anchor_id AS originAnchorId,
              return_anchor_id AS returnAnchorId
         FROM analysis_scratch_draft WHERE context_id IS ?`,
    )
    .get(contextId) as
    | {
        readonly scratchId: number;
        readonly scratchKey: string;
        readonly scratchRevision: number;
        readonly rootPositionId: number;
        readonly originItemId: number | null;
        readonly originRevisionId: number | null;
        readonly originAnchorId: number | null;
        readonly returnAnchorId: number | null;
      }
    | undefined;
}

function clearScratchResume(
  database: Database.Database,
  contextId: number | null,
  scratch: NonNullable<ReturnType<typeof currentScratchIdentity>>,
  occurredAt: string,
): number {
  const member =
    scratch.originItemId === null
      ? undefined
      : contextId === null
        ? database
            .prepare(
              "SELECT 1 FROM inventory_item WHERE item_id = ? AND lifecycle = 'active'",
            )
            .get(scratch.originItemId)
        : database
            .prepare(
              'SELECT 1 FROM workspace_context_item WHERE context_id = ? AND item_id = ?',
            )
            .get(contextId, scratch.originItemId);
  const returnPositionId =
    scratch.originItemId === null ||
    scratch.originRevisionId === null ||
    scratch.returnAnchorId === null
      ? scratch.rootPositionId
      : resolveAnchorPosition(
          database,
          scratch.originItemId,
          scratch.originRevisionId,
          scratch.returnAnchorId,
        );
  if (returnPositionId === undefined) throw invalidAnalysisUpdate();
  const changed = database
    .prepare(
      `UPDATE workspace_analysis_resume
          SET resume_version = resume_version + 1,
              item_id = ?, revision_id = ?, anchor_id = ?,
              mode = 'analyze', current_position_id = ?,
              analysis_scratch_draft_id = NULL, updated_at_utc = ?
        WHERE context_id IS ? AND analysis_scratch_draft_id = ?`,
    )
    .run(
      member === undefined ? null : scratch.originItemId,
      member === undefined ? null : scratch.originRevisionId,
      member === undefined
        ? null
        : (scratch.returnAnchorId ?? scratch.originAnchorId),
      returnPositionId,
      occurredAt,
      contextId,
      scratch.scratchId,
    );
  if (changed.changes !== 1) throw invalidAnalysisUpdate();
  const resume = database
    .prepare(
      `SELECT resume_version AS resumeVersion
         FROM workspace_analysis_resume WHERE context_id IS ?`,
    )
    .get(contextId) as { readonly resumeVersion: number } | undefined;
  if (resume === undefined) throw invalidAnalysisUpdate();
  return resume.resumeVersion;
}

function assertExpectedScratch(
  expectedScratchId: string | null,
  expectedRevision: number | null,
  current: ReturnType<typeof currentScratchIdentity>,
): void {
  const currentScratchId = current === undefined ? null : current.scratchKey;
  const currentRevision = current?.scratchRevision ?? null;
  if (
    expectedScratchId !== currentScratchId ||
    expectedRevision !== currentRevision
  ) {
    throw analysisScratchRevisionConflict(expectedRevision, currentRevision);
  }
}
