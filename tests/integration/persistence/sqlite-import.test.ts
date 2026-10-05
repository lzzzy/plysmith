import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { PgnContentFormatAdapter } from '../../../app/infrastructure/adapters/content/pgn/index.ts';
import type { ChessTreeCandidate } from '../../../app/domain/inventory/chess-tree-candidate.ts';
import type { ImportRepository } from '../../../app/application/inventory/import-ports.ts';
import { localId } from '../../../app/domain/identity/index.ts';

const time = '2026-10-02T12:00:00.000Z';
const scope = { kind: 'free' } as const;
const pgn =
  '[Event "Study"]\n{Root note} 1.e4 {Move note} (1.d4 d5 (1...Nf6)) e5 *';

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'plysmith-import-'));
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
async function parsed(text = pgn): Promise<ChessTreeCandidate[]> {
  const candidates: ChessTreeCandidate[] = [];
  await new PgnContentFormatAdapter(new ChessJsRulesAdapter()).decode(
    (async function* () {
      yield text;
    })(),
    {
      signal: new AbortController().signal,
      onCandidate: async (candidate) => {
        candidates.push(candidate);
      },
    },
  );
  return candidates;
}
async function request(
  displayName = 'italian-game.pgn - Study',
): Promise<Parameters<ImportRepository['publishImport']>[0]> {
  const content = (await parsed())[0]!;
  return {
    candidates: [
      {
        sourceOrder: content.sourceOrder,
        displayName,
        itemType: 'analysis',
        content,
      },
    ],
    folder: { kind: 'unfiled' },
    languageTag: 'en-GB',
    occurredAt: time,
  };
}
function counts(db: Database.Database) {
  return Object.fromEntries(
    [
      'inventory_item',
      'item_revision',
      'inventory_folder',
      'workspace_contribution',
      'chess_occurrence_identity',
      'chess_occurrence_snapshot',
      'chess_move_node_snapshot',
      'search_document',
      'workspace_context_item',
      'workspace_context_reference',
    ].map((table) => [
      table,
      db.prepare(`SELECT count(*) AS n FROM ${table}`).get(),
    ]),
  );
}

test('schema stores only native records and no import operation, history, staging or receipt', async (t) => {
  const f = fixture(t);
  assert.deepEqual(
    f.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name LIKE 'import_%' OR name LIKE 'inventory_import%'",
      )
      .all(),
    [],
  );
  assert.equal(
    (
      f.db.prepare('PRAGMA table_info(item_revision)').all() as {
        name: string;
      }[]
    ).some((c) => c.name.includes('import')),
    false,
  );
  await f.store.publishImport(await request());
  await f.reopen();
  assert.deepEqual(
    f.db
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'import_%'")
      .all(),
    [],
  );
});

test('native analysis tree, FEN and editable notes survive restart and retain final name search projection', async (t) => {
  const f = fixture(t);
  const published = await f.store.publishImport({
    ...(await request()),
    folder: { kind: 'new', displayName: 'italian-game.pgn' },
  });
  const item = published.items[0]!;
  const record = (await f.store.readAnalysisRevision({ scope, ...item }))!;
  assert.equal(record.tree!.nodes.length, 5);
  const root = record.contributions.find(
    (note) => note.anchorId.value === record.rootAnchorId.value,
  )!;
  assert.match(root.body, /Root note/);
  assert.match(root.body, /Study/);
  assert.equal(
    new Set(record.contributions.map((note) => note.anchorId.value)).size,
    record.contributions.length,
  );
  assert.deepEqual(root.anchorId, record.rootAnchorId);
  assert.equal(
    f.db
      .prepare('SELECT title FROM search_document WHERE contribution_id = ?')
      .get(root.contributionId.value) instanceof Object,
    true,
  );
  assert.deepEqual(
    f.db
      .prepare('SELECT title FROM search_document WHERE contribution_id = ?')
      .get(root.contributionId.value),
    { title: 'italian-game.pgn - Study' },
  );
  await f.store.updateAnalysisNote({
    scope,
    contributionId: root.contributionId,
    expectedContributionVersion: 1,
    body: 'Edited note',
    occurredAt: time,
  });
  const move = record.contributions.find((note) => note.body === 'Move note')!;
  await f.store.deleteAnalysisNote({
    scope,
    contributionId: move.contributionId,
    expectedContributionVersion: 1,
    occurredAt: time,
  });
  await f.reopen();
  const reopened = (await f.store.readAnalysisRevision({ scope, ...item }))!;
  assert.deepEqual(reopened.tree, record.tree);
  assert.equal(
    reopened.contributions.find(
      (note) => note.contributionId.value === root.contributionId.value,
    )?.body,
    'Edited note',
  );
  assert.equal(
    reopened.contributions.some(
      (note) => note.contributionId.value === move.contributionId.value,
    ),
    false,
  );
  assert.deepEqual(
    f.db
      .prepare(
        'SELECT folder_id AS folder FROM inventory_item WHERE item_id = ?',
      )
      .get(item.itemId.value),
    { folder: published.folderId!.value },
  );
});

