import type Database from 'better-sqlite3';

import {
  invalidPlayout,
  playoutConflict,
  playoutNotFound,
  type PersistDiscardPlayoutRequest,
  type PersistReplacePlayoutRequest,
  type PersistStartPlayoutRequest,
  type StoredPlayout,
} from '../../../../application/playout/index.ts';
import type {
  AppliedMove,
  HistoryKnowledge,
  Position,
  PromotionPiece,
} from '../../../../domain/chess_graph/index.ts';
import {
  appendUserPlayoutMove,
  completePlayoutDraft,
  createPlayoutDraft,
  restorePlayoutDraft,
  type PlayoutDraft,
  type PlayoutOrigin,
  type PlayoutOutcome,
  type PlayoutStatus,
  type PlayoutStep,
} from '../../../../domain/playout/index.ts';
import { localId } from '../../../../domain/identity/index.ts';
import type { WorkScope } from '../../../../domain/workspace/index.ts';
import {
  deleteUnreferencedPositions,
  ensurePosition,
  readChessState,
} from './sqlite-chess-state.ts';
import {
  incrementDataRevision,
  readDataRevision,
} from './sqlite-store-helpers.ts';
import {
  requireActiveContext,
  resolveAnchorPosition,
} from './sqlite-workspace.ts';

interface DraftRow {
  readonly draftId: number;
  readonly originMode: PlayoutOrigin['kind'];
  readonly originItemId: number | null;
  readonly originRevisionId: number | null;
  readonly originAnchorId: number | null;
  readonly sourceDisplayName: string | null;
  readonly sourceRootPositionId: number | null;
  readonly sourceRootHalfmoveClock: number | null;
  readonly sourceRootFullmoveNumber: number | null;
  readonly sourceRootHistoryKnowledge: HistoryKnowledge | null;
  readonly rootPositionId: number;
  readonly rootHalfmoveClock: number;
  readonly rootFullmoveNumber: number;
  readonly rootHistoryKnowledge: HistoryKnowledge;
  readonly playerSide: 'white' | 'black';
  readonly policyCapability: 'best_move';
  readonly providerInstanceId: string;
  readonly providerFingerprint: string;
  readonly providerType: string;
  readonly providerDisplayName: string;
  readonly statusKind: PlayoutStatus['kind'];
  readonly terminalReason:
    | 'checkmate'
    | 'stalemate'
    | 'insufficient_material'
    | 'seventy_five_move'
    | null;
  readonly outcomeKind: 'win' | 'draw' | 'unfinished' | null;
  readonly winnerSide: 'white' | 'black' | null;
  readonly draftRevision: number;
  readonly decisionGeneration: number;
  readonly pendingDecisionId: number | null;
}

interface PlyRow {
  readonly plyIndex: number;
  readonly beforePositionId: number;
  readonly beforeHalfmoveClock: number;
  readonly beforeFullmoveNumber: number;
  readonly beforeHistoryKnowledge: HistoryKnowledge;
  readonly afterPositionId: number;
  readonly afterHalfmoveClock: number;
  readonly afterFullmoveNumber: number;
  readonly afterHistoryKnowledge: HistoryKnowledge;
  readonly from: string;
  readonly to: string;
  readonly promotion: PromotionPiece | null;
  readonly san: string;
  readonly actor: 'user' | 'provider';
  readonly decisionId: number | null;
}

type SourcePlyRow = Omit<PlyRow, 'actor' | 'decisionId'>;

export function readPlayout(
  database: Database.Database,
  scope: WorkScope,
): StoredPlayout | undefined {
  const row = database
    .prepare(
      `${draftSelectSql}
       WHERE d.scope_kind = ?
         AND ((? = 'free' AND d.context_id IS NULL) OR d.context_id = ?)`,
    )
    .get(
      scope.kind,
      scope.kind,
      scope.kind === 'context' ? scope.contextId.value : null,
    ) as DraftRow | undefined;
  if (row === undefined) return undefined;
  return Object.freeze({
    draft: mapDraft(database, row),
    dataRevision: readDataRevision(database),
  });
}

