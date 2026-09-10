import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { SetUiLanguage } from '../../../app/application/preferences/index.ts';
import type {
  PreferencesTransaction,
  UiLanguageChanged,
  UserPreferences,
} from '../../../app/application/preferences/index.ts';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';
import { preferencesStoreContract } from '../../application/preferences-store-contract.ts';

const timestamp = '2026-09-08T10:00:00.000Z';

function storeFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'plysmith-preferences-'));
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

function command(
  store: SqlitePersistenceAdapter,
  events: UiLanguageChanged[] = [],
) {
  return new SetUiLanguage({
    unitOfWork: store,
    clock: { now: () => '2026-09-08T11:00:00.000Z' },
    events: {
      publish: (event) => {
        events.push(event);
      },
    },
  });
}

preferencesStoreContract('SQLite preferences port contract', async (t) =>
  storeFixture(t).open(),
);

test('persists a committed command across reopening even when its response was lost', async (t) => {
  const fixture = storeFixture(t);
  const first = fixture.open();
  await command(first).execute({ uiLocale: 'en-GB', expectedRevision: 1 });
  // Discard the response, then discover the outcome through the authoritative query.
  await first.close();
  const reopened = fixture.open();
  assert.deepEqual(await reopened.readUserPreferences(), {
    uiLocale: 'en-GB',
    preferenceRevision: 2,
    dataRevision: 1,
    updatedAt: '2026-09-08T11:00:00.000Z',
  });
  await assert.rejects(
    command(reopened).execute({ uiLocale: 'en-GB', expectedRevision: 1 }),
    {
      problemCode: 'preference.revision_conflict',
    },
  );
  assert.deepEqual(await reopened.readStoreStatus(), {
    schemaVersion: 1,
    dataRevision: 1,
  });
});

test('a failed second SQL update rolls back the preference and emits nothing', async (t) => {
  const fixture = storeFixture(t);
  const store = fixture.open();
  const inspection = new Database(fixture.databasePath);
  try {
    inspection
      .prepare(
        'UPDATE runtime_store_state SET data_revision = ? WHERE store_state_id = 1',
      )
      .run(Number.MAX_SAFE_INTEGER);
  } finally {
    inspection.close();
  }
  const before = await store.readUserPreferences();
  const events: UiLanguageChanged[] = [];
  await assert.rejects(
    command(store, events).execute({ uiLocale: 'en-GB', expectedRevision: 1 }),
    {
      problemCode: 'persistence.unavailable',
    },
  );
  assert.deepEqual(await store.readUserPreferences(), before);
  assert.deepEqual(events, []);
  await store.close();
  assert.deepEqual(await fixture.open().readUserPreferences(), before);
});

test('queries see the previous committed snapshot while a write is open', async (t) => {
  const store = storeFixture(t).open();
  const before = await store.readUserPreferences();
  let during: Promise<UserPreferences> | undefined;
  await store.run((transaction) => {
    transaction.setUiLanguage('en-GB', timestamp);
    during = store.readUserPreferences();
  });
  assert.deepEqual(await during, before);
  assert.equal((await store.readUserPreferences()).uiLocale, 'en-GB');
});

test('transaction scopes cannot escape, nest or await asynchronous work', async (t) => {
  const store = storeFixture(t).open();
  const before = await store.readUserPreferences();
  let escaped: PreferencesTransaction | undefined;
  await store.run((transaction) => {
    escaped = transaction;
  });
  assert.ok(escaped);
  const endedScope = escaped;
  assert.throws(() => endedScope.getUserPreferences(), /scope has ended/);
  assert.throws(
    () => endedScope.setUiLanguage('en-GB', timestamp),
    /scope has ended/,
  );
  await assert.rejects(
    store.run(() => store.run(() => undefined)),
    {
      problemCode: 'persistence.unavailable',
    },
  );
  await assert.rejects(
    store.run(async (transaction) => {
      transaction.setUiLanguage('en-GB', timestamp);
      await Promise.resolve();
      transaction.setUiLanguage('de-DE', timestamp);
    }),
    { problemCode: 'persistence.unavailable' },
  );
  assert.deepEqual(await store.readUserPreferences(), before);
});

