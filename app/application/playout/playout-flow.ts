import type { ContextAnalysisReader } from '../analysis/index.ts';
import {
  assertInventoryWorkAccess,
  requireInventoryWorkAccess,
  type InventoryWorkAccessReader,
} from '../workspace/inventory-work-access.ts';
import type { ChessRulesPort } from '../chess_graph/index.ts';
import {
  appendPolicyPlayoutMove,
  appendUserPlayoutMove,
  cancelPlayoutCompletion,
  completePlayoutDraft,
  currentPlayoutState,
  isManualGameResult,
  pausePlayoutDraft,
  resumePlayoutDraft,
  resolvePlayoutResult,
  retryPlayoutPolicy,
  stopPlayoutDraft,
  type PlayoutDraft,
  type PlayoutOrigin,
  type PlayoutOutcome,
  type PlayoutTerminalReason,
} from '../../domain/playout/index.ts';
import type { WorkScope } from '../../domain/workspace/index.ts';
import type {
  CanonicalMove,
  SideToMove,
} from '../../domain/chess_graph/index.ts';
import type {
  CompletePlayoutRequest,
  CompletePlayoutResult,
  ExpectedPlayoutRequest,
  GetPlayoutRequest,
  StartPlayoutRequest,
  StoredPlayout,
  PlayoutView,
  SubmitPlayoutMoveRequest,
} from './playout-models.ts';
import { createGameRecordDraft } from '../../domain/inventory/index.ts';
import {
  MovePolicyProviderError,
  policyBinding,
  type MovePolicyProvider,
  type MovePolicyProviderDescriptor,
  type MovePolicyRegistry,
  type PlayoutChangedPublisher,
  type PlayoutClock,
  type PlayoutReader,
  type PlayoutWriter,
} from './playout-ports.ts';
import {
  invalidPlayout,
  movePolicyFailed,
  movePolicyUnavailable,
  playoutConflict,
  playoutNotFound,
} from './playout-problems.ts';
import type { ActiveMovePolicyDecisions } from './active-move-policy-decisions.ts';

interface PlayoutDependencies {
  readonly reader: PlayoutReader & InventoryWorkAccessReader;
  readonly writer: PlayoutWriter;
  readonly rules: ChessRulesPort;
  readonly policies: MovePolicyRegistry;
  readonly decisions: ActiveMovePolicyDecisions;
  readonly clock: PlayoutClock;
  readonly events: PlayoutChangedPublisher;
}

interface StartDependencies extends PlayoutDependencies {
  readonly analysis: ContextAnalysisReader;
}

interface CancelCompletionDependencies extends Pick<
  PlayoutDependencies,
  'writer' | 'rules' | 'clock' | 'events'
> {
  readonly reader: PlayoutReader;
}

export interface ListMovePolicyProvidersUseCase {
  execute(): readonly MovePolicyProviderDescriptor[];
}

export interface GetPlayoutUseCase {
  execute(request: GetPlayoutRequest): Promise<PlayoutView | undefined>;
}

export interface StartPlayoutUseCase {
  execute(request: StartPlayoutRequest): Promise<PlayoutView>;
}

export interface SubmitPlayoutMoveUseCase {
  execute(request: SubmitPlayoutMoveRequest): Promise<PlayoutView>;
}

export interface ExpectedPlayoutUseCase {
  execute(request: ExpectedPlayoutRequest): Promise<PlayoutView>;
}

export interface DiscardPlayoutUseCase {
  execute(
    request: ExpectedPlayoutRequest,
  ): Promise<{ readonly dataRevision: number }>;
}

export interface CompletePlayoutUseCase {
  execute(request: CompletePlayoutRequest): Promise<CompletePlayoutResult>;
}

export class ListMovePolicyProviders implements ListMovePolicyProvidersUseCase {
  readonly #policies: MovePolicyRegistry;

  constructor(policies: MovePolicyRegistry) {
    this.#policies = policies;
  }

