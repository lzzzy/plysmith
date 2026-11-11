import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import type { PersistAnalysisRecordRequest } from '../../../app/application/analysis/index.ts';
import {
  SearchInventory,
  type InventoryOrganizationChange,
  type SearchInventoryRequest,
} from '../../../app/application/inventory/index.ts';
import {
  localId,
  type InventoryFolderId,
} from '../../../app/domain/identity/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { migrateStore } from '../../../app/infrastructure/adapters/persistence/sqlite/migrate.ts';
import { createAnalysisRecord } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-analysis-record.ts';
import { searchInventory } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-inventory.ts';
import {
  changeInventoryOrganization,
  readInventoryOrganization,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-inventory-organization.ts';
import { createWorkingContext } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-workspace.ts';
import {
  encodeCursor,
  readDataRevision,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-store-helpers.ts';

const time = '2026-11-10T12:00:00.000Z';
const rules = new ChessJsRulesAdapter();

function fixture(t: TestContext) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateStore(db, true, time);
  t.after(() => db.close());
  const change = (change: InventoryOrganizationChange) =>
    changeInventoryOrganization(
      db,
      { change, expectedDataRevision: readDataRevision(db) },
      time,
    );
  const folder = (displayName: string, parentFolderId?: InventoryFolderId) =>
    change({
      kind: 'create_folder',
      displayName,
      ...(parentFolderId === undefined ? {} : { parentFolderId }),
    }).folderId!;
  const item = (
    displayName: string,
    options: Partial<PersistAnalysisRecordRequest> = {},
  ) => {
    if (options.folderId != null && options.targetContextId !== undefined) {
      change({
        kind: 'include_folder',
        folderId: options.folderId,
        contextId: options.targetContextId,
        includeItems: false,
      });
    }
    return createAnalysisRecord(db, {
      displayName,
      languageTag: 'en-GB',
      origin: { kind: 'initial_position' },
      root: rules.initialState(),
      steps: [],
      occurredAt: time,
      ...options,
    });
  };
  const context = (displayName: string) =>
    createWorkingContext(db, { displayName }, time).context.contextId;
  const search = (request: SearchInventoryRequest = {}) =>
    searchInventory(db, { pageSize: 100, ...request });
  const ids = (request: SearchInventoryRequest = {}) =>
    search(request).items.map((row) => row.itemId);
  return { db, change, folder, item, context, search, ids };
}

test('folder loading returns only direct active contents and intersects context, item and literal FTS filters', async (t) => {
  const { db, folder, item, context, ids } = fixture(t);
  const parent = folder('Parent');
  const child = folder('Child', parent);
  const empty = folder('Empty');
  const selected = context('Selected');
  const other = context('Other');
  const direct = item('Needle direct', {
    folderId: parent,
    targetContextId: selected,
  });
  const second = item('Needle other context', {
    folderId: parent,
    targetContextId: other,
  });
  const nested = item('Needle nested', {
    folderId: child,
    targetContextId: selected,
  });
  const unfiled = item('Needle unfiled', { targetContextId: selected });
  const outside = item('Outside');
  assert.deepEqual(
    ids(),
    [direct, second, nested, unfiled, outside].map((entry) => entry.itemId),
  );
  assert.deepEqual(ids({ folderId: parent }), [direct.itemId, second.itemId]);
  assert.deepEqual(ids({ folderId: child }), [nested.itemId]);
  assert.deepEqual(ids({ folderId: empty }), []);
  assert.deepEqual(ids({ folderId: localId('inventory-folder', 999999) }), []);
  assert.deepEqual(ids({ folderId: 'unfiled' }), [
    unfiled.itemId,
    outside.itemId,
  ]);
  assert.deepEqual(
    ids({ folderId: parent, contextId: selected, query: 'Needle' }),
    [direct.itemId],
  );
  assert.deepEqual(ids({ folderId: parent, contextId: other }), [
    second.itemId,
  ]);
  assert.deepEqual(
    ids({ folderId: 'unfiled', contextId: selected, query: 'Needle' }),
    [unfiled.itemId],
  );
  assert.deepEqual(ids({ folderId: 'unfiled', contextId: other }), []);
  assert.deepEqual(ids({ itemId: direct.itemId }), [direct.itemId]);
  assert.deepEqual(
    ids({
      itemId: direct.itemId,
      folderId: parent,
      contextId: selected,
      query: 'Needle',
    }),
    [direct.itemId],
  );
  for (const request of [
    { itemId: direct.itemId, folderId: child },
    { itemId: direct.itemId, folderId: 'unfiled' as const },
    { itemId: direct.itemId, contextId: other },
    { itemId: direct.itemId, query: 'Outside' },
    { itemId: localId('inventory-item', 999999) },
    { folderId: parent, query: 'Needle OR Outside' },
    { folderId: 'unfiled' as const, query: '" OR *' },
  ])
    assert.deepEqual(ids(request), []);
  const application = new SearchInventory({
    searchInventory: async (request) => searchInventory(db, request),
  });
  const found = await application.execute({
    folderId: parent,
    itemId: direct.itemId,
    contextId: selected,
    query: 'Needle',
  });
  assert.deepEqual(
    found.items.map((row) => row.itemId),
    [direct.itemId],
  );
  assert.equal(found.nextCursor, undefined);
});

test('unfiled counts match visible active rows globally and per context, including empty results', (t) => {
  const { db, folder, item, context, ids } = fixture(t);
  const selected = context('Selected');
  const other = context('Other');
  const empty = readInventoryOrganization(db, { contextId: selected });
  assert.equal(empty.unfiledItemCount, 0);
  assert.equal(empty.unfiledContextItemCount, 0);
  const target = folder('Filed');
  const visible = item('Visible', { targetContextId: selected });
  item('Other visible', { targetContextId: other });
  item('Filed visible', { folderId: target, targetContextId: selected });
  for (const lifecycle of ['archived', 'trashed', 'tombstone']) {
    for (const folderId of [null, target]) {
      const hidden = item(
        `${lifecycle} ${folderId === null ? 'unfiled' : 'filed'}`,
        { folderId, targetContextId: selected },
      );
      db.prepare(
        'UPDATE inventory_item SET lifecycle = ? WHERE item_id = ?',
      ).run(lifecycle, hidden.itemId.value);
      assert.deepEqual(ids({ itemId: hidden.itemId }), []);
    }
  }
  const staged = item('Not published', { targetContextId: selected });
  db.prepare(
    'UPDATE inventory_item SET current_revision_id = NULL WHERE item_id = ?',
  ).run(staged.itemId.value);
  assert.deepEqual(ids({ itemId: staged.itemId }), []);
  for (const request of [{}, { contextId: selected }, { contextId: other }]) {
    const organization = readInventoryOrganization(db, request);
    assert.equal(organization.unfiledItemCount, 2);
    assert.equal(
      organization.unfiledContextItemCount,
      'contextId' in request ? 1 : 0,
    );
    assert.equal(
      organization.unfiledItemCount,
      ids({ folderId: 'unfiled' }).length,
    );
    if ('contextId' in request)
      assert.equal(
        organization.unfiledContextItemCount,
        ids({ folderId: 'unfiled', ...request }).length,
      );
    assert.equal(organization.folders[0]?.itemCount, 1);
  }
  assert.deepEqual(ids({ folderId: 'unfiled', contextId: selected }), [
    visible.itemId,
  ]);
});

test('folder pages bind both filters, query, context and revision and reject missing or malformed cursor fields', (t) => {
  const { db, folder, item, context, search } = fixture(t);
  const target = folder('Target');
  const other = folder('Other');
  const selected = context('Selected');
  const otherContext = context('Other context');
  const filed = [
    item('Needle one', { folderId: target, targetContextId: selected }),
    item('Needle two', { folderId: target, targetContextId: selected }),
  ];
  const unfiled = [
    item('Needle three', { targetContextId: selected }),
    item('Needle four', { targetContextId: selected }),
  ];
  for (const folderId of [undefined, target, 'unfiled'] as const) {
    const request = {
      ...(folderId === undefined ? {} : { folderId }),
      contextId: selected,
      query: 'Needle',
      pageSize: 1,
    };
    const first = search(request);
    const cursor = first.nextCursor!;
    assert.ok(cursor);
    const collected = [...first.items];
    let next: string | undefined = first.nextCursor;
    while (next !== undefined) {
      const page = search({ ...request, cursor: next });
      collected.push(...page.items);
      next = page.nextCursor;
      assert.ok(collected.length <= 4);
    }
    assert.deepEqual(
      collected.map((row) => row.itemId),
      (folderId === undefined
        ? [...filed, ...unfiled]
        : folderId === 'unfiled'
          ? unfiled
          : filed
      ).map((row) => row.itemId),
    );
    for (const filters of [
      { folderId: other },
      { folderId: folderId === 'unfiled' ? target : ('unfiled' as const) },
      { itemId: first.items[0]!.itemId },
      { contextId: otherContext },
      { query: 'Other' },
    ])
      assert.throws(() => search({ ...request, ...filters, cursor }), {
        problemCode: 'inventory.invalid_search',
      });
    if (folderId !== undefined)
      assert.throws(
        () => search({ query: 'Needle', contextId: selected, cursor }),
        { problemCode: 'inventory.invalid_search' },
      );
    const value = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    for (const fields of [
      { folderId: undefined },
      { folderId: 0 },
      { folderId: -1 },
      { folderId: 1.5 },
      { folderId: '1' },
      { filteredItemId: undefined },
      { filteredItemId: 0 },
      { filteredItemId: -1 },
      { filteredItemId: 1.5 },
      { filteredItemId: '1' },
      { filteredItemId: filed[0]!.itemId.value },
    ])
      assert.throws(
        () =>
          search({ ...request, cursor: encodeCursor({ ...value, ...fields }) }),
        { problemCode: 'inventory.invalid_search' },
      );
    // A syntactically valid cursor with an item filter must not be reused without that filter.
    const itemCursor = encodeCursor({
      ...value,
      filteredItemId: filed[0]!.itemId.value,
    });
    assert.throws(() => search({ ...request, cursor: itemCursor }), {
      problemCode: 'inventory.invalid_search',
    });
    assert.throws(
      () =>
        search({ ...request, itemId: filed[1]!.itemId, cursor: itemCursor }),
      { problemCode: 'inventory.invalid_search' },
    );
  }
  const request = {
    folderId: target,
    contextId: selected,
    query: 'Needle',
    pageSize: 1,
  };
  const cursor = search(request).nextCursor!;
  item('Revision change');
  assert.throws(() => search({ ...request, cursor }), {
    problemCode: 'inventory.invalid_search',
  });
  assert.equal(
    readInventoryOrganization(db, {}).dataRevision,
    search().dataRevision,
  );
});

test('selected rows retain necessary provenance ancestors outside the requested folder and context', (t) => {
  const { folder, item, context, search } = fixture(t);
  const sourceFolder = folder('Sources');
  const target = folder('Selected');
  const selected = context('Selected context');
  const source = item('Source', { folderId: sourceFolder });
  const child = item('Child', {
    folderId: target,
    targetContextId: selected,
    origin: {
      kind: 'inventory_anchor',
      itemId: source.itemId,
      revisionId: source.revisionId,
      anchorId: source.rootAnchorId,
    },
  });
  const result = search({
    folderId: target,
    itemId: child.itemId,
    contextId: selected,
  });
  assert.deepEqual(
    result.items.map((row) => row.itemId),
    [child.itemId],
  );
  assert.deepEqual(
    result.ancestors.map((row) => row.itemId),
    [source.itemId],
  );
  assert.deepEqual(
    result.provenanceEdges.map((edge) => edge.sourceItemId),
    [source.itemId],
  );
  assert.equal(result.nextCursor, undefined);
});
