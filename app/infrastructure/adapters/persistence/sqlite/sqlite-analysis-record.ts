import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

import {
  analysisScratchNotFound,
  analysisScratchRevisionConflict,
  invalidAnalysisRecord,
  type AnalysisContributionView,
  type AnalysisRecordView,
  type AnalysisSourceLineView,
  type CreateAnalysisRecordResult,
  type PersistAnalysisRecordRequest,
} from '../../../../application/analysis/index.ts';
import type {
  ChessState,
  PromotionPiece,
} from '../../../../domain/chess_graph/index.ts';
import type { HumanMovePolicyProfile } from '../../../../domain/playout/index.ts';
import {
  localId,
  type AnchorId,
  type InventoryItemId,
  type ItemRevisionId,
  type WorkingContextId,
} from '../../../../domain/identity/index.ts';
import { ensurePosition, readChessState } from './sqlite-chess-state.ts';
import { readContextScratch } from './sqlite-analysis-scratch.ts';
import { deleteContextScratch } from './sqlite-context-scratch.ts';
import {
  insertAnalysisNoteContribution,
  readAnalysisNoteMoves,
} from './sqlite-analysis-note.ts';
import { incrementDataRevision } from './sqlite-store-helpers.ts';
import { inventoryDisplayNameIsAvailable } from './sqlite-inventory-display-name.ts';
import { analysisContentFingerprint } from './sqlite-analysis-content-fingerprint.ts';
import {
  requireActiveContext,
  resolveAnchorPosition,
} from './sqlite-workspace.ts';

interface InsertedGraph {
  readonly rootAnchorId: AnchorId;
  readonly endAnchorId: AnchorId;
}

export interface LinearChessGraphInput {
  readonly root: ChessState;
  readonly steps: readonly {
    readonly move: {
      readonly from: string;
      readonly to: string;
      readonly promotion?: PromotionPiece;
      readonly san: string;
    };
    readonly after: ChessState;
  }[];
}