test('a later invalid candidate rolls back the new folder, earlier graph, notes, search and revision', async (t) => {
  const f = fixture(t);
  const first = await request();
  const candidate = first.candidates[0]!;
  const before = counts(f.db);
  const revision = (await f.store.readStoreStatus()).dataRevision;
  const content = {
    ...candidate.content,
    sourceOrder: 1,
    nodes: [{ ...candidate.content.nodes[0]!, nodeIndex: 99 }],
  };
  await assert.rejects(
    f.store.publishImport({
      ...first,
      folder: { kind: 'new', displayName: 'Rollback' },
      candidates: [
        ...first.candidates,
        { ...candidate, sourceOrder: 1, displayName: 'Second', content },
      ],
    }),
    { problemCode: 'import.invalid_candidate' },
  );
  assert.deepEqual(counts(f.db), before);
  assert.equal((await f.store.readStoreStatus()).dataRevision, revision);
});

test('stale names and Unicode/case/intrabatch collisions are checked against both native item types at commit', async (t) => {
  const f = fixture(t);
  const check = { candidates: [{ sourceOrder: 0, displayName: 'Study' }] };
  assert.equal(
    (await f.store.checkImportNames(check)).candidates[0]!.available,
    true,
  );
  const first = await request('Study');
  await f.store.publishImport({
    ...first,
    candidates: [{ ...first.candidates[0]!, itemType: 'game' }],
  });
  const current = await f.store.checkImportNames({
    candidates: [
      { sourceOrder: 0, displayName: 'ＳＴＵＤＹ' },
      { sourceOrder: 1, displayName: 'Study (2)' },
      { sourceOrder: 2, displayName: 'Fresh' },
      { sourceOrder: 3, displayName: 'fresh' },
    ],
  });
  assert.deepEqual(
    current.candidates.map((c) => c.available),
    [false, true, true, false],
  );
  assert.equal(current.candidates[0]!.suggestedDisplayName, 'ＳＴＵＤＹ (3)');
  assert.equal(current.candidates[3]!.suggestedDisplayName, 'fresh (2)');
  const before = counts(f.db);
  await assert.rejects(f.store.publishImport(first), {
    problemCode: 'import.name_conflict',
  });
  assert.deepEqual(counts(f.db), before);
});

for (const [label, displayName] of [
  ['long prefix and title', 'a'.repeat(156) + 'XYZ'],
  ['Unicode surrogate pair', 'a'.repeat(155) + '\u{1F600}' + 'xyz'],
] as const) {
  test(`name suggestions preserve the complete ${label} even beyond the publication limit`, async (t) => {
    const f = fixture(t);
    const input = await request(displayName);
    await f.store.publishImport(input);

    const checks = await f.store.checkImportNames({
      candidates: [
        { sourceOrder: 0, displayName },
        { sourceOrder: 1, displayName },
      ],
    });
    assert.deepEqual(
      checks.candidates.map((candidate) => candidate.available),
      [false, false],
    );
    assert.deepEqual(
      checks.candidates.map((candidate) => candidate.suggestedDisplayName),
      [displayName + ' (2)', displayName + ' (3)'],
    );
    for (const candidate of checks.candidates) {
      assert(candidate.suggestedDisplayName.length > 160);
      assert(candidate.suggestedDisplayName.isWellFormed());
    }

    const before = counts(f.db);
    await assert.rejects(
      f.store.publishImport({
        ...input,
        candidates: [
          {
            ...input.candidates[0]!,
            displayName: checks.candidates[0]!.suggestedDisplayName,
          },
        ],
      }),
      { problemCode: 'import.invalid_selection' },
    );
    assert.deepEqual(counts(f.db), before);
  });
}

