import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  ActivePositionAnalysisLanes,
  AnalyzePosition,
  FreeAnalysisSession,
  GetAnalysisWorkspace,
  UpdateAnalysisScratch,
  type PositionAnalysisProvider,
} from '../../../app/application/analysis/index.ts';
import {
  ActiveMovePolicyDecisions,
  CompletePlayout,
  PausePlayout,
  ResumePlayout,
  StartPlayout,
  StopPlayout,
  SubmitPlayoutMove,
  type MovePolicyProvider,
} from '../../../app/application/playout/index.ts';
import { requireInventoryWorkAccess } from '../../../app/application/workspace/inventory-work-access.ts';
import { freeWorkScope } from '../../../app/domain/workspace/index.ts';
import {
  appendUserPlayoutMove,
  pausePlayoutDraft,
} from '../../../app/domain/playout/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';

const timestamp = '2026-09-27T12:00:00.000Z';
const rules = new ChessJsRulesAdapter();
const denied = { problemCode: 'workspace.inventory_work_not_allowed' };

async function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'plysmith-work-access-'));
  const store = new SqlitePersistenceAdapter({
    databasePath: join(directory, 'store.sqlite'),
    now: () => timestamp,
  });
  const stores = [store];
  t.after(async () => {
    for (const current of stores) await current.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const { context } = await store.createWorkingContext(
    { displayName: 'Context' },
    timestamp,
  );
  const scope = { kind: 'context' as const, contextId: context.contextId };
  const item = await store.createAnalysisRecord({
    displayName: 'Source',
    languageTag: 'en-GB',
    origin: { kind: 'initial_position' },
    root: rules.initialState(),
    steps: [],
    occurredAt: timestamp,
  });
  const origin = {
    kind: 'inventory_anchor' as const,
    itemId: item.itemId,
    revisionId: item.revisionId,
    anchorId: item.rootAnchorId,
  };
  const freeSession = new FreeAnalysisSession({
    persistence: store,
    clock: { now: () => timestamp },
  });
  const analysis = new GetAnalysisWorkspace({
    reader: store,
    freeSession,
    rules,
    storeStatus: store,
  });
  const scratch = new UpdateAnalysisScratch({
    reader: store,
    writer: store,
    freeSession,
    rules,
    storeStatus: store,
    clock: { now: () => timestamp },
    events: { publish: () => undefined },
    scratchId: () => 'access-scratch',
  });
  const add = () =>
    store.addContextReference(
      {
        contextId: context.contextId,
        itemId: item.itemId,
        anchorId: item.rootAnchorId,
      },
      timestamp,
    );
  const remove = async () => {
    const preview = await store.previewContextItemRemoval({
      contextId: context.contextId,
      itemId: item.itemId,
    });
    return store.removeContextItem(
      {
        contextId: context.contextId,
        itemId: item.itemId,
        expectedContextVersion: preview.contextVersion,
        expectedDataRevision: preview.dataRevision,
      },
      timestamp,
    );
  };
  async function reopen() {
    await store.close();
    const next = new SqlitePersistenceAdapter({
      databasePath: join(directory, 'store.sqlite'),
      now: () => timestamp,
    });
    stores.push(next);
    return next;
  }
  return { store, scope, item, origin, analysis, scratch, add, remove, reopen };
}

test('requires context membership for active analysis while retaining global reads and new work', async (t) => {
  const { store, scope, item, origin, analysis, scratch, add } =
    await fixture(t);
  await assert.rejects(
    requireInventoryWorkAccess(store, scope, item.itemId),
    denied,
  );
  await assert.rejects(analysis.execute({ scope, preview: origin }), denied);
  await assert.rejects(
    scratch.execute({
      scope,
      expectedScratchId: null,
      expectedScratchRevision: null,
      action: { kind: 'start', origin },
    }),
    denied,
  );
  assert.equal(
    (await store.readAnalysisRecord({ ...origin, contextId: scope.contextId }))
      ?.contextMember,
    false,
  );
  assert.equal(
    (await analysis.execute({ scope: freeWorkScope(), preview: origin })).record
      ?.itemId.value,
    item.itemId.value,
  );
  assert.equal(
    (await analysis.execute({ scope, mode: 'initial_position' })).record,
    undefined,
  );
  const own = await scratch.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: { kind: 'fen', fen: rules.initialState().fen },
    },
  });
  assert.equal(own.scratch?.origin.kind, 'fen');
  assert.ok(own.scratch);
  await scratch.execute({
    scope,
    expectedScratchId: own.scratch.scratchId,
    expectedScratchRevision: own.scratch.scratchRevision,
    action: { kind: 'discard' },
  });
  await add();
  assert.equal(
    (await analysis.execute({ scope, preview: origin })).record?.contextMember,
    true,
  );
  const started = await scratch.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin },
  });
  assert.equal(started.scratch?.origin.kind, 'inventory_anchor');
});