export function createPlayout(
  database: Database.Database,
  request: PersistStartPlayoutRequest,
): StoredPlayout {
  if (request.scope.kind === 'context') {
    requireActiveContext(database, request.scope.contextId);
  }
  validateOrigin(database, request.origin, request.root.position);
  const draftId = nextDraftId(database);
  let draft = createPlayoutDraft({
    draftId: localId('playout-draft', draftId),
    origin: request.origin,
    ...(request.sourcePath === undefined
      ? {}
      : { sourcePath: request.sourcePath }),
    root: request.root,
    playerSide: request.playerSide,
    policy: request.policy,
  });
  if (request.initialUserMove !== undefined) {
    draft = appendUserPlayoutMove(draft, request.initialUserMove);
  }
  if (request.initialTerminal !== undefined) {
    if (request.initialUserMove === undefined) throw invalidPlayout();
    draft = completePlayoutDraft(draft, request.initialTerminal);
  }
  insertDraft(database, request.scope, draft, request.occurredAt);
  return Object.freeze({
    draft,
    dataRevision: incrementDataRevision(database, request.occurredAt),
  });
}

export function replacePlayout(
  database: Database.Database,
  request: PersistReplacePlayoutRequest,
): StoredPlayout {
  const current = requireDraft(database, request.scope);
  if (current.draftId !== request.draft.draftId.value) throw invalidPlayout();
  if (current.draftRevision !== request.expectedDraftRevision) {
    throw playoutConflict(request.expectedDraftRevision, current.draftRevision);
  }
  const draft = restorePlayoutDraft(request.draft);
  const replacedPositionIds = readPlayoutPositionIds(
    database,
    draft.draftId.value,
  );
  database
    .prepare('DELETE FROM playout_ply WHERE draft_id = ?')
    .run(draft.draftId.value);
  updateDraft(database, draft, request.occurredAt);
  insertSteps(database, draft);
  deleteUnreferencedPositions(database, replacedPositionIds);
  return Object.freeze({
    draft,
    dataRevision: incrementDataRevision(database, request.occurredAt),
  });
}

export function discardPlayout(
  database: Database.Database,
  request: PersistDiscardPlayoutRequest,
): { readonly dataRevision: number } {
  const current = requireDraft(database, request.scope);
  if (current.draftId !== request.draftId.value) throw playoutNotFound();
  if (current.draftRevision !== request.expectedDraftRevision) {
    throw playoutConflict(request.expectedDraftRevision, current.draftRevision);
  }
  const positionIds = readPlayoutPositionIds(database, current.draftId);
  database
    .prepare('DELETE FROM playout_ply WHERE draft_id = ?')
    .run(current.draftId);
  database
    .prepare('DELETE FROM playout_source_ply WHERE draft_id = ?')
    .run(current.draftId);
  database
    .prepare('DELETE FROM playout_draft WHERE draft_id = ?')
    .run(current.draftId);
  deleteUnreferencedPositions(database, positionIds);
  return Object.freeze({
    dataRevision: incrementDataRevision(database, request.occurredAt),
  });
}

const draftSelectSql = `
  SELECT d.draft_id AS draftId, d.origin_mode AS originMode,
         d.origin_item_id AS originItemId,
         d.origin_revision_id AS originRevisionId,
         d.origin_anchor_id AS originAnchorId,
         d.source_display_name AS sourceDisplayName,
         d.source_root_position_id AS sourceRootPositionId,
         d.source_root_halfmove_clock AS sourceRootHalfmoveClock,
         d.source_root_fullmove_number AS sourceRootFullmoveNumber,
         d.source_root_history_knowledge AS sourceRootHistoryKnowledge,
         d.root_position_id AS rootPositionId,
         d.root_halfmove_clock AS rootHalfmoveClock,
         d.root_fullmove_number AS rootFullmoveNumber,
         d.root_history_knowledge AS rootHistoryKnowledge,
         d.player_side AS playerSide,
         d.policy_capability AS policyCapability,
         d.provider_instance_id AS providerInstanceId,
         d.provider_fingerprint AS providerFingerprint,
         d.provider_type AS providerType,
         d.provider_display_name AS providerDisplayName,
         d.status_kind AS statusKind, d.terminal_reason AS terminalReason,
         d.outcome_kind AS outcomeKind, d.winner_side AS winnerSide,
         d.draft_revision AS draftRevision,
         d.decision_generation AS decisionGeneration,
         d.pending_decision_id AS pendingDecisionId
    FROM playout_draft AS d`;

