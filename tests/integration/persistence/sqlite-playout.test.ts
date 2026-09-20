import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import Database from 'better-sqlite3';

import { CreateWorkingContext } from '../../../app/application/workspace/index.ts';
import {
  appendUserPlayoutMove,
  pausePlayoutDraft,
  resumePlayoutDraft,
} from '../../../app/domain/playout/index.ts';
import {
  contextWorkScope,
  freeWorkScope,
} from '../../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';

const timestamp = '2026-09-17T10:00:00.000Z';
const rules = new ChessJsRulesAdapter();

function storeFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'plysmith-playout-'));
  const databasePath = join(directory, 'store.sqlite');
  const stores: SqlitePersistenceAdapter[] = [];
  t.after(async () => {
    for (const store of stores) await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    databasePath,
    open() {
      const store = new SqlitePersistenceAdapter({
        databasePath,
        now: () => timestamp,
      });
      stores.push(store);
      return store;
    },
  };
}

test('persists one resumable playout per work scope with revision protection', async (t) => {
  const fixture = storeFixture(t);
  const store = fixture.open();
  const free = freeWorkScope();
  const policy = {
    capability: 'best_move' as const,
    providerInstanceId: 'stockfish-main',
    providerFingerprint: 'stockfish-main:reference',
    providerType: 'stockfish-uci',
    providerDisplayName: 'Stockfish',
  };
  const sourceMove = rules.applyMove(rules.initialState(), [], {
    kind: 'coordinates',
    value: 'e2e4',
  });
  assert.equal(sourceMove.ok, true);
  if (!sourceMove.ok) throw new Error('Expected a legal source move.');
  const created = await store.createPlayout({
    scope: free,
    origin: { kind: 'initial_position' },
    sourcePath: {
      displayName: 'Scandinavisch',
      root: rules.initialState(),
      steps: [sourceMove.value],
    },
    root: sourceMove.value.after,
    playerSide: 'black',
    policy,
    occurredAt: timestamp,
  });
  assert.equal(created.draft.draftRevision, 1);
  await assert.rejects(
    store.createPlayout({
      scope: free,
      origin: { kind: 'initial_position' },
      root: rules.initialState(),
      playerSide: 'white',
      policy,
      occurredAt: timestamp,
    }),
    { problemCode: 'playout.invalid' },
  );

  const move = rules.applyMove(created.draft.root, [], {
    kind: 'coordinates',
    value: 'e7e5',
  });
  assert.equal(move.ok, true);
  if (!move.ok) throw new Error('Expected a legal move.');
  const waiting = appendUserPlayoutMove(created.draft, move.value);
  const replaced = await store.replacePlayout({
    scope: free,
    expectedDraftRevision: 1,
    draft: waiting,
    occurredAt: timestamp,
  });
  assert.equal(replaced.draft.status.kind, 'awaiting_policy');
  await assert.rejects(
    store.replacePlayout({
      scope: free,
      expectedDraftRevision: 1,
      draft: waiting,
      occurredAt: timestamp,
    }),
    { problemCode: 'playout.revision_conflict' },
  );

  const paused = pausePlayoutDraft(replaced.draft);
  await store.replacePlayout({
    scope: free,
    expectedDraftRevision: replaced.draft.draftRevision,
    draft: paused,
    occurredAt: timestamp,
  });
  await store.close();
  const reopened = fixture.open();
  const recovered = await reopened.readPlayout(free);
  assert.equal(recovered?.draft.status.kind, 'paused');
  assert.equal(recovered?.draft.sourcePath?.displayName, 'Scandinavisch');
  assert.deepEqual(
    recovered?.draft.sourcePath?.steps.map((step) => step.move.san),
    ['e4'],
  );
  assert.equal(recovered?.draft.steps[0]?.move.san, 'e5');
  const resumed = resumePlayoutDraft(recovered!.draft);
  assert.deepEqual(resumed.status, {
    kind: 'awaiting_policy',
    decisionId: 2,
  });

  const context = await new CreateWorkingContext({
    writer: reopened,
    clock: { now: () => timestamp },
    events: { publish: () => undefined },
  }).execute({ displayName: 'Partietest' });
  const contextScope = contextWorkScope(context.context.contextId);
  const contextDraft = await reopened.createPlayout({
    scope: contextScope,
    origin: { kind: 'initial_position' },
    root: rules.initialState(),
    playerSide: 'black',
    policy,
    occurredAt: timestamp,
  });
  assert.notEqual(
    (await reopened.readPlayout(contextScope))?.draft.draftId.value,
    recovered?.draft.draftId.value,
  );

  await reopened.discardPlayout({
    scope: free,
    draftId: recovered!.draft.draftId,
    expectedDraftRevision: recovered!.draft.draftRevision,
    occurredAt: timestamp,
  });
  assert.equal(await reopened.readPlayout(free), undefined);

  const fresh = await reopened.createPlayout({
    scope: free,
    origin: { kind: 'initial_position' },
    root: rules.initialState(),
    playerSide: 'white',
    policy,
    occurredAt: timestamp,
  });
  assert.ok(fresh.draft.draftId.value > contextDraft.draft.draftId.value);
  await assert.rejects(
    reopened.replacePlayout({
      scope: free,
      expectedDraftRevision: recovered!.draft.draftRevision,
      draft: recovered!.draft,
      occurredAt: timestamp,
    }),
    { problemCode: 'playout.invalid' },
  );

  const database = new Database(fixture.databasePath, { readonly: true });
  const removedMovePosition = database
    .prepare('SELECT 1 FROM chess_position WHERE board_key = ?')
    .get(recovered!.draft.steps[0]!.after.position.boardKey);
  assert.equal(removedMovePosition, undefined);
  database.close();
});