test('keeps unassigned ancestors readable without granting active navigation', async (t) => {
  const { store, scope, origin, analysis } = await fixture(t);
  const child = await store.createAnalysisRecord({
    displayName: 'Child',
    languageTag: 'en-GB',
    origin,
    root: rules.initialState(),
    steps: [],
    occurredAt: timestamp,
  });
  await store.addContextReference(
    {
      contextId: scope.contextId,
      itemId: child.itemId,
      anchorId: child.rootAnchorId,
    },
    timestamp,
  );
  const workspace = await analysis.execute({
    scope,
    preview: {
      itemId: child.itemId,
      revisionId: child.revisionId,
      anchorId: child.rootAnchorId,
    },
  });
  assert.equal(
    workspace.record?.sourceLine?.sourceItemId.value,
    origin.itemId.value,
  );
  await assert.rejects(analysis.execute({ scope, preview: origin }), denied);
});

test('removing membership clears bound analysis resume and prevents restarting it', async (t) => {
  const { store, scope, origin, analysis, scratch, add, remove } =
    await fixture(t);
  await add();
  await scratch.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin,
      firstMove: { kind: 'coordinates', value: 'e2e4' },
    },
  });
  await remove();
  const workspace = await analysis.execute({ scope });
  assert.equal(workspace.record, undefined);
  assert.equal(workspace.scratch, undefined);
  await assert.rejects(analysis.execute({ scope, preview: origin }), denied);
  assert.ok(await store.readAnalysisRecord(origin));
});

test('checks engine membership before work and again before publishing its result', async (t) => {
  const { store, scope, item, add, remove } = await fixture(t);
  let calls = 0;
  let finish: (() => void) | undefined;
  let started: (() => void) | undefined;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const finishPromise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const provider: PositionAnalysisProvider = {
    descriptor: {
      instanceId: 'test',
      providerType: 'test',
      displayName: 'Test',
      capability: 'objective_position_analysis',
      readiness: 'ready',
      status: 'available',
    },
    async analyze(request) {
      calls += 1;
      started?.();
      await finishPromise;
      return {
        kind: 'objective',
        perspective: 'white',
        focusKey: request.focus.focusKey,
        providerInstanceId: 'test',
        providerDisplayName: 'Test',
        historyCompleteness: 'complete',
        budget: 'fast',
        candidates: [],
        search: { limiter: { kind: 'movetime', value: 1 } },
      };
    },
  };
  const analyze = new AnalyzePosition({
    rules,
    providers: { list: () => [provider.descriptor], resolve: () => provider },
    lanes: new ActivePositionAnalysisLanes(),
    workspace: store,
  });
  const request = {
    work: {
      scope,
      subject: { kind: 'inventory_item' as const, itemId: item.itemId },
    },
    consumerId: 'test',
    laneId: 'test',
    providerInstanceId: 'test',
    candidateCount: 1,
    focus: {
      focusKey: 'root',
      root: rules.initialState(),
      moves: [],
      current: rules.initialState(),
    },
    mode: { kind: 'objective' as const, budget: 'fast' as const },
  };
  await assert.rejects(analyze.execute(request), denied);
  assert.equal(calls, 0);
  await add();
  const result = analyze.execute(request);
  await startedPromise;
  await remove();
  finish?.();
  await assert.rejects(result, denied);
  assert.equal(calls, 1);
  assert.equal(
    (
      await analyze.execute({
        ...request,
        work: { scope, subject: { kind: 'position' } },
      })
    ).kind,
    'objective',
  );
});

