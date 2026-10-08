import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

import type { AnalysisRecordView } from '../../../../application/analysis/index.ts';
import {
  invalidInventoryRevision,
  inventoryDisplayNameConflict,
  inventoryPreviewConflict,
  inventoryRevisionConflict,
  normalizeInventoryRevisionComment,
  type InventoryRevisionComment,
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
  inventoryRevisionHasChanges,
  type InventoryRevisionLine,
} from '../../../../domain/inventory/index.ts';
import type { WorkScope } from '../../../../domain/workspace/index.ts';
import { readAnalysisRecordView } from './sqlite-analysis-record.ts';
import {
  insertAnalysisNoteContribution,
  validatePositionNoteTarget,
} from './sqlite-analysis-note.ts';
import { analysisContentFingerprint } from './sqlite-analysis-content-fingerprint.ts';
import { readContextScratch } from './sqlite-analysis-scratch-state.ts';
import { ensurePosition } from './sqlite-chess-state.ts';
import { deleteContextScratch } from './sqlite-context-scratch.ts';
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
import { readMainLine } from './sqlite-analysis-line.ts';

interface GraphRow {
  readonly depth: number;
  readonly occurrenceId: number;
  readonly occurrenceAnchorId: number;
  readonly positionId: number;
  readonly moveNodeId: number | null;
  readonly moveAnchorId: number | null;
}

interface TreeRow {
  readonly occurrenceId: number;
  readonly occurrenceAnchorId: number;
  readonly positionId: number;
  readonly parentOccurrenceId: number | null;
  readonly moveNodeId: number | null;
  readonly moveAnchorId: number | null;
  readonly siblingOrder: number | null;
  readonly isMainLine: number | null;
}

interface RevisionCandidate {
  readonly mode: InventoryRevisionPreview['mode'];
  readonly variation: boolean;
  readonly base: AnalysisRecordView;
  readonly graph: readonly GraphRow[];
  readonly retainedTree: readonly TreeRow[];
  readonly reusedRows: readonly TreeRow[];
  readonly addedSteps: readonly AnalysisScratchStep[];
  readonly comment: InventoryRevisionComment | undefined;
  readonly replacedMove: TreeRow | undefined;
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
  });
}