function requireDraft(database: Database.Database, scope: WorkScope): DraftRow {
  const stored = readDraftRow(database, scope);
  if (stored === undefined) throw playoutNotFound();
  return stored;
}

function readDraftRow(
  database: Database.Database,
  scope: WorkScope,
): DraftRow | undefined {
  return database
    .prepare(
      `${draftSelectSql}
       WHERE d.scope_kind = ?
         AND ((? = 'free' AND d.context_id IS NULL) OR d.context_id = ?)`,
    )
    .get(
      scope.kind,
      scope.kind,
      scope.kind === 'context' ? scope.contextId.value : null,
    ) as DraftRow | undefined;
}

function mapDraft(database: Database.Database, row: DraftRow): PlayoutDraft {
  const root = readChessState(
    database,
    localId('position', row.rootPositionId),
    {
      halfmoveClock: row.rootHalfmoveClock,
      fullmoveNumber: row.rootFullmoveNumber,
      historyKnowledge: row.rootHistoryKnowledge,
    },
  );
  const rows = database
    .prepare(
      `SELECT ply_index AS plyIndex,
              before_position_id AS beforePositionId,
              before_halfmove_clock AS beforeHalfmoveClock,
              before_fullmove_number AS beforeFullmoveNumber,
              before_history_knowledge AS beforeHistoryKnowledge,
              after_position_id AS afterPositionId,
              after_halfmove_clock AS afterHalfmoveClock,
              after_fullmove_number AS afterFullmoveNumber,
              after_history_knowledge AS afterHistoryKnowledge,
              from_square AS 'from', to_square AS 'to', promotion, san,
              actor, decision_id AS decisionId
         FROM playout_ply WHERE draft_id = ? ORDER BY ply_index`,
    )
    .all(row.draftId) as PlyRow[];
  if (rows.some((ply, index) => ply.plyIndex !== index)) throw invalidPlayout();
  const steps: readonly PlayoutStep[] = Object.freeze(
    rows.map((ply) => ({
      before: readChessState(
        database,
        localId('position', ply.beforePositionId),
        {
          halfmoveClock: ply.beforeHalfmoveClock,
          fullmoveNumber: ply.beforeFullmoveNumber,
          historyKnowledge: ply.beforeHistoryKnowledge,
        },
      ),
      move: Object.freeze({
        from: ply.from,
        to: ply.to,
        ...(ply.promotion === null ? {} : { promotion: ply.promotion }),
        san: ply.san,
      }),
      after: readChessState(
        database,
        localId('position', ply.afterPositionId),
        {
          halfmoveClock: ply.afterHalfmoveClock,
          fullmoveNumber: ply.afterFullmoveNumber,
          historyKnowledge: ply.afterHistoryKnowledge,
        },
      ),
      actor: ply.actor,
      ...(ply.decisionId === null ? {} : { decisionId: ply.decisionId }),
    })),
  );
  return restorePlayoutDraft({
    draftId: localId('playout-draft', row.draftId),
    draftRevision: row.draftRevision,
    decisionGeneration: row.decisionGeneration,
    origin: mapOrigin(row),
    ...mapSourcePath(database, row),
    root,
    playerSide: row.playerSide,
    policy: {
      capability: row.policyCapability,
      providerInstanceId: row.providerInstanceId,
      providerFingerprint: row.providerFingerprint,
      providerType: row.providerType,
      providerDisplayName: row.providerDisplayName,
    },
    steps,
    status: mapStatus(row),
  });
}

