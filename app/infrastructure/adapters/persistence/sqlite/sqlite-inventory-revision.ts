import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

import type { AnalysisRecordView } from '../../../../application/analysis/index.ts';
import {
  invalidInventoryRevision,
  inventoryPreviewConflict,
  inventoryRevisionConflict,
  type InventoryRevisionPreview,
  type InventoryRevisionReader,
  type InventoryRevisionWriter,
  type ListInventoryRevisionsResult,
  type SaveInventoryRevisionResult,
} from '../../../../application/inventory/index.ts';
import type {
  AnalysisScratch,
  AnalysisScratchStep,
} from '../../../../domain/analysis/index.ts';
import type {
  ChessState,
  Position,
} from '../../../../domain/chess_graph/index.ts';
import {
  localId,
  type AnchorId,
  type InventoryItemId,
  type ItemRevisionId,
} from '../../../../domain/identity/index.ts';
import {
  inventoryRevisionCandidateSteps,
  type InventoryRevisionLine,
} from '../../../../domain/inventory/index.ts';
import type { WorkScope } from '../../../../domain/workspace/index.ts';
import { readAnalysisRecordView } from './sqlite-analysis-record.ts';
import { analysisContentFingerprint } from './sqlite-analysis-content-fingerprint.ts';
import {
  deleteContextScratch,
  readContextScratch,
} from './sqlite-analysis-scratch.ts';
import { ensurePosition } from './sqlite-chess-state.ts';
import { inventoryDisplayNameIsAvailable } from './sqlite-inventory-display-name.ts';
import {
  applyAutomaticRevisionFollow,
  inspectRevisionImpact,
  persistRevisionImpacts,
  type RevisionImpactInspection,
} from './sqlite-revision-impact.ts';
import {
  decodeCursor,
  encodeCursor,
  incrementDataRevision,
  readDataRevision,
} from './sqlite-store-helpers.ts';
import { resolveAnchorPosition } from './sqlite-workspace.ts';

interface GraphRow {
  readonly depth: number;
  readonly occurrenceId: number;
  readonly occurrenceAnchorId: number;
  readonly positionId: number;
  readonly moveNodeId: number | null;
  readonly moveAnchorId: number | null;
}

interface RevisionCandidate {
  readonly base: AnalysisRecordView;
  readonly graph: readonly GraphRow[];
  readonly candidateSteps: readonly AnalysisScratchStep[];
  readonly preservedMoveCount: number;
  readonly removedSteps: AnalysisRecordView['steps'];
  readonly removedAnchorIds: ReadonlySet<number>;
  readonly impact: RevisionImpactInspection;
  readonly noOp: boolean;
  readonly previewFingerprint: string;
  readonly dataRevision: number;
}

interface RevisionCursor {
  readonly version: 1;
  readonly revisionNumber: number;
  readonly revisionId: number;
}

export function readAnalysisRevision(
  database: Database.Database,
  request: Parameters<InventoryRevisionReader['readAnalysisRevision']>[0],
): AnalysisRecordView | undefined {
  const rootAnchorId = rootAnchor(
    database,
    request.itemId.value,
    request.revisionId.value,
  );
  if (rootAnchorId === undefined) return undefined;
  return readAnalysisRecordView(database, {
    itemId: request.itemId,
    revisionId: request.revisionId,
    anchorId: request.anchorId ?? rootAnchorId,
    ...(request.scope.kind === 'context'
      ? { contextId: request.scope.contextId }
      : {}),
    readOnlyPreview: request.scope.kind === 'context',
  });
}

export function previewInventoryRevision(
  database: Database.Database,
  request: Parameters<InventoryRevisionReader['previewInventoryRevision']>[0],
): InventoryRevisionPreview {
  const candidate = buildCandidate(database, request.scope, request.scratch);
  return previewFromCandidate(request.scratch, candidate);
}

