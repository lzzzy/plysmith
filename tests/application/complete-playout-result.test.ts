import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CompletePlayout,
  type CompletePlayoutRequest,
  type CompletePlayoutResult,
  type PersistCompletePlayoutRequest,
  type PlayoutWriter,
} from '../../app/application/playout/index.ts';
import { localId } from '../../app/domain/identity/index.ts';
import {
  createPlayoutDraft,
  completePlayoutDraft,
  stopPlayoutDraft,
  type ManualGameResult,
  type PlayoutDraft,
} from '../../app/domain/playout/index.ts';
import { freeWorkScope } from '../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

const active = createPlayoutDraft({
  draftId: localId('playout-draft', 1),
  origin: { kind: 'initial_position' },
  root: new ChessJsRulesAdapter().initialState(),
  playerSide: 'white',
  policy: {
    capability: 'best_move',
    providerInstanceId: 'test',
    providerFingerprint: 'test:v1',
    providerType: 'test-engine',
    providerDisplayName: 'Test engine',
  },
});

function fixture(draft: PlayoutDraft) {
  const writes: PersistCompletePlayoutRequest[] = [];
  let receipt: CompletePlayoutResult | undefined;
  const writer: PlayoutWriter = {
    createPlayout: async () => assert.fail('No new draft'),
    replacePlayout: async () => assert.fail('No changed draft'),
    discardPlayout: async () => assert.fail('No discarded draft'),
    completePlayout: async (request) => {
      writes.push(request);
      return {
        itemId: localId('inventory-item', 1),
        revisionId: localId('item-revision', 1),
        rootAnchorId: localId('anchor', 1),
        dataRevision: 11,
        outcome: request.game.outcome,
        outcomeSource: request.game.outcomeSource,
      };
    },
  };
  return {
    writes,
    useCase: new CompletePlayout({
      reader: {
        readPlayout: async () => ({ draft, dataRevision: 10 }),
        readPlayoutCompletion: async () => receipt,
        readWorkingContextWorkspace: async () => assert.fail('No context read'),
      },
      writer,
      clock: { now: () => '2026-09-27T12:00:00.000Z' },
    }),
    request: {
      scope: freeWorkScope(),
      draftId: draft.draftId,
      expectedDraftRevision: draft.draftRevision,
      completionId: 'save-game',
      displayName: 'Saved game',
      languageTag: 'en-GB',
    } satisfies CompletePlayoutRequest,
    receipt: (value: CompletePlayoutResult) => {
      receipt = value;
    },
  };
}

test('passes each explicit selection and provenance through the application to persistence', async () => {
  for (const manualResult of [
    'white_win',
    'black_win',
    'draw',
    'unfinished',
  ] as const) {
    const f = fixture(stopPlayoutDraft(active));
    const result = await f.useCase.execute({ ...f.request, manualResult });
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0]?.game.outcomeSource, 'manual');
    assert.deepEqual(result.outcome, f.writes[0]?.game.outcome);
    assert.equal(result.outcomeSource, 'manual');
    assert.equal('reason' in result.outcome, false);
  }
});

test('rejects missing, invalid, stale and wrong-draft manual requests before writing', async () => {
  const f = fixture(stopPlayoutDraft(active));
  await assert.rejects(f.useCase.execute(f.request), {
    problemCode: 'playout.invalid',
  });
  await assert.rejects(
    f.useCase.execute({
      ...f.request,
      manualResult: 'agreed_draw' as ManualGameResult,
    }),
    { problemCode: 'playout.invalid' },
  );
  await assert.rejects(
    f.useCase.execute({
      ...f.request,
      manualResult: 'draw',
      expectedDraftRevision: 1,
    }),
    { problemCode: 'playout.revision_conflict' },
  );
  await assert.rejects(
    f.useCase.execute({
      ...f.request,
      manualResult: 'draw',
      draftId: localId('playout-draft', 2),
    }),
    { problemCode: 'playout.not_found' },
  );
  assert.equal(f.writes.length, 0);
});

test('rejects manual overrides of automatic outcomes before writing and returns unchanged automatic results', async () => {
  const f = fixture(
    completePlayoutDraft(active, {
      reason: 'checkmate',
      outcome: { kind: 'win', winner: 'black' },
    }),
  );
  for (const manualResult of [
    'white_win',
    'black_win',
    'draw',
    'unfinished',
  ] as const) {
    await assert.rejects(f.useCase.execute({ ...f.request, manualResult }), {
      problemCode: 'playout.invalid',
    });
  }
  assert.equal(f.writes.length, 0);
  const result = await f.useCase.execute(f.request);
  assert.deepEqual(result.outcome, { kind: 'win', winner: 'black' });
  assert.equal(result.outcomeSource, 'automatic');
  f.receipt(result);
  assert.deepEqual(await f.useCase.execute(f.request), result);
  assert.equal(f.writes.length, 1);
});