function mapSourcePath(
  database: Database.Database,
  row: DraftRow,
): { readonly sourcePath?: NonNullable<PlayoutDraft['sourcePath']> } {
  if (row.sourceDisplayName === null) {
    if (
      row.sourceRootPositionId !== null ||
      row.sourceRootHalfmoveClock !== null ||
      row.sourceRootFullmoveNumber !== null ||
      row.sourceRootHistoryKnowledge !== null
    ) {
      throw invalidPlayout();
    }
    return {};
  }
  if (
    row.sourceRootPositionId === null ||
    row.sourceRootHalfmoveClock === null ||
    row.sourceRootFullmoveNumber === null ||
    row.sourceRootHistoryKnowledge === null
  ) {
    throw invalidPlayout();
  }
  const root = readChessState(
    database,
    localId('position', row.sourceRootPositionId),
    {
      halfmoveClock: row.sourceRootHalfmoveClock,
      fullmoveNumber: row.sourceRootFullmoveNumber,
      historyKnowledge: row.sourceRootHistoryKnowledge,
    },
  );
  const rows = database
    .prepare(
      `SELECT ply_index AS plyIndex,
              before_position_id AS beforePositionId,
              before_halfmove_clock AS beforeHalfmoveClock,
              before_fullmove_number AS beforeFullmoveNumber,
              before_history_knowledge AS beforeHistoryKnowledge,
              after_position_id AS afterPositionId,
              after_halfmove_clock AS afterHalfmoveClock,
              after_fullmove_number AS afterFullmoveNumber,
              after_history_knowledge AS afterHistoryKnowledge,
              from_square AS 'from', to_square AS 'to', promotion, san
         FROM playout_source_ply WHERE draft_id = ? ORDER BY ply_index`,
    )
    .all(row.draftId) as SourcePlyRow[];
  if (rows.some((ply, index) => ply.plyIndex !== index)) throw invalidPlayout();
  return {
    sourcePath: {
      displayName: row.sourceDisplayName,
      root,
      steps: Object.freeze(rows.map((ply) => mapAppliedMove(database, ply))),
    },
  };
}

function mapAppliedMove(
  database: Database.Database,
  ply: SourcePlyRow,
): AppliedMove {
  return {
    before: readChessState(
      database,
      localId('position', ply.beforePositionId),
      {
        halfmoveClock: ply.beforeHalfmoveClock,
        fullmoveNumber: ply.beforeFullmoveNumber,
        historyKnowledge: ply.beforeHistoryKnowledge,
      },
    ),
    move: Object.freeze({
      from: ply.from,
      to: ply.to,
      ...(ply.promotion === null ? {} : { promotion: ply.promotion }),
      san: ply.san,
    }),
    after: readChessState(database, localId('position', ply.afterPositionId), {
      halfmoveClock: ply.afterHalfmoveClock,
      fullmoveNumber: ply.afterFullmoveNumber,
      historyKnowledge: ply.afterHistoryKnowledge,
    }),
  };
}