export function createAnalysisRecord(
  database: Database.Database,
  request: PersistAnalysisRecordRequest,
): CreateAnalysisRecordResult {
  validateSourceScratch(database, request);
  if (!inventoryDisplayNameIsAvailable(database, request.displayName)) {
    throw invalidAnalysisRecord();
  }
  if (request.targetContextId !== undefined) {
    requireActiveContext(database, request.targetContextId);
    if (
      request.targetContextId.value !== request.sourceContextId?.value &&
      contextHasScratch(database, request.targetContextId.value)
    ) {
      throw invalidAnalysisRecord();
    }
  }
  if ((request.note === undefined) !== (request.noteScope === undefined)) {
    throw invalidAnalysisRecord();
  }
  if (
    request.noteScope?.kind === 'context' &&
    request.targetContextId?.value !== request.noteScope.contextId.value
  ) {
    throw invalidAnalysisRecord();
  }

  const itemInsert = database
    .prepare(
      `INSERT INTO inventory_item
         (item_type, origin_kind, lifecycle, current_revision_id,
          created_at_utc, updated_at_utc)
       VALUES ('analysis', 'manual', 'active', NULL, ?, ?)`,
    )
    .run(request.occurredAt, request.occurredAt);
  const itemId = localId('inventory-item', Number(itemInsert.lastInsertRowid));
  const revisionInsert = database
    .prepare(
      `INSERT INTO item_revision
         (item_id, revision_number, base_revision_id, display_name,
          summary_text, language_tag, content_fingerprint, creator_role,
          created_at_utc)
       VALUES (?, 1, NULL, ?, NULL, ?, ?, 'user', ?)`,
    )
    .run(
      itemId.value,
      request.displayName,
      request.languageTag,
      analysisContentFingerprint({
        displayName: request.displayName,
        languageTag: request.languageTag,
        originMode: request.origin.kind,
        root: request.root,
        steps: request.steps,
      }),
      request.occurredAt,
    );
  const revisionId = localId(
    'item-revision',
    Number(revisionInsert.lastInsertRowid),
  );
  const graph = insertLinearGraph(database, itemId, revisionId, request);
  database
    .prepare(
      `INSERT INTO inventory_analysis_revision
         (revision_id, item_id, root_occurrence_id, origin_mode)
       SELECT ?, ?, a.occurrence_id, ?
         FROM chess_anchor AS a
        WHERE a.anchor_id = ? AND a.anchor_kind = 'occurrence'`,
    )
    .run(
      revisionId.value,
      itemId.value,
      request.origin.kind,
      graph.rootAnchorId.value,
    );
  if (request.origin.kind === 'inventory_anchor') {
    database
      .prepare(
        `INSERT INTO inventory_analysis_origin
           (analysis_revision_id, source_item_id, source_revision_id,
            source_anchor_id)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        revisionId.value,
        request.origin.itemId.value,
        request.origin.revisionId.value,
        request.origin.anchorId.value,
      );
  }
  validateLinearGraph(database, itemId, revisionId, request.steps.length + 1);

  const contributionId =
    request.note === undefined || request.noteScope === undefined
      ? undefined
      : insertAnalysisNoteContribution(database, {
          itemId,
          anchorId: graph.rootAnchorId,
          note: request.note,
          noteScope: request.noteScope,
          languageTag: request.languageTag,
          occurredAt: request.occurredAt,
          title: request.displayName,
        });
  database
    .prepare(
      `UPDATE inventory_item SET current_revision_id = ? WHERE item_id = ?`,
    )
    .run(revisionId.value, itemId.value);
  insertSearchDocument(
    database,
    request,
    itemId,
    revisionId,
    graph.rootAnchorId,
  );

  let contextReferenceId: number | undefined;
  const resumeUpdates: {
    readonly contextId: WorkingContextId;
    readonly resumeVersion: number;
  }[] = [];
  if (request.targetContextId !== undefined) {
    contextReferenceId = insertTargetContext(
      database,
      request.targetContextId,
      itemId,
      graph.rootAnchorId,
      request.occurredAt,
    );
    const resumeVersion = upsertRecordResume(
      database,
      request.targetContextId,
      itemId,
      revisionId,
      graph.endAnchorId,
      request.occurredAt,
    );
    resumeUpdates.push({
      contextId: request.targetContextId,
      resumeVersion,
    });
  }
  if (
    request.sourceContextId !== undefined &&
    request.targetContextId?.value !== request.sourceContextId.value &&
    request.origin.kind === 'inventory_anchor'
  ) {
    const resumeVersion = restoreSourceContextResume(
      database,
      request.sourceContextId,
      request.origin,
      request.occurredAt,
    );
    resumeUpdates.push({
      contextId: request.sourceContextId,
      resumeVersion,
    });
  }
  if (request.sourceContextId !== undefined) {
    deleteContextScratch(database, request.sourceContextId.value);
  }

  const dataRevision = incrementDataRevision(database, request.occurredAt);
  return Object.freeze({
    itemId,
    revisionId,
    rootAnchorId: graph.rootAnchorId,
    ...(contributionId === undefined ? {} : { contributionId }),
    ...(contextReferenceId === undefined
      ? {}
      : {
          contextReferenceId: localId('context-reference', contextReferenceId),
        }),
    resumeUpdates: Object.freeze(resumeUpdates),
    dataRevision,
  });
}

export function readAnalysisRecordView(
  database: Database.Database,
  request: {
    readonly itemId: InventoryItemId;
    readonly revisionId: ItemRevisionId;
    readonly anchorId: AnchorId;
    readonly contextId?: WorkingContextId;
    readonly readOnlyPreview: boolean;
  },
): AnalysisRecordView | undefined {
  return readAnalysisRecordViewInternal(database, request, new Set());
}

function readAnalysisRecordViewInternal(
  database: Database.Database,
  request: {
    readonly itemId: InventoryItemId;
    readonly revisionId: ItemRevisionId;
    readonly anchorId: AnchorId;
    readonly contextId?: WorkingContextId;
    readonly readOnlyPreview: boolean;
  },
  ancestors: ReadonlySet<string>,
): AnalysisRecordView | undefined {
  const recordKey = `${request.itemId.value}:${request.revisionId.value}`;
  if (ancestors.has(recordKey)) throw invalidAnalysisRecord();
  const nextAncestors = new Set(ancestors).add(recordKey);
  const header = database
    .prepare(
      `SELECT item.item_type AS itemType,
              revision.display_name AS displayName,
              revision.summary_text AS summary,
              revision.language_tag AS languageTag,
              revision.revision_number AS revisionNumber,
              item.current_revision_id AS currentRevisionId,
              COALESCE(analysis.origin_mode, game.origin_mode) AS originMode,
              COALESCE(analysis.root_occurrence_id,
                       game.root_occurrence_id) AS rootOccurrenceId,
              COALESCE(analysis_origin.source_item_id,
                       game_origin.source_item_id) AS sourceItemId,
              COALESCE(analysis_origin.source_revision_id,
                       game_origin.source_revision_id) AS sourceRevisionId,
              COALESCE(analysis_origin.source_anchor_id,
                       game_origin.source_anchor_id) AS sourceAnchorId,
              game.player_side AS playerSide,
              game.result_kind AS resultKind,
              game.result_reason AS resultReason,
              game.policy_capability AS policyCapability,
              game.provider_instance_id AS providerInstanceId,
              game.provider_fingerprint AS providerFingerprint,
              game.provider_type AS providerType,
              game.provider_display_name AS providerDisplayName,
              game.profile_model_name AS profileModelName,
              game.profile_selection_mode AS profileSelectionMode,
              game.profile_history_mode AS profileHistoryMode,
              game.profile_reproducibility AS profileReproducibility
         FROM inventory_item AS item
         JOIN item_revision AS revision
           ON revision.item_id = item.item_id
          AND revision.revision_id = ?
         LEFT JOIN inventory_analysis_revision AS analysis
           ON analysis.item_id = item.item_id
          AND analysis.revision_id = revision.revision_id
         LEFT JOIN inventory_game_revision AS game
           ON game.item_id = item.item_id
          AND game.revision_id = revision.revision_id
         LEFT JOIN inventory_analysis_origin AS analysis_origin
           ON analysis_origin.analysis_revision_id = analysis.revision_id
         LEFT JOIN inventory_game_origin AS game_origin
           ON game_origin.game_revision_id = game.revision_id
        WHERE item.item_id = ? AND item.item_type IN ('analysis', 'game')
          AND (analysis.revision_id IS NOT NULL OR game.revision_id IS NOT NULL)`,
    )
    .get(request.revisionId.value, request.itemId.value) as
    | {
        itemType: 'analysis' | 'game';
        displayName: string;
        summary: string | null;
        languageTag: string;
        revisionNumber: number;
        currentRevisionId: number;
        originMode:
          'initial_position' | 'fen' | 'position_setup' | 'inventory_anchor';
        rootOccurrenceId: number;
        sourceItemId: number | null;
        sourceRevisionId: number | null;
        sourceAnchorId: number | null;
        playerSide: 'white' | 'black' | null;
        resultKind: 'white_win' | 'black_win' | 'draw' | 'unfinished' | null;
        resultReason:
          | 'checkmate'
          | 'stalemate'
          | 'insufficient_material'
          | 'threefold_repetition'
          | 'seventy_five_move'
          | null;
        policyCapability: 'best_move' | 'human_profile' | null;
        providerInstanceId: string | null;
        providerFingerprint: string | null;
        providerType: string | null;
        providerDisplayName: string | null;
        profileModelName: string | null;
        profileSelectionMode: HumanMovePolicyProfile['selectionMode'] | null;
        profileHistoryMode: HumanMovePolicyProfile['historyMode'] | null;
        profileReproducibility:
          HumanMovePolicyProfile['reproducibility'] | null;
      }
    | undefined;
  if (header === undefined) return undefined;

  const rows = readMainLine(
    database,
    request.revisionId.value,
    header.rootOccurrenceId,
  );
  if (rows.length === 0) throw invalidAnalysisRecord();
  if (
    resolveAnchorPosition(
      database,
      request.itemId.value,
      request.revisionId.value,
      request.anchorId.value,
    ) === undefined
  ) {
    return undefined;
  }
  const states = rows.map((row) =>
    readChessState(database, localId('position', row.positionId), {
      halfmoveClock: row.halfmoveClock,
      fullmoveNumber: row.fullmoveNumber,
      historyKnowledge: row.historyKnowledge,
    }),
  );
  const steps = Object.freeze(
    rows.slice(0, -1).map((row, index) => {
      const after = states[index + 1];
      const before = states[index];
      if (
        before === undefined ||
        after === undefined ||
        row.moveNodeId === null ||
        row.from === null ||
        row.to === null ||
        row.san === null
      ) {
        throw invalidAnalysisRecord();
      }
      return Object.freeze({
        before,
        move: Object.freeze({
          from: row.from,
          to: row.to,
          ...(row.promotion === null ? {} : { promotion: row.promotion }),
          san: row.san,
        }),
        after,
        anchorId: localId('anchor', rows[index + 1]!.occurrenceAnchorId),
      });
    }),
  );
  const cursor = resolveRecordCursor(database, request.anchorId, rows);
  if (cursor === undefined) return undefined;
  const rootAnchor = database
    .prepare(
      `SELECT anchor_id AS anchorId FROM chess_anchor
        WHERE anchor_kind = 'occurrence' AND owner_item_id = ?
          AND occurrence_id = ?`,
    )
    .get(request.itemId.value, header.rootOccurrenceId) as
    { anchorId: number } | undefined;
  if (rootAnchor === undefined || states[0] === undefined) {
    throw invalidAnalysisRecord();
  }
  const origin = analysisRecordOrigin(header);
  const sourceLine = readSourceLine(
    database,
    origin,
    nextAncestors,
    request.contextId,
  );
  const contributions = readContributions(
    database,
    request.itemId.value,
    request.revisionId.value,
    request.contextId,
  );
  const contextMember =
    request.contextId === undefined
      ? false
      : database
          .prepare(
            `SELECT 1 FROM workspace_context_item
              WHERE context_id = ? AND item_id = ?`,
          )
          .get(request.contextId.value, request.itemId.value) !== undefined;
  return Object.freeze({
    itemType: header.itemType,
    itemId: request.itemId,
    revisionId: request.revisionId,
    currentRevisionId: localId('item-revision', header.currentRevisionId),
    revisionNumber: header.revisionNumber,
    rootAnchorId: localId('anchor', rootAnchor.anchorId),
    currentAnchorId: request.anchorId,
    displayName: header.displayName,
    ...(header.summary === null ? {} : { summary: header.summary }),
    languageTag: header.languageTag,
    ...(header.itemType === 'game' ? { game: gameDetails(header) } : {}),
    origin,
    ...(sourceLine === undefined ? {} : { sourceLine }),
    root: states[0],
    steps,
    cursor,
    contributions,
    contextMember,
    readOnlyPreview: request.readOnlyPreview && !contextMember,
    historical: request.revisionId.value !== header.currentRevisionId,
  });
}

function gameDetails(header: {
  readonly playerSide: 'white' | 'black' | null;
  readonly resultKind: 'white_win' | 'black_win' | 'draw' | 'unfinished' | null;
  readonly resultReason:
    | 'checkmate'
    | 'stalemate'
    | 'insufficient_material'
    | 'threefold_repetition'
    | 'seventy_five_move'
    | null;
  readonly policyCapability: 'best_move' | 'human_profile' | null;
  readonly providerInstanceId: string | null;
  readonly providerFingerprint: string | null;
  readonly providerType: string | null;
  readonly providerDisplayName: string | null;
  readonly profileModelName: string | null;
  readonly profileSelectionMode: HumanMovePolicyProfile['selectionMode'] | null;
  readonly profileHistoryMode: HumanMovePolicyProfile['historyMode'] | null;
  readonly profileReproducibility:
    HumanMovePolicyProfile['reproducibility'] | null;
}): NonNullable<AnalysisRecordView['game']> {
  if (
    header.playerSide === null ||
    header.resultKind === null ||
    header.policyCapability === null ||
    header.providerInstanceId === null ||
    header.providerFingerprint === null ||
    header.providerType === null ||
    header.providerDisplayName === null
  ) {
    throw invalidAnalysisRecord();
  }
  const outcome =
    header.resultKind === 'unfinished'
      ? ({ kind: 'unfinished' } as const)
      : header.resultKind === 'white_win' || header.resultKind === 'black_win'
        ? ({
            kind: 'win',
            winner: header.resultKind === 'white_win' ? 'white' : 'black',
          } as const)
        : header.resultReason === 'stalemate' ||
            header.resultReason === 'insufficient_material' ||
            header.resultReason === 'threefold_repetition' ||
            header.resultReason === 'seventy_five_move'
          ? ({ kind: 'draw', reason: header.resultReason } as const)
          : undefined;
  if (outcome === undefined) throw invalidAnalysisRecord();
  const binding = {
    providerInstanceId: header.providerInstanceId,
    providerFingerprint: header.providerFingerprint,
    providerType: header.providerType,
    providerDisplayName: header.providerDisplayName,
  } as const;
  return Object.freeze({
    playerSide: header.playerSide,
    outcome: Object.freeze(outcome),
    policy:
      header.policyCapability === 'best_move'
        ? Object.freeze({ ...binding, capability: 'best_move' as const })
        : Object.freeze({
            ...binding,
            capability: 'human_profile' as const,
            profile: Object.freeze(gameProfile(header)),
          }),
  });
}

function gameProfile(header: {
  readonly profileModelName: string | null;
  readonly profileSelectionMode: HumanMovePolicyProfile['selectionMode'] | null;
  readonly profileHistoryMode: HumanMovePolicyProfile['historyMode'] | null;
  readonly profileReproducibility:
    HumanMovePolicyProfile['reproducibility'] | null;
}): HumanMovePolicyProfile {
  if (
    header.profileModelName === null ||
    header.profileSelectionMode === null ||
    header.profileHistoryMode === null ||
    header.profileReproducibility === null
  ) {
    throw invalidAnalysisRecord();
  }
  return {
    modelName: header.profileModelName,
    selectionMode: header.profileSelectionMode,
    historyMode: header.profileHistoryMode,
    reproducibility: header.profileReproducibility,
  };
}

function readSourceLine(
  database: Database.Database,
  origin: AnalysisRecordView['origin'],
  ancestors: ReadonlySet<string>,
  contextId: WorkingContextId | undefined,
): AnalysisSourceLineView | undefined {
  if (origin.kind !== 'inventory_anchor') return undefined;
  const source = readAnalysisRecordViewInternal(
    database,
    {
      itemId: origin.itemId,
      revisionId: origin.revisionId,
      anchorId: origin.anchorId,
      ...(contextId === undefined ? {} : { contextId }),
      readOnlyPreview: true,
    },
    ancestors,
  );
  if (source === undefined) throw invalidAnalysisRecord();
  return Object.freeze({
    sourceItemId: origin.itemId,
    sourceRevisionId: origin.revisionId,
    sourceAnchorId: origin.anchorId,
    sourceDisplayName: source.displayName,
    root: source.sourceLine?.root ?? source.root,
    rootTarget: source.sourceLine?.rootTarget ?? {
      itemId: source.itemId,
      revisionId: source.revisionId,
      anchorId: source.rootAnchorId,
    },
    steps: Object.freeze([
      ...(source.sourceLine?.steps ?? []),
      ...source.steps.slice(0, source.cursor).map((step) =>
        Object.freeze({
          ...step,
          itemId: source.itemId,
          revisionId: source.revisionId,
        }),
      ),
    ]),
    contributions: Object.freeze([
      ...(source.sourceLine?.contributions ?? []),
      ...source.contributions,
    ]),
  });
}

export function insertLinearGraph(
  database: Database.Database,
  itemId: InventoryItemId,
  revisionId: ItemRevisionId,
  request: LinearChessGraphInput,
): InsertedGraph {
  const states: ChessState[] = [
    request.root,
    ...request.steps.map((step) => step.after),
  ];
  const occurrenceIds: number[] = [];
  const occurrenceAnchorIds: AnchorId[] = [];
  for (const [index, state] of states.entries()) {
    const identity = database
      .prepare(
        `INSERT INTO chess_occurrence_identity (item_id, created_revision_id)
         VALUES (?, ?)`,
      )
      .run(itemId.value, revisionId.value);
    const occurrenceId = Number(identity.lastInsertRowid);
    occurrenceIds.push(occurrenceId);
    const positionId = ensurePosition(database, state.position);
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
        positionId.value,
        index === 0 ? 1 : 0,
        fingerprint({
          positionKey: state.position.positionKey,
          playState: state.playState,
        }),
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
        state.playState.halfmoveClock,
        state.playState.fullmoveNumber,
        state.playState.historyKnowledge,
      );
    const anchor = database
      .prepare(
        `INSERT INTO chess_anchor
           (anchor_kind, owner_item_id, item_id, position_id,
            occurrence_id, move_node_id)
         VALUES ('occurrence', ?, NULL, NULL, ?, NULL)`,
      )
      .run(itemId.value, occurrenceId);
    occurrenceAnchorIds.push(localId('anchor', Number(anchor.lastInsertRowid)));
  }
  database
    .prepare(
      `INSERT INTO chess_anchor
         (anchor_kind, owner_item_id, item_id, position_id,
          occurrence_id, move_node_id)
       VALUES ('item', NULL, ?, NULL, NULL, NULL)`,
    )
    .run(itemId.value);

  for (const [index, step] of request.steps.entries()) {
    const parentOccurrenceId = occurrenceIds[index];
    const childOccurrenceId = occurrenceIds[index + 1];
    if (parentOccurrenceId === undefined || childOccurrenceId === undefined) {
      throw invalidAnalysisRecord();
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
         VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId.value,
        moveNodeId,
        itemId.value,
        parentOccurrenceId,
        childOccurrenceId,
        step.move.from,
        step.move.to,
        step.move.promotion ?? null,
        step.move.san,
        fingerprint({
          parentOccurrenceId,
          childOccurrenceId,
          move: step.move,
        }),
      );
    database
      .prepare(
        `INSERT INTO chess_anchor
           (anchor_kind, owner_item_id, item_id, position_id,
            occurrence_id, move_node_id)
         VALUES ('move_node', ?, NULL, NULL, NULL, ?)`,
      )
      .run(itemId.value, moveNodeId);
  }
  const rootAnchorId = occurrenceAnchorIds[0];
  const endAnchorId = occurrenceAnchorIds.at(-1);
  if (rootAnchorId === undefined || endAnchorId === undefined) {
    throw invalidAnalysisRecord();
  }
  return { rootAnchorId, endAnchorId };
}

export function validateLinearGraph(
  database: Database.Database,
  itemId: InventoryItemId,
  revisionId: ItemRevisionId,
  expectedOccurrences: number,
): void {
  const result = database
    .prepare(
      `WITH RECURSIVE reachable(occurrence_id, path, cycle) AS (
         SELECT occurrence_id, printf('/%d/', occurrence_id), 0
           FROM chess_occurrence_snapshot
          WHERE revision_id = ? AND item_id = ? AND is_root = 1
         UNION ALL
         SELECT move.child_occurrence_id,
                reachable.path || move.child_occurrence_id || '/',
                instr(reachable.path,
                      printf('/%d/', move.child_occurrence_id)) > 0
           FROM reachable
           JOIN chess_move_node_snapshot AS move
             ON move.revision_id = ?
            AND move.parent_occurrence_id = reachable.occurrence_id
          WHERE reachable.cycle = 0
       )
       SELECT count(DISTINCT occurrence_id) AS reachableCount,
              max(cycle) AS hasCycle
         FROM reachable`,
    )
    .get(revisionId.value, itemId.value, revisionId.value) as {
    reachableCount: number;
    hasCycle: number;
  };
  const moveCount = database
    .prepare(
      `SELECT count(*) AS count FROM chess_move_node_snapshot
        WHERE revision_id = ? AND item_id = ?`,
    )
    .get(revisionId.value, itemId.value) as { count: number };
  if (
    result.reachableCount !== expectedOccurrences ||
    result.hasCycle !== 0 ||
    moveCount.count !== expectedOccurrences - 1
  ) {
    throw invalidAnalysisRecord();
  }
}

function validateSourceScratch(
  database: Database.Database,
  request: PersistAnalysisRecordRequest,
): void {
  if (request.sourceContextId === undefined) return;
  if (
    request.expectedScratchId === undefined ||
    request.expectedScratchRevision === undefined
  ) {
    throw invalidAnalysisRecord();
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
}

function contextHasScratch(
  database: Database.Database,
  contextId: number,
): boolean {
  return (
    database
      .prepare(`SELECT 1 FROM analysis_scratch_draft WHERE context_id = ?`)
      .get(contextId) !== undefined
  );
}

function insertTargetContext(
  database: Database.Database,
  contextId: WorkingContextId,
  itemId: InventoryItemId,
  rootAnchorId: AnchorId,
  occurredAt: string,
): number {
  database
    .prepare(
      `INSERT INTO workspace_context_item
         (context_id, item_id, relationship_version, created_at_utc)
       VALUES (?, ?, 1, ?)`,
    )
    .run(contextId.value, itemId.value, occurredAt);
  const inserted = database
    .prepare(
      `INSERT INTO workspace_context_reference
         (context_id, item_id, anchor_id, created_at_utc)
       VALUES (?, ?, ?, ?)`,
    )
    .run(contextId.value, itemId.value, rootAnchorId.value, occurredAt);
  database
    .prepare(
      `UPDATE workspace_working_context SET updated_at_utc = ?
        WHERE context_id = ?`,
    )
    .run(occurredAt, contextId.value);
  return Number(inserted.lastInsertRowid);
}

function upsertRecordResume(
  database: Database.Database,
  contextId: WorkingContextId,
  itemId: InventoryItemId,
  revisionId: ItemRevisionId,
  anchorId: AnchorId,
  occurredAt: string,
): number {
  const positionId = resolveAnchorPosition(
    database,
    itemId.value,
    revisionId.value,
    anchorId.value,
  );
  if (positionId === undefined) throw invalidAnalysisRecord();
  const row = database
    .prepare(
      `SELECT resume_version AS resumeVersion
         FROM workspace_analysis_resume WHERE context_id = ?`,
    )
    .get(contextId.value) as { resumeVersion: number } | undefined;
  const resumeVersion = (row?.resumeVersion ?? 0) + 1;
  database
    .prepare(
      `INSERT INTO workspace_analysis_resume
         (context_id, resume_version, item_id, revision_id, anchor_id,
          mode, current_position_id, analysis_scratch_draft_id, updated_at_utc)
       VALUES (?, ?, ?, ?, ?, 'analyze', ?, NULL, ?)
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
      contextId.value,
      resumeVersion,
      itemId.value,
      revisionId.value,
      anchorId.value,
      positionId,
      occurredAt,
    );
  return resumeVersion;
}

function insertSearchDocument(
  database: Database.Database,
  request: PersistAnalysisRecordRequest,
  itemId: InventoryItemId,
  revisionId: ItemRevisionId,
  rootAnchorId: AnchorId,
): void {
  database
    .prepare(
      `INSERT INTO search_document
         (projection_version, subject_kind, item_id, item_revision_id,
          contribution_id, anchor_id, context_id, language_tag,
          evidence_class, scope_kind, stable_sort_value, title,
          aliases_concepts, metadata, body)
       VALUES (1, 'item_revision', ?, ?, NULL, ?, NULL, ?,
               'personal', 'global', ?, ?, '', 'analysis manual', '')`,
    )
    .run(
      itemId.value,
      revisionId.value,
      rootAnchorId.value,
      request.languageTag,
      request.occurredAt,
      request.displayName,
    );
}

interface MainLineRow {
  readonly depth: number;
  readonly occurrenceId: number;
  readonly occurrenceAnchorId: number;
  readonly positionId: number;
  readonly halfmoveClock: number;
  readonly fullmoveNumber: number;
  readonly historyKnowledge: ChessState['playState']['historyKnowledge'];
  readonly moveNodeId: number | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly promotion: PromotionPiece | null;
  readonly san: string | null;
}

function readMainLine(
  database: Database.Database,
  revisionId: number,
  rootOccurrenceId: number,
): MainLineRow[] {
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
       SELECT line.depth,
              occurrence.occurrence_id AS occurrenceId,
              occurrence_anchor.anchor_id AS occurrenceAnchorId,
              occurrence.position_id AS positionId,
              play.halfmove_clock AS halfmoveClock,
              play.fullmove_number AS fullmoveNumber,
              play.history_knowledge AS historyKnowledge,
              move.move_node_id AS moveNodeId,
              move.from_square AS 'from', move.to_square AS 'to',
              move.promotion, move.san
         FROM line
         JOIN chess_occurrence_snapshot AS occurrence
           ON occurrence.revision_id = ?
          AND occurrence.occurrence_id = line.occurrence_id
         JOIN chess_play_state_snapshot AS play
          ON play.revision_id = occurrence.revision_id
         AND play.occurrence_id = occurrence.occurrence_id
         JOIN chess_anchor AS occurrence_anchor
           ON occurrence_anchor.anchor_kind = 'occurrence'
          AND occurrence_anchor.owner_item_id = occurrence.item_id
          AND occurrence_anchor.occurrence_id = occurrence.occurrence_id
         LEFT JOIN chess_move_node_snapshot AS move
           ON move.revision_id = occurrence.revision_id
          AND move.parent_occurrence_id = occurrence.occurrence_id
          AND move.is_main_line = 1
        ORDER BY line.depth`,
    )
    .all(rootOccurrenceId, revisionId, revisionId) as MainLineRow[];
}

function resolveRecordCursor(
  database: Database.Database,
  anchorId: AnchorId,
  rows: readonly MainLineRow[],
): number | undefined {
  const anchor = database
    .prepare(
      `SELECT anchor_kind AS anchorKind, item_id AS itemId,
              position_id AS positionId, occurrence_id AS occurrenceId,
              move_node_id AS moveNodeId
         FROM chess_anchor WHERE anchor_id = ?`,
    )
    .get(anchorId.value) as
    | {
        anchorKind: 'item' | 'position' | 'occurrence' | 'move_node';
        itemId: number | null;
        positionId: number | null;
        occurrenceId: number | null;
        moveNodeId: number | null;
      }
    | undefined;
  if (anchor === undefined) return undefined;
  if (anchor.anchorKind === 'item') return 0;
  if (anchor.anchorKind === 'occurrence') {
    return rows.findIndex((row) => row.occurrenceId === anchor.occurrenceId);
  }
  if (anchor.anchorKind === 'move_node') {
    const index = rows.findIndex((row) => row.moveNodeId === anchor.moveNodeId);
    return index < 0 ? undefined : index + 1;
  }
  const index = rows.findIndex((row) => row.positionId === anchor.positionId);
  return index < 0 ? undefined : index;
}

function readContributions(
  database: Database.Database,
  itemId: number,
  revisionId: number,
  contextId: WorkingContextId | undefined,
): readonly AnalysisContributionView[] {
  const rows = database
    .prepare(
      `SELECT contribution.contribution_id AS contributionId,
              contribution.anchor_id AS anchorId,
              contribution.body, contribution.language_tag AS languageTag,
              contribution.scope_kind AS scopeKind,
              contribution.context_id AS contextId,
              contribution.contribution_version AS contributionVersion,
              contribution.created_at_utc AS createdAt,
              contribution.updated_at_utc AS updatedAt
         FROM workspace_contribution AS contribution
         JOIN chess_anchor AS anchor
           ON anchor.anchor_id = contribution.anchor_id
        WHERE contribution.status = 'active'
          AND (anchor.item_id = ? OR anchor.owner_item_id = ?)
          AND (
            anchor.anchor_kind = 'item'
            OR (anchor.anchor_kind = 'position' AND EXISTS (
              SELECT 1 FROM chess_occurrence_snapshot AS member
               WHERE member.revision_id = ? AND member.item_id = ?
                 AND member.position_id = anchor.position_id
            ))
            OR (anchor.anchor_kind = 'occurrence' AND EXISTS (
              SELECT 1 FROM chess_occurrence_snapshot AS member
               WHERE member.revision_id = ? AND member.item_id = ?
                 AND member.occurrence_id = anchor.occurrence_id
            ))
            OR (anchor.anchor_kind = 'move_node' AND EXISTS (
              SELECT 1 FROM chess_move_node_snapshot AS member
               WHERE member.revision_id = ? AND member.item_id = ?
                 AND member.move_node_id = anchor.move_node_id
            ))
          )
          AND (contribution.scope_kind = 'global'
               OR contribution.context_id = ?)
        ORDER BY contribution.created_at_utc, contribution.contribution_id`,
    )
    .all(
      itemId,
      itemId,
      revisionId,
      itemId,
      revisionId,
      itemId,
      revisionId,
      itemId,
      contextId?.value ?? null,
    ) as {
    contributionId: number;
    anchorId: number;
    body: string;
    languageTag: string;
    scopeKind: 'global' | 'context';
    contextId: number | null;
    contributionVersion: number;
    createdAt: string;
    updatedAt: string;
  }[];
  const moves = readAnalysisNoteMoves(
    database,
    rows.map((row) => row.contributionId),
  );
  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        contributionId: localId('contribution', row.contributionId),
        anchorId: localId('anchor', row.anchorId),
        body: row.body,
        moves: moves.get(row.contributionId) ?? Object.freeze([]),
        languageTag: row.languageTag,
        scopeKind: row.scopeKind,
        ...(row.contextId === null
          ? {}
          : { contextId: localId('working-context', row.contextId) }),
        contributionVersion: row.contributionVersion,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
    ),
  );
}

function analysisRecordOrigin(header: {
  readonly originMode:
    'initial_position' | 'fen' | 'position_setup' | 'inventory_anchor';
  readonly sourceItemId: number | null;
  readonly sourceRevisionId: number | null;
  readonly sourceAnchorId: number | null;
}): AnalysisRecordView['origin'] {
  if (header.originMode !== 'inventory_anchor') {
    return Object.freeze({ kind: header.originMode });
  }
  if (
    header.sourceItemId === null ||
    header.sourceRevisionId === null ||
    header.sourceAnchorId === null
  ) {
    throw invalidAnalysisRecord();
  }
  return Object.freeze({
    kind: 'inventory_anchor',
    itemId: localId('inventory-item', header.sourceItemId),
    revisionId: localId('item-revision', header.sourceRevisionId),
    anchorId: localId('anchor', header.sourceAnchorId),
  });
}

function restoreSourceContextResume(
  database: Database.Database,
  contextId: WorkingContextId,
  origin: Extract<
    PersistAnalysisRecordRequest['origin'],
    { readonly kind: 'inventory_anchor' }
  >,
  occurredAt: string,
): number {
  const positionId = resolveAnchorPosition(
    database,
    origin.itemId.value,
    origin.revisionId.value,
    origin.anchorId.value,
  );
  if (positionId === undefined) throw invalidAnalysisRecord();
  const current = database
    .prepare(
      `SELECT resume_version AS resumeVersion
         FROM workspace_analysis_resume
        WHERE context_id = ? AND analysis_scratch_draft_id IS NOT NULL`,
    )
    .get(contextId.value) as { resumeVersion: number } | undefined;
  if (current === undefined) throw invalidAnalysisRecord();
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
  if (changed.changes !== 1) throw invalidAnalysisRecord();
  return resumeVersion;
}

function fingerprint(value: unknown): Buffer {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest();
}
