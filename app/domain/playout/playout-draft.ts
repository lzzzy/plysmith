import type {
  AppliedMove,
  ChessState,
  SideToMove,
} from '../chess_graph/index.ts';
import type {
  AnchorId,
  InventoryItemId,
  ItemRevisionId,
  PlayoutDraftId,
} from '../identity/index.ts';

export type MovePolicyCapability = 'best_move' | 'human_profile';

interface MovePolicyBindingBase {
  readonly providerInstanceId: string;
  readonly providerFingerprint: string;
  readonly providerType: string;
  readonly providerDisplayName: string;
}

export interface HumanMovePolicyProfile {
  readonly modelName: string;
  readonly selectionMode: 'most_likely' | 'sampled';
  readonly historyMode: 'known_position_history' | 'position_only';
  readonly reproducibility: 'deterministic' | 'stochastic';
}

export type MovePolicyBinding = MovePolicyBindingBase &
  (
    | { readonly capability: 'best_move' }
    | {
        readonly capability: 'human_profile';
        readonly profile: HumanMovePolicyProfile;
      }
  );

export type PlayoutOrigin =
  | { readonly kind: 'initial_position' }
  | { readonly kind: 'fen' }
  | { readonly kind: 'position_setup' }
  | {
      readonly kind: 'inventory_anchor';
      readonly itemId: InventoryItemId;
      readonly revisionId: ItemRevisionId;
      readonly anchorId: AnchorId;
    };

export type PlayoutActor = 'user' | 'provider';

export interface PlayoutStep extends AppliedMove {
  readonly actor: PlayoutActor;
  readonly decisionId?: number;
}

export interface PlayoutSourcePath {
  readonly displayName: string;
  readonly root: ChessState;
  readonly steps: readonly AppliedMove[];
}

export type PlayoutTerminalReason =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient_material'
  | 'threefold_repetition'
  | 'seventy_five_move';

export type PlayoutOutcome =
  | { readonly kind: 'win'; readonly winner: SideToMove }
  | {
      readonly kind: 'draw';
      readonly reason: Exclude<PlayoutTerminalReason, 'checkmate'>;
    }
  | { readonly kind: 'unfinished' };

export type PlayoutStatus =
  | { readonly kind: 'active' }
  | { readonly kind: 'awaiting_policy'; readonly decisionId: number }
  | { readonly kind: 'paused' }
  | { readonly kind: 'stopped'; readonly outcome: PlayoutOutcome }
  | {
      readonly kind: 'terminal';
      readonly reason: PlayoutTerminalReason;
      readonly outcome: Exclude<
        PlayoutOutcome,
        { readonly kind: 'unfinished' }
      >;
    };

export interface PlayoutDraft {
  readonly draftId: PlayoutDraftId;
  readonly draftRevision: number;
  readonly decisionGeneration: number;
  readonly origin: PlayoutOrigin;
  readonly sourcePath?: PlayoutSourcePath;
  readonly root: ChessState;
  readonly playerSide: SideToMove;
  readonly policy: MovePolicyBinding;
  readonly steps: readonly PlayoutStep[];
  readonly status: PlayoutStatus;
}

export function createPlayoutDraft(input: {
  readonly draftId: PlayoutDraftId;
  readonly origin: PlayoutOrigin;
  readonly sourcePath?: PlayoutSourcePath;
  readonly root: ChessState;
  readonly playerSide: SideToMove;
  readonly policy: MovePolicyBinding;
}): PlayoutDraft {
  validatePolicy(input.policy);
  validateSourcePath(input.sourcePath, input.root);
  return freezeDraft({
    draftId: input.draftId,
    draftRevision: 1,
    decisionGeneration:
      input.root.position.sideToMove === input.playerSide ? 0 : 1,
    origin: input.origin,
    ...(input.sourcePath === undefined ? {} : { sourcePath: input.sourcePath }),
    root: input.root,
    playerSide: input.playerSide,
    policy: input.policy,
    steps: [],
    status:
      input.root.position.sideToMove === input.playerSide
        ? { kind: 'active' }
        : { kind: 'awaiting_policy', decisionId: 1 },
  });
}

