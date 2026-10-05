import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import type { SearchInventoryRequest } from '../../../app/application/inventory/index.ts';
import type { ChessTreeCandidate } from '../../../app/domain/inventory/chess-tree-candidate.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { PgnContentFormatAdapter } from '../../../app/infrastructure/adapters/content/pgn/index.ts';
import { migrateStore } from '../../../app/infrastructure/adapters/persistence/sqlite/migrate.ts';
import { createAnalysisRecord } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-analysis-record.ts';
import { publishImport } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-import.ts';
import { searchInventory } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-inventory.ts';
import { changeInventoryOrganization } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-inventory-organization.ts';
import { createWorkingContext } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-workspace.ts';
import {
  encodeCursor,
  incrementDataRevision,
  readDataRevision,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-store-helpers.ts';

const time = '2026-10-04T12:00:00.000Z';
const later = '2026-10-04T13:00:00.000Z';
const rules = new ChessJsRulesAdapter();

function fixture(t: TestContext) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateStore(db, true, time);
  t.after(() => db.close());
  const create = (displayName: string, occurredAt = time) =>
    createAnalysisRecord(db, {
      displayName,
      languageTag: 'en-GB',
      origin: { kind: 'initial_position' },
      root: rules.initialState(),
      steps: [],
      occurredAt,
    });
  const pages = (request: Omit<SearchInventoryRequest, 'cursor'> = {}) => {
    const items = [];
    let cursor: string | undefined;
    do {
      const page = searchInventory(db, {
        pageSize: 2,
        ...request,
        ...(cursor === undefined ? {} : { cursor }),
      });
      items.push(...page.items);
      cursor = page.nextCursor;
      assert.ok(items.length < 100, 'pagination must terminate');
    } while (cursor !== undefined);
    return items;
  };
  return { db, create, pages };
}

test('same-timestamp import batches retain source order across page boundaries', async (t) => {
  const { db, pages } = fixture(t);
  const candidates: ChessTreeCandidate[] = [];
  await new PgnContentFormatAdapter(rules).decode(
    (async function* () {
      yield '[Event "Z"]\n1.e4 *\n\n[Event "A"]\n1.d4 *\n\n[Event "M"]\n1.c4 *';
    })(),
    {
      signal: new AbortController().signal,
      onCandidate: async (candidate) => {
        candidates.push(candidate);
      },
    },
  );
  assert.equal(candidates.length, 3);
  const imported = db
    .transaction(() =>
      publishImport(db, {
        candidates: candidates.map((content, index) => ({
          sourceOrder: content.sourceOrder,
          displayName: ['Zulu', 'Alpha', 'Middle'][index]!,
          itemType: 'analysis',
          content,
        })),
        folder: { kind: 'unfiled' },
        languageTag: 'en-GB',
        occurredAt: time,
      }),
    )
    .immediate();
  const ids = imported.items.map((item) => item.itemId.value);
  assert.ok(ids.every((id, index) => index === 0 || id > ids[index - 1]!));
  for (const pageSize of [1, 2, 3]) {
    const items = pages({ pageSize });
    assert.deepEqual(
      items.map((item) => item.itemId.value),
      ids,
    );
    assert.deepEqual(
      items.map((item) => item.displayName),
      ['Zulu', 'Alpha', 'Middle'],
    );
    assert.ok(items.every((item) => item.createdAt === time));
  }
});