test('close drains accepted commands and rejects new work', async (t) => {
  const fixture = storeFixture(t);
  const store = fixture.open();
  const write = command(store).execute({
    uiLocale: 'en-GB',
    expectedRevision: 1,
  });
  const closing = store.close();
  assert.equal(store.close(), closing);
  await assert.rejects(store.readUserPreferences(), {
    problemCode: 'persistence.closed',
  });
  await assert.rejects(
    store.run(() => undefined),
    { problemCode: 'persistence.closed' },
  );
  await write;
  await closing;
  assert.equal((await fixture.open().readUserPreferences()).uiLocale, 'en-GB');
});

test('migration 1 contains only strict metadata and the constrained preference singleton', async (t) => {
  const fixture = storeFixture(t);
  const store = fixture.open();
  await store.close();
  const database = new Database(fixture.databasePath);
  try {
    const tables = database
      .prepare(
        "SELECT name, strict FROM pragma_table_list WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    assert.deepEqual(tables, [
      { name: 'preference_state', strict: 1 },
      { name: 'runtime_schema_migration', strict: 1 },
      { name: 'runtime_store_state', strict: 1 },
    ]);
    assert.equal(database.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal(
      (
        database
          .prepare(
            'SELECT length(checksum_sha256) AS size FROM runtime_schema_migration',
          )
          .get() as { size: number }
      ).size,
      32,
    );
    assert.throws(() =>
      database
        .prepare("INSERT INTO preference_state VALUES (2, 'de-DE', 1, ?)")
        .run(timestamp),
    );
    assert.throws(() =>
      database
        .prepare("INSERT INTO preference_state VALUES (1, 'de-DE', 1, ?)")
        .run(timestamp),
    );
    for (const uiLocale of ['en-US', '', null]) {
      assert.throws(() =>
        database
          .prepare('UPDATE preference_state SET ui_locale = ?')
          .run(uiLocale),
      );
    }
    for (const revision of [0, -1, 1.5, 'one', Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() =>
        database
          .prepare('UPDATE preference_state SET preference_revision = ?')
          .run(revision),
      );
    }
    assert.throws(() =>
      database.exec('UPDATE runtime_store_state SET data_revision = -1'),
    );
    assert.throws(() =>
      database.exec("UPDATE runtime_store_state SET search_state = 'unknown'"),
    );
    for (const time of [
      'invalid',
      '2026-09-08',
      '2026-09-08T10:00:00Z',
      '2026-09-08T12:00:00.000+02:00',
    ]) {
      assert.throws(() =>
        database
          .prepare('UPDATE preference_state SET updated_at_utc = ?')
          .run(time),
      );
    }
  } finally {
    database.close();
  }
});

test('does not replace or seed an existing corrupt or empty database', async (t) => {
  for (const bytes of [Buffer.from('not a SQLite database'), Buffer.alloc(0)]) {
    const fixture = storeFixture(t);
    writeFileSync(fixture.databasePath, bytes);
    assert.throws(() => fixture.open());
    if (bytes.length > 0)
      assert.deepEqual(readFileSync(fixture.databasePath), bytes);
    else {
      const database = new Database(fixture.databasePath);
      try {
        assert.deepEqual(
          database
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all(),
          [],
        );
      } finally {
        database.close();
      }
    }
  }
});

test('rejects incompatible migration history and a missing singleton without reseeding', async (t) => {
  for (const mutation of [
    'UPDATE runtime_schema_migration SET checksum_sha256 = zeroblob(32)',
    'DELETE FROM preference_state',
    'DELETE FROM runtime_store_state',
    'DELETE FROM runtime_schema_migration',
    'UPDATE runtime_store_state SET schema_version = 2',
  ]) {
    const fixture = storeFixture(t);
    await fixture.open().close();
    const database = new Database(fixture.databasePath);
    database.exec(mutation);
    database.close();
    assert.throws(() => fixture.open(), {
      problemCode: 'persistence.incompatible_store',
    });
  }
});