test('guards playout start and continuation while allowing pause and free position starts', async (t) => {
  const { store, scope, origin, add, remove } = await fixture(t);
  let calls = 0;
  const provider: MovePolicyProvider = {
    descriptor: {
      instanceId: 'test',
      providerType: 'test',
      displayName: 'Test',
      fingerprint: 'test',
      capabilities: ['best_move'],
      readiness: 'ready',
      status: 'available',
    },
    async chooseMove() {
      calls += 1;
      throw new Error('Provider must not run.');
    },
  };
  const common = {
    reader: store,
    writer: store,
    rules,
    policies: { list: () => [provider.descriptor], resolve: () => provider },
    decisions: new ActiveMovePolicyDecisions(),
    clock: { now: () => timestamp },
    events: { publish: () => undefined },
  };
  const start = new StartPlayout({ ...common, analysis: store });
  const startRequest = {
    scope,
    start: origin,
    providerInstanceId: 'test',
    capability: 'best_move' as const,
    opening: {
      kind: 'user_move' as const,
      move: { kind: 'coordinates' as const, value: 'e2e4' },
    },
  };
  await assert.rejects(start.execute(startRequest), denied);
  const policy = {
    capability: 'best_move' as const,
    providerInstanceId: 'test',
    providerFingerprint: 'test',
    providerType: 'test',
    providerDisplayName: 'Test',
  };
  const create = {
    scope,
    origin,
    root: rules.initialState(),
    playerSide: 'white' as const,
    policy,
    occurredAt: timestamp,
  };
  await assert.rejects(store.createPlayout(create), denied);
  await add();
  const created = await store.createPlayout(create);
  await remove();
  const e4 = rules.applyMove(created.draft.root, [], {
    kind: 'coordinates',
    value: 'e2e4',
  });
  assert.ok(e4.ok);
  await assert.rejects(
    store.replacePlayout({
      scope,
      expectedDraftRevision: created.draft.draftRevision,
      draft: pausePlayoutDraft(appendUserPlayoutMove(created.draft, e4.value)),
      occurredAt: timestamp,
    }),
    denied,
  );
  await assert.rejects(
    store.replacePlayout({
      scope,
      expectedDraftRevision: created.draft.draftRevision,
      draft: { ...created.draft, origin: { kind: 'fen' } },
      occurredAt: timestamp,
    }),
    denied,
  );
  const expected = {
    scope,
    draftId: created.draft.draftId,
    expectedDraftRevision: created.draft.draftRevision,
  };
  await assert.rejects(
    new SubmitPlayoutMove(common).execute({
      ...expected,
      move: { kind: 'coordinates', value: 'e2e4' },
    }),
    denied,
  );
  const paused = await new PausePlayout(common).execute(expected);
  await assert.rejects(
    new ResumePlayout(common).execute({
      ...expected,
      expectedDraftRevision: paused.draft.draftRevision,
    }),
    denied,
  );
  assert.equal(calls, 0);
  const free = await store.createPlayout({
    ...create,
    scope: freeWorkScope(),
    origin: { kind: 'fen' },
  });
  assert.equal(free.draft.origin.kind, 'fen');
});