export function restorePlayoutDraft(draft: PlayoutDraft): PlayoutDraft {
  validatePolicy(draft.policy);
  validateSourcePath(draft.sourcePath, draft.root);
  if (
    !Number.isSafeInteger(draft.draftRevision) ||
    draft.draftRevision < 1 ||
    !Number.isSafeInteger(draft.decisionGeneration) ||
    draft.decisionGeneration < 0
  ) {
    throw new Error('A persisted playout requires valid revisions.');
  }
  let current = draft.root;
  for (const step of draft.steps) {
    if (
      step.before.fen !== current.fen ||
      step.before.position.positionKey !== current.position.positionKey ||
      (step.actor === 'user') !==
        (step.before.position.sideToMove === draft.playerSide) ||
      (step.actor === 'provider') !== (step.decisionId !== undefined) ||
      (step.decisionId !== undefined &&
        (!Number.isSafeInteger(step.decisionId) ||
          step.decisionId < 1 ||
          step.decisionId > draft.decisionGeneration))
    ) {
      throw new Error('A persisted playout contains invalid steps.');
    }
    current = step.after;
  }
  if (
    (draft.status.kind === 'active' &&
      current.position.sideToMove !== draft.playerSide) ||
    (draft.status.kind === 'awaiting_policy' &&
      (current.position.sideToMove === draft.playerSide ||
        draft.status.decisionId !== draft.decisionGeneration))
  ) {
    throw new Error('A persisted playout contains an invalid status.');
  }
  return freezeDraft(draft);
}

export function currentPlayoutState(draft: PlayoutDraft): ChessState {
  return draft.steps.at(-1)?.after ?? draft.root;
}

export function appendUserPlayoutMove(
  draft: PlayoutDraft,
  applied: AppliedMove,
): PlayoutDraft {
  if (
    draft.status.kind !== 'active' ||
    currentPlayoutState(draft).position.sideToMove !== draft.playerSide
  ) {
    throw new Error('A user move requires an active player turn.');
  }
  assertContinuesDraft(draft, applied);
  const decisionId = draft.decisionGeneration + 1;
  return freezeDraft({
    ...draft,
    draftRevision: draft.draftRevision + 1,
    decisionGeneration: decisionId,
    steps: [...draft.steps, { ...applied, actor: 'user' }],
    status: { kind: 'awaiting_policy', decisionId },
  });
}

export function appendPolicyPlayoutMove(
  draft: PlayoutDraft,
  decisionId: number,
  applied: AppliedMove,
): PlayoutDraft {
  if (
    draft.status.kind !== 'awaiting_policy' ||
    draft.status.decisionId !== decisionId ||
    currentPlayoutState(draft).position.sideToMove === draft.playerSide
  ) {
    throw new Error('A policy move requires the current policy decision.');
  }
  assertContinuesDraft(draft, applied);
  return freezeDraft({
    ...draft,
    draftRevision: draft.draftRevision + 1,
    steps: [...draft.steps, { ...applied, actor: 'provider', decisionId }],
    status: { kind: 'active' },
  });
}

export function retryPlayoutPolicy(draft: PlayoutDraft): PlayoutDraft {
  if (draft.status.kind !== 'awaiting_policy') {
    throw new Error('Only a pending policy move can be retried.');
  }
  const decisionId = draft.decisionGeneration + 1;
  return freezeDraft({
    ...draft,
    draftRevision: draft.draftRevision + 1,
    decisionGeneration: decisionId,
    status: {
      kind: 'awaiting_policy',
      decisionId,
    },
  });
}

export function pausePlayoutDraft(draft: PlayoutDraft): PlayoutDraft {
  if (
    draft.status.kind !== 'active' &&
    draft.status.kind !== 'awaiting_policy'
  ) {
    throw new Error('Only a running playout can be paused.');
  }
  return freezeDraft({
    ...draft,
    draftRevision: draft.draftRevision + 1,
    status: { kind: 'paused' },
  });
}

export function resumePlayoutDraft(draft: PlayoutDraft): PlayoutDraft {
  if (draft.status.kind !== 'paused') {
    throw new Error('Only a paused playout can be resumed.');
  }
  const providerTurn =
    currentPlayoutState(draft).position.sideToMove !== draft.playerSide;
  const decisionId = draft.decisionGeneration + (providerTurn ? 1 : 0);
  return freezeDraft({
    ...draft,
    draftRevision: draft.draftRevision + 1,
    decisionGeneration: decisionId,
    status: providerTurn
      ? { kind: 'awaiting_policy', decisionId }
      : { kind: 'active' },
  });
}

export function stopPlayoutDraft(draft: PlayoutDraft): PlayoutDraft {
  if (draft.status.kind === 'stopped' || draft.status.kind === 'terminal') {
    throw new Error('A finished playout cannot be stopped again.');
  }
  return freezeDraft({
    ...draft,
    draftRevision: draft.draftRevision + 1,
    status: { kind: 'stopped', outcome: { kind: 'unfinished' } },
  });
}

