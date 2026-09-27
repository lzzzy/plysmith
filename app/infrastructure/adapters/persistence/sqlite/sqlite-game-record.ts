import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

import {
  invalidPlayout,
  playoutConflict,
  playoutNotFound,
  type CompletePlayoutRequest,
  type CompletePlayoutResult,
  type PersistCompletePlayoutRequest,
} from '../../../../application/playout/index.ts';
import {
  gameResultMatchesPlayout,
  manualGameResult,
  validateGameResult,
  type GameResult,
  type GameOutcome,
  type GameOutcomeSource,
  type PlayoutTerminalReason,
  type MovePolicyBinding,
} from '../../../../domain/playout/index.ts';
import {
  localId,
  type AnchorId,
  type InventoryItemId,
  type ItemRevisionId,
} from '../../../../domain/identity/index.ts';
import {
  insertLinearGraph,
  validateLinearGraph,
} from './sqlite-analysis-record.ts';
import { inventoryDisplayNameIsAvailable } from './sqlite-inventory-display-name.ts';
import { inventoryDisplayNameConflict } from '../../../../application/inventory/index.ts';
import { readPlayout } from './sqlite-playout.ts';
import { deleteUnreferencedPositions } from './sqlite-chess-state.ts';
import { incrementDataRevision } from './sqlite-store-helpers.ts';
import { requireActiveContext } from './sqlite-workspace.ts';
import { persistGameSourcePath } from './sqlite-game-source-path.ts';
import { requireContextInventoryWorkAccess } from './sqlite-context-item.ts';