function insertDraft(
  database: Database.Database,
  scope: WorkScope,
  draft: PlayoutDraft,
  occurredAt: string,
): void {
  const rootPositionId = ensurePosition(database, draft.root.position);
  const origin = originValues(draft.origin);
  const source = sourceValues(database, draft.sourcePath);
  const status = statusValues(draft.status);
  try {
    database
      .prepare(
        `INSERT INTO playout_draft
           (draft_id, scope_kind, context_id, origin_mode, origin_item_id,
            origin_revision_id, origin_anchor_id, source_display_name,
            source_root_position_id, source_root_halfmove_clock,
            source_root_fullmove_number, source_root_history_knowledge,
            root_position_id,
            root_halfmove_clock, root_fullmove_number, root_history_knowledge,
            player_side, policy_capability, provider_instance_id,
            provider_fingerprint, provider_type, provider_display_name,
            status_kind, terminal_reason, outcome_kind,
            winner_side, draft_revision, decision_generation,
            pending_decision_id, created_at_utc, updated_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        draft.draftId.value,
        scope.kind,
        scope.kind === 'context' ? scope.contextId.value : null,
        ...origin,
        ...source,
        rootPositionId.value,
        draft.root.playState.halfmoveClock,
        draft.root.playState.fullmoveNumber,
        draft.root.playState.historyKnowledge,
        draft.playerSide,
        draft.policy.capability,
        draft.policy.providerInstanceId,
        draft.policy.providerFingerprint,
        draft.policy.providerType,
        draft.policy.providerDisplayName,
        ...status,
        draft.draftRevision,
        draft.decisionGeneration,
        draft.status.kind === 'awaiting_policy'
          ? draft.status.decisionId
          : null,
        occurredAt,
        occurredAt,
      );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('UNIQUE constraint failed')
    ) {
      throw invalidPlayout();
    }
    throw error;
  }
  insertSourceSteps(database, draft);
  insertSteps(database, draft);
}

function sourceValues(
  database: Database.Database,
  sourcePath: PlayoutDraft['sourcePath'],
): readonly [
  string | null,
  number | null,
  number | null,
  number | null,
  HistoryKnowledge | null,
] {
  if (sourcePath === undefined) return [null, null, null, null, null];
  const rootPositionId = ensurePosition(database, sourcePath.root.position);
  return [
    sourcePath.displayName,
    rootPositionId.value,
    sourcePath.root.playState.halfmoveClock,
    sourcePath.root.playState.fullmoveNumber,
    sourcePath.root.playState.historyKnowledge,
  ];
}

function updateDraft(
  database: Database.Database,
  draft: PlayoutDraft,
  occurredAt: string,
): void {
  const status = statusValues(draft.status);
  const result = database
    .prepare(
      `UPDATE playout_draft
          SET status_kind = ?, terminal_reason = ?, outcome_kind = ?,
              winner_side = ?, draft_revision = ?, decision_generation = ?,
              pending_decision_id = ?, updated_at_utc = ?
        WHERE draft_id = ?`,
    )
    .run(
      ...status,
      draft.draftRevision,
      draft.decisionGeneration,
      draft.status.kind === 'awaiting_policy' ? draft.status.decisionId : null,
      occurredAt,
      draft.draftId.value,
    );
  if (result.changes !== 1) throw playoutNotFound();
}

function insertSourceSteps(
  database: Database.Database,
  draft: PlayoutDraft,
): void {
  if (draft.sourcePath === undefined) return;
  const insert = database.prepare(
    `INSERT INTO playout_source_ply
       (draft_id, ply_index, before_position_id, before_halfmove_clock,
        before_fullmove_number, before_history_knowledge, after_position_id,
        after_halfmove_clock, after_fullmove_number, after_history_knowledge,
        from_square, to_square, promotion, san)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  draft.sourcePath.steps.forEach((step, index) => {
    const before = ensurePosition(database, step.before.position);
    const after = ensurePosition(database, step.after.position);
    insert.run(
      draft.draftId.value,
      index,
      before.value,
      step.before.playState.halfmoveClock,
      step.before.playState.fullmoveNumber,
      step.before.playState.historyKnowledge,
      after.value,
      step.after.playState.halfmoveClock,
      step.after.playState.fullmoveNumber,
      step.after.playState.historyKnowledge,
      step.move.from,
      step.move.to,
      step.move.promotion ?? null,
      step.move.san,
    );
  });
}

function insertSteps(database: Database.Database, draft: PlayoutDraft): void {
  const insert = database.prepare(
    `INSERT INTO playout_ply
       (draft_id, ply_index, before_position_id, before_halfmove_clock,
        before_fullmove_number, before_history_knowledge, after_position_id,
        after_halfmove_clock, after_fullmove_number, after_history_knowledge,
        from_square, to_square, promotion, san, actor, decision_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  draft.steps.forEach((step, index) => {
    const before = ensurePosition(database, step.before.position);
    const after = ensurePosition(database, step.after.position);
    insert.run(
      draft.draftId.value,
      index,
      before.value,
      step.before.playState.halfmoveClock,
      step.before.playState.fullmoveNumber,
      step.before.playState.historyKnowledge,
      after.value,
      step.after.playState.halfmoveClock,
      step.after.playState.fullmoveNumber,
      step.after.playState.historyKnowledge,
      step.move.from,
      step.move.to,
      step.move.promotion ?? null,
      step.move.san,
      step.actor,
      step.decisionId ?? null,
    );
  });
}

function nextDraftId(database: Database.Database): number {
  const row = database
    .prepare(
      `SELECT COALESCE(
         (SELECT seq FROM sqlite_sequence WHERE name = 'playout_draft'), 0
       ) + 1 AS draftId`,
    )
    .get() as { readonly draftId: number };
  return row.draftId;
}

function readPlayoutPositionIds(
  database: Database.Database,
  draftId: number,
): readonly number[] {
  const rows = database
    .prepare(
      `SELECT root_position_id AS positionId
         FROM playout_draft WHERE draft_id = ?
       UNION
       SELECT source_root_position_id AS positionId
         FROM playout_draft WHERE draft_id = ? AND source_root_position_id IS NOT NULL
       UNION
       SELECT before_position_id AS positionId
         FROM playout_source_ply WHERE draft_id = ?
       UNION
       SELECT after_position_id AS positionId
         FROM playout_source_ply WHERE draft_id = ?
       UNION
       SELECT before_position_id AS positionId
         FROM playout_ply WHERE draft_id = ?
       UNION
       SELECT after_position_id AS positionId
         FROM playout_ply WHERE draft_id = ?`,
    )
    .all(draftId, draftId, draftId, draftId, draftId, draftId) as {
    readonly positionId: number;
  }[];
  return rows.map((row) => row.positionId);
}

function validateOrigin(
  database: Database.Database,
  origin: PlayoutOrigin,
  rootPosition: Position,
): void {
  if (origin.kind !== 'inventory_anchor') return;
  const positionId = resolveAnchorPosition(
    database,
    origin.itemId.value,
    origin.revisionId.value,
    origin.anchorId.value,
  );
  if (
    positionId === undefined ||
    positionId !== ensurePosition(database, rootPosition).value
  ) {
    throw invalidPlayout();
  }
}

function mapOrigin(row: DraftRow): PlayoutOrigin {
  if (row.originMode !== 'inventory_anchor') return { kind: row.originMode };
  if (
    row.originItemId === null ||
    row.originRevisionId === null ||
    row.originAnchorId === null
  ) {
    throw invalidPlayout();
  }
  return {
    kind: 'inventory_anchor',
    itemId: localId('inventory-item', row.originItemId),
    revisionId: localId('item-revision', row.originRevisionId),
    anchorId: localId('anchor', row.originAnchorId),
  };
}

function mapStatus(row: DraftRow): PlayoutStatus {
  if (row.statusKind === 'active' || row.statusKind === 'paused') {
    return { kind: row.statusKind };
  }
  if (row.statusKind === 'awaiting_policy') {
    if (row.pendingDecisionId === null) throw invalidPlayout();
    return { kind: 'awaiting_policy', decisionId: row.pendingDecisionId };
  }
  const outcome = mapOutcome(row);
  if (row.statusKind === 'stopped') return { kind: 'stopped', outcome };
  if (row.terminalReason === null || outcome.kind === 'unfinished') {
    throw invalidPlayout();
  }
  return { kind: 'terminal', reason: row.terminalReason, outcome };
}

function mapOutcome(row: DraftRow): PlayoutOutcome {
  if (row.outcomeKind === 'unfinished') return { kind: 'unfinished' };
  if (row.outcomeKind === 'win' && row.winnerSide !== null) {
    return { kind: 'win', winner: row.winnerSide };
  }
  if (
    row.outcomeKind === 'draw' &&
    row.terminalReason !== null &&
    row.terminalReason !== 'checkmate'
  ) {
    return { kind: 'draw', reason: row.terminalReason };
  }
  throw invalidPlayout();
}

function originValues(
  origin: PlayoutOrigin,
): readonly [
  PlayoutOrigin['kind'],
  number | null,
  number | null,
  number | null,
] {
  return origin.kind === 'inventory_anchor'
    ? [
        origin.kind,
        origin.itemId.value,
        origin.revisionId.value,
        origin.anchorId.value,
      ]
    : [origin.kind, null, null, null];
}

function statusValues(
  status: PlayoutStatus,
): readonly [
  PlayoutStatus['kind'],
  DraftRow['terminalReason'],
  DraftRow['outcomeKind'],
  DraftRow['winnerSide'],
] {
  if (
    status.kind === 'active' ||
    status.kind === 'awaiting_policy' ||
    status.kind === 'paused'
  ) {
    return [status.kind, null, null, null];
  }
  if (status.kind === 'stopped') return [status.kind, null, 'unfinished', null];
  return [
    status.kind,
    status.reason,
    status.outcome.kind,
    status.outcome.kind === 'win' ? status.outcome.winner : null,
  ];
}