test('creation time precedes the ID tie-breaker and edits or moves never reorder items', (t) => {
  const { db, create, pages } = fixture(t);
  const second = create('Second', later);
  const first = create('First', time);
  const third = create('Third', later);
  const expected = [first.itemId, second.itemId, third.itemId];
  assert.deepEqual(
    pages().map((item) => item.itemId),
    expected,
  );
  const cursor = searchInventory(db, { pageSize: 1 }).nextCursor!;
  // Model the changed projection fields without coupling this query test to revision drafts.
  db.prepare(
    'UPDATE item_revision SET display_name = ? WHERE revision_id = ?',
  ).run('Renamed', first.revisionId.value);
  db.prepare(
    'UPDATE inventory_item SET updated_at_utc = ? WHERE item_id = ?',
  ).run('2026-10-05T12:00:00.000Z', first.itemId.value);
  incrementDataRevision(db, later);
  assert.deepEqual(
    pages().map((item) => item.itemId),
    expected,
  );
  assert.equal(pages()[0]?.displayName, 'Renamed');
  assert.throws(() => searchInventory(db, { pageSize: 1, cursor }), {
    problemCode: 'inventory.invalid_search',
  });
  const folder = changeInventoryOrganization(
    db,
    {
      expectedDataRevision: readDataRevision(db),
      change: { kind: 'create_folder', displayName: 'Destination' },
    },
    later,
  ).folderId!;
  const beforeMove = searchInventory(db, { pageSize: 1 }).nextCursor!;
  changeInventoryOrganization(
    db,
    {
      expectedDataRevision: readDataRevision(db),
      change: {
        kind: 'move_items',
        itemIds: [third.itemId, first.itemId],
        folderId: folder,
      },
    },
    later,
  );
  assert.deepEqual(
    pages({ pageSize: 1 }).map((item) => item.itemId),
    expected,
  );
  assert.deepEqual(pages()[0]?.folderId, folder);
  assert.throws(
    () => searchInventory(db, { pageSize: 1, cursor: beforeMove }),
    { problemCode: 'inventory.invalid_search' },
  );
});

test('context and search pagination stays ascending and rejects malformed, mismatched and stale cursors', (t) => {
  const { db, create, pages } = fixture(t);
  const first = create('Needle Z');
  create('Other');
  const second = create('Needle A', later);
  create('Needle outside', later);
  const third = create('Needle M', later);
  const contextId = createWorkingContext(db, { displayName: 'Context' }, time)
    .context.contextId;
  changeInventoryOrganization(
    db,
    {
      expectedDataRevision: readDataRevision(db),
      change: {
        kind: 'move_items',
        itemIds: [third.itemId, first.itemId, second.itemId],
        contextId,
      },
    },
    later,
  );
  const request = { query: 'Needle', contextId, pageSize: 1 };
  assert.deepEqual(
    pages(request).map((item) => item.itemId),
    [first.itemId, second.itemId, third.itemId],
  );
  assert.deepEqual(
    pages({ contextId }).map((item) => item.itemId),
    [first.itemId, second.itemId, third.itemId],
  );
  assert.equal(pages({ query: 'Needle' }).length, 4);
  const cursor = searchInventory(db, request).nextCursor!;
  const value = JSON.parse(
    Buffer.from(cursor, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  assert.equal(value.createdAt, time);
  assert.equal(value.updatedAt, undefined);
  for (const invalid of [
    'garbage',
    encodeCursor(null),
    encodeCursor({ ...value, version: 2 }),
    encodeCursor({ ...value, createdAt: undefined }),
    encodeCursor({ ...value, createdAt: 7 }),
    encodeCursor({ ...value, itemId: 0 }),
    encodeCursor({ ...value, itemId: 1.5 }),
    encodeCursor({ ...value, dataRevision: -1 }),
  ]) {
    assert.throws(() => searchInventory(db, { ...request, cursor: invalid }), {
      problemCode: 'inventory.invalid_search',
    });
  }
  assert.throws(
    () => searchInventory(db, { ...request, query: 'Other', cursor }),
    { problemCode: 'inventory.invalid_search' },
  );
  assert.throws(
    () => searchInventory(db, { query: 'Needle', pageSize: 1, cursor }),
    { problemCode: 'inventory.invalid_search' },
  );
  create('New entry', later);
  assert.throws(() => searchInventory(db, { ...request, cursor }), {
    problemCode: 'inventory.invalid_search',
  });
});