export function previewInventoryRevision(
  database: Database.Database,
  request: Parameters<InventoryRevisionReader['previewInventoryRevision']>[0],
): InventoryRevisionPreview {
  const candidate = buildCandidate(
    database,
    request.scope,
    request.scratch,
    request.comment,
  );
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
          AND item.current_revision_id IS NOT NULL
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
      | 'created'
      | 'extend'
      | 'truncate_after'
      | 'replace_move'
      | 'metadata'
      | 'add_variation';
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
  if (
    intent.kind !== 'inventory_revision' ||
    request.expectedScratchId !== request.scratch.scratchId ||
    request.expectedScratchRevision !== request.scratch.scratchRevision
  ) {
    throw invalidInventoryRevision();
  }
  validateStoredScratch(database, request.scope, request.scratch);
  const candidate = buildCandidate(
    database,
    request.scope,
    request.scratch,
    request.comment,
  );
  if (candidate.previewFingerprint !== request.previewFingerprint) {
    throw inventoryPreviewConflict();
  }
  if (candidate.noOp) {
    return Object.freeze({
      itemId: candidate.base.itemId,
      revisionId: candidate.base.revisionId,
      revisionNumber: candidate.base.revisionNumber,
      currentAnchorId:
        intent.mode === 'add_variation'
          ? localId(
              'anchor',
              candidate.reusedRows.at(-1)?.occurrenceAnchorId ??
                intent.cutAnchorId.value,
            )
          : (candidate.base.steps.at(-1)?.anchorId ??
            candidate.base.rootAnchorId),
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
    candidate,
  );
  const currentAnchorId =
    intent.mode === 'metadata' ? intent.returnAnchorId : revisionEndAnchorId;
  copyTypedRevisionMetadata(
    database,
    candidate.base.itemId,
    candidate.base.revisionId,
    revisionId,
    candidate.base.itemType,
  );
  insertRevisionSearchDocument(
    database,
    revisionId,
    candidate.base.itemId,
    candidate.base.rootAnchorId,
    request.scratch,
    candidate.base.languageTag,
    request.occurredAt,
    candidate.base.itemType,
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
  consumePublishingScopeScratch(database, {
    contextId:
      request.scope.kind === 'context' ? request.scope.contextId.value : null,
    itemId: candidate.base.itemId,
    baseRevisionId: candidate.base.revisionId,
    targetRevisionId: revisionId,
    currentAnchorId,
    cutAnchorId: intent.cutAnchorId,
    impacted:
      request.scope.kind === 'context' &&
      impactedContexts.has(request.scope.contextId.value),
    occurredAt: request.occurredAt,
  });
  const commentContributionId =
    candidate.comment === undefined
      ? undefined
      : insertAnalysisNoteContribution(database, {
          itemId: candidate.base.itemId,
          anchorId: intent.cutAnchorId,
          note: { body: candidate.comment.body, moves: Object.freeze([]) },
          noteScope: candidate.comment.noteScope,
          languageTag: candidate.comment.languageTag,
          occurredAt: request.occurredAt,
        });
  const dataRevision = incrementDataRevision(database, request.occurredAt);
  return Object.freeze({
    itemId: candidate.base.itemId,
    revisionId,
    revisionNumber: candidate.base.revisionNumber + 1,
    currentAnchorId,
    impacts,
    noOp: false,
    ...(commentContributionId === undefined
      ? {}
      : { commentContributionId: String(commentContributionId.value) }),
    dataRevision,
  });
}

function buildCandidate(
  database: Database.Database,
  scope: WorkScope,
  scratch: AnalysisScratch,
  requestedComment?: InventoryRevisionComment,
): RevisionCandidate {
  if (scratch.intent.kind !== 'inventory_revision') {
    throw invalidInventoryRevision();
  }
  const intent = scratch.intent;
  const comment = normalizeInventoryRevisionComment(scope, requestedComment);
  if (comment !== undefined && intent.mode !== 'add_variation') {
    throw invalidInventoryRevision();
  }
  const current = database
    .prepare(
      `SELECT current_revision_id AS currentRevisionId,
              item_type AS itemType
         FROM inventory_item
        WHERE item_id = ? AND item_type IN ('analysis', 'game')
          AND lifecycle = 'active'`,
    )
    .get(intent.itemId.value) as
    | { currentRevisionId: number | null; itemType: 'analysis' | 'game' }
    | undefined;
  if (current?.currentRevisionId !== intent.baseRevisionId.value) {
    throw inventoryRevisionConflict();
  }
  if (current.itemType === 'game' && intent.mode !== 'metadata') {
    throw invalidInventoryRevision();
  }
  const base = readAnalysisRevision(database, {
    scope,
    itemId: intent.itemId,
    revisionId: intent.baseRevisionId,
    anchorId:
      intent.mode === 'replace_move' || intent.mode === 'truncate_after'
        ? intent.returnAnchorId
        : intent.cutAnchorId,
  });
  if (
    base === undefined ||
    base.historical ||
    (scope.kind === 'context' &&
      !base.contextMember &&
      intent.mode !== 'metadata')
  ) {
    throw invalidInventoryRevision();
  }
  if (
    !inventoryDisplayNameIsAvailable(
      database,
      intent.displayName,
      intent.itemId.value,
    )
  ) {
    throw inventoryDisplayNameConflict();
  }
  if (comment !== undefined) {
    validatePositionNoteTarget(database, {
      scope,
      itemId: base.itemId,
      revisionId: base.revisionId,
      anchorId: intent.cutAnchorId,
      noteScope: comment.noteScope,
    });
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
  const candidate = Object.freeze({
    intent,
    root: scratch.root,
    steps: scratch.steps,
  });
  let candidateSteps: readonly AnalysisScratchStep[];
  try {
    if (scratch.cursor !== scratch.steps.length) {
      throw invalidInventoryRevision();
    }
    candidateSteps = inventoryRevisionCandidateSteps({ base: line, candidate });
  } catch {
    throw invalidInventoryRevision();
  }
  const graph = readGraph(
    database,
    base.itemId.value,
    base.revisionId.value,
    intent.mode === 'replace_move' || intent.mode === 'truncate_after'
      ? intent.returnAnchorId.value
      : intent.cutAnchorId.value,
  );
  const cutMoveCount = graph.findIndex(
    (row) => row.occurrenceAnchorId === intent.cutAnchorId.value,
  );
  if (cutMoveCount < 0) throw invalidInventoryRevision();
  const tree = readRevisionTree(database, base.revisionId.value);
  const reusedRows =
    intent.mode === 'add_variation'
      ? reuseVariationPrefix(base, tree, intent.cutAnchorId, scratch.steps)
      : reuseLinePrefix(base, tree, cutMoveCount, scratch.steps);
  const preservedMoveCount =
    cutMoveCount + (intent.mode === 'add_variation' ? 0 : reusedRows.length);
  const removedSteps = Object.freeze(
    intent.mode === 'add_variation' ? [] : base.steps.slice(preservedMoveCount),
  );
  const addedSteps = Object.freeze(scratch.steps.slice(reusedRows.length));
  const mode =
    intent.mode === 'add_variation' || intent.mode === 'metadata'
      ? intent.mode
      : removedSteps.length === 0
        ? addedSteps.length === 0
          ? 'metadata'
          : 'extend'
        : addedSteps.length === 0
          ? 'truncate_after'
          : 'replace_move';
  const replacedMove =
    intent.mode === 'metadata' ||
    intent.mode === 'extend' ||
    intent.mode === 'add_variation'
      ? undefined
      : tree.find(
          (row) =>
            row.moveNodeId !== null &&
            row.moveNodeId === graph[preservedMoveCount]!.moveNodeId,
        );
  const removedOccurrences = new Set<number>();
  if (replacedMove !== undefined) {
    const children = new Map<number, number[]>();
    for (const row of tree) {
      if (row.parentOccurrenceId === null) continue;
      const siblings = children.get(row.parentOccurrenceId) ?? [];
      siblings.push(row.occurrenceId);
      children.set(row.parentOccurrenceId, siblings);
    }
    const pending = [replacedMove.occurrenceId];
    while (pending.length > 0) {
      const occurrenceId = pending.pop()!;
      if (removedOccurrences.has(occurrenceId)) continue;
      removedOccurrences.add(occurrenceId);
      pending.push(...(children.get(occurrenceId) ?? []));
    }
  }
  const retainedTree = tree.filter(
    (row) => !removedOccurrences.has(row.occurrenceId),
  );
  const anchorChange = buildAnchorChange(
    database,
    tree,
    retainedTree,
    addedSteps,
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
    intent.mode === 'add_variation'
      ? addedSteps.length === 0
      : !inventoryRevisionHasChanges({ base: line, candidate }) &&
        removedOccurrences.size <= removedSteps.length;
  const dataRevision = readDataRevision(database);
  return Object.freeze({
    mode,
    base,
    variation: intent.mode === 'add_variation',
    graph,
    retainedTree,
    reusedRows,
    addedSteps,
    comment,
    replacedMove,
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
      tree: base.tree,
      comment: comment ?? null,
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
    mode: candidate.mode,
    displayName: scratch.intent.displayName,
    ...(scratch.intent.summary === undefined
      ? {}
      : { summary: scratch.intent.summary }),
    preservedMoveCount: candidate.preservedMoveCount,
    addedSteps: candidate.addedSteps,
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

function reuseLinePrefix(
  base: AnalysisRecordView,
  tree: readonly TreeRow[],
  cutMoveCount: number,
  steps: readonly AnalysisScratchStep[],
): readonly TreeRow[] {
  const byAnchor = new Map(tree.map((row) => [row.occurrenceAnchorId, row]));
  const reused: TreeRow[] = [];
  // Only the selected line can retain identity; equal positions in other branches cannot.
  for (const [index, step] of steps.entries()) {
    const existing = base.steps[cutMoveCount + index];
    if (
      existing === undefined ||
      existing.move.from !== step.move.from ||
      existing.move.to !== step.move.to ||
      existing.move.promotion !== step.move.promotion ||
      existing.after.fen !== step.after.fen
    )
      break;
    const row = byAnchor.get(existing.anchorId.value);
    if (row === undefined) throw invalidInventoryRevision();
    reused.push(row);
  }
  return Object.freeze(reused);
}

function reuseVariationPrefix(
  base: AnalysisRecordView,
  tree: readonly TreeRow[],
  anchorId: AnchorId,
  steps: readonly AnalysisScratchStep[],
): readonly TreeRow[] {
  const nodes =
    base.tree?.nodes ??
    base.steps.map((step, nodeIndex) => ({
      nodeIndex,
      parentNodeIndex: nodeIndex === 0 ? null : nodeIndex - 1,
      siblingOrder: 0,
      anchorId: step.anchorId,
      move: step.move,
      after: step.after,
    }));
  const children = new Map<number | null, (typeof nodes)[number][]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentNodeIndex) ?? [];
    siblings.push(node);
    children.set(node.parentNodeIndex, siblings);
  }
  const rootNodeIndex =
    anchorId.value === base.rootAnchorId.value
      ? null
      : nodes.find((node) => node.anchorId.value === anchorId.value)?.nodeIndex;
  if (rootNodeIndex === undefined) throw invalidInventoryRevision();
  let parentNodeIndex: number | null = rootNodeIndex;
  const byAnchor = new Map(tree.map((row) => [row.occurrenceAnchorId, row]));
  const reused: TreeRow[] = [];
  for (const step of steps) {
    const existing: (typeof nodes)[number] | undefined = children
      .get(parentNodeIndex)
      ?.find(
        (node) =>
          node.move.from === step.move.from &&
          node.move.to === step.move.to &&
          node.move.promotion === step.move.promotion &&
          node.after.fen === step.after.fen,
      );
    if (existing === undefined) break;
    const row = byAnchor.get(existing.anchorId.value);
    if (row === undefined) throw invalidInventoryRevision();
    reused.push(row);
    parentNodeIndex = existing.nodeIndex;
  }
  return Object.freeze(reused);
}

function buildAnchorChange(
  database: Database.Database,
  tree: readonly TreeRow[],
  retainedTree: readonly TreeRow[],
  addedSteps: readonly AnalysisScratchStep[],
  revisionId: number,
): {
  readonly removedAnchorIds: ReadonlySet<number>;
} {
  const retained = new Set<number>();
  for (const row of retainedTree) {
    retained.add(row.occurrenceAnchorId);
    if (row.moveAnchorId !== null) {
      retained.add(row.moveAnchorId);
    }
  }
  const candidatePositionIds = new Set<number>(
    retainedTree.map((row) => row.positionId),
  );
  for (const step of addedSteps) {
    const positionId = findPosition(database, step.after.position);
    if (positionId !== undefined) candidatePositionIds.add(positionId);
  }
  const removed = new Set<number>();
  for (const row of tree) {
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
    if (candidatePositionIds.has(position.positionId)) continue;
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
  const retainedAnchors = new Set(
    candidate.retainedTree.map((row) => row.occurrenceAnchorId),
  );
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
      candidate.base.itemType === 'game'
        ? gameMetadataFingerprint(
            database,
            candidate.base.revisionId,
            scratch.intent.displayName,
            scratch.intent.summary,
          )
        : sha256({
            line: analysisContentFingerprint({
              displayName: scratch.intent.displayName,
              ...(scratch.intent.summary === undefined
                ? {}
                : { summary: scratch.intent.summary }),
              languageTag: candidate.base.languageTag,
              originMode: candidate.base.origin.kind,
              root: candidate.base.root,
              steps: candidate.candidateSteps,
            }).toString('hex'),
            retainedTree: candidate.base.tree?.nodes.filter((node) =>
              retainedAnchors.has(node.anchorId.value),
            ),
            appendedAt:
              candidate.reusedRows.at(-1)?.occurrenceAnchorId ??
              scratch.intent.cutAnchorId.value,
            addedSteps: candidate.addedSteps,
          }),
      occurredAt,
      candidate.mode,
    );
  return localId('item-revision', Number(inserted.lastInsertRowid));
}

function gameMetadataFingerprint(
  database: Database.Database,
  baseRevisionId: ItemRevisionId,
  displayName: string,
  summary: string | undefined,
): Buffer {
  const base = database
    .prepare(
      `SELECT content_fingerprint AS contentFingerprint
         FROM item_revision WHERE revision_id = ?`,
    )
    .get(baseRevisionId.value) as { contentFingerprint: Buffer } | undefined;
  if (base === undefined) throw invalidInventoryRevision();
  return createHash('sha256')
    .update(
      JSON.stringify({
        baseFingerprint: base.contentFingerprint.toString('hex'),
        displayName,
        summary: summary ?? null,
      }),
    )
    .digest();
}

function writeRevisionGraph(
  database: Database.Database,
  revisionId: ItemRevisionId,
  candidate: RevisionCandidate,
): AnchorId {
  const itemId = candidate.base.itemId.value;
  const baseRevisionId = candidate.base.revisionId.value;
  const prefixRows = candidate.graph.slice(0, candidate.preservedMoveCount + 1);
  for (const row of candidate.retainedTree) {
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
  for (const row of candidate.retainedTree) {
    if (row.moveNodeId !== null) {
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

  const continuationRoot = candidate.reusedRows.at(-1) ?? prefixRows.at(-1);
  let parentOccurrenceId = continuationRoot?.occurrenceId;
  let endAnchorId = continuationRoot?.occurrenceAnchorId;
  if (parentOccurrenceId === undefined || endAnchorId === undefined) {
    throw invalidInventoryRevision();
  }
  // Replacing a variation keeps its sibling slot and main-line status.
  let siblingOrder =
    candidate.replacedMove?.siblingOrder ??
    Math.max(
      candidate.variation ? 0 : -1,
      ...candidate.retainedTree
        .filter((row) => row.parentOccurrenceId === parentOccurrenceId)
        .map((row) => row.siblingOrder!),
    ) + 1;
  let isMainLine =
    candidate.replacedMove?.isMainLine ?? (candidate.variation ? 0 : 1);
  for (const step of candidate.addedSteps) {
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId.value,
        moveNodeId,
        itemId,
        parentOccurrenceId,
        childOccurrenceId,
        siblingOrder,
        isMainLine,
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
    siblingOrder = 0;
    isMainLine = 1;
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
    counts.occurrenceCount !==
      candidate.retainedTree.length + candidate.addedSteps.length ||
    counts.moveCount !== counts.occurrenceCount - 1
  ) {
    throw invalidInventoryRevision();
  }
  return localId('anchor', endAnchorId);
}

function copyTypedRevisionMetadata(
  database: Database.Database,
  itemId: InventoryItemId,
  baseRevisionId: ItemRevisionId,
  revisionId: ItemRevisionId,
  itemType: 'analysis' | 'game',
): void {
  if (itemType === 'game') {
    database
      .prepare(
        `INSERT INTO inventory_game_revision
           (revision_id, item_id, root_occurrence_id, origin_mode, player_side,
            result_kind, result_reason, result_source, policy_capability, provider_instance_id,
            provider_fingerprint, provider_type, provider_display_name,
            profile_model_name, profile_selection_mode, profile_history_mode,
            profile_reproducibility)
         SELECT ?, item_id, root_occurrence_id, origin_mode, player_side,
                result_kind, result_reason, result_source, policy_capability, provider_instance_id,
                provider_fingerprint, provider_type, provider_display_name,
                profile_model_name, profile_selection_mode, profile_history_mode,
                profile_reproducibility
           FROM inventory_game_revision
          WHERE item_id = ? AND revision_id = ?`,
      )
      .run(revisionId.value, itemId.value, baseRevisionId.value);
    database
      .prepare(
        `INSERT INTO inventory_game_origin
           (game_revision_id, source_item_id, source_revision_id,
            source_anchor_id)
         SELECT ?, source_item_id, source_revision_id, source_anchor_id
           FROM inventory_game_origin WHERE game_revision_id = ?`,
      )
      .run(revisionId.value, baseRevisionId.value);
    copyGameSourcePath(database, baseRevisionId.value, revisionId.value);
    return;
  }
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
  itemType: 'analysis' | 'game',
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
               ?, 'global', ?, ?, '', ?, ?)`,
    )
    .run(
      itemId.value,
      revisionId.value,
      rootAnchorId.value,
      languageTag,
      'personal',
      occurredAt,
      scratch.intent.displayName,
      itemType === 'game' ? 'game playout' : 'analysis manual',
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
    contextId: number | null;
    anchorId: number | null;
    scratchId: number | null;
  }[];
  for (const resume of resumes) {
    if (
      (resume.contextId !== null &&
        request.impactedContexts.has(resume.contextId)) ||
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
          WHERE context_id IS ? AND revision_id = ?`,
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
    readonly contextId: number | null;
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

function consumePublishingScopeScratch(
  database: Database.Database,
  request: {
    readonly contextId: number | null;
    readonly itemId: InventoryItemId;
    readonly baseRevisionId: ItemRevisionId;
    readonly targetRevisionId: ItemRevisionId;
    readonly currentAnchorId: AnchorId;
    readonly cutAnchorId: AnchorId;
    readonly impacted: boolean;
    readonly occurredAt: string;
  },
): void {
  const member = database
    .prepare(
      'SELECT 1 FROM workspace_context_item WHERE context_id = ? AND item_id = ?',
    )
    .get(request.contextId, request.itemId.value);
  if (request.contextId !== null && member === undefined) {
    const cleared = database
      .prepare(
        `UPDATE workspace_analysis_resume
      SET resume_version = resume_version + 1, item_id = NULL, revision_id = NULL,
          anchor_id = NULL, mode = 'analyze', analysis_scratch_draft_id = NULL,
          updated_at_utc = ?
      WHERE context_id = ? AND item_id = ? AND analysis_scratch_draft_id IS NOT NULL`,
      )
      .run(request.occurredAt, request.contextId, request.itemId.value);
    if (cleared.changes !== 1) throw inventoryRevisionConflict();
    deleteContextScratch(database, request.contextId);
    return;
  }
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
        WHERE context_id IS ? AND item_id = ?
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
  const stored = readContextScratch(
    database,
    scope.kind === 'free' ? null : scope.contextId,
  );
  if (
    stored?.scratchId !== scratch.scratchId ||
    stored.scratchRevision !== scratch.scratchRevision ||
    stored.intent.kind !== 'inventory_revision'
  ) {
    throw inventoryRevisionConflict();
  }
}

function readRevisionTree(
  database: Database.Database,
  revisionId: number,
): readonly TreeRow[] {
  return database
    .prepare(
      `SELECT occurrence.occurrence_id AS occurrenceId,
              occurrence.position_id AS positionId,
              occurrence_anchor.anchor_id AS occurrenceAnchorId,
              move.parent_occurrence_id AS parentOccurrenceId,
              move.move_node_id AS moveNodeId,
              move_anchor.anchor_id AS moveAnchorId,
              move.sibling_order AS siblingOrder,
              move.is_main_line AS isMainLine
         FROM chess_occurrence_snapshot AS occurrence
         JOIN chess_anchor AS occurrence_anchor
           ON occurrence_anchor.anchor_kind = 'occurrence'
          AND occurrence_anchor.occurrence_id = occurrence.occurrence_id
         LEFT JOIN chess_move_node_snapshot AS move
           ON move.revision_id = occurrence.revision_id
          AND move.child_occurrence_id = occurrence.occurrence_id
         LEFT JOIN chess_anchor AS move_anchor
           ON move_anchor.anchor_kind = 'move_node'
          AND move_anchor.move_node_id = move.move_node_id
        WHERE occurrence.revision_id = ?
        ORDER BY occurrence.occurrence_id`,
    )
    .all(revisionId) as TreeRow[];
}

function readGraph(
  database: Database.Database,
  itemId: number,
  revisionId: number,
  anchorId?: number,
): readonly GraphRow[] {
  const root = database
    .prepare(
      `SELECT root_occurrence_id AS rootOccurrenceId
         FROM inventory_chess_revision
        WHERE item_id = ? AND revision_id = ?`,
    )
    .get(itemId, revisionId) as { rootOccurrenceId: number } | undefined;
  if (root === undefined) throw invalidInventoryRevision();
  const anchors = database
    .prepare(
      "SELECT move_node_id AS move, anchor_id AS anchor FROM chess_anchor WHERE anchor_kind = 'move_node' AND owner_item_id = ?",
    )
    .all(itemId) as { move: number; anchor: number }[];
  const byMove = new Map(anchors.map((a) => [a.move, a.anchor]));
  return readMainLine(
    database,
    revisionId,
    root.rootOccurrenceId,
    anchorId,
  ).map((row) => ({
    ...row,
    moveAnchorId:
      row.moveNodeId === null ? null : (byMove.get(row.moveNodeId) ?? null),
  }));
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
         FROM inventory_item AS item
         JOIN item_revision AS revision
           ON revision.item_id = item.item_id
         LEFT JOIN inventory_chess_revision AS analysis
           ON analysis.revision_id = revision.revision_id
         JOIN chess_anchor AS anchor
           ON anchor.anchor_kind = 'occurrence'
          AND anchor.owner_item_id = item.item_id
          AND anchor.occurrence_id = analysis.root_occurrence_id
        WHERE item.item_id = ? AND revision.revision_id = ?
          AND item.current_revision_id IS NOT NULL`,
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
import { copyGameSourcePath } from './sqlite-game-source-path.ts';