test('preserves an inventory continuation through game completion, reopening, and further derivation', async (t) => {
  const { store, scope, origin, add, reopen } = await fixture(t);
  await add();
  const provider: MovePolicyProvider = {
    descriptor: {
      instanceId: 'bridge',
      providerType: 'test',
      displayName: 'Bridge',
      fingerprint: 'bridge-v1',
      capabilities: ['best_move'],
      readiness: 'ready',
      status: 'available',
    },
    async chooseMove(request) {
      return {
        decisionId: request.decisionId,
        move: { from: 'e7', to: 'e5', san: 'e5' },
        providerInstanceId: 'bridge',
        providerFingerprint: 'bridge-v1',
        reproducibility: 'deterministic',
      };
    },
  };
  const common = {
    reader: store,
    writer: store,
    rules,
    policies: { list: () => [provider.descriptor], resolve: () => provider },
    decisions: new ActiveMovePolicyDecisions(),
    clock: { now: () => timestamp },
    events: { publish: () => undefined },
  };
  const started = await new StartPlayout({
    ...common,
    analysis: store,
  }).execute({
    scope,
    start: {
      ...origin,
      continuation: [{ kind: 'coordinates', value: 'e2e4' }],
    },
    providerInstanceId: 'bridge',
    capability: 'best_move',
    opening: { kind: 'provider_move' },
  });
  assert.deepEqual(started.draft.origin, origin);
  assert.deepEqual(
    started.draft.sourcePath?.steps.map((step) => step.move.san),
    ['e4'],
  );
  assert.deepEqual(
    started.draft.steps.map((step) => step.move.san),
    ['e5'],
  );
  assert.equal(
    started.draft.root.fen,
    started.draft.sourcePath?.steps[0]?.after.fen,
  );
  const stopped = await new StopPlayout(common).execute({
    scope,
    draftId: started.draft.draftId,
    expectedDraftRevision: started.draft.draftRevision,
  });
  const saved = await new CompletePlayout(common).execute({
    scope,
    draftId: stopped.draft.draftId,
    expectedDraftRevision: stopped.draft.draftRevision,
    completionId: 'bridge-game',
    manualResult: 'unfinished',
    displayName: 'Bridge game',
    languageTag: 'en-GB',
    targetContextId: scope.contextId,
  });
  const recovered = await reopen();
  assert.equal((await recovered.readStoreStatus()).schemaVersion, 9);
  const game = await recovered.readAnalysisRecord({
    itemId: saved.itemId,
    revisionId: saved.revisionId,
    anchorId: saved.rootAnchorId,
  });
  assert.ok(game);
  assert.deepEqual(game.origin, origin);
  assert.deepEqual(
    game.sourcePath?.steps.map((step) => step.move.san),
    ['e4'],
  );
  assert.deepEqual(
    game.sourceLine?.steps.map((step) => step.move.san),
    ['e4'],
  );
  assert.equal(game.sourceLine?.steps[0]?.anchorId, undefined);
  assert.deepEqual(
    game.steps.map((step) => step.move.san),
    ['e5'],
  );
  const after = game.steps[0];
  assert.ok(after);
  const child = await recovered.createAnalysisRecord({
    displayName: 'After bridge',
    languageTag: 'en-GB',
    origin: {
      kind: 'inventory_anchor',
      itemId: saved.itemId,
      revisionId: saved.revisionId,
      anchorId: after.anchorId,
    },
    root: after.after,
    steps: [],
    occurredAt: timestamp,
  });
  const analysis = await recovered.readAnalysisRecord({
    itemId: child.itemId,
    revisionId: child.revisionId,
    anchorId: child.rootAnchorId,
  });
  assert.deepEqual(
    analysis?.sourceLine?.steps.map((step) => step.move.san),
    ['e4', 'e5'],
  );
  assert.equal(analysis?.sourceLine?.steps[0]?.anchorId, undefined);
  assert.equal(
    analysis?.sourceLine?.steps[1]?.itemId?.value,
    saved.itemId.value,
  );
  assert.equal(
    analysis?.sourceLine?.steps[1]?.anchorId?.value,
    after.anchorId.value,
  );
  const family = await recovered.searchInventory({
    query: 'After bridge',
    pageSize: 1,
  });
  assert.deepEqual(
    family.items.map((entry) => entry.itemId),
    [child.itemId],
  );
  assert.equal(family.ancestors.length, 2);
  assert.equal(
    family.ancestors.find((entry) => entry.itemId.value === saved.itemId.value)
      ?.itemType,
    'game',
  );
  assert.equal(
    family.ancestors.find((entry) => entry.itemId.value === origin.itemId.value)
      ?.itemType,
    'analysis',
  );
  assert.deepEqual(
    family.provenanceEdges.find(
      (edge) => edge.itemId.value === child.itemId.value,
    ),
    {
      itemId: child.itemId,
      sourceItemId: saved.itemId,
      sourceRevisionId: saved.revisionId,
      sourceAnchorId: after.anchorId,
    },
  );
  assert.deepEqual(
    family.provenanceEdges.find(
      (edge) => edge.itemId.value === saved.itemId.value,
    ),
    {
      itemId: saved.itemId,
      sourceItemId: origin.itemId,
      sourceRevisionId: origin.revisionId,
      sourceAnchorId: origin.anchorId,
    },
  );
});