test('ordinary inventory name availability reserves analysis and game names globally', async (t) => {
  const f = fixture(t);
  for (const itemType of ['analysis', 'game'] as const) {
    const displayName = `${itemType} Study`;
    const input = await request(displayName);
    const published = await f.store.publishImport({
      ...input,
      candidates: [{ ...input.candidates[0]!, itemType }],
    });
    const blocked = await f.store.checkInventoryNameAvailability({
      displayName: `  ${itemType.toUpperCase()} \uFF33\uFF34\uFF35\uFF24\uFF39  `,
    });
    assert.equal(blocked.available, false, itemType);
    const ownName = await f.store.checkInventoryNameAvailability({
      displayName,
      excludingItemId: published.items[0]!.itemId,
    });
    assert.equal(ownName.available, true, itemType);
  }
});

test('folder destinations validate atomically and never write context membership or links', async (t) => {
  const f = fixture(t);
  const context = await f.store.createWorkingContext(
    { displayName: 'Context' },
    time,
  );
  const before = counts(f.db);
  await assert.rejects(
    f.store.publishImport({
      ...(await request()),
      folder: { kind: 'existing', folderId: localId('inventory-folder', 9999) },
    }),
  );
  assert.deepEqual(counts(f.db), before);
  const parent = await f.store.publishImport({
    ...(await request('One')),
    folder: { kind: 'new', displayName: 'Parent' },
  });
  const child = await f.store.publishImport({
    ...(await request('Two')),
    folder: {
      kind: 'new',
      displayName: 'Child',
      parentFolderId: parent.folderId!,
    },
  });
  await f.store.publishImport({
    ...(await request('Three')),
    folder: { kind: 'existing', folderId: child.folderId! },
  });
  const complete = counts(f.db);
  await assert.rejects(
    f.store.publishImport({
      ...(await request('Four')),
      folder: {
        kind: 'new',
        displayName: 'Child',
        parentFolderId: parent.folderId!,
      },
    }),
  );
  assert.deepEqual(counts(f.db), complete);
  assert.deepEqual(
    (
      await f.store.readInventoryOrganization({
        contextId: context.context.contextId,
      })
    ).linkedFolderIds,
    [],
  );
  assert.deepEqual(
    f.db.prepare('SELECT * FROM workspace_context_item').all(),
    [],
  );
  assert.deepEqual(
    f.db.prepare('SELECT * FROM workspace_context_reference').all(),
    [],
  );
});

test('explicit game imports preserve setup and result comments without inventing engine results', async (t) => {
  const f = fixture(t);
  const valid = (
    await parsed(
      '[Event "Endgame"]\n[SetUp "1"]\n[FEN "8/8/8/8/8/4k3/8/4K2R w - - 0 1"]\n{Endgame note} 1.Rh3+ 1/2-1/2',
    )
  )[0]!;
  assert.equal(valid.status, 'ready');
  const published = await f.store.publishImport({
    candidates: [
      {
        sourceOrder: 0,
        displayName: 'Endgame',
        itemType: 'game',
        content: valid,
      },
    ],
    folder: { kind: 'unfiled' },
    languageTag: 'en-GB',
    occurredAt: time,
  });
  const item = published.items[0]!;
  assert.deepEqual(
    f.db
      .prepare('SELECT item_type FROM inventory_item WHERE item_id = ?')
      .get(item.itemId.value),
    { item_type: 'game' },
  );
  assert.equal(
    f.db
      .prepare(
        'SELECT * FROM inventory_analysis_revision WHERE revision_id = ?',
      )
      .get(item.revisionId.value),
    undefined,
  );
  const record = (await f.store.readAnalysisRevision({ scope, ...item }))!;
  assert.equal(record.root.fen, valid.root!.fen);
  assert(record.contributions.some((note) => note.body.includes('1/2-1/2')));
});