export function completePlayout(
  database: Database.Database,
  request: PersistCompletePlayoutRequest,
): CompletePlayoutResult {
  try {
    validateGameResult(request.game);
  } catch {
    throw invalidPlayout();
  }
  const manualResult = manualGameResult(request.game);
  const receipt = readPlayoutCompletion(database, {
    scope: request.scope,
    draftId: request.draftId,
    expectedDraftRevision: request.expectedDraftRevision,
    completionId: request.completionId,
    displayName: request.game.displayName,
    languageTag: request.game.languageTag,
    ...(manualResult === undefined ? {} : { manualResult }),
    ...(request.targetContextId === undefined
      ? {}
      : { targetContextId: request.targetContextId }),
  });
  if (receipt !== undefined) {
    const expectedResult = resultValues(receipt);
    if (
      resultValues(request.game).some(
        (value, index) => value !== expectedResult[index],
      )
    ) {
      throw invalidPlayout();
    }
    return receipt;
  }
  if (
    request.completionId.trim() !== request.completionId ||
    request.completionId.length < 1 ||
    request.completionId.length > 160
  ) {
    throw invalidPlayout();
  }
  const stored = readPlayout(database, request.scope);
  if (
    stored === undefined ||
    stored.draft.draftId.value !== request.draftId.value
  ) {
    throw playoutNotFound();
  }
  if (stored.draft.draftRevision !== request.expectedDraftRevision) {
    throw playoutConflict(
      request.expectedDraftRevision,
      stored.draft.draftRevision,
    );
  }
  if (
    (stored.draft.status.kind !== 'stopped' &&
      stored.draft.status.kind !== 'terminal') ||
    !gameMatchesDraft(request, stored.draft)
  ) {
    throw invalidPlayout();
  }
  requireContextInventoryWorkAccess(
    database,
    request.scope,
    stored.draft.origin.kind === 'inventory_anchor'
      ? stored.draft.origin.itemId
      : undefined,
  );
  if (!inventoryDisplayNameIsAvailable(database, request.game.displayName)) {
    throw inventoryDisplayNameConflict();
  }
  if (request.targetContextId !== undefined) {
    if (
      request.scope.kind !== 'context' ||
      request.scope.contextId.value !== request.targetContextId.value
    ) {
      throw invalidPlayout();
    }
    requireActiveContext(database, request.targetContextId);
  }

  const itemInsert = database
    .prepare(
      `INSERT INTO inventory_item
         (item_type, origin_kind, lifecycle, current_revision_id,
          created_at_utc, updated_at_utc)
       VALUES ('game', 'playout', 'active', NULL, ?, ?)`,
    )
    .run(request.occurredAt, request.occurredAt);
  const itemId = localId('inventory-item', Number(itemInsert.lastInsertRowid));
  const revisionInsert = database
    .prepare(
      `INSERT INTO item_revision
         (item_id, revision_number, base_revision_id, display_name,
          summary_text, language_tag, content_fingerprint, creator_role,
          created_at_utc)
       VALUES (?, 1, NULL, ?, NULL, ?, ?, 'playout', ?)`,
    )
    .run(
      itemId.value,
      request.game.displayName,
      request.game.languageTag,
      gameFingerprint(request),
      request.occurredAt,
    );
  const revisionId = localId(
    'item-revision',
    Number(revisionInsert.lastInsertRowid),
  );
  const graph = insertLinearGraph(database, itemId, revisionId, request.game);
  const result = resultValues(request.game);
  database
    .prepare(
      `INSERT INTO inventory_game_revision
         (revision_id, item_id, root_occurrence_id, origin_mode, player_side,
          result_kind, result_reason, result_source, policy_capability, provider_instance_id,
          provider_fingerprint, provider_type, provider_display_name,
          profile_model_name, profile_selection_mode,
          profile_history_mode, profile_reproducibility)
       SELECT ?, ?, a.occurrence_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM chess_anchor AS a
        WHERE a.anchor_id = ? AND a.anchor_kind = 'occurrence'`,
    )
    .run(
      revisionId.value,
      itemId.value,
      request.game.origin.kind,
      request.game.playerSide,
      ...result,
      request.game.policy.capability,
      request.game.policy.providerInstanceId,
      request.game.policy.providerFingerprint,
      request.game.provider.providerType,
      request.game.provider.providerDisplayName,
      ...policyProfileValues(request.game.policy),
      graph.rootAnchorId.value,
    );
  if (request.game.origin.kind === 'inventory_anchor') {
    database
      .prepare(
        `INSERT INTO inventory_game_origin
           (game_revision_id, source_item_id, source_revision_id,
            source_anchor_id)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        revisionId.value,
        request.game.origin.itemId.value,
        request.game.origin.revisionId.value,
        request.game.origin.anchorId.value,
      );
  }
  validateLinearGraph(
    database,
    itemId,
    revisionId,
    request.game.steps.length + 1,
  );
  persistGameSourcePath(database, request.draftId.value, revisionId.value);
  database
    .prepare(
      'UPDATE inventory_item SET current_revision_id = ? WHERE item_id = ?',
    )
    .run(revisionId.value, itemId.value);
  insertSearchDocument(
    database,
    itemId,
    revisionId,
    graph.rootAnchorId,
    request,
  );
  const contextReferenceId =
    request.targetContextId === undefined
      ? undefined
      : insertContextReference(
          database,
          request.targetContextId.value,
          itemId.value,
          graph.rootAnchorId.value,
          request.occurredAt,
        );
  const sourcePositionIds = readSourcePositionIds(
    database,
    stored.draft.draftId.value,
  );
  database
    .prepare('DELETE FROM playout_source_ply WHERE draft_id = ?')
    .run(stored.draft.draftId.value);
  database
    .prepare('DELETE FROM playout_ply WHERE draft_id = ?')
    .run(request.draftId.value);
  database
    .prepare('DELETE FROM playout_draft WHERE draft_id = ?')
    .run(request.draftId.value);
  deleteUnreferencedPositions(database, sourcePositionIds);
  const dataRevision = incrementDataRevision(database, request.occurredAt);
  database
    .prepare(
      `INSERT INTO playout_completion_receipt
         (completion_id, draft_id, scope_kind, context_id,
          expected_draft_revision, display_name, language_tag,
          target_context_id, item_id, revision_id, root_anchor_id,
          context_reference_id, data_revision, completed_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      request.completionId,
      request.draftId.value,
      request.scope.kind,
      request.scope.kind === 'context' ? request.scope.contextId.value : null,
      request.expectedDraftRevision,
      request.game.displayName,
      request.game.languageTag,
      request.targetContextId?.value ?? null,
      itemId.value,
      revisionId.value,
      graph.rootAnchorId.value,
      contextReferenceId ?? null,
      dataRevision,
      request.occurredAt,
    );
  return resultModel(
    itemId.value,
    revisionId.value,
    graph.rootAnchorId.value,
    contextReferenceId ?? null,
    dataRevision,
    request.game,
  );
}

function readSourcePositionIds(
  database: Database.Database,
  draftId: number,
): readonly number[] {
  const rows = database
    .prepare(
      `SELECT source_root_position_id AS positionId
         FROM playout_draft
        WHERE draft_id = ? AND source_root_position_id IS NOT NULL
       UNION
       SELECT before_position_id AS positionId
         FROM playout_source_ply WHERE draft_id = ?
       UNION
       SELECT after_position_id AS positionId
         FROM playout_source_ply WHERE draft_id = ?`,
    )
    .all(draftId, draftId, draftId) as { readonly positionId: number }[];
  return rows.map((row) => row.positionId);
}

function gameMatchesDraft(
  request: PersistCompletePlayoutRequest,
  draft: NonNullable<ReturnType<typeof readPlayout>>['draft'],
): boolean {
  if (draft.status.kind !== 'stopped' && draft.status.kind !== 'terminal') {
    return false;
  }
  return (
    JSON.stringify(request.game.origin) === JSON.stringify(draft.origin) &&
    JSON.stringify(request.game.sourcePath) ===
      JSON.stringify(draft.sourcePath) &&
    request.game.root.fen === draft.root.fen &&
    request.game.playerSide === draft.playerSide &&
    request.game.policy.providerInstanceId ===
      draft.policy.providerInstanceId &&
    request.game.policy.providerFingerprint ===
      draft.policy.providerFingerprint &&
    request.game.steps.length === draft.steps.length &&
    request.game.steps.every((step, index) => {
      const persisted = draft.steps[index];
      return (
        persisted !== undefined &&
        step.actor === persisted.actor &&
        step.move.from === persisted.move.from &&
        step.move.to === persisted.move.to &&
        step.move.promotion === persisted.move.promotion &&
        step.move.san === persisted.move.san &&
        step.after.fen === persisted.after.fen
      );
    }) &&
    gameResultMatchesPlayout(request.game, draft)
  );
}

export function readPlayoutCompletion(
  database: Database.Database,
  request: CompletePlayoutRequest,
): CompletePlayoutResult | undefined {
  const row = database
    .prepare(
      `SELECT draft_id AS draftId, scope_kind AS scopeKind,
              context_id AS contextId,
              expected_draft_revision AS expectedDraftRevision,
              display_name AS displayName, language_tag AS languageTag,
              target_context_id AS targetContextId,
              receipt.item_id AS itemId, receipt.revision_id AS revisionId,
              root_anchor_id AS rootAnchorId,
              context_reference_id AS contextReferenceId,
              data_revision AS dataRevision,
              game.result_kind AS resultKind,
              game.result_reason AS resultReason,
              game.result_source AS resultSource
         FROM playout_completion_receipt AS receipt
         JOIN inventory_game_revision AS game ON game.revision_id = receipt.revision_id
        WHERE completion_id = ?`,
    )
    .get(request.completionId) as
    | {
        draftId: number;
        scopeKind: 'free' | 'context';
        contextId: number | null;
        expectedDraftRevision: number;
        displayName: string;
        languageTag: string;
        targetContextId: number | null;
        itemId: number;
        revisionId: number;
        rootAnchorId: number;
        contextReferenceId: number | null;
        dataRevision: number;
        resultKind: 'white_win' | 'black_win' | 'draw' | 'unfinished';
        resultReason: PlayoutTerminalReason | null;
        resultSource: GameOutcomeSource;
      }
    | undefined;
  if (row === undefined) return undefined;
  const outcome: GameOutcome =
    row.resultKind === 'white_win' || row.resultKind === 'black_win'
      ? {
          kind: 'win',
          winner: row.resultKind === 'white_win' ? 'white' : 'black',
        }
      : row.resultKind === 'draw'
        ? row.resultSource === 'manual'
          ? { kind: 'draw' }
          : {
              kind: 'draw',
              reason: row.resultReason as Exclude<
                PlayoutTerminalReason,
                'checkmate'
              >,
            }
        : { kind: 'unfinished' };
  const result = validateGameResult({
    outcome,
    outcomeSource: row.resultSource,
  });
  const contextId =
    request.scope.kind === 'context' ? request.scope.contextId.value : null;
  if (
    row.draftId !== request.draftId.value ||
    row.scopeKind !== request.scope.kind ||
    row.contextId !== contextId ||
    row.expectedDraftRevision !== request.expectedDraftRevision ||
    row.displayName !== request.displayName ||
    row.languageTag !== request.languageTag ||
    row.targetContextId !== (request.targetContextId?.value ?? null) ||
    manualGameResult(result) !== request.manualResult
  ) {
    throw invalidPlayout();
  }
  return resultModel(
    row.itemId,
    row.revisionId,
    row.rootAnchorId,
    row.contextReferenceId,
    row.dataRevision,
    result,
  );
}

function resultModel(
  itemId: number,
  revisionId: number,
  rootAnchorId: number,
  contextReferenceId: number | null,
  dataRevision: number,
  result: GameResult,
): CompletePlayoutResult {
  return Object.freeze({
    itemId: localId('inventory-item', itemId),
    revisionId: localId('item-revision', revisionId),
    rootAnchorId: localId('anchor', rootAnchorId),
    ...(contextReferenceId === null
      ? {}
      : {
          contextReferenceId: localId('context-reference', contextReferenceId),
        }),
    dataRevision,
    ...validateGameResult(result),
  });
}

function resultValues(
  result: GameResult,
): readonly [
  'white_win' | 'black_win' | 'draw' | 'unfinished',
  (
    | 'checkmate'
    | 'stalemate'
    | 'insufficient_material'
    | 'threefold_repetition'
    | 'seventy_five_move'
    | null
  ),
  GameOutcomeSource,
] {
  const { outcome, outcomeSource } = result;
  if (outcome.kind === 'unfinished') return ['unfinished', null, outcomeSource];
  if (outcome.kind === 'win') {
    return [
      outcome.winner === 'white' ? 'white_win' : 'black_win',
      outcomeSource === 'automatic' ? 'checkmate' : null,
      outcomeSource,
    ];
  }
  return ['draw', outcome.reason ?? null, outcomeSource];
}

function insertContextReference(
  database: Database.Database,
  contextId: number,
  itemId: number,
  rootAnchorId: number,
  occurredAt: string,
): number {
  database
    .prepare(
      `INSERT INTO workspace_context_item
         (context_id, item_id, relationship_version, created_at_utc)
       VALUES (?, ?, 1, ?)`,
    )
    .run(contextId, itemId, occurredAt);
  const reference = database
    .prepare(
      `INSERT INTO workspace_context_reference
         (context_id, item_id, anchor_id, created_at_utc)
       VALUES (?, ?, ?, ?)`,
    )
    .run(contextId, itemId, rootAnchorId, occurredAt);
  database
    .prepare(
      'UPDATE workspace_working_context SET updated_at_utc = ? WHERE context_id = ?',
    )
    .run(occurredAt, contextId);
  return Number(reference.lastInsertRowid);
}

function insertSearchDocument(
  database: Database.Database,
  itemId: InventoryItemId,
  revisionId: ItemRevisionId,
  rootAnchorId: AnchorId,
  request: PersistCompletePlayoutRequest,
): void {
  database
    .prepare(
      `INSERT INTO search_document
         (projection_version, subject_kind, item_id, item_revision_id,
          contribution_id, anchor_id, context_id, language_tag,
          evidence_class, scope_kind, stable_sort_value, title,
          aliases_concepts, metadata, body)
       VALUES (1, 'item_revision', ?, ?, NULL, ?, NULL, ?,
               'personal', 'global', ?, ?, '', 'game playout', '')`,
    )
    .run(
      itemId.value,
      revisionId.value,
      rootAnchorId.value,
      request.game.languageTag,
      request.occurredAt,
      request.game.displayName,
    );
}

function gameFingerprint(request: PersistCompletePlayoutRequest): Buffer {
  return createHash('sha256')
    .update(
      JSON.stringify({
        displayName: request.game.displayName,
        languageTag: request.game.languageTag,
        origin: request.game.origin,
        sourcePath: request.game.sourcePath,
        root: request.game.root.fen,
        moves: request.game.steps.map((step) => step.move),
        outcome: request.game.outcome,
        outcomeSource: request.game.outcomeSource,
        policy: request.game.policy,
      }),
    )
    .digest();
}

function policyProfileValues(
  policy: MovePolicyBinding,
): readonly (string | number | null)[] {
  if (policy.capability === 'best_move') {
    return [null, null, null, null];
  }
  return [
    policy.profile.modelName,
    policy.profile.selectionMode,
    policy.profile.historyMode,
    policy.profile.reproducibility,
  ];
}