export function listInventoryRevisions(
  database: Database.Database,
  request: Parameters<InventoryRevisionReader['listInventoryRevisions']>[0],
): ListInventoryRevisionsResult {
  const cursor =
    request.cursor === undefined
      ? undefined
      : decodeCursor<RevisionCursor>(request.cursor);
  if (
    cursor !== undefined &&
    (cursor.version !== 1 ||
      !Number.isSafeInteger(cursor.revisionNumber) ||
      !Number.isSafeInteger(cursor.revisionId))
  ) {
    throw invalidInventoryRevision();
  }
  if (request.cursor !== undefined && cursor === undefined) {
    throw invalidInventoryRevision();
  }
  const rows = database
    .prepare(
      `SELECT revision.revision_id AS revisionId,
              revision.revision_number AS revisionNumber,
              revision.base_revision_id AS baseRevisionId,
              revision.display_name AS displayName,
              revision.summary_text AS summary,
              revision.revision_change_kind AS changeKind,
              revision.created_at_utc AS createdAt,
              item.current_revision_id AS currentRevisionId
         FROM item_revision AS revision
         JOIN inventory_item AS item ON item.item_id = revision.item_id
        WHERE revision.item_id = ?
          AND (? IS NULL
               OR revision.revision_number < ?
               OR (revision.revision_number = ? AND revision.revision_id < ?))
        ORDER BY revision.revision_number DESC, revision.revision_id DESC
        LIMIT ?`,
    )
    .all(
      request.itemId.value,
      cursor?.version ?? null,
      cursor?.revisionNumber ?? 0,
      cursor?.revisionNumber ?? 0,
      cursor?.revisionId ?? 0,
      request.pageSize + 1,
    ) as {
    revisionId: number;
    revisionNumber: number;
    baseRevisionId: number | null;
    displayName: string;
    summary: string | null;
    changeKind:
      'created' | 'extend' | 'truncate_after' | 'replace_move' | 'metadata';
    createdAt: string;
    currentRevisionId: number;
  }[];
  const hasMore = rows.length > request.pageSize;
  const page = rows.slice(0, request.pageSize);
  const last = page.at(-1);
  return Object.freeze({
    revisions: Object.freeze(
      page.map((row) =>
        Object.freeze({
          itemId: request.itemId,
          revisionId: localId('item-revision', row.revisionId),
          revisionNumber: row.revisionNumber,
          ...(row.baseRevisionId === null
            ? {}
            : {
                baseRevisionId: localId('item-revision', row.baseRevisionId),
              }),
          displayName: row.displayName,
          ...(row.summary === null ? {} : { summary: row.summary }),
          changeKind: row.changeKind,
          createdAt: row.createdAt,
          current: row.revisionId === row.currentRevisionId,
        }),
      ),
    ),
    ...(hasMore && last !== undefined
      ? {
          nextCursor: encodeCursor({
            version: 1,
            revisionNumber: last.revisionNumber,
            revisionId: last.revisionId,
          } satisfies RevisionCursor),
        }
      : {}),
    dataRevision: readDataRevision(database),
  });
}

export function saveInventoryRevision(
  database: Database.Database,
  request: Parameters<InventoryRevisionWriter['saveInventoryRevision']>[0],
): SaveInventoryRevisionResult {
  const intent = request.scratch.intent;
  if (intent.kind !== 'inventory_revision') {
    throw invalidInventoryRevision();
  }
  validateStoredScratch(database, request.scope, request.scratch);
  const candidate = buildCandidate(database, request.scope, request.scratch);
  if (candidate.previewFingerprint !== request.previewFingerprint) {
    throw inventoryPreviewConflict();
  }
  if (candidate.noOp) {
    return Object.freeze({
      itemId: candidate.base.itemId,
      revisionId: candidate.base.revisionId,
      revisionNumber: candidate.base.revisionNumber,
      currentAnchorId:
        candidate.base.steps.at(-1)?.anchorId ?? candidate.base.rootAnchorId,
      impacts: Object.freeze([]),
      noOp: true,
      dataRevision: candidate.dataRevision,
    });
  }

  const revisionId = insertRevision(
    database,
    request.scratch,
    candidate,
    request.occurredAt,
  );
  const revisionEndAnchorId = writeRevisionGraph(
    database,
    revisionId,
    request.scratch,
    candidate,
  );
  const currentAnchorId =
    intent.mode === 'metadata' ? intent.returnAnchorId : revisionEndAnchorId;
  copyAnalysisRevisionMetadata(
    database,
    candidate.base.itemId,
    candidate.base.revisionId,
    revisionId,
  );
  insertRevisionSearchDocument(
    database,
    revisionId,
    candidate.base.itemId,
    candidate.base.rootAnchorId,
    request.scratch,
    candidate.base.languageTag,
    request.occurredAt,
  );
  database
    .prepare(
      `UPDATE inventory_item
          SET current_revision_id = ?, updated_at_utc = ?
        WHERE item_id = ? AND current_revision_id = ?`,
    )
    .run(
      revisionId.value,
      request.occurredAt,
      candidate.base.itemId.value,
      candidate.base.revisionId.value,
    );
  assertCurrentRevision(database, candidate.base.itemId, revisionId);

  const targetAnchors = revisionAnchorIds(
    database,
    candidate.base.itemId.value,
    revisionId.value,
  );
  applyAutomaticRevisionFollow(database, {
    itemId: candidate.base.itemId,
    targetRevisionId: revisionId,
    targetAnchorId: currentAnchorId,
    contexts: candidate.impact.automaticContexts,
    ...(request.scope.kind === 'context'
      ? { publishingContextId: request.scope.contextId }
      : {}),
    occurredAt: request.occurredAt,
  });
  const impacts = persistRevisionImpacts(database, {
    itemId: candidate.base.itemId,
    pinnedRevisionId: candidate.base.revisionId,
    targetRevisionId: revisionId,
    targetAnchorId: currentAnchorId,
    inspection: candidate.impact,
    occurredAt: request.occurredAt,
  });
  const impactedContexts = new Set(
    impacts.map((impact) => impact.contextId.value),
  );
  advanceCompatibleContextState(database, {
    itemId: candidate.base.itemId,
    baseRevisionId: candidate.base.revisionId,
    targetRevisionId: revisionId,
    targetAnchorIds: targetAnchors,
    impactedContexts,
    occurredAt: request.occurredAt,
  });
  if (request.scope.kind === 'context') {
    consumePublishingContextScratch(database, {
      contextId: request.scope.contextId.value,
      itemId: candidate.base.itemId,
      baseRevisionId: candidate.base.revisionId,
      targetRevisionId: revisionId,
      currentAnchorId,
      cutAnchorId: intent.cutAnchorId,
      impacted: impactedContexts.has(request.scope.contextId.value),
      occurredAt: request.occurredAt,
    });
  }
  const dataRevision = incrementDataRevision(database, request.occurredAt);
  return Object.freeze({
    itemId: candidate.base.itemId,
    revisionId,
    revisionNumber: candidate.base.revisionNumber + 1,
    currentAnchorId,
    impacts,
    noOp: false,
    dataRevision,
  });
}