test('rejects illegal inventory continuations without creating a draft', async (t) => {
  const { store, scope, origin, add } = await fixture(t);
  await add();
  const provider: MovePolicyProvider = {
    descriptor: {
      instanceId: 'test',
      providerType: 'test',
      displayName: 'Test',
      fingerprint: 'test',
      capabilities: ['best_move'],
      readiness: 'ready',
      status: 'available',
    },
    async chooseMove() {
      throw new Error('Provider must not run.');
    },
  };
  const start = new StartPlayout({
    reader: store,
    writer: store,
    rules,
    policies: { list: () => [provider.descriptor], resolve: () => provider },
    decisions: new ActiveMovePolicyDecisions(),
    clock: { now: () => timestamp },
    events: { publish: () => undefined },
    analysis: store,
  });
  await assert.rejects(
    start.execute({
      scope,
      start: {
        ...origin,
        continuation: [{ kind: 'coordinates', value: 'e2e5' }],
      },
      providerInstanceId: 'test',
      capability: 'best_move',
      opening: { kind: 'provider_move' },
    }),
    { problemCode: 'playout.invalid' },
  );
  assert.equal(await store.readPlayout(scope), undefined);
});

test('rejects a provider result atomically after the inventory assignment is removed', async (t) => {
  const { store, scope, origin, add, remove } = await fixture(t);
  await add();
  const provider: MovePolicyProvider = {
    descriptor: {
      instanceId: 'test',
      providerType: 'test',
      displayName: 'Test',
      fingerprint: 'test',
      capabilities: ['best_move'],
      readiness: 'ready',
      status: 'available',
    },
    async chooseMove(request) {
      await remove();
      return {
        decisionId: request.decisionId,
        move: { from: 'e7', to: 'e5', san: 'e5' },
        providerInstanceId: 'test',
        providerFingerprint: 'test',
        reproducibility: 'deterministic',
      };
    },
  };
  const start = new StartPlayout({
    reader: store,
    writer: store,
    rules,
    policies: { list: () => [provider.descriptor], resolve: () => provider },
    decisions: new ActiveMovePolicyDecisions(),
    clock: { now: () => timestamp },
    events: { publish: () => undefined },
    analysis: store,
  });
  await assert.rejects(
    start.execute({
      scope,
      start: origin,
      providerInstanceId: 'test',
      capability: 'best_move',
      opening: {
        kind: 'user_move',
        move: { kind: 'coordinates', value: 'e2e4' },
      },
    }),
    denied,
  );
  const stored = await store.readPlayout(scope);
  assert.deepEqual(
    stored?.draft.steps.map((step) => step.move.san),
    ['e4'],
  );
  assert.equal(stored?.draft.status.kind, 'awaiting_policy');
});
