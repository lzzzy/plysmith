import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  ActiveMovePolicyDecisions,
  CancelPlayoutCompletion,
  MovePolicyProviderError,
  CompletePlayout,
  PausePlayout,
  StartPlayout,
  StopPlayout,
  SubmitPlayoutMove,
  type MovePolicyDecision,
  type MovePolicyProvider,
  type MovePolicyProviderDescriptor,
  type MovePolicyRegistry,
  type MovePolicyRequest,
  type PlayoutChanged,
} from '../../app/application/playout/index.ts';
import { freeWorkScope } from '../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { SqlitePersistenceAdapter } from '../../app/infrastructure/adapters/persistence/sqlite/index.ts';

const timestamp = '2026-09-17T11:00:00.000Z';

function fixture(
  t: TestContext,
  choose: MovePolicyProvider['chooseMove'],
  policy: {
    readonly capability: 'best_move' | 'human_profile';
    readonly profile?: MovePolicyProviderDescriptor['profile'];
  } = { capability: 'best_move' },
) {
  const directory = mkdtempSync(join(tmpdir(), 'plysmith-playout-flow-'));
  const store = new SqlitePersistenceAdapter({
    databasePath: join(directory, 'store.sqlite'),
    now: () => timestamp,
  });
  t.after(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const provider: MovePolicyProvider = {
    descriptor: {
      instanceId: 'engine-main',
      providerType: 'test-engine',
      displayName: 'Test engine',
      fingerprint: 'test-engine:v1',
      capabilities: [policy.capability],
      ...(policy.profile === undefined ? {} : { profile: policy.profile }),
      readiness: 'cold',
      status: 'available',
    },
    chooseMove: choose,
  };
  const policies: MovePolicyRegistry = {
    list: () => [provider.descriptor],
    resolve: (instanceId, capability) =>
      instanceId === provider.descriptor.instanceId &&
      capability === policy.capability
        ? provider
        : undefined,
  };
  const rules = new ChessJsRulesAdapter();
  const published: PlayoutChanged[] = [];
  const common = {
    reader: store,
    writer: store,
    rules,
    policies,
    decisions: new ActiveMovePolicyDecisions(),
    clock: { now: () => timestamp },
    events: { publish: (event: PlayoutChanged) => published.push(event) },
  };
  return {
    store,
    published,
    start: new StartPlayout({
      ...common,
      analysis: {
        readAnalysisRecord: async () => undefined,
        readContextAnalysisWorkspace: async () => undefined,
      },
    }),
    submit: new SubmitPlayoutMove(common),
    pause: new PausePlayout(common),
    stop: new StopPlayout(common),
    cancelCompletion: new CancelPlayoutCompletion(common),
    complete: new CompletePlayout(common),
  };
}

test('cancels completion through persistence after context access and provider are unavailable', async (t) => {
  const { store, stop, cancelCompletion } = fixture(t, async () =>
    assert.fail('Cancellation must not call a provider'),
  );
  const rules = new ChessJsRulesAdapter();
  const { context } = await store.createWorkingContext(
    { displayName: 'Completion context' },
    timestamp,
  );
  const scope = { kind: 'context' as const, contextId: context.contextId };
  const source = await store.createAnalysisRecord({
    displayName: 'Completion source',
    languageTag: 'en-GB',
    origin: { kind: 'initial_position' },
    root: rules.initialState(),
    steps: [],
    occurredAt: timestamp,
  });
  await store.addContextReference(
    {
      contextId: context.contextId,
      itemId: source.itemId,
      anchorId: source.rootAnchorId,
    },
    timestamp,
  );
  const created = await store.createPlayout({
    scope,
    origin: {
      kind: 'inventory_anchor',
      itemId: source.itemId,
      revisionId: source.revisionId,
      anchorId: source.rootAnchorId,
    },
    root: rules.initialState(),
    playerSide: 'black',
    policy: {
      capability: 'best_move',
      providerInstanceId: 'removed-engine',
      providerFingerprint: 'removed-engine:v1',
      providerType: 'test-engine',
      providerDisplayName: 'Removed engine',
    },
    occurredAt: timestamp,
  });
  await store.removeContextItem(
    {
      contextId: context.contextId,
      itemId: source.itemId,
      expectedContextVersion: context.contextVersion,
      expectedDataRevision: (await store.readStoreStatus()).dataRevision,
    },
    timestamp,
  );
  const stopped = await stop.execute({
    scope,
    draftId: created.draft.draftId,
    expectedDraftRevision: created.draft.draftRevision,
  });
  const cancelled = await cancelCompletion.execute({
    scope,
    draftId: stopped.draft.draftId,
    expectedDraftRevision: stopped.draft.draftRevision,
  });
  assert.deepEqual(cancelled.draft, {
    ...stopped.draft,
    draftRevision: stopped.draft.draftRevision + 1,
    status: { kind: 'paused' },
  });
  assert.deepEqual(await store.readPlayout(scope), {
    draft: cancelled.draft,
    dataRevision: cancelled.dataRevision,
  });
  const inventory = await store.searchInventory({ pageSize: 20 });
  assert.deepEqual(
    inventory.items.map((item) => item.itemType),
    ['analysis'],
  );
});

test('binds the player to the opposite side when the provider moves first', async (t) => {
  let policyCalls = 0;
  const { start } = fixture(t, async (request) => {
    policyCalls += 1;
    return decision(request, 'e8', 'e7', 'Ke7', 'black');
  });

  const created = await start.execute({
    scope: freeWorkScope(),
    start: { kind: 'fen', fen: '4k3/8/8/8/8/8/8/R3K3 b - - 0 1' },
    providerInstanceId: 'engine-main',
    capability: 'best_move',
    opening: { kind: 'provider_move' },
  });

  assert.equal(created.draft.root.position.sideToMove, 'black');
  assert.equal(created.draft.playerSide, 'white');
  assert.equal(created.draft.status.kind, 'active');
  assert.equal(created.draft.steps[0]?.actor, 'provider');
  assert.equal(created.draft.steps[0]?.move.san, 'Ke7');
  assert.equal(policyCalls, 1);
});

test('keeps a validated analysis path separate from played moves', async (t) => {
  const rules = new ChessJsRulesAdapter();
  const sourceMove = rules.applyMove(rules.initialState(), [], {
    kind: 'coordinates',
    value: 'e2e4',
  });
  assert.equal(sourceMove.ok, true);
  if (!sourceMove.ok) throw new Error('Expected a legal source move.');
  const { store, start } = fixture(t, async (request) =>
    decision(request, 'e7', 'e5', 'e5'),
  );
  const scope = freeWorkScope();

  const created = await start.execute({
    scope,
    start: { kind: 'fen', fen: sourceMove.value.after.fen },
    sourcePath: {
      displayName: 'Scandinavisch',
      rootFen: rules.initialState().fen,
      moves: [{ kind: 'coordinates', value: 'e2e4' }],
    },
    providerInstanceId: 'engine-main',
    capability: 'best_move',
    opening: { kind: 'provider_move' },
  });

  assert.equal(created.draft.sourcePath?.displayName, 'Scandinavisch');
  assert.deepEqual(
    created.draft.sourcePath?.steps.map((step) => step.move.san),
    ['e4'],
  );
  assert.deepEqual(
    created.draft.steps.map((step) => [step.actor, step.move.san]),
    [['provider', 'e5']],
  );
  const recovered = await store.readPlayout(scope);
  assert.deepEqual(
    recovered?.draft.sourcePath?.steps.map((step) => step.move.san),
    ['e4'],
  );
});

test('rejects a source path that does not end at the playout root', async (t) => {
  const rules = new ChessJsRulesAdapter();
  const { start } = fixture(t, async (request) =>
    decision(request, 'e7', 'e5', 'e5'),
  );
  await assert.rejects(
    start.execute({
      scope: freeWorkScope(),
      start: { kind: 'initial_position' },
      sourcePath: {
        displayName: 'Andere Stellung',
        rootFen: rules.initialState().fen,
        moves: [{ kind: 'coordinates', value: 'e2e4' }],
      },
      providerInstanceId: 'engine-main',
      capability: 'best_move',
      opening: { kind: 'provider_move' },
    }),
    { problemCode: 'playout.invalid' },
  );
});

test('publishes the committed user move before the policy response arrives', async (t) => {
  let releasePolicy: (() => void) | undefined;
  const policyReleased = new Promise<void>((resolve) => {
    releasePolicy = resolve;
  });
  let policyStarted: ((request: MovePolicyRequest) => void) | undefined;
  const policyRequest = new Promise<MovePolicyRequest>((resolve) => {
    policyStarted = resolve;
  });
  const { store, start, published } = fixture(t, async (request) => {
    policyStarted?.(request);
    await policyReleased;
    return decision(request, 'e7', 'e5', 'e5');
  });
  const scope = freeWorkScope();
  const result = start.execute({
    scope,
    start: { kind: 'initial_position' },
    providerInstanceId: 'engine-main',
    capability: 'best_move',
    opening: {
      kind: 'user_move',
      move: { kind: 'coordinates', value: 'e2e4' },
    },
  });
  await policyRequest;

  const committed = await store.readPlayout(scope);
  assert.deepEqual(
    committed?.draft.steps.map((step) => [step.actor, step.move.san]),
    [['user', 'e4']],
  );
  assert.equal(committed?.draft.status.kind, 'awaiting_policy');
  assert.equal(published.length, 1);
  assert.equal(published[0]?.kind, 'playout.changed');
  assert.equal(published[0]?.draftRevision, committed?.draft.draftRevision);

  releasePolicy?.();
  const completed = await result;
  assert.deepEqual(
    completed.draft.steps.map((step) => [step.actor, step.move.san]),
    [
      ['user', 'e4'],
      ['provider', 'e5'],
    ],
  );
  assert.equal(published.length, 2);
  assert.equal(published[1]?.draftRevision, completed.draft.draftRevision);
});

test('completes and persists a practice game after threefold repetition', async (t) => {
  let policyCalls = 0;
  const { store, start, submit, complete } = fixture(t, async (request) => {
    policyCalls += 1;
    return policyCalls % 2 === 1
      ? decision(request, 'g8', 'f6', 'Nf6')
      : decision(request, 'f6', 'g8', 'Ng8');
  });
  const scope = freeWorkScope();
  let view = await start.execute({
    scope,
    start: { kind: 'initial_position' },
    providerInstanceId: 'engine-main',
    capability: 'best_move',
    opening: {
      kind: 'user_move',
      move: { kind: 'coordinates', value: 'g1f3' },
    },
  });

  for (const value of ['f3g1', 'g1f3', 'f3g1']) {
    view = await submit.execute({
      scope,
      draftId: view.draft.draftId,
      expectedDraftRevision: view.draft.draftRevision,
      move: { kind: 'coordinates', value },
    });
  }

  assert.deepEqual(view.draft.status, {
    kind: 'terminal',
    reason: 'threefold_repetition',
    outcome: { kind: 'draw', reason: 'threefold_repetition' },
  });
  const completed = await complete.execute({
    scope,
    draftId: view.draft.draftId,
    expectedDraftRevision: view.draft.draftRevision,
    completionId: 'complete-threefold-game',
    displayName: 'Remis durch Zugwiederholung',
    languageTag: 'de-DE',
  });
  const opened = await store.readAnalysisRecord({
    itemId: completed.itemId,
    revisionId: completed.revisionId,
    anchorId: completed.rootAnchorId,
  });

  assert.deepEqual(opened?.game?.outcome, {
    kind: 'draw',
    reason: 'threefold_repetition',
  });
});

test('persists moves and completes one idempotent game record', async (t) => {
  const { store, start, stop, complete } = fixture(t, async (request) =>
    decision(request, 'e7', 'e5', 'e5'),
  );
  const scope = freeWorkScope();
  const played = await start.execute({
    scope,
    start: { kind: 'initial_position' },
    providerInstanceId: 'engine-main',
    capability: 'best_move',
    opening: {
      kind: 'user_move',
      move: { kind: 'coordinates', value: 'e2e4' },
    },
  });

  assert.equal(played.draft.status.kind, 'active');
  assert.deepEqual(
    played.draft.steps.map((step) => [step.actor, step.move.san]),
    [
      ['user', 'e4'],
      ['provider', 'e5'],
    ],
  );
  const stopped = await stop.execute({
    scope,
    draftId: played.draft.draftId,
    expectedDraftRevision: played.draft.draftRevision,
  });
  const completionRequest = {
    scope,
    draftId: stopped.draft.draftId,
    expectedDraftRevision: stopped.draft.draftRevision,
    completionId: 'complete-game-1',
    manualResult: 'unfinished',
    displayName: 'Praxispartie nach 1. e4',
    languageTag: 'de-DE',
  } as const;
  const completed = await complete.execute(completionRequest);
  assert.deepEqual(await complete.execute(completionRequest), completed);
  await assert.rejects(
    complete.execute({
      ...completionRequest,
      displayName: 'Anderer Abschlussauftrag',
    }),
    { problemCode: 'playout.invalid' },
  );
  assert.equal(await store.readPlayout(scope), undefined);
  const found = await store.searchInventory({
    query: 'Praxispartie nach 1. e4',
    pageSize: 20,
  });
  assert.equal(found.items[0]?.itemType, 'game');
  assert.equal(
    found.items[0]?.rootAnchorId.value,
    completed.rootAnchorId.value,
  );
  const opened = await store.readAnalysisRecord({
    itemId: completed.itemId,
    revisionId: completed.revisionId,
    anchorId: completed.rootAnchorId,
  });
  assert.deepEqual(
    opened?.steps.map((step) => step.move.san),
    ['e4', 'e5'],
  );
  assert.equal(opened?.itemType, 'game');
  assert.deepEqual(opened?.game, {
    playerSide: 'white',
    outcome: { kind: 'unfinished' },
    outcomeSource: 'manual',
    policy: {
      capability: 'best_move',
      providerInstanceId: 'engine-main',
      providerFingerprint: 'test-engine:v1',
      providerType: 'test-engine',
      providerDisplayName: 'Test engine',
    },
  });
});

test('persists the selected Maia profile with the completed game', async (t) => {
  const profile = {
    modelName: 'maia-1500.pb.gz',
    selectionMode: 'most_likely' as const,
    historyMode: 'known_position_history' as const,
    reproducibility: 'deterministic' as const,
  };
  const { store, start, stop, complete } = fixture(
    t,
    async (request) => decision(request, 'e7', 'e5', 'e5'),
    { capability: 'human_profile', profile },
  );
  const scope = freeWorkScope();
  const played = await start.execute({
    scope,
    start: { kind: 'initial_position' },
    providerInstanceId: 'engine-main',
    capability: 'human_profile',
    opening: {
      kind: 'user_move',
      move: { kind: 'coordinates', value: 'e2e4' },
    },
  });
  const stopped = await stop.execute({
    scope,
    draftId: played.draft.draftId,
    expectedDraftRevision: played.draft.draftRevision,
  });
  const completed = await complete.execute({
    scope,
    draftId: stopped.draft.draftId,
    expectedDraftRevision: stopped.draft.draftRevision,
    completionId: 'complete-maia-game',
    manualResult: 'unfinished',
    displayName: 'Praxispartie gegen Maia 1500',
    languageTag: 'de-DE',
  });
  const opened = await store.readAnalysisRecord({
    itemId: completed.itemId,
    revisionId: completed.revisionId,
    anchorId: completed.rootAnchorId,
  });

  assert.deepEqual(opened?.game?.policy, {
    capability: 'human_profile',
    providerInstanceId: 'engine-main',
    providerFingerprint: 'test-engine:v1',
    providerType: 'test-engine',
    providerDisplayName: 'Test engine',
    profile,
  });
});

test('keeps the confirmed user move when the provider fails', async (t) => {
  const { store, start } = fixture(t, async () => {
    throw new MovePolicyProviderError('provider_timeout');
  });
  const scope = freeWorkScope();
  await assert.rejects(
    start.execute({
      scope,
      start: { kind: 'initial_position' },
      providerInstanceId: 'engine-main',
      capability: 'best_move',
      opening: {
        kind: 'user_move',
        move: { kind: 'coordinates', value: 'e2e4' },
      },
    }),
    { problemCode: 'playout.provider_timeout' },
  );

  const retained = await store.readPlayout(scope);
  assert.equal(retained?.draft.status.kind, 'awaiting_policy');
  assert.equal(retained?.draft.steps.length, 1);
  assert.equal(retained?.draft.steps[0]?.move.san, 'e4');
});

test('pausing aborts the active policy decision without mutating the draft', async (t) => {
  const { store, start, pause } = fixture(
    t,
    (_request, signal) =>
      new Promise<MovePolicyDecision>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(new MovePolicyProviderError('interrupted')),
          { once: true },
        );
      }),
  );
  const scope = freeWorkScope();
  const starting = start.execute({
    scope,
    start: { kind: 'initial_position' },
    providerInstanceId: 'engine-main',
    capability: 'best_move',
    opening: {
      kind: 'user_move',
      move: { kind: 'coordinates', value: 'e2e4' },
    },
  });
  await waitUntil(
    async () =>
      (await store.readPlayout(scope))?.draft.status.kind === 'awaiting_policy',
  );
  const waiting = await store.readPlayout(scope);
  assert.ok(waiting);
  await pause.execute({
    scope,
    draftId: waiting.draft.draftId,
    expectedDraftRevision: waiting.draft.draftRevision,
  });
  await assert.rejects(starting, {
    problemCode: 'playout.interrupted',
  });
  const paused = await store.readPlayout(scope);
  assert.equal(paused?.draft.status.kind, 'paused');
  assert.equal(paused?.draft.steps.length, 1);
});

function decision(
  request: MovePolicyRequest,
  from: string,
  to: string,
  san: string,
  sideToMove: 'white' | 'black' = 'black',
): MovePolicyDecision {
  assert.equal(request.current.position.sideToMove, sideToMove);
  return {
    move: { from, to, san },
    providerInstanceId: 'engine-main',
    providerFingerprint: 'test-engine:v1',
    reproducibility: 'deterministic',
  };
}

async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for persisted policy state.');
}