function buildCandidate(
  database: Database.Database,
  scope: WorkScope,
  scratch: AnalysisScratch,
): RevisionCandidate {
  if (scratch.intent.kind !== 'inventory_revision') {
    throw invalidInventoryRevision();
  }
  const intent = scratch.intent;
  const current = database
    .prepare(
      `SELECT current_revision_id AS currentRevisionId
         FROM inventory_item
        WHERE item_id = ? AND item_type = 'analysis' AND lifecycle = 'active'`,
    )
    .get(intent.itemId.value) as
    { currentRevisionId: number | null } | undefined;
  if (current?.currentRevisionId !== intent.baseRevisionId.value) {
    throw inventoryRevisionConflict();
  }
  const base = readAnalysisRevision(database, {
    scope,
    itemId: intent.itemId,
    revisionId: intent.baseRevisionId,
    anchorId: intent.cutAnchorId,
  });
  if (base === undefined || base.historical || base.readOnlyPreview) {
    throw invalidInventoryRevision();
  }
  if (
    !inventoryDisplayNameIsAvailable(
      database,
      intent.displayName,
      intent.itemId.value,
    )
  ) {
    throw invalidInventoryRevision();
  }
  const line: InventoryRevisionLine = {
    itemId: base.itemId,
    revisionId: base.revisionId,
    rootAnchorId: base.rootAnchorId,
    root: base.root,
    steps: base.steps,
    displayName: base.displayName,
    ...(base.summary === undefined ? {} : { summary: base.summary }),
  };
  let candidateSteps: readonly AnalysisScratchStep[];
  try {
    candidateSteps = inventoryRevisionCandidateSteps({ base: line, scratch });
  } catch {
    throw invalidInventoryRevision();
  }
  const graph = readGraph(database, base.itemId.value, base.revisionId.value);
  const preservedMoveCount = graph.findIndex(
    (row) => row.occurrenceAnchorId === intent.cutAnchorId.value,
  );
  if (preservedMoveCount < 0) throw invalidInventoryRevision();
  const removedSteps = Object.freeze(base.steps.slice(preservedMoveCount));
  const anchorChange = buildAnchorChange(
    database,
    graph,
    candidateSteps,
    preservedMoveCount,
    base.revisionId.value,
  );
  const impact = inspectRevisionImpact(database, {
    itemId: base.itemId,
    removedAnchorIds: anchorChange.removedAnchorIds,
    ...(scope.kind === 'context'
      ? {
          publishingScratch: {
            contextId: scope.contextId,
            scratchId: scratch.scratchId,
          },
        }
      : {}),
  });
  const noOp =
    intent.displayName === base.displayName &&
    intent.summary === base.summary &&
    sameSteps(candidateSteps, base.steps);
  const dataRevision = readDataRevision(database);
  return Object.freeze({
    base,
    graph,
    candidateSteps,
    preservedMoveCount,
    removedSteps,
    removedAnchorIds: anchorChange.removedAnchorIds,
    impact,
    noOp,
    previewFingerprint: revisionFingerprint({
      scratch,
      baseCurrentRevisionId: current.currentRevisionId,
      candidateSteps,
      preservedMoveCount,
      removedAnchors: [...anchorChange.removedAnchorIds],
      dependencies: impact.fingerprintValue,
    }),
    dataRevision,
  });
}

