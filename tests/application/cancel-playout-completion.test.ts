import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CancelPlayoutCompletion,
  playoutConflict,
  type ExpectedPlayoutRequest,
  type PlayoutChanged,
  type PlayoutReader,
  type PlayoutWriter,
  type StoredPlayout,
} from '../../app/application/playout/index.ts';
import {
  appendPolicyPlayoutMove,
  appendUserPlayoutMove,
  completePlayoutDraft,
  createPlayoutDraft,
  isPlayoutClosureWithoutMoves,
  pausePlayoutDraft,
  stopPlayoutDraft,
  type PlayoutDraft,
} from '../../app/domain/playout/index.ts';
import { localId } from '../../app/domain/identity/index.ts';
import {
  contextWorkScope,
  freeWorkScope,
  type WorkScope,
} from '../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

const rules = new ChessJsRulesAdapter();
const timestamp = '2026-09-27T12:00:00.000Z';

function playedDraft(providerTurn: boolean): PlayoutDraft {
  const draft = createPlayoutDraft({
    draftId: localId('playout-draft', 1),
    origin: {
      kind: 'inventory_anchor',
      itemId: localId('inventory-item', 1),
      revisionId: localId('item-revision', 1),
      anchorId: localId('anchor', 1),
    },
    root: rules.initialState(),
    playerSide: 'white',
    policy: {
      capability: 'best_move',
      providerInstanceId: 'removed-engine',
      providerFingerprint: 'removed-engine:v1',
      providerType: 'test-engine',
      providerDisplayName: 'Removed engine',
    },
  });
  const userMove = rules.applyMove(draft.root, [], {
    kind: 'coordinates',
    value: 'e2e4',
  });
  assert.ok(userMove.ok);
  const waiting = appendUserPlayoutMove(draft, userMove.value);
  if (providerTurn) return waiting;
  const policyMove = rules.applyMove(draft.root, [userMove.value.move], {
    kind: 'coordinates',
    value: 'e7e5',
  });
  assert.ok(policyMove.ok);
  return appendPolicyPlayoutMove(waiting, 1, policyMove.value);
}

function fixture(draft: PlayoutDraft, scope: WorkScope = freeWorkScope()) {
  let stored: StoredPlayout = { draft, dataRevision: 10 };
  let writes = 0;
  let conflictOnWrite = false;
  const published: PlayoutChanged[] = [];
  const reader: PlayoutReader = {
    readPlayout: async (requestedScope) => {
      assert.deepEqual(requestedScope, scope);
      return stored;
    },
    readPlayoutCompletion: async () => assert.fail('No completion read'),
  };
  const writer: PlayoutWriter = {
    createPlayout: async () => assert.fail('No new draft'),
    discardPlayout: async () => assert.fail('No discarded draft'),
    completePlayout: async () => assert.fail('No saved game'),
    replacePlayout: async (request) => {
      if (conflictOnWrite) {
        throw playoutConflict(
          request.expectedDraftRevision,
          draft.draftRevision + 1,
        );
      }
      assert.deepEqual(request.scope, scope);
      assert.equal(request.expectedDraftRevision, stored.draft.draftRevision);
      assert.equal(request.occurredAt, timestamp);
      assert.ok(isPlayoutClosureWithoutMoves(stored.draft, request.draft));
      writes += 1;
      stored = { draft: request.draft, dataRevision: stored.dataRevision + 1 };
      return stored;
    },
  };
  return {
    cancel: new CancelPlayoutCompletion({
      reader,
      writer,
      rules,
      clock: { now: () => timestamp },
      events: { publish: (event) => published.push(event) },
    }),
    request: {
      scope,
      draftId: draft.draftId,
      expectedDraftRevision: draft.draftRevision,
    } satisfies ExpectedPlayoutRequest,
    published,
    stored: () => stored,
    writes: () => writes,
    rejectWrite: () => {
      conflictOnWrite = true;
    },
  };
}

for (const providerTurn of [false, true]) {
  test(`cancels to paused without provider or context access (provider turn: ${providerTurn})`, async () => {
    const stopped = stopPlayoutDraft(playedDraft(providerTurn));
    const scope = contextWorkScope(localId('working-context', 1));
    const f = fixture(stopped, scope);
    const result = await f.cancel.execute(f.request);

    assert.deepEqual(result.draft, {
      ...stopped,
      draftRevision: stopped.draftRevision + 1,
      status: { kind: 'paused' },
    });
    assert.deepEqual(f.stored().draft, result.draft);
    assert.equal(f.writes(), 1);
    assert.equal(result.dataRevision, 11);
    assert.deepEqual(f.published, [
      {
        kind: 'playout.changed',
        occurredAt: timestamp,
        scope,
        draftId: stopped.draftId,
        draftRevision: result.draft.draftRevision,
        dataRevision: result.dataRevision,
      },
    ]);
    await assert.rejects(f.cancel.execute(f.request), {
      problemCode: 'playout.revision_conflict',
    });
    assert.equal(f.writes(), 1);
    assert.equal(f.published.length, 1);
  });
}

test('rejects non-stopped states without changing or publishing the draft', async () => {
  const active = playedDraft(false);
  for (const draft of [
    active,
    playedDraft(true),
    pausePlayoutDraft(active),
    completePlayoutDraft(active, {
      reason: 'threefold_repetition',
      outcome: { kind: 'draw', reason: 'threefold_repetition' },
    }),
  ]) {
    const f = fixture(draft);
    await assert.rejects(f.cancel.execute(f.request), {
      problemCode: 'playout.invalid',
    });
    assert.deepEqual(f.stored().draft, draft);
    assert.equal(f.writes(), 0);
    assert.equal(f.published.length, 0);
  }
});

test('rejects a mismatched draft and a stale revision before writing', async () => {
  const f = fixture(stopPlayoutDraft(playedDraft(false)));
  await assert.rejects(
    f.cancel.execute({
      ...f.request,
      draftId: localId('playout-draft', 2),
    }),
    { problemCode: 'playout.not_found' },
  );
  await assert.rejects(
    f.cancel.execute({
      ...f.request,
      expectedDraftRevision: f.request.expectedDraftRevision - 1,
    }),
    { problemCode: 'playout.revision_conflict' },
  );
  assert.equal(f.writes(), 0);
  assert.equal(f.published.length, 0);
});

test('does not publish cancellation when persistence rejects the revision', async () => {
  const draft = stopPlayoutDraft(playedDraft(true));
  const f = fixture(draft);
  f.rejectWrite();
  await assert.rejects(f.cancel.execute(f.request), {
    problemCode: 'playout.revision_conflict',
  });
  assert.deepEqual(f.stored().draft, draft);
  assert.equal(f.writes(), 0);
  assert.equal(f.published.length, 0);
});
