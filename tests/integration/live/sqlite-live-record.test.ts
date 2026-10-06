import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import type { LiveRecordWriter } from '../../../app/application/live/live-models.ts';

const time = '2026-10-05T12:00:00.000Z';
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'plysmith-live-record-'));
  const databasePath = join(directory, 'store.sqlite');
  let store = new SqlitePersistenceAdapter({ databasePath, now: () => time });
  const db = new Database(databasePath);
  t.after(async () => {
    db.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    db,
    get store() {
      return store;
    },
    async reopen() {
      await store.close();
      store = new SqlitePersistenceAdapter({ databasePath, now: () => time });
    },
  };
}
function request(
  role: 'observe' | 'play' = 'observe',
): Parameters<LiveRecordWriter['saveLiveGame']>[0] {
  const rules = new ChessJsRulesAdapter();
  const root = rules.initialState();
  const applied = rules.applyMove(root, [], {
    kind: 'coordinates',
    value: 'e2e4',
  });
  assert.equal(applied.ok, true);
  if (!applied.ok) throw new Error('fixture move');
  return {
    gameId: 'AbCd1234',
    role,
    white: { name: 'Alice' },
    black: { name: 'Bob' },
    root,
    steps: [{ move: applied.value.move, after: applied.value.after }],
    outcome: 'draw',
    displayName: `${role} game`,
    languageTag: 'en-GB',
    occurredAt: time,
  };
}

test('live games save ordinary graph, factual result, search and context with correct provenance', async (t) => {
  const f = fixture(t);
  const context = await f.store.createWorkingContext(
    { displayName: 'Live games' },
    time,
  );
  const observed = await f.store.saveLiveGame({
    ...request(),
    workingContextId: context.context.contextId.value,
  });
  const played = await f.store.saveLiveGame(request('play'));
  assert.equal(played.dataRevision, observed.dataRevision + 1);
  assert.deepEqual(
    f.db
      .prepare(
        'SELECT item_type, origin_kind FROM inventory_item ORDER BY item_id',
      )
      .all(),
    [
      { item_type: 'game', origin_kind: 'live_observed' },
      { item_type: 'game', origin_kind: 'live_played' },
    ],
  );
  assert.deepEqual(
    f.db.prepare('SELECT creator_role FROM item_revision').all(),
    [{ creator_role: 'live' }, { creator_role: 'live' }],
  );
  assert.equal(
    (
      f.db
        .prepare('SELECT count(*) AS n FROM inventory_analysis_revision')
        .get() as { n: number }
    ).n,
    0,
  );
  assert.equal(
    (
      f.db
        .prepare('SELECT count(*) AS n FROM chess_move_node_snapshot')
        .get() as { n: number }
    ).n,
    2,
  );
  assert.equal(
    (
      f.db
        .prepare(
          'SELECT count(*) AS n FROM workspace_context_item WHERE item_id = ?',
        )
        .get(observed.itemId) as { n: number }
    ).n,
    1,
  );
  assert.equal(
    (
      f.db
        .prepare('SELECT count(*) AS n FROM search_document WHERE item_id = ?')
        .get(observed.itemId) as { n: number }
    ).n,
    1,
  );
  assert.match(
    (
      f.db.prepare('SELECT body FROM workspace_contribution LIMIT 1').get() as {
        body: string;
      }
    ).body,
    /Alice - Bob\n1\/2-1\/2\nhttps:\/\/lichess.org\/AbCd1234/,
  );
  assert.deepEqual(
    f.db
      .prepare(
        'SELECT policy_capability, provider_instance_id FROM inventory_game_revision',
      )
      .all(),
    [
      { policy_capability: null, provider_instance_id: null },
      { policy_capability: null, provider_instance_id: null },
    ],
  );
  assert.deepEqual(f.db.pragma('foreign_key_check'), []);
  await f.reopen();
  const items = await f.store.searchInventory({ pageSize: 100 });
  assert.equal(items.items.length, 2);
});

test('failed live save rolls back all graph, notes, search and revision writes', async (t) => {
  const f = fixture(t);
  await f.store.saveLiveGame(request());
  const revision = (await f.store.readStoreStatus()).dataRevision;
  const before = f.db.prepare('SELECT count(*) AS n FROM inventory_item').get();
  await assert.rejects(f.store.saveLiveGame(request()));
  await assert.rejects(
    f.store.saveLiveGame({ ...request('play'), workingContextId: 987 }),
  );
  await assert.rejects(
    f.store.saveLiveGame({ ...request('play'), folderId: 987 }),
  );
  f.db.exec(
    "CREATE TRIGGER fail_live_note BEFORE INSERT ON workspace_contribution BEGIN SELECT RAISE(ABORT, 'test write failure'); END",
  );
  await assert.rejects(f.store.saveLiveGame(request('play')));
  assert.deepEqual(
    f.db.prepare('SELECT count(*) AS n FROM inventory_item').get(),
    before,
  );
  assert.equal((await f.store.readStoreStatus()).dataRevision, revision);
  assert.deepEqual(f.db.pragma('foreign_key_check'), []);
});

test('fair-play guard survives reopening independently of user configuration and inventory revision', async (t) => {
  const f = fixture(t);
  assert.deepEqual(await f.store.readLiveFairPlayGuard(), { blocked: false });
  await f.store.writeLiveFairPlayGuard({ blocked: true, accountId: 'alice' });
  await f.reopen();
  assert.deepEqual(await f.store.readLiveFairPlayGuard(), {
    blocked: true,
    accountId: 'alice',
  });
  assert.equal((await f.store.readStoreStatus()).dataRevision, 0);
  await f.store.writeLiveFairPlayGuard({ blocked: false });
  assert.deepEqual(await f.store.readLiveFairPlayGuard(), { blocked: false });
});