  execute(): readonly MovePolicyProviderDescriptor[] {
    return Object.freeze(
      this.#policies.list().map((entry) => Object.freeze({ ...entry })),
    );
  }
}

export class GetPlayout implements GetPlayoutUseCase {
  readonly #reader: PlayoutReader;
  readonly #rules: ChessRulesPort;

  constructor(reader: PlayoutReader, rules: ChessRulesPort) {
    this.#reader = reader;
    this.#rules = rules;
  }

  async execute(request: GetPlayoutRequest): Promise<PlayoutView | undefined> {
    const stored = await this.#reader.readPlayout(request.scope);
    return stored === undefined ? undefined : playoutView(this.#rules, stored);
  }
}

export class StartPlayout implements StartPlayoutUseCase {
  readonly #dependencies: StartDependencies;

  constructor(dependencies: StartDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(request: StartPlayoutRequest): Promise<PlayoutView> {
    if (
      (await this.#dependencies.reader.readPlayout(request.scope)) !== undefined
    ) {
      throw invalidPlayout();
    }
    const provider = requireProvider(
      this.#dependencies.policies,
      request.providerInstanceId,
      request.capability,
    );
    const resolved = await resolveStart(
      this.#dependencies.rules,
      this.#dependencies.analysis,
      request.scope,
      request.start,
    );
    const sourcePath =
      resolved.sourcePath ??
      resolveSourcePath(
        this.#dependencies.rules,
        request.sourcePath,
        resolved.root,
      );
    assertOngoing(this.#dependencies.rules, resolved.root, []);
    const playerSide =
      request.opening.kind === 'user_move'
        ? resolved.root.position.sideToMove
        : oppositeSide(resolved.root.position.sideToMove);
    const initialUserMove =
      request.opening.kind === 'user_move'
        ? this.#dependencies.rules.applyMove(
            resolved.root,
            [],
            request.opening.move,
          )
        : undefined;
    if (initialUserMove !== undefined && !initialUserMove.ok) {
      throw invalidPlayout();
    }
    const initialTerminal =
      initialUserMove?.ok === true
        ? terminalResult(this.#dependencies.rules, resolved.root, [
            initialUserMove.value.move,
          ])
        : undefined;
    const occurredAt = this.#dependencies.clock.now();
    const stored = await this.#dependencies.writer.createPlayout({
      scope: request.scope,
      origin: resolved.origin,
      ...(sourcePath === undefined ? {} : { sourcePath }),
      root: resolved.root,
      playerSide,
      policy: policyBinding(provider.descriptor, request.capability),
      ...(initialUserMove?.ok === true
        ? { initialUserMove: initialUserMove.value }
        : {}),
      ...(initialTerminal === undefined ? {} : { initialTerminal }),
      occurredAt,
    });
    publishPlayoutChanged(
      this.#dependencies,
      request.scope,
      stored,
      occurredAt,
    );
    const result =
      stored.draft.status.kind === 'awaiting_policy'
        ? await drivePolicy(this.#dependencies, request.scope, stored, provider)
        : stored;
    return playoutView(this.#dependencies.rules, result);
  }
}

export class SubmitPlayoutMove implements SubmitPlayoutMoveUseCase {
  readonly #dependencies: PlayoutDependencies;