function previewFromCandidate(
  scratch: AnalysisScratch,
  candidate: RevisionCandidate,
): InventoryRevisionPreview {
  if (scratch.intent.kind !== 'inventory_revision') {
    throw invalidInventoryRevision();
  }
  return Object.freeze({
    itemId: candidate.base.itemId,
    baseRevisionId: candidate.base.revisionId,
    mode: scratch.intent.mode,
    displayName: scratch.intent.displayName,
    ...(scratch.intent.summary === undefined
      ? {}
      : { summary: scratch.intent.summary }),
    preservedMoveCount: candidate.preservedMoveCount,
    addedSteps: scratch.steps,
    removedSteps: candidate.removedSteps,
    historicalGlobalContributionCount:
      candidate.impact.historicalGlobalContributionCount,
    affectedContexts: candidate.impact.affectedContexts,
    followingContexts: candidate.impact.followingContexts,
    noOp: candidate.noOp,
    previewFingerprint: candidate.previewFingerprint,
    dataRevision: candidate.dataRevision,
  });
}

function buildAnchorChange(
  database: Database.Database,
  graph: readonly GraphRow[],
  candidateSteps: readonly AnalysisScratchStep[],
  preservedMoveCount: number,
  revisionId: number,
): {
  readonly removedAnchorIds: ReadonlySet<number>;
} {
  const root = graph[0];
  if (root === undefined) throw invalidInventoryRevision();
  const retained = new Set<number>();
  const itemAnchor = database
    .prepare(
      `SELECT anchor_id AS anchorId FROM chess_anchor
        WHERE anchor_kind = 'item' AND item_id = (
          SELECT owner_item_id FROM chess_anchor WHERE anchor_id = ?
        )`,
    )
    .get(root.occurrenceAnchorId) as { anchorId: number } | undefined;
  if (itemAnchor !== undefined) retained.add(itemAnchor.anchorId);
  for (const row of graph.slice(0, preservedMoveCount + 1)) {
    retained.add(row.occurrenceAnchorId);
    if (row.depth < preservedMoveCount && row.moveAnchorId !== null) {
      retained.add(row.moveAnchorId);
    }
  }
  const candidatePositionIds = new Set<number>(
    graph.slice(0, preservedMoveCount + 1).map((row) => row.positionId),
  );
  for (const step of candidateSteps.slice(preservedMoveCount)) {
    const positionId = findPosition(database, step.after.position);
    if (positionId !== undefined) candidatePositionIds.add(positionId);
  }
  if (candidatePositionIds.size > 0) {
    const placeholders = [...candidatePositionIds].map(() => '?').join(', ');
    const positionAnchors = database
      .prepare(
        `SELECT anchor_id AS anchorId FROM chess_anchor
          WHERE anchor_kind = 'position'
            AND position_id IN (${placeholders})`,
      )
      .all(...candidatePositionIds) as { anchorId: number }[];
    for (const anchor of positionAnchors) retained.add(anchor.anchorId);
  }

  const removed = new Set<number>();
  for (const row of graph) {
    if (!retained.has(row.occurrenceAnchorId)) {
      removed.add(row.occurrenceAnchorId);
    }
    if (row.moveAnchorId !== null && !retained.has(row.moveAnchorId)) {
      removed.add(row.moveAnchorId);
    }
  }
  const positions = database
    .prepare(
      `SELECT DISTINCT anchor.anchor_id AS anchorId,
              occurrence.position_id AS positionId
         FROM chess_occurrence_snapshot AS occurrence
         JOIN chess_anchor AS anchor
           ON anchor.anchor_kind = 'position'
          AND anchor.position_id = occurrence.position_id
        WHERE occurrence.revision_id = ?`,
    )
    .all(revisionId) as {
    anchorId: number;
    positionId: number;
  }[];
  for (const position of positions) {
    if (retained.has(position.anchorId)) continue;
    removed.add(position.anchorId);
  }
  return Object.freeze({
    removedAnchorIds: removed,
  });
}

function insertRevision(
  database: Database.Database,
  scratch: AnalysisScratch,
  candidate: RevisionCandidate,
  occurredAt: string,
): ItemRevisionId {
  if (scratch.intent.kind !== 'inventory_revision') {
    throw invalidInventoryRevision();
  }
  const inserted = database
    .prepare(
      `INSERT INTO item_revision
         (item_id, revision_number, base_revision_id, display_name,
          summary_text, language_tag, content_fingerprint, creator_role,
          created_at_utc, revision_change_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?, ?)`,
    )
    .run(
      candidate.base.itemId.value,
      candidate.base.revisionNumber + 1,
      candidate.base.revisionId.value,
      scratch.intent.displayName,
      scratch.intent.summary ?? null,
      candidate.base.languageTag,
      analysisContentFingerprint({
        displayName: scratch.intent.displayName,
        ...(scratch.intent.summary === undefined
          ? {}
          : { summary: scratch.intent.summary }),
        languageTag: candidate.base.languageTag,
        originMode: candidate.base.origin.kind,
        root: candidate.base.root,
        steps: candidate.candidateSteps,
      }),
      occurredAt,
      scratch.intent.mode,
    );
  return localId('item-revision', Number(inserted.lastInsertRowid));
}

