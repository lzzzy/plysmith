import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import Database from 'better-sqlite3';

import {
  CompletePlayout,
  type CompletePlayoutRequest,
  type PersistCompletePlayoutRequest,
} from '../../../app/application/playout/index.ts';
import { createGameRecordDraft } from '../../../app/domain/inventory/index.ts';
import {
  completePlayoutDraft,
  stopPlayoutDraft,
  type GameOutcome,
  type ManualGameResult,
  type PlayoutDraft,
} from '../../../app/domain/playout/index.ts';
import { freeWorkScope } from '../../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';

const timestamp = '2026-09-27T12:00:00.000Z';
const scope = freeWorkScope();
const rules = new ChessJsRulesAdapter();

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'plysmith-game-results-'));
  const databasePath = join(directory, 'store.sqlite');
  const store = new SqlitePersistenceAdapter({
    databasePath,
    now: () => timestamp,
  });
  t.after(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const complete = new CompletePlayout({
    reader: store,
    writer: store,
    clock: { now: () => timestamp },
  });
  return {
    store,
    complete,
    databasePath,
    async draft(terminal = false) {
      const created = await store.createPlayout({
        scope,
        origin: { kind: 'initial_position' },
        root: rules.initialState(),
        playerSide: 'white',
        policy: {
          capability: 'best_move',
          providerInstanceId: 'test',
          providerFingerprint: 'test:v1',
          providerType: 'test-engine',
          providerDisplayName: 'Test engine',
        },
        occurredAt: timestamp,
      });
      const draft = terminal
        ? completePlayoutDraft(created.draft, {
            reason: 'stalemate',
            outcome: { kind: 'draw', reason: 'stalemate' },
          })
        : stopPlayoutDraft(created.draft);
      return (
        await store.replacePlayout({
          scope,
          expectedDraftRevision: created.draft.draftRevision,
          draft,
          occurredAt: timestamp,
        })
      ).draft;
    },
  };
}

function request(
  draft: PlayoutDraft,
  manualResult?: ManualGameResult,
): CompletePlayoutRequest {
  return {
    scope,
    draftId: draft.draftId,
    expectedDraftRevision: draft.draftRevision,
    completionId: 'complete-game',
    displayName: 'Result game',
    languageTag: 'en-GB',
    ...(manualResult === undefined ? {} : { manualResult }),
  };
}

const manualCases: readonly [ManualGameResult, GameOutcome][] = [
  ['white_win', { kind: 'win', winner: 'white' }],
  ['black_win', { kind: 'win', winner: 'black' }],
  ['draw', { kind: 'draw' }],
  ['unfinished', { kind: 'unfinished' }],
];

for (const [selection, outcome] of manualCases) {
  test(`persists and reads manual ${selection}, including idempotent retries`, async (t) => {
    const f = fixture(t);
    const draft = await f.draft();
    const input = request(draft, selection);
    const result = await f.complete.execute(input);
    assert.deepEqual(result.outcome, outcome);
    assert.equal(result.outcomeSource, 'manual');
    assert.equal(await f.store.readPlayout(scope), undefined);
    const after = await f.store.readStoreStatus();
    assert.deepEqual(await f.complete.execute(input), result);
    const reopened = new SqlitePersistenceAdapter({
      databasePath: f.databasePath,
      now: () => timestamp,
    });
    try {
      assert.deepEqual(await reopened.readPlayoutCompletion(input), result);
    } finally {
      await reopened.close();
    }
    const record = await f.store.readAnalysisRecord({
      itemId: result.itemId,
      revisionId: result.revisionId,
      anchorId: result.rootAnchorId,
    });
    assert.deepEqual(record?.game?.outcome, outcome);
    assert.equal(record?.game?.outcomeSource, 'manual');
    const database = new Database(f.databasePath, { readonly: true });
    try {
      assert.deepEqual(
        database
          .prepare(
            'SELECT result_kind, result_source, result_reason FROM inventory_game_revision',
          )
          .get(),
        {
          result_kind: selection,
          result_source: 'manual',
          result_reason: null,
        },
      );
    } finally {
      database.close();
    }
    await assert.rejects(
      f.complete.execute({
        ...input,
        manualResult: selection === 'draw' ? 'white_win' : 'draw',
      }),
      { problemCode: 'playout.invalid' },
    );
    const { manualResult: omitted, ...withoutSelection } = input;
    assert.equal(omitted, selection);
    await assert.rejects(f.complete.execute(withoutSelection), {
      problemCode: 'playout.invalid',
    });
    assert.deepEqual(await f.store.readStoreStatus(), after);
  });
}