export function completePlayoutDraft(
  draft: PlayoutDraft,
  terminal: {
    readonly reason: PlayoutTerminalReason;
    readonly outcome: Exclude<PlayoutOutcome, { readonly kind: 'unfinished' }>;
  },
): PlayoutDraft {
  if (draft.status.kind === 'stopped' || draft.status.kind === 'terminal') {
    throw new Error('A finished playout cannot become terminal again.');
  }
  return freezeDraft({
    ...draft,
    draftRevision: draft.draftRevision + 1,
    status: { kind: 'terminal', ...terminal },
  });
}

function assertContinuesDraft(draft: PlayoutDraft, applied: AppliedMove): void {
  const current = currentPlayoutState(draft);
  if (
    applied.before.fen !== current.fen ||
    applied.before.position.positionKey !== current.position.positionKey
  ) {
    throw new Error('A playout move must continue the current position.');
  }
}

function validatePolicy(policy: MovePolicyBinding): void {
  if (
    (policy.capability !== 'best_move' &&
      policy.capability !== 'human_profile') ||
    policy.providerInstanceId.trim() !== policy.providerInstanceId ||
    policy.providerInstanceId.length === 0 ||
    policy.providerFingerprint.trim() !== policy.providerFingerprint ||
    policy.providerFingerprint.length === 0 ||
    policy.providerType.trim().length === 0 ||
    policy.providerDisplayName.trim().length === 0
  ) {
    throw new Error('A playout requires a valid move policy binding.');
  }
  if (policy.capability === 'human_profile')
    validateHumanProfile(policy.profile);
}

function validateHumanProfile(profile: HumanMovePolicyProfile): void {
  if (
    profile.modelName.trim() !== profile.modelName ||
    profile.modelName.length === 0 ||
    profile.modelName.length > 160 ||
    (profile.selectionMode !== 'most_likely' &&
      profile.selectionMode !== 'sampled') ||
    (profile.historyMode !== 'known_position_history' &&
      profile.historyMode !== 'position_only') ||
    (profile.reproducibility !== 'deterministic' &&
      profile.reproducibility !== 'stochastic')
  ) {
    throw new Error('A human move policy requires a valid profile.');
  }
}

function validateSourcePath(
  sourcePath: PlayoutSourcePath | undefined,
  playoutRoot: ChessState,
): void {
  if (sourcePath === undefined) return;
  if (
    sourcePath.displayName.trim() !== sourcePath.displayName ||
    sourcePath.displayName.length === 0 ||
    sourcePath.displayName.length > 200
  ) {
    throw new Error('A playout source path requires a valid display name.');
  }
  let current = sourcePath.root;
  for (const step of sourcePath.steps) {
    if (!sameChessState(step.before, current)) {
      throw new Error('A playout source path must be contiguous.');
    }
    current = step.after;
  }
  if (!sameChessState(current, playoutRoot)) {
    throw new Error('A playout source path must end at the playout root.');
  }
}

function sameChessState(left: ChessState, right: ChessState): boolean {
  return (
    left.fen === right.fen &&
    left.position.positionKey === right.position.positionKey
  );
}

function freezeDraft(draft: PlayoutDraft): PlayoutDraft {
  return Object.freeze({
    draftId: draft.draftId,
    draftRevision: draft.draftRevision,
    decisionGeneration: draft.decisionGeneration,
    origin: Object.freeze({ ...draft.origin }),
    ...(draft.sourcePath === undefined
      ? {}
      : {
          sourcePath: Object.freeze({
            displayName: draft.sourcePath.displayName,
            root: draft.sourcePath.root,
            steps: Object.freeze(
              draft.sourcePath.steps.map((step) =>
                Object.freeze({
                  before: step.before,
                  move: Object.freeze({ ...step.move }),
                  after: step.after,
                }),
              ),
            ),
          }),
        }),
    root: draft.root,
    playerSide: draft.playerSide,
    policy: Object.freeze({
      ...draft.policy,
      ...(draft.policy.capability === 'human_profile'
        ? { profile: Object.freeze({ ...draft.policy.profile }) }
        : {}),
    }),
    steps: Object.freeze(
      draft.steps.map((step) =>
        Object.freeze({
          before: step.before,
          move: Object.freeze({ ...step.move }),
          after: step.after,
          actor: step.actor,
          ...(step.decisionId === undefined
            ? {}
            : { decisionId: step.decisionId }),
        }),
      ),
    ),
    status: Object.freeze({ ...draft.status }),
  });
}
