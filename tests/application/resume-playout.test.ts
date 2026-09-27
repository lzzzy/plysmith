import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import {
  ActiveMovePolicyDecisions,
  CancelPlayoutCompletion,
  DiscardPlayout,
  MovePolicyProviderError,
  PausePlayout,
  ResumePlayout,
  StopPlayout,
  playoutConflict,
  playoutNotFound,
  type ExpectedPlayoutRequest,
  type MovePolicyProvider,
  type PlayoutChanged,
  type PlayoutReader,
  type PlayoutWriter,
  type StoredPlayout,
} from '../../app/application/playout/index.ts';
import { localId } from '../../app/domain/identity/index.ts';
import { createPlayoutDraft } from '../../app/domain/playout/index.ts';
import { freeWorkScope } from '../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

const timestamp = '2026-09-27T12:00:00.000Z';

function fixture(t: TestContext) {
  const rules = new ChessJsRulesAdapter();
  const scope = freeWorkScope();
  const initial = createPlayoutDraft({
    draftId: localId('playout-draft', 1),
    origin: { kind: 'initial_position' },
    root: rules.initialState(),
    playerSide: 'black',
    policy: {
      capability: 'best_move',
      providerInstanceId: 'engine',
      providerFingerprint: 'engine:v1',
      providerType: 'test-engine',
      providerDisplayName: 'Test engine',
    },
  });
  let stored: StoredPlayout | undefined = { draft: initial, dataRevision: 1 };
  const published: PlayoutChanged[] = [];
  const providerCalls: number[] = [];
  const decisions = new ActiveMovePolicyDecisions();
  const cleanup = Promise.withResolvers<void>();
  let aborted = false;
  const oldDecision = decisions.run(initial.draftId, 1, async (signal) => {
    signal.addEventListener('abort', () => {
      aborted = true;
    });
    await cleanup.promise;
    throw new MovePolicyProviderError('interrupted');
  });
  const oldFinished = assert.rejects(oldDecision, { code: 'interrupted' });
  t.after(async () => {
    cleanup.resolve();
    await oldFinished;
  });
  function requireCurrent(request: ExpectedPlayoutRequest) {
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
  const reader: PlayoutReader = {
    readPlayout: async () => stored,
    readPlayoutCompletion: async () => assert.fail('No completion expected'),
  };
  const writer: PlayoutWriter = {
    createPlayout: async () => assert.fail('No creation expected'),
    completePlayout: async () => assert.fail('No completion expected'),
    replacePlayout: async (request) => {
      const current = requireCurrent({
        ...request,
        draftId: request.draft.draftId,
      });
      stored = { draft: request.draft, dataRevision: current.dataRevision + 1 };
      return stored;
    },
    discardPlayout: async (request) => {
      const current = requireCurrent(request);
      stored = undefined;
      return { dataRevision: current.dataRevision + 1 };
    },
  };
  const provider: MovePolicyProvider = {
    descriptor: {
      instanceId: 'engine',
      fingerprint: 'engine:v1',
      providerType: 'test-engine',
      displayName: 'Test engine',
      capabilities: ['best_move'],
      readiness: 'ready',
      status: 'available',
    },
    chooseMove: async (request) => {
      providerCalls.push(request.decisionId);
      return {
        move: { from: 'e2', to: 'e4', san: 'e4' },
        providerInstanceId: 'engine',
        providerFingerprint: 'engine:v1',
        reproducibility: 'deterministic',
      };
    },
  };
  const dependencies = {
    reader: { ...reader, readWorkingContextWorkspace: async () => undefined },
    writer,
    rules,
    decisions,
    policies: { list: () => [provider.descriptor], resolve: () => provider },
    clock: { now: () => timestamp },
    events: { publish: (event: PlayoutChanged) => published.push(event) },
  };
  return {
    pause: new PausePlayout(dependencies),
    stop: new StopPlayout(dependencies),
    cancel: new CancelPlayoutCompletion(dependencies),
    resume: new ResumePlayout(dependencies),
    discard: new DiscardPlayout(dependencies),
    stored: () => stored,
    aborted: () => aborted,
    providerCalls,
    published,
    releaseCleanup: cleanup.resolve,
    request: (): ExpectedPlayoutRequest => {
      assert.ok(stored);
      return {
        scope,
        draftId: stored.draft.draftId,
        expectedDraftRevision: stored.draft.draftRevision,
      };
    },
  };
}

for (const path of ['stop-cancel', 'pause'] as const) {
  async function prepare(t: TestContext) {
    const f = fixture(t);
    if (path === 'stop-cancel') {
      await f.stop.execute(f.request());
      await f.cancel.execute(f.request());
    } else {
      await f.pause.execute(f.request());
    }
    assert.equal(f.aborted(), true);
    assert.equal(f.stored()?.draft.status.kind, 'paused');
    assert.deepEqual(f.providerCalls, []);
    return f;
  }

  test(`${path}: resume waits for old cleanup before requesting the next policy move`, async (t) => {
    const f = await prepare(t);
    const paused = f.stored();
    let settled = false;
    const resuming = f.resume.execute(f.request()).finally(() => {
      settled = true;
    });
    const outcome = resuming.then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    await setImmediate();
    assert.equal(settled, false, 'Resume must wait for delayed policy cleanup');
    assert.deepEqual(f.stored(), paused);
    assert.deepEqual(f.providerCalls, []);

    f.releaseCleanup();
    const resumed = await outcome;
    if ('error' in resumed) throw resumed.error;
    assert.equal(resumed.result.draft.status.kind, 'active');
    assert.deepEqual(f.providerCalls, [2]);
    assert.equal(resumed.result.draft.steps[0]?.move.san, 'e4');
  });

  for (const newer of ['stopped', 'paused', 'discarded'] as const) {
    test(`${path}: resume preserves a newer ${newer} draft after cleanup`, async (t) => {
      const f = await prepare(t);
      const resuming = f.resume.execute(f.request());
      const outcome = resuming.then(
        () => undefined,
        (error: unknown) => error,
      );
      await setImmediate();
      if (newer === 'discarded') {
        await f.discard.execute(f.request());
      } else {
        await f.stop.execute(f.request());
        if (newer === 'paused') await f.cancel.execute(f.request());
      }
      const latest = f.stored();
      const eventCount = f.published.length;
      f.releaseCleanup();
      const error = await outcome;
      assert.ok(error instanceof Error && 'problemCode' in error);
      assert.equal(
        error.problemCode,
        newer === 'discarded'
          ? 'playout.not_found'
          : 'playout.revision_conflict',
      );
      assert.deepEqual(f.stored(), latest);
      assert.deepEqual(f.providerCalls, []);
      assert.equal(f.published.length, eventCount);
    });
  }
}