test('rejects stale and missing selections without consuming the draft or changing the store', async (t) => {
  const f = fixture(t);
  const draft = await f.draft();
  const before = await f.store.readStoreStatus();
  await assert.rejects(f.complete.execute(request(draft)), {
    problemCode: 'playout.invalid',
  });
  await assert.rejects(
    f.complete.execute({
      ...request(draft, 'draw'),
      expectedDraftRevision: draft.draftRevision - 1,
    }),
    { problemCode: 'playout.revision_conflict' },
  );
  assert.deepEqual((await f.store.readPlayout(scope))?.draft, draft);
  assert.deepEqual(await f.store.readStoreStatus(), before);
  assert.equal(
    (await f.store.searchInventory({ pageSize: 10 })).items.length,
    0,
  );
});

test('retains automatic draw provenance and rejects all manual overrides including retries', async (t) => {
  const f = fixture(t);
  const draft = await f.draft(true);
  const before = await f.store.readStoreStatus();
  for (const [selection] of manualCases)
    await assert.rejects(f.complete.execute(request(draft, selection)), {
      problemCode: 'playout.invalid',
    });
  assert.deepEqual(await f.store.readStoreStatus(), before);
  const result = await f.complete.execute(request(draft));
  assert.deepEqual(result.outcome, { kind: 'draw', reason: 'stalemate' });
  assert.equal(result.outcomeSource, 'automatic');
  const after = await f.store.readStoreStatus();
  assert.deepEqual(await f.complete.execute(request(draft)), result);
  await assert.rejects(f.complete.execute(request(draft, 'draw')), {
    problemCode: 'playout.invalid',
  });
  assert.deepEqual(await f.store.readStoreStatus(), after);
});

test('persistence rejects forged provenance and outcomes even when invoked without the use case', async (t) => {
  const f = fixture(t);
  const draft = await f.draft(true);
  const game = createGameRecordDraft({
    ...draft,
    displayName: 'Automatic game',
    languageTag: 'en-GB',
    outcome: { kind: 'draw', reason: 'stalemate' },
    outcomeSource: 'automatic',
    provider: {
      providerType: 'test-engine',
      providerDisplayName: 'Test engine',
    },
  });
  const input: PersistCompletePlayoutRequest = {
    ...request(draft),
    game,
    occurredAt: timestamp,
  };
  const before = await f.store.readStoreStatus();
  await assert.rejects(
    f.store.completePlayout({
      ...input,
      game: { ...game, outcomeSource: 'manual', outcome: { kind: 'draw' } },
    }),
    { problemCode: 'playout.invalid' },
  );
  await assert.rejects(
    f.store.completePlayout({
      ...input,
      game: { ...game, outcome: { kind: 'win', winner: 'white' } },
    }),
    { problemCode: 'playout.invalid' },
  );
  assert.deepEqual(await f.store.readStoreStatus(), before);
  assert.deepEqual((await f.store.readPlayout(scope))?.draft, draft);
});

test('rejects a changed automatic result on a direct persistence retry', async (t) => {
  const f = fixture(t);
  const draft = await f.draft(true);
  const game = createGameRecordDraft({
    ...draft,
    displayName: 'Automatic game',
    languageTag: 'en-GB',
    outcome: { kind: 'draw', reason: 'stalemate' },
    outcomeSource: 'automatic',
    provider: {
      providerType: 'test-engine',
      providerDisplayName: 'Test engine',
    },
  });
  const input: PersistCompletePlayoutRequest = {
    ...request(draft),
    game,
    occurredAt: timestamp,
  };
  const saved = await f.store.completePlayout(input);
  const before = await f.store.readStoreStatus();
  assert.deepEqual(await f.store.completePlayout(input), saved);
  await assert.rejects(
    f.store.completePlayout({
      ...input,
      game: { ...game, outcome: { kind: 'win', winner: 'white' } },
    }),
    { problemCode: 'playout.invalid' },
  );
  assert.deepEqual(await f.store.readStoreStatus(), before);
});

test('SQL constraints reject invented manual reasons and incomplete automatic results', async (t) => {
  const f = fixture(t);
  await f.complete.execute(request(await f.draft(), 'draw'));
  const database = new Database(f.databasePath);
  try {
    for (const sql of [
      "UPDATE inventory_game_revision SET result_reason = 'stalemate'",
      "UPDATE inventory_game_revision SET result_source = 'automatic'",
      "UPDATE inventory_game_revision SET result_source = 'automatic', result_kind = 'unfinished'",
      "UPDATE inventory_game_revision SET result_source = 'automatic', result_kind = 'white_win'",
      "UPDATE inventory_game_revision SET result_source = 'automatic', result_kind = 'draw', result_reason = 'checkmate'",
    ])
      assert.throws(() => database.exec(sql), /CHECK constraint failed/);
  } finally {
    database.close();
  }
});