  constructor(dependencies: PlayoutDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(request: SubmitPlayoutMoveRequest): Promise<PlayoutView> {
    const stored = await requireExpected(this.#dependencies.reader, request);
    await requirePlayoutWorkAccess(
      this.#dependencies.reader,
      request.scope,
      stored,
    );
    const moves = stored.draft.steps.map((step) => step.move);
    const applied = this.#dependencies.rules.applyMove(
      stored.draft.root,
      moves,
      request.move,
    );
    if (!applied.ok) throw invalidPlayout();
    let draft = appendUserPlayoutMove(stored.draft, applied.value);
    draft = completeIfTerminal(this.#dependencies.rules, draft);
    const occurredAt = this.#dependencies.clock.now();
    const persisted = await this.#dependencies.writer.replacePlayout({
      scope: request.scope,
      expectedDraftRevision: stored.draft.draftRevision,
      draft,
      occurredAt,
    });
    publishPlayoutChanged(
      this.#dependencies,
      request.scope,
      persisted,
      occurredAt,
    );
    if (persisted.draft.status.kind !== 'awaiting_policy') {
      return playoutView(this.#dependencies.rules, persisted);
    }
    const provider = requireBoundProvider(
      this.#dependencies.policies,
      persisted.draft,
    );
    return playoutView(
      this.#dependencies.rules,
      await drivePolicy(this.#dependencies, request.scope, persisted, provider),
    );
  }
}

export class RetryPlayoutPolicyMove implements ExpectedPlayoutUseCase {
  readonly #dependencies: PlayoutDependencies;

  constructor(dependencies: PlayoutDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(request: ExpectedPlayoutRequest): Promise<PlayoutView> {
    const stored = await requireExpected(this.#dependencies.reader, request);
    await requirePlayoutWorkAccess(
      this.#dependencies.reader,
      request.scope,
      stored,
    );
    const provider = requireBoundProvider(
      this.#dependencies.policies,
      stored.draft,
    );
    const retried = retryPlayoutPolicy(stored.draft);
    const occurredAt = this.#dependencies.clock.now();
    const persisted = await this.#dependencies.writer.replacePlayout({
      scope: request.scope,
      expectedDraftRevision: stored.draft.draftRevision,
      draft: retried,
      occurredAt,
    });
    publishPlayoutChanged(
      this.#dependencies,
      request.scope,
      persisted,
      occurredAt,
    );
    await this.#dependencies.decisions.cancelAndWait(
      persisted.draft.draftId,
      stored.draft.status.kind === 'awaiting_policy'
        ? stored.draft.status.decisionId
        : undefined,
    );
    return playoutView(
      this.#dependencies.rules,
      await drivePolicy(this.#dependencies, request.scope, persisted, provider),
    );
  }
}

export class PausePlayout implements ExpectedPlayoutUseCase {
  readonly #dependencies: Pick<
    PlayoutDependencies,
    'reader' | 'writer' | 'clock' | 'rules' | 'decisions'
  >;

  constructor(
    dependencies: Pick<
      PlayoutDependencies,
      'reader' | 'writer' | 'clock' | 'rules' | 'decisions'
    >,
  ) {
    this.#dependencies = dependencies;
  }

  async execute(request: ExpectedPlayoutRequest): Promise<PlayoutView> {
    const result = playoutView(
      this.#dependencies.rules,
      await replaceExpected(this.#dependencies, request, pausePlayoutDraft),
    );
    this.#dependencies.decisions.cancel(result.draft.draftId);
    return result;
  }
}

export class ResumePlayout implements ExpectedPlayoutUseCase {
  readonly #dependencies: PlayoutDependencies;

  constructor(dependencies: PlayoutDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(request: ExpectedPlayoutRequest): Promise<PlayoutView> {
    const stored = await requireExpected(this.#dependencies.reader, request);
    await requirePlayoutWorkAccess(
      this.#dependencies.reader,
      request.scope,
      stored,
    );
    const provider = requireBoundProvider(
      this.#dependencies.policies,
      stored.draft,
    );
    const resumed = resumePlayoutDraft(stored.draft);
    if (resumed.status.kind === 'awaiting_policy') {
      await this.#dependencies.decisions.cancelAndWait(
        stored.draft.draftId,
        stored.draft.decisionGeneration,
      );
      await requireExpected(this.#dependencies.reader, request);
    }
    const occurredAt = this.#dependencies.clock.now();
    const persisted = await this.#dependencies.writer.replacePlayout({
      scope: request.scope,
      expectedDraftRevision: stored.draft.draftRevision,
      draft: resumed,
      occurredAt,
    });
    publishPlayoutChanged(
      this.#dependencies,
      request.scope,
      persisted,
      occurredAt,
    );
    const result =
      persisted.draft.status.kind === 'awaiting_policy'
        ? await drivePolicy(
            this.#dependencies,
            request.scope,
            persisted,
            provider,
          )
        : persisted;
    return playoutView(this.#dependencies.rules, result);
  }
}

export class StopPlayout implements ExpectedPlayoutUseCase {
  readonly #dependencies: Pick<
    PlayoutDependencies,
    'reader' | 'writer' | 'clock' | 'rules' | 'decisions'
  >;

  constructor(
    dependencies: Pick<
      PlayoutDependencies,
      'reader' | 'writer' | 'clock' | 'rules' | 'decisions'
    >,
  ) {
    this.#dependencies = dependencies;
  }

  async execute(request: ExpectedPlayoutRequest): Promise<PlayoutView> {
    const result = playoutView(
      this.#dependencies.rules,
      await replaceExpected(this.#dependencies, request, stopPlayoutDraft),
    );
    this.#dependencies.decisions.cancel(result.draft.draftId);
    return result;
  }
}

export class CancelPlayoutCompletion implements ExpectedPlayoutUseCase {
  readonly #dependencies: CancelCompletionDependencies;

  constructor(dependencies: CancelCompletionDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(request: ExpectedPlayoutRequest): Promise<PlayoutView> {
    const stored = await requireExpected(this.#dependencies.reader, request);
    if (stored.draft.status.kind !== 'stopped') throw invalidPlayout();
    const occurredAt = this.#dependencies.clock.now();
    const persisted = await this.#dependencies.writer.replacePlayout({
      scope: request.scope,
      expectedDraftRevision: stored.draft.draftRevision,
      draft: cancelPlayoutCompletion(stored.draft),
      occurredAt,
    });
    publishPlayoutChanged(
      this.#dependencies,
      request.scope,
      persisted,
      occurredAt,
    );
    return playoutView(this.#dependencies.rules, persisted);
  }
}

export class DiscardPlayout implements DiscardPlayoutUseCase {
  readonly #dependencies: Pick<
    PlayoutDependencies,
    'reader' | 'writer' | 'clock' | 'decisions'
  >;

  constructor(
    dependencies: Pick<
      PlayoutDependencies,
      'reader' | 'writer' | 'clock' | 'decisions'
    >,
  ) {
    this.#dependencies = dependencies;
  }

  async execute(
    request: ExpectedPlayoutRequest,
  ): Promise<{ readonly dataRevision: number }> {
    await requireExpected(this.#dependencies.reader, request);
    const result = await this.#dependencies.writer.discardPlayout({
      ...request,
      occurredAt: this.#dependencies.clock.now(),
    });
    this.#dependencies.decisions.cancel(request.draftId);
    return result;
  }
}

export class CompletePlayout implements CompletePlayoutUseCase {
  readonly #dependencies: Pick<
    PlayoutDependencies,
    'reader' | 'writer' | 'clock'
  >;

  constructor(
    dependencies: Pick<PlayoutDependencies, 'reader' | 'writer' | 'clock'>,
  ) {
    this.#dependencies = dependencies;
  }

  async execute(
    request: CompletePlayoutRequest,
  ): Promise<CompletePlayoutResult> {
    if (
      request.manualResult !== undefined &&
      !isManualGameResult(request.manualResult)
    )
      throw invalidPlayout();
    const receipt =
      await this.#dependencies.reader.readPlayoutCompletion(request);
    if (receipt !== undefined) return receipt;
    const stored = await requireExpected(this.#dependencies.reader, request);
    if (
      stored.draft.status.kind !== 'stopped' &&
      stored.draft.status.kind !== 'terminal'
    ) {
      throw invalidPlayout();
    }
    await requirePlayoutWorkAccess(
      this.#dependencies.reader,
      request.scope,
      stored,
    );
    let game;
    try {
      game = createGameRecordDraft({
        displayName: request.displayName,
        languageTag: request.languageTag,
        origin: stored.draft.origin,
        ...(stored.draft.sourcePath === undefined
          ? {}
          : { sourcePath: stored.draft.sourcePath }),
        root: stored.draft.root,
        steps: stored.draft.steps,
        playerSide: stored.draft.playerSide,
        ...resolvePlayoutResult(stored.draft, request.manualResult),
        policy: stored.draft.policy,
        provider: {
          providerType: stored.draft.policy.providerType,
          providerDisplayName: stored.draft.policy.providerDisplayName,
        },
      });
    } catch {
      throw invalidPlayout();
    }
    return this.#dependencies.writer.completePlayout({
      ...(request.folderId === undefined ? {} : { folderId: request.folderId }),
      scope: request.scope,
      draftId: request.draftId,
      expectedDraftRevision: request.expectedDraftRevision,
      completionId: request.completionId,
      game,
      ...(request.targetContextId === undefined
        ? {}
        : { targetContextId: request.targetContextId }),
      occurredAt: this.#dependencies.clock.now(),
    });
  }
}

function playoutView(
  rules: ChessRulesPort,
  stored: StoredPlayout,
): PlayoutView {
  const legalMoves = rules.legalMoves(
    stored.draft.root,
    stored.draft.steps.map((step) => step.move),
  );
  if (!legalMoves.ok) throw invalidPlayout();
  return Object.freeze({
    ...stored,
    legalMoves: Object.freeze(legalMoves.value),
  });
}

async function drivePolicy(
  dependencies: PlayoutDependencies,
  scope: WorkScope,
  stored: StoredPlayout,
  provider: MovePolicyProvider,
): Promise<StoredPlayout> {
  if (stored.draft.status.kind !== 'awaiting_policy') throw invalidPlayout();
  await requirePlayoutWorkAccess(dependencies.reader, scope, stored);
  const decisionId = stored.draft.status.decisionId;
  let decision;
  try {
    decision = await dependencies.decisions.run(
      stored.draft.draftId,
      decisionId,
      (signal) =>
        provider.chooseMove(
          {
            root: stored.draft.sourcePath?.root ?? stored.draft.root,
            moves: [
              ...(stored.draft.sourcePath?.steps.map((step) => step.move) ??
                []),
              ...stored.draft.steps.map((step) => step.move),
            ],
            current: currentPlayoutState(stored.draft),
            decisionId,
          },
          signal,
        ),
    );
  } catch (error) {
    throw movePolicyFailed(
      error instanceof MovePolicyProviderError
        ? error.code
        : 'provider_protocol_error',
    );
  }
  if (
    decision.providerInstanceId !== stored.draft.policy.providerInstanceId ||
    decision.providerFingerprint !== stored.draft.policy.providerFingerprint
  ) {
    throw movePolicyFailed('provider_protocol_error');
  }
  const applied = dependencies.rules.applyMove(
    stored.draft.root,
    stored.draft.steps.map((step) => step.move),
    {
      kind: 'coordinates',
      value: `${decision.move.from}${decision.move.to}${promotionLetter(decision.move.promotion)}`,
    },
  );
  if (!applied.ok) throw movePolicyFailed('illegal_engine_move');
  let draft = appendPolicyPlayoutMove(stored.draft, decisionId, applied.value);
  draft = completeIfTerminal(dependencies.rules, draft);
  const occurredAt = dependencies.clock.now();
  const persisted = await dependencies.writer.replacePlayout({
    scope,
    expectedDraftRevision: stored.draft.draftRevision,
    draft,
    occurredAt,
  });
  publishPlayoutChanged(dependencies, scope, persisted, occurredAt);
  return persisted;
}

function publishPlayoutChanged(
  dependencies: Pick<PlayoutDependencies, 'events'>,
  scope: WorkScope,
  stored: StoredPlayout,
  occurredAt: string,
): void {
  dependencies.events.publish(
    Object.freeze({
      kind: 'playout.changed',
      occurredAt,
      dataRevision: stored.dataRevision,
      scope,
      draftId: stored.draft.draftId,
      draftRevision: stored.draft.draftRevision,
    }),
  );
}

function resolveSourcePath(
  rules: ChessRulesPort,
  input: StartPlayoutRequest['sourcePath'],
  playoutRoot: PlayoutDraft['root'],
): NonNullable<PlayoutDraft['sourcePath']> | undefined {
  if (input === undefined) return undefined;
  const displayName = input.displayName.trim();
  if (
    displayName.length === 0 ||
    displayName.length > 200 ||
    input.moves.length > 1_000
  ) {
    throw invalidPlayout();
  }
  const parsed = rules.parseFen(input.rootFen);
  if (!parsed.ok) throw invalidPlayout();
  const root = parsed.value;
  const steps = [];
  let current = root;
  const moves: CanonicalMove[] = [];
  for (const move of input.moves) {
    const applied = rules.applyMove(root, moves, move);
    if (!applied.ok) throw invalidPlayout();
    steps.push(applied.value);
    moves.push(applied.value.move);
    current = applied.value.after;
  }
  if (
    current.fen !== playoutRoot.fen ||
    current.position.positionKey !== playoutRoot.position.positionKey
  ) {
    throw invalidPlayout();
  }
  return Object.freeze({
    displayName,
    root,
    steps: Object.freeze(steps),
  });
}

async function resolveStart(
  rules: ChessRulesPort,
  analysis: ContextAnalysisReader,
  scope: WorkScope,
  start: StartPlayoutRequest['start'],
): Promise<{
  readonly origin: PlayoutOrigin;
  readonly root: PlayoutDraft['root'];
  readonly sourcePath?: NonNullable<PlayoutDraft['sourcePath']>;
}> {
  if (start.kind === 'initial_position') {
    return { origin: start, root: rules.initialState() };
  }
  if (start.kind === 'fen') {
    const parsed = rules.parseFen(start.fen);
    if (!parsed.ok) throw invalidPlayout();
    return { origin: { kind: 'fen' }, root: parsed.value };
  }
  if (start.kind === 'position_setup') {
    const validated = rules.validateSetup(start.setup);
    if (!validated.valid) throw invalidPlayout();
    return { origin: { kind: 'position_setup' }, root: validated.state };
  }
  const record = await analysis.readAnalysisRecord({
    itemId: start.itemId,
    revisionId: start.revisionId,
    anchorId: start.anchorId,
    ...(scope.kind === 'context' ? { contextId: scope.contextId } : {}),
  });
  if (
    record === undefined ||
    record.currentAnchorId.value !== start.anchorId.value
  ) {
    throw invalidPlayout();
  }
  assertInventoryWorkAccess(scope, record.contextMember);
  const anchorState =
    record.cursor === 0 ? record.root : record.steps[record.cursor - 1]?.after;
  if (anchorState === undefined || (start.continuation?.length ?? 0) > 1_000)
    throw invalidPlayout();
  const sourceRoot =
    record.sourcePath?.root ?? record.sourceLine?.root ?? record.root;
  const sourceSteps = [
    ...(record.sourcePath?.steps ?? record.sourceLine?.steps ?? []),
    ...record.steps.slice(0, record.cursor),
  ];
  let root = anchorState;
  const history = sourceSteps.map((step) => step.move);
  for (const move of start.continuation ?? []) {
    const applied = rules.applyMove(sourceRoot, history, move);
    if (!applied.ok) throw invalidPlayout();
    sourceSteps.push(applied.value);
    history.push(applied.value.move);
    root = applied.value.after;
  }
  return {
    origin: {
      kind: 'inventory_anchor',
      itemId: start.itemId,
      revisionId: start.revisionId,
      anchorId: start.anchorId,
    },
    root,
    sourcePath: Object.freeze({
      displayName: record.displayName,
      root: sourceRoot,
      steps: Object.freeze(sourceSteps),
    }),
  };
}

function requirePlayoutWorkAccess(
  reader: InventoryWorkAccessReader,
  scope: WorkScope,
  stored: StoredPlayout,
): Promise<void> {
  return requireInventoryWorkAccess(
    reader,
    scope,
    stored.draft.origin.kind === 'inventory_anchor'
      ? stored.draft.origin.itemId
      : undefined,
  );
}

function completeIfTerminal(
  rules: ChessRulesPort,
  draft: PlayoutDraft,
): PlayoutDraft {
  const terminal = terminalResult(
    rules,
    draft.root,
    draft.steps.map((step) => step.move),
  );
  return terminal === undefined ? draft : completePlayoutDraft(draft, terminal);
}

function terminalResult(
  rules: ChessRulesPort,
  root: PlayoutDraft['root'],
  moves: readonly CanonicalMove[],
):
  | {
      readonly reason: PlayoutTerminalReason;
      readonly outcome: Exclude<
        PlayoutOutcome,
        { readonly kind: 'unfinished' }
      >;
    }
  | undefined {
  const status = rules.gameStatus(root, moves);
  if (!status.ok) throw invalidPlayout();
  if (status.value.kind === 'ongoing') return undefined;
  return {
    reason: status.value.reason,
    outcome:
      status.value.reason === 'checkmate' && status.value.winner !== undefined
        ? { kind: 'win', winner: status.value.winner }
        : status.value.reason === 'checkmate'
          ? (() => {
              throw invalidPlayout();
            })()
          : { kind: 'draw', reason: status.value.reason },
  };
}

function assertOngoing(
  rules: ChessRulesPort,
  root: PlayoutDraft['root'],
  moves: readonly PlayoutDraft['steps'][number]['move'][],
): void {
  const status = rules.gameStatus(root, moves);
  if (!status.ok || status.value.kind !== 'ongoing') throw invalidPlayout();
}

function requireProvider(
  registry: MovePolicyRegistry,
  instanceId: string,
  capability: PlayoutDraft['policy']['capability'],
): MovePolicyProvider {
  const provider = registry.resolve(instanceId, capability);
  if (
    provider === undefined ||
    provider.descriptor.status !== 'available' ||
    !provider.descriptor.capabilities.includes(capability)
  ) {
    throw movePolicyUnavailable();
  }
  return provider;
}

function requireBoundProvider(
  registry: MovePolicyRegistry,
  draft: PlayoutDraft,
): MovePolicyProvider {
  const provider = requireProvider(
    registry,
    draft.policy.providerInstanceId,
    draft.policy.capability,
  );
  if (provider.descriptor.fingerprint !== draft.policy.providerFingerprint) {
    throw movePolicyUnavailable();
  }
  return provider;
}

async function requireExpected(
  reader: PlayoutReader,
  request: ExpectedPlayoutRequest,
): Promise<StoredPlayout> {
  const stored = await reader.readPlayout(request.scope);
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
  return stored;
}

async function replaceExpected(
  dependencies: Pick<PlayoutDependencies, 'reader' | 'writer' | 'clock'>,
  request: ExpectedPlayoutRequest,
  transition: (draft: PlayoutDraft) => PlayoutDraft,
): Promise<StoredPlayout> {
  const stored = await requireExpected(dependencies.reader, request);
  return dependencies.writer.replacePlayout({
    scope: request.scope,
    expectedDraftRevision: stored.draft.draftRevision,
    draft: transition(stored.draft),
    occurredAt: dependencies.clock.now(),
  });
}

function promotionLetter(
  promotion: PlayoutDraft['steps'][number]['move']['promotion'],
): string {
  return promotion === undefined
    ? ''
    : { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }[promotion];
}

function oppositeSide(side: SideToMove): SideToMove {
  return side === 'white' ? 'black' : 'white';
}