function writeRevisionGraph(
  database: Database.Database,
  revisionId: ItemRevisionId,
  scratch: AnalysisScratch,
  candidate: RevisionCandidate,
): AnchorId {
  const itemId = candidate.base.itemId.value;
  const baseRevisionId = candidate.base.revisionId.value;
  const prefixRows = candidate.graph.slice(0, candidate.preservedMoveCount + 1);
  for (const row of prefixRows) {
    database
      .prepare(
        `INSERT INTO chess_occurrence_snapshot
           (revision_id, occurrence_id, item_id, position_id, is_root,
            content_fingerprint)
         SELECT ?, occurrence_id, item_id, position_id, is_root,
                content_fingerprint
           FROM chess_occurrence_snapshot
          WHERE revision_id = ? AND occurrence_id = ?`,
      )
      .run(revisionId.value, baseRevisionId, row.occurrenceId);
    database
      .prepare(
        `INSERT INTO chess_play_state_snapshot
           (revision_id, occurrence_id, halfmove_clock, fullmove_number,
            history_knowledge)
         SELECT ?, occurrence_id, halfmove_clock, fullmove_number,
                history_knowledge
           FROM chess_play_state_snapshot
          WHERE revision_id = ? AND occurrence_id = ?`,
      )
      .run(revisionId.value, baseRevisionId, row.occurrenceId);
  }
  for (const row of prefixRows) {
    if (row.depth < candidate.preservedMoveCount && row.moveNodeId !== null) {
      database
        .prepare(
          `INSERT INTO chess_move_node_snapshot
             (revision_id, move_node_id, item_id, parent_occurrence_id,
              child_occurrence_id, sibling_order, is_main_line,
              from_square, to_square, promotion, san, content_fingerprint)
           SELECT ?, move_node_id, item_id, parent_occurrence_id,
                  child_occurrence_id, sibling_order, is_main_line,
                  from_square, to_square, promotion, san, content_fingerprint
             FROM chess_move_node_snapshot
            WHERE revision_id = ? AND move_node_id = ?`,
        )
        .run(revisionId.value, baseRevisionId, row.moveNodeId);
    }
  }

  let parentOccurrenceId = prefixRows.at(-1)?.occurrenceId;
  let endAnchorId = prefixRows.at(-1)?.occurrenceAnchorId;
  if (parentOccurrenceId === undefined || endAnchorId === undefined) {
    throw invalidInventoryRevision();
  }
  for (const step of scratch.steps) {
    const occurrenceInsert = database
      .prepare(
        `INSERT INTO chess_occurrence_identity (item_id, created_revision_id)
         VALUES (?, ?)`,
      )
      .run(itemId, revisionId.value);
    const childOccurrenceId = Number(occurrenceInsert.lastInsertRowid);
    const positionId = ensurePosition(database, step.after.position);
    database
      .prepare(
        `INSERT INTO chess_occurrence_snapshot
           (revision_id, occurrence_id, item_id, position_id, is_root,
            content_fingerprint)
         VALUES (?, ?, ?, ?, 0, ?)`,
      )
      .run(
        revisionId.value,
        childOccurrenceId,
        itemId,
        positionId.value,
        stateFingerprint(step.after),
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
        childOccurrenceId,
        step.after.playState.halfmoveClock,
        step.after.playState.fullmoveNumber,
        step.after.playState.historyKnowledge,
      );
    const occurrenceAnchor = database
      .prepare(
        `INSERT INTO chess_anchor
           (anchor_kind, owner_item_id, item_id, position_id,
            occurrence_id, move_node_id)
         VALUES ('occurrence', ?, NULL, NULL, ?, NULL)`,
      )
      .run(itemId, childOccurrenceId);
    endAnchorId = Number(occurrenceAnchor.lastInsertRowid);

    const moveInsert = database
      .prepare(
        `INSERT INTO chess_move_node_identity (item_id, created_revision_id)
         VALUES (?, ?)`,
      )
      .run(itemId, revisionId.value);
    const moveNodeId = Number(moveInsert.lastInsertRowid);
    database
      .prepare(
        `INSERT INTO chess_move_node_snapshot
           (revision_id, move_node_id, item_id, parent_occurrence_id,
            child_occurrence_id, sibling_order, is_main_line,
            from_square, to_square, promotion, san, content_fingerprint)
         VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId.value,
        moveNodeId,
        itemId,
        parentOccurrenceId,
        childOccurrenceId,
        step.move.from,
        step.move.to,
        step.move.promotion ?? null,
        step.move.san,
        moveFingerprint(parentOccurrenceId, childOccurrenceId, step),
      );
    database
      .prepare(
        `INSERT INTO chess_anchor
           (anchor_kind, owner_item_id, item_id, position_id,
            occurrence_id, move_node_id)
         VALUES ('move_node', ?, NULL, NULL, NULL, ?)`,
      )
      .run(itemId, moveNodeId);
    parentOccurrenceId = childOccurrenceId;
  }
  const counts = database
    .prepare(
      `SELECT
         (SELECT count(*) FROM chess_occurrence_snapshot
           WHERE revision_id = ?) AS occurrenceCount,
         (SELECT count(*) FROM chess_move_node_snapshot
           WHERE revision_id = ?) AS moveCount`,
    )
    .get(revisionId.value, revisionId.value) as {
    occurrenceCount: number;
    moveCount: number;
  };
  if (
    counts.occurrenceCount !== candidate.candidateSteps.length + 1 ||
    counts.moveCount !== candidate.candidateSteps.length
  ) {
    throw invalidInventoryRevision();
  }
  return localId('anchor', endAnchorId);
}

function copyAnalysisRevisionMetadata(
  database: Database.Database,
  itemId: InventoryItemId,
  baseRevisionId: ItemRevisionId,
  revisionId: ItemRevisionId,
): void {
  database
    .prepare(
      `INSERT INTO inventory_analysis_revision
         (revision_id, item_id, root_occurrence_id, origin_mode)
       SELECT ?, item_id, root_occurrence_id, origin_mode
         FROM inventory_analysis_revision
        WHERE item_id = ? AND revision_id = ?`,
    )
    .run(revisionId.value, itemId.value, baseRevisionId.value);
  database
    .prepare(
      `INSERT INTO inventory_analysis_origin
         (analysis_revision_id, source_item_id, source_revision_id,
          source_anchor_id)
       SELECT ?, source_item_id, source_revision_id, source_anchor_id
         FROM inventory_analysis_origin WHERE analysis_revision_id = ?`,
    )
    .run(revisionId.value, baseRevisionId.value);
}

function insertRevisionSearchDocument(
  database: Database.Database,
  revisionId: ItemRevisionId,
  itemId: InventoryItemId,
  rootAnchorId: AnchorId,
  scratch: AnalysisScratch,
  languageTag: string,
  occurredAt: string,
): void {
  if (scratch.intent.kind !== 'inventory_revision') {
    throw invalidInventoryRevision();
  }
  database
    .prepare(
      `INSERT INTO search_document
         (projection_version, subject_kind, item_id, item_revision_id,
          contribution_id, anchor_id, context_id, language_tag,
          evidence_class, scope_kind, stable_sort_value, title,
          aliases_concepts, metadata, body)
       VALUES (1, 'item_revision', ?, ?, NULL, ?, NULL, ?,
               'personal', 'global', ?, ?, '', 'analysis manual', ?)`,
    )
    .run(
      itemId.value,
      revisionId.value,
      rootAnchorId.value,
      languageTag,
      occurredAt,
      scratch.intent.displayName,
      scratch.intent.summary ?? '',
    );
}

function advanceCompatibleContextState(
  database: Database.Database,
  request: {
    readonly itemId: InventoryItemId;
    readonly baseRevisionId: ItemRevisionId;
    readonly targetRevisionId: ItemRevisionId;
    readonly targetAnchorIds: ReadonlySet<number>;
    readonly impactedContexts: ReadonlySet<number>;
    readonly occurredAt: string;
  },
): void {
  const resumes = database
    .prepare(
      `SELECT context_id AS contextId, anchor_id AS anchorId,
              analysis_scratch_draft_id AS scratchId
         FROM workspace_analysis_resume
        WHERE item_id = ? AND revision_id = ?`,
    )
    .all(request.itemId.value, request.baseRevisionId.value) as {
    contextId: number;
    anchorId: number | null;
    scratchId: number | null;
  }[];
  for (const resume of resumes) {
    if (
      request.impactedContexts.has(resume.contextId) ||
      resume.anchorId === null ||
      !request.targetAnchorIds.has(resume.anchorId) ||
      (resume.scratchId === null
        ? false
        : !rebaseExplorationScratch(database, {
            ...request,
            contextId: resume.contextId,
            anchorId: resume.anchorId,
            scratchId: resume.scratchId,
          }))
    ) {
      continue;
    }
    database
      .prepare(
        `UPDATE workspace_analysis_resume
            SET revision_id = ?, resume_version = resume_version + 1,
                updated_at_utc = ?
          WHERE context_id = ? AND revision_id = ?`,
      )
      .run(
        request.targetRevisionId.value,
        request.occurredAt,
        resume.contextId,
        request.baseRevisionId.value,
      );
  }
}

function rebaseExplorationScratch(
  database: Database.Database,
  request: {
    readonly itemId: InventoryItemId;
    readonly baseRevisionId: ItemRevisionId;
    readonly targetRevisionId: ItemRevisionId;
    readonly targetAnchorIds: ReadonlySet<number>;
    readonly contextId: number;
    readonly anchorId: number;
    readonly scratchId: number;
    readonly occurredAt: string;
  },
): boolean {
  const scratch = database
    .prepare(
      `SELECT scratch_mode AS scratchMode, origin_item_id AS originItemId,
              origin_revision_id AS originRevisionId,
              origin_anchor_id AS originAnchorId
         FROM analysis_scratch_draft WHERE scratch_draft_id = ?`,
    )
    .get(request.scratchId) as
    | {
        scratchMode: 'exploration' | 'inventory_revision';
        originItemId: number | null;
        originRevisionId: number | null;
        originAnchorId: number | null;
      }
    | undefined;
  if (
    scratch?.scratchMode !== 'exploration' ||
    scratch.originItemId !== request.itemId.value ||
    scratch.originRevisionId !== request.baseRevisionId.value ||
    scratch.originAnchorId !== request.anchorId ||
    !request.targetAnchorIds.has(request.anchorId)
  ) {
    return false;
  }
  const changed = database
    .prepare(
      `UPDATE analysis_scratch_draft
          SET origin_revision_id = ?, updated_at_utc = ?
        WHERE scratch_draft_id = ? AND scratch_mode = 'exploration'
          AND origin_revision_id = ?`,
    )
    .run(
      request.targetRevisionId.value,
      request.occurredAt,
      request.scratchId,
      request.baseRevisionId.value,
    );
  return changed.changes === 1;
}

function consumePublishingContextScratch(
  database: Database.Database,
  request: {
    readonly contextId: number;
    readonly itemId: InventoryItemId;
    readonly baseRevisionId: ItemRevisionId;
    readonly targetRevisionId: ItemRevisionId;
    readonly currentAnchorId: AnchorId;
    readonly cutAnchorId: AnchorId;
    readonly impacted: boolean;
    readonly occurredAt: string;
  },
): void {
  const revisionId = request.impacted
    ? request.baseRevisionId
    : request.targetRevisionId;
  const anchorId = request.impacted
    ? request.cutAnchorId
    : request.currentAnchorId;
  const positionId = resolveAnchorPosition(
    database,
    request.itemId.value,
    revisionId.value,
    anchorId.value,
  );
  if (positionId === undefined) throw invalidInventoryRevision();
  const cleared = database
    .prepare(
      `UPDATE workspace_analysis_resume
          SET resume_version = resume_version + 1, revision_id = ?,
              anchor_id = ?, mode = 'analyze', current_position_id = ?,
              analysis_scratch_draft_id = NULL, updated_at_utc = ?
        WHERE context_id = ? AND item_id = ?
          AND analysis_scratch_draft_id IS NOT NULL`,
    )
    .run(
      revisionId.value,
      anchorId.value,
      positionId,
      request.occurredAt,
      request.contextId,
      request.itemId.value,
    );
  if (cleared.changes !== 1) throw inventoryRevisionConflict();
  deleteContextScratch(database, request.contextId);
}

function validateStoredScratch(
  database: Database.Database,
  scope: WorkScope,
  scratch: AnalysisScratch,
): void {
  if (scope.kind === 'free') return;
  const stored = readContextScratch(database, scope.contextId);
  if (
    stored?.scratchId !== scratch.scratchId ||
    stored.scratchRevision !== scratch.scratchRevision ||
    stored.intent.kind !== 'inventory_revision'
  ) {
    throw inventoryRevisionConflict();
  }
}

function readGraph(
  database: Database.Database,
  itemId: number,
  revisionId: number,
): readonly GraphRow[] {
  const root = database
    .prepare(
      `SELECT root_occurrence_id AS rootOccurrenceId
         FROM inventory_analysis_revision
        WHERE item_id = ? AND revision_id = ?`,
    )
    .get(itemId, revisionId) as { rootOccurrenceId: number } | undefined;
  if (root === undefined) throw invalidInventoryRevision();
  return database
    .prepare(
      `WITH RECURSIVE line(depth, occurrence_id) AS (
         VALUES (0, ?)
         UNION ALL
         SELECT line.depth + 1, move.child_occurrence_id
           FROM line
           JOIN chess_move_node_snapshot AS move
             ON move.revision_id = ?
            AND move.parent_occurrence_id = line.occurrence_id
            AND move.is_main_line = 1
       )
       SELECT line.depth, occurrence.occurrence_id AS occurrenceId,
              occurrence_anchor.anchor_id AS occurrenceAnchorId,
              occurrence.position_id AS positionId,
              move.move_node_id AS moveNodeId,
              move_anchor.anchor_id AS moveAnchorId
         FROM line
         JOIN chess_occurrence_snapshot AS occurrence
           ON occurrence.revision_id = ?
          AND occurrence.occurrence_id = line.occurrence_id
          AND occurrence.item_id = ?
         JOIN chess_anchor AS occurrence_anchor
           ON occurrence_anchor.anchor_kind = 'occurrence'
          AND occurrence_anchor.owner_item_id = occurrence.item_id
          AND occurrence_anchor.occurrence_id = occurrence.occurrence_id
         LEFT JOIN chess_move_node_snapshot AS move
           ON move.revision_id = occurrence.revision_id
          AND move.parent_occurrence_id = occurrence.occurrence_id
          AND move.is_main_line = 1
         LEFT JOIN chess_anchor AS move_anchor
           ON move_anchor.anchor_kind = 'move_node'
          AND move_anchor.owner_item_id = move.item_id
          AND move_anchor.move_node_id = move.move_node_id
        ORDER BY line.depth`,
    )
    .all(root.rootOccurrenceId, revisionId, revisionId, itemId) as GraphRow[];
}

function revisionAnchorIds(
  database: Database.Database,
  itemId: number,
  revisionId: number,
): ReadonlySet<number> {
  const rows = database
    .prepare(
      `SELECT anchor.anchor_id AS anchorId
         FROM chess_anchor AS anchor
        WHERE (anchor.anchor_kind = 'item' AND anchor.item_id = ?)
           OR (anchor.anchor_kind = 'occurrence' AND anchor.owner_item_id = ?
               AND EXISTS (
                 SELECT 1 FROM chess_occurrence_snapshot AS occurrence
                  WHERE occurrence.revision_id = ?
                    AND occurrence.item_id = ?
                    AND occurrence.occurrence_id = anchor.occurrence_id))
           OR (anchor.anchor_kind = 'move_node' AND anchor.owner_item_id = ?
               AND EXISTS (
                 SELECT 1 FROM chess_move_node_snapshot AS move
                  WHERE move.revision_id = ? AND move.item_id = ?
                    AND move.move_node_id = anchor.move_node_id))
           OR (anchor.anchor_kind = 'position' AND EXISTS (
                 SELECT 1 FROM chess_occurrence_snapshot AS occurrence
                  WHERE occurrence.revision_id = ? AND occurrence.item_id = ?
                    AND occurrence.position_id = anchor.position_id))`,
    )
    .all(
      itemId,
      itemId,
      revisionId,
      itemId,
      itemId,
      revisionId,
      itemId,
      revisionId,
      itemId,
    ) as { anchorId: number }[];
  return new Set(rows.map((row) => row.anchorId));
}

function rootAnchor(
  database: Database.Database,
  itemId: number,
  revisionId: number,
): AnchorId | undefined {
  const row = database
    .prepare(
      `SELECT anchor.anchor_id AS anchorId
         FROM inventory_analysis_revision AS analysis
         JOIN chess_anchor AS anchor
           ON anchor.anchor_kind = 'occurrence'
          AND anchor.owner_item_id = analysis.item_id
          AND anchor.occurrence_id = analysis.root_occurrence_id
        WHERE analysis.item_id = ? AND analysis.revision_id = ?`,
    )
    .get(itemId, revisionId) as { anchorId: number } | undefined;
  return row === undefined ? undefined : localId('anchor', row.anchorId);
}

function assertCurrentRevision(
  database: Database.Database,
  itemId: InventoryItemId,
  revisionId: ItemRevisionId,
): void {
  const row = database
    .prepare(
      `SELECT current_revision_id AS currentRevisionId FROM inventory_item
        WHERE item_id = ?`,
    )
    .get(itemId.value) as { currentRevisionId: number } | undefined;
  if (row?.currentRevisionId !== revisionId.value) {
    throw inventoryRevisionConflict();
  }
}

function sameSteps(
  left: readonly AnalysisScratchStep[],
  right: readonly AnalysisScratchStep[],
): boolean {
  return (
    left.length === right.length &&
    left.every((step, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        step.move.from === other.move.from &&
        step.move.to === other.move.to &&
        step.move.promotion === other.move.promotion &&
        step.after.fen === other.after.fen
      );
    })
  );
}

function findPosition(
  database: Database.Database,
  position: Position,
): number | undefined {
  const row = database
    .prepare(
      `SELECT position_id AS positionId FROM chess_position
        WHERE rule_set_id = 'standardChess' AND board_key = ?
          AND side_to_move = ? AND white_king_side = ?
          AND white_queen_side = ? AND black_king_side = ?
          AND black_queen_side = ? AND effective_en_passant_square = ?`,
    )
    .get(
      position.boardKey,
      position.sideToMove,
      Number(position.castlingRights.whiteKingSide),
      Number(position.castlingRights.whiteQueenSide),
      Number(position.castlingRights.blackKingSide),
      Number(position.castlingRights.blackQueenSide),
      position.effectiveEnPassantSquare,
    ) as { positionId: number } | undefined;
  return row?.positionId;
}

function stateFingerprint(state: ChessState): Buffer {
  return sha256({
    positionKey: state.position.positionKey,
    playState: state.playState,
  });
}

function moveFingerprint(
  parentOccurrenceId: number,
  childOccurrenceId: number,
  step: AnalysisScratchStep,
): Buffer {
  return sha256({
    parentOccurrenceId,
    childOccurrenceId,
    move: step.move,
  });
}

function revisionFingerprint(value: unknown): string {
  return `sha256:${sha256(value).toString('hex')}`;
}

function sha256(value: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest();
}
