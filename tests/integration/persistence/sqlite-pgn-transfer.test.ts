import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-persistence-adapter.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { ApplicationProblem } from '../../../app/application/problems/application-problem.ts';
import type {
  InventoryTransferSnapshot,
  PreparedInventoryRestore,
  TransferChessRecord,
} from '../../../app/application/inventory/pgn-transfer-models.ts';
import { PgnInventoryTransferCodec } from '../../../app/infrastructure/adapters/content/pgn/index.ts';
import { inheritedSourcePathSnapshot } from '../../fixtures/pgn-transfer-source-path.ts';
import { CompletePlayout } from '../../../app/application/playout/index.ts';
import { stopPlayoutDraft } from '../../../app/domain/playout/index.ts';
import { freeWorkScope } from '../../../app/domain/workspace/index.ts';

const time = '2026-10-12T12:00:00.000Z';
const rules = new ChessJsRulesAdapter();
const check = () => undefined;

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'plysmith-transfer-'));
  const databasePath = join(directory, 'store.sqlite');
  let store = new SqlitePersistenceAdapter({
    databasePath,
    now: () => time,
    chessRules: rules,
  });
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
      store = new SqlitePersistenceAdapter({
        databasePath,
        now: () => time,
        chessRules: rules,
      });
    },
  };
}

function tree(
  branches = true,
  root = rules.initialState(),
): TransferChessRecord {
  const nodes: TransferChessRecord['nodes'][number][] = [];
  const steps: (readonly [number | null, number, string])[] = [
    [null, 0, 'e2e4'],
    [0, 0, 'e7e5'],
  ];
  if (branches) steps.push([null, 1, 'd2d4'], [2, 0, 'd7d5']);
  for (const [parent, sibling, value] of steps) {
    const applied = rules.applyMove(
      parent === null ? root : nodes[parent]!.after,
      [],
      { kind: 'coordinates', value },
    );
    assert(applied.ok);
    nodes.push({
      nodeIndex: nodes.length,
      parentNodeIndex: parent,
      siblingOrder: sibling,
      move: applied.value.move,
      after: applied.value.after,
      comments: [],
      startingComments: [],
    });
  }
  return { root, nodes, result: '*' };
}

async function seed(
  f: ReturnType<typeof fixture>,
  name = 'Tree',
  record = tree(),
  itemType: 'analysis' | 'game' = 'analysis',
) {
  return (
    await f.store.publishImport({
      languageTag: 'de-DE',
      occurredAt: time,
      folder: { kind: 'unfiled' },
      candidates: [
        {
          sourceOrder: 0,
          displayName: name,
          itemType,
          content: {
            ...record,
            sourceOrder: 0,
            suggestedName: name,
            status: 'ready',
            initialComments: ['Root note', 'Second note'],
            findings: [],
          },
        },
      ],
    })
  ).items[0]!;
}

function prepared(
  snapshot: InventoryTransferSnapshot,
): PreparedInventoryRestore {
  return {
    manifest: { ...snapshot.manifest, pgnSha256: '0'.repeat(64) },
    records: snapshot.records,
  };
}

async function roundtrip(t: TestContext, source: ReturnType<typeof fixture>) {
  const snapshot = await source.store.readPgnTransferSnapshot(check);
  const target = fixture(t);
  const result = await target.store.restorePgnTransfer(
    prepared(snapshot),
    time,
    check,
  );
  assert.equal(result.noOp, false);
  assert.equal(result.dataRevision, 1);
  const restored = await target.store.readPgnTransferSnapshot(check);
  assert.deepEqual(restored.manifest, snapshot.manifest);
  assert.deepEqual(restored.records, snapshot.records);
  await target.reopen();
  assert.deepEqual(
    (await target.store.readPgnTransferSnapshot(check)).manifest,
    snapshot.manifest,
  );
  assert.deepEqual(target.db.pragma('foreign_key_check'), []);
  target.db
    .prepare(
      "INSERT INTO search_document_fts(search_document_fts, rank) VALUES ('integrity-check', 1)",
    )
    .run();
  return { target, snapshot };
}

test('fresh startup reads and preferences permit carrier no-op; empty nested folders restore', async (t) => {
  const source = fixture(t),
    target = fixture(t);
  await target.store.readStartupResume();
  await target.store.readWorkScopeWorkspace({ kind: 'free' });
  await target.store.readFreeAnalysisWorkspace();
  assert.equal(
    (await target.store.inspectFreshRestoreTarget()).canRestore,
    true,
  );
  const empty = prepared(await source.store.readPgnTransferSnapshot(check));
  const before = await target.store.readUserPreferences();
  assert.deepEqual(await target.store.restorePgnTransfer(empty, time, check), {
    dataRevision: 0,
    noOp: true,
  });
  assert.deepEqual(await target.store.restorePgnTransfer(empty, time, check), {
    dataRevision: 0,
    noOp: true,
  });
  assert.deepEqual(await target.store.readUserPreferences(), before);
  source.db.exec(
    "INSERT INTO inventory_folder(folder_id, display_name, name_key) VALUES (19, 'Empty', 'empty'); INSERT INTO inventory_folder(parent_folder_id, display_name, name_key) VALUES (19, 'Nested', 'nested')",
  );
  await roundtrip(t, source);
});

test('complete variant tree, root-only game, long names, exact notes, paths, search and navigation survive restart', async (t) => {
  const source = fixture(t);
  const longName = await seed(source, 'Long name');
  source.db
    .prepare('UPDATE item_revision SET display_name = ? WHERE revision_id = ?')
    .run('A'.repeat(200), longName.revisionId.value);
  await seed(
    source,
    'Root-only game',
    { root: rules.initialState(), nodes: [], result: '*' },
    'game',
  );
  source.db
    .exec(`UPDATE workspace_contribution SET body = 'Identical text', rationale = 'Exact rationale', contribution_version = 7;
    UPDATE workspace_contribution SET updated_at_utc = '2026-10-12T13:00:00.000Z' WHERE contribution_id = 1;
    INSERT INTO workspace_analysis_note_path_step VALUES (1, 0, 'g1', 'f3', NULL, 'Nf3');
    UPDATE chess_move_node_snapshot SET sibling_order = 8 WHERE sibling_order = 1;`);
  const { target, snapshot } = await roundtrip(t, source);
  assert.equal(snapshot.manifest.items.length, 2);
  assert.equal(snapshot.records[0]!.nodes.length, 4);
  assert.deepEqual(
    snapshot.manifest.contributions.map((n) => n.version),
    [7, 7, 7, 7],
  );
  const counts = target.db
    .prepare(
      "SELECT (SELECT count(*) FROM chess_occurrence_identity) AS occurrences, (SELECT count(*) FROM chess_anchor WHERE anchor_kind = 'occurrence') AS anchors",
    )
    .get();
  assert.deepEqual(counts, { occurrences: 6, anchors: 6 });
  assert.equal(
    (await target.store.searchInventory({ query: 'Root-only', pageSize: 100 }))
      .items.length,
    1,
  );
  const items = (await target.store.searchInventory({ pageSize: 100 })).items;
  assert.equal(items[0]!.displayName, 'A'.repeat(200));
  const view = await target.store.readAnalysisRevision({
    scope: { kind: 'free' },
    itemId: items[0]!.itemId,
    revisionId: items[0]!.currentRevisionId,
  });
  assert.equal(view?.tree?.nodes.length, 4);
});

async function provenanceFixture(t: TestContext, inactive = false) {
  const source = fixture(t);
  const sourceItem = await seed(source, 'Source', tree(false));
  const revision = sourceItem.revisionId.value,
    item = sourceItem.itemId.value;
  source.db
    .prepare(
      `INSERT INTO item_revision(item_id, revision_number, base_revision_id, display_name, summary_text, language_tag, content_fingerprint, creator_role, created_at_utc, revision_change_kind)
    SELECT item_id, 9, revision_id, 'Current source', summary_text, language_tag, content_fingerprint, creator_role, created_at_utc, 'metadata' FROM item_revision WHERE revision_id = ?`,
    )
    .run(revision);
  const current = (
    source.db
      .prepare('SELECT max(revision_id) AS id FROM item_revision')
      .get() as { id: number }
  ).id;
  source.db
    .prepare(
      'INSERT INTO chess_occurrence_snapshot SELECT ?, occurrence_id, item_id, position_id, is_root, content_fingerprint FROM chess_occurrence_snapshot WHERE revision_id = ?',
    )
    .run(current, revision);
  source.db
    .prepare(
      "INSERT INTO chess_play_state_snapshot SELECT ?, occurrence_id, halfmove_clock, fullmove_number, 'partial' FROM chess_play_state_snapshot WHERE revision_id = ?",
    )
    .run(current, revision);
  source.db
    .prepare(
      'INSERT INTO chess_move_node_snapshot SELECT ?, move_node_id, item_id, parent_occurrence_id, child_occurrence_id, sibling_order, is_main_line, from_square, to_square, promotion, san, content_fingerprint FROM chess_move_node_snapshot WHERE revision_id = ?',
    )
    .run(current, revision);
  source.db
    .prepare(
      'INSERT INTO inventory_analysis_revision SELECT ?, item_id, root_occurrence_id, origin_mode FROM inventory_analysis_revision WHERE revision_id = ?',
    )
    .run(current, revision);
  source.db
    .prepare(
      'UPDATE inventory_item SET current_revision_id = ? WHERE item_id = ?',
    )
    .run(current, item);
  const derived = await seed(source, 'Derived', {
    root: tree(false).nodes[0]!.after,
    nodes: [],
    result: '*',
  });
  const anchor = (
    source.db
      .prepare(
        "SELECT a.anchor_id AS id FROM chess_anchor a JOIN chess_move_node_snapshot m ON m.child_occurrence_id = a.occurrence_id WHERE m.revision_id = ? AND m.from_square = 'e2'",
      )
      .get(revision) as { id: number }
  ).id;
  source.db
    .prepare(
      "UPDATE inventory_analysis_revision SET origin_mode = 'inventory_anchor' WHERE revision_id = ?",
    )
    .run(derived.revisionId.value);
  source.db
    .prepare('INSERT INTO inventory_analysis_origin VALUES (?, ?, ?, ?)')
    .run(derived.revisionId.value, item, revision, anchor);
  if (inactive) {
    source.db
      .prepare(
        "UPDATE inventory_item SET lifecycle = 'tombstone', current_revision_id = NULL WHERE item_id = ?",
      )
      .run(item);
    source.db.exec(
      "UPDATE workspace_contribution SET status = 'archived' WHERE contribution_id <= 2",
    );
  }
  return source;
}

test('explicit older provenance retains shared identities and per-revision knowledge, not all history', async (t) => {
  const source = await provenanceFixture(t);
  const { target, snapshot } = await roundtrip(t, source);
  assert.equal(snapshot.manifest.records.length, 3);
  const current = snapshot.manifest.records[0]!,
    old = snapshot.manifest.records[2]!;
  assert.equal(current.nodes[0]![0], old.nodes[0]![0]);
  assert.equal(current.nodes[0]![2], 'partial');
  assert.equal(old.nodes[0]![2], 'complete');
  assert.deepEqual(
    target.db
      .prepare('SELECT count(*) AS n FROM chess_occurrence_identity')
      .get(),
    { n: 4 },
  );
});

test('deleted source contributes only the explicitly required old revision and stays invisible', async (t) => {
  const source = await provenanceFixture(t, true);
  const { target, snapshot } = await roundtrip(t, source);
  assert.equal(snapshot.manifest.records.length, 2);
  const historical = snapshot.manifest.items.find(
    (i) => i.role === 'provenanceOnly',
  )!;
  assert.equal(historical.lifecycle, 'tombstone');
  assert.equal(historical.currentRevision, null);
  assert.equal(
    snapshot.manifest.records.find((r) => r.id === historical.retainedRevision)
      ?.revisionNumber,
    1,
  );
  assert.equal(snapshot.manifest.contributions.length, 2);
  assert.equal(
    (await target.store.searchInventory({ pageSize: 100 })).items.length,
    1,
  );
});

test('game facts and independent source-path knowledge are restored without playout defaults', async (t) => {
  const source = fixture(t);
  const game = await seed(
    source,
    'Game',
    { root: tree(false).nodes[1]!.after, nodes: [], result: '*' },
    'game',
  );
  const snapshot = await source.store.readPgnTransferSnapshot(check);
  const record = snapshot.manifest.records[0]!;
  const value: PreparedInventoryRestore = {
    manifest: {
      ...snapshot.manifest,
      pgnSha256: '0'.repeat(64),
      records: [
        {
          ...record,
          game: {
            playerSide: 'black',
            result: { kind: 'draw', source: 'manual', reason: null },
            policy: {
              capability: 'human_profile',
              providerInstanceId: 'historical-provider',
              providerFingerprint: 'historical-fingerprint',
              providerType: 'maia_chess',
              providerDisplayName: 'Historical Maia',
              profile: {
                modelName: '1500',
                selectionMode: 'sampled',
                historyMode: 'known_position_history',
                reproducibility: 'stochastic',
              },
            },
          },
          sourcePath: {
            title: 'Source path',
            rootFen: rules.initialState().fen,
            moves: [
              { from: 'e2', to: 'e4', promotion: null },
              { from: 'e7', to: 'e5', promotion: null },
            ],
            historyKnowledge: {
              root: 'unknown',
              before: ['partial', 'unknown'],
              after: ['complete', 'partial'],
            },
          },
        },
      ],
    },
    records: [{ ...snapshot.records[0]!, result: '1/2-1/2' }],
  };
  const target = fixture(t);
  await target.store.restorePgnTransfer(value, time, check);
  const reread = await target.store.readPgnTransferSnapshot(check);
  assert.deepEqual(
    reread.manifest.records[0]!.sourcePath,
    value.manifest.records[0]!.sourcePath,
  );
  assert.deepEqual(
    reread.manifest.records[0]!.game,
    value.manifest.records[0]!.game,
  );
  assert.equal(reread.records[0]!.result, '1/2-1/2');
  assert.deepEqual(
    target.db.prepare('SELECT count(*) AS n FROM playout_draft').get(),
    { n: 0 },
  );
  assert(game.itemId.value > 0);
  await roundtrip(t, target);
});

test('saved initial-position playout with an advanced game root survives PGN restore and restart', async (t) => {
  const source = fixture(t);
  const scope = freeWorkScope();
  const root = rules.initialState();
  const move = rules.applyMove(root, [], {
    kind: 'coordinates',
    value: 'e2e4',
  });
  assert(move.ok);
  const created = await source.store.createPlayout({
    scope,
    origin: { kind: 'initial_position' },
    sourcePath: { displayName: 'Free exploration', root, steps: [move.value] },
    root: move.value.after,
    playerSide: 'black',
    policy: {
      capability: 'best_move',
      providerInstanceId: 'test',
      providerFingerprint: 'test:v1',
      providerType: 'test-engine',
      providerDisplayName: 'Test engine',
    },
    occurredAt: time,
  });
  const stopped = await source.store.replacePlayout({
    scope,
    expectedDraftRevision: created.draft.draftRevision,
    draft: stopPlayoutDraft(created.draft),
    occurredAt: time,
  });
  await new CompletePlayout({
    reader: source.store,
    writer: source.store,
    clock: { now: () => time },
  }).execute({
    scope,
    draftId: stopped.draft.draftId,
    expectedDraftRevision: stopped.draft.draftRevision,
    completionId: 'initial-source-path',
    displayName: 'Free exploration game',
    languageTag: 'en-GB',
    manualResult: 'unfinished',
  });
  assert.deepEqual(
    source.db.prepare('SELECT origin_mode FROM inventory_game_revision').get(),
    { origin_mode: 'initial_position' },
  );
  const snapshot = await source.store.readPgnTransferSnapshot(check);
  assert.equal(snapshot.manifest.records[0]!.sourcePath!.rootFen, root.fen);
  assert.equal(snapshot.records[0]!.root.fen, move.value.after.fen);
  const codec = new PgnInventoryTransferCodec(rules);
  const signal = new AbortController().signal;
  const bytes = await codec.encode(snapshot, signal, check);
  const target = fixture(t);
  await target.store.restorePgnTransfer(
    await codec.decode(bytes, signal, check),
    time,
    check,
  );
  await target.reopen();
  const restored = await target.store.readPgnTransferSnapshot(check);
  assert.deepEqual(restored.manifest, snapshot.manifest);
  assert.deepEqual(restored.records, snapshot.records);
  assert.deepEqual(await codec.encode(restored, signal, check), bytes);
});

for (const sourceHasPath of [false, true]) {
  for (const sourcesAfter of [false, true]) {
    test(`inherited source path survives SQLite, PGN and restart: sourcePath=${sourceHasPath}, laterSources=${sourcesAfter}`, async (t) => {
      const input = inheritedSourcePathSnapshot(sourceHasPath, sourcesAfter);
      const source = fixture(t);
      // Exercise persistence validation independently of the codec, including forward references.
      await source.store.restorePgnTransfer(prepared(input), time, check);
      const snapshot = await source.store.readPgnTransferSnapshot(check);
      for (const record of input.manifest.records) {
        assert.deepEqual(
          snapshot.manifest.records.find(
            (candidate) => candidate.name === record.name,
          )!.sourcePath,
          record.sourcePath,
        );
      }
      const codec = new PgnInventoryTransferCodec(rules);
      const signal = new AbortController().signal;
      const bytes = await codec.encode(snapshot, signal, check);
      const decoded = await codec.decode(bytes, signal, check);
      const target = fixture(t);
      await target.store.restorePgnTransfer(decoded, time, check);
      await target.reopen();
      const restored = await target.store.readPgnTransferSnapshot(check);
      assert.deepEqual(restored.manifest, snapshot.manifest);
      assert.deepEqual(restored.records, snapshot.records);
      assert.deepEqual(await codec.encode(restored, signal, check), bytes);
      const items = (await target.store.searchInventory({ pageSize: 100 }))
        .items;
      assert.equal(items.length, sourcesAfter ? 1 : 3);
      const game = items.find((item) => item.displayName === 'Final game')!;
      const view = await target.store.readAnalysisRevision({
        scope: { kind: 'free' },
        itemId: game.itemId,
        revisionId: game.currentRevisionId,
      });
      assert(view?.sourceLine && view.sourcePath);
      assert.deepEqual(
        view.sourceLine.steps.map((step) => step.move.san),
        ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'e4', 'e5'],
      );
      assert.equal(view.sourcePath.root.fen, rules.initialState().fen);
      assert.deepEqual(target.db.pragma('foreign_key_check'), []);
    });
  }
}

test('SQLite rejects an altered inherited prefix with the same final FEN and rolls back all content', async (t) => {
  const input = inheritedSourcePathSnapshot(true, true);
  const altered = prepared({
    ...input,
    manifest: {
      ...input.manifest,
      records: input.manifest.records.map((record) => ({
        ...record,
        sourcePath:
          record.sourcePath === null
            ? null
            : {
                ...record.sourcePath,
                moves: [
                  ...['b1c3', 'b8c6', 'c3b1', 'c6b8'].map((move) => ({
                    from: move.slice(0, 2),
                    to: move.slice(2),
                    promotion: null,
                  })),
                  ...record.sourcePath.moves.slice(4),
                ],
              },
      })),
    },
  });
  const target = fixture(t);
  await assert.rejects(target.store.restorePgnTransfer(altered, time, check), {
    problemCode: 'inventory_transfer.invalid_backup',
  });
  assert.equal(
    (await target.store.inspectFreshRestoreTarget()).canRestore,
    true,
  );
  assert.equal(
    (await target.store.readPgnTransferSnapshot(check)).dataRevision,
    0,
  );
  await target.store.restorePgnTransfer(prepared(input), time, check);
});

test('fresh check rejects trash, folders, contexts, neutral explicit scratches, anchor remnants and live guards', async (t) => {
  const emptySource = fixture(t),
    empty = prepared(await emptySource.store.readPgnTransferSnapshot(check));
  const statements = [
    `INSERT INTO inventory_item(item_type, origin_kind, lifecycle, created_at_utc, updated_at_utc) VALUES ('analysis', 'manual', 'trashed', '${time}', '${time}')`,
    "INSERT INTO inventory_folder(display_name, name_key) VALUES ('Empty', 'empty')",
    `INSERT INTO workspace_working_context(display_name, lifecycle, context_version, created_at_utc, updated_at_utc) VALUES ('Context', 'archived', 1, '${time}', '${time}')`,
    'UPDATE live_fair_play_guard SET blocked = 1',
  ];
  for (const sql of statements) {
    const target = fixture(t);
    target.db.exec(sql);
    assert.equal(
      (await target.store.inspectFreshRestoreTarget()).canRestore,
      false,
    );
    await assert.rejects(target.store.restorePgnTransfer(empty, time, check), {
      problemCode: 'inventory_transfer.target_not_empty',
    });
  }
  for (const kind of ['scratch', 'anchor'] as const) {
    const target = fixture(t);
    const state = rules.initialState(),
      p = state.position;
    target.db
      .prepare(
        'INSERT INTO chess_position VALUES (1, ?, ?, ?, 1, 1, 1, 1, -1, ?)',
      )
      .run(p.ruleSetId, p.boardKey, p.sideToMove, Buffer.alloc(32));
    if (kind === 'anchor')
      target.db.exec(
        "INSERT INTO chess_anchor(anchor_kind, position_id) VALUES ('position', 1)",
      );
    else
      target.db
        .prepare(
          `INSERT INTO analysis_scratch_draft(scratch_key, origin_mode, root_position_id, root_halfmove_clock, root_fullmove_number, root_history_knowledge, cursor_index, scratch_revision, created_at_utc, updated_at_utc) VALUES ('explicit-neutral', 'initial_position', 1, 0, 1, 'complete', 0, 1, ?, ?)`,
        )
        .run(time, time);
    assert.equal(
      (await target.store.inspectFreshRestoreTarget()).canRestore,
      false,
    );
  }
});

test('write-lock fresh recheck admits only one concurrent restore', async (t) => {
  const source = fixture(t);
  await seed(source);
  const value = prepared(await source.store.readPgnTransferSnapshot(check));
  const target = fixture(t);
  assert.equal(
    (await target.store.inspectFreshRestoreTarget()).canRestore,
    true,
  );
  const outcomes = await Promise.allSettled([
    target.store.restorePgnTransfer(value, time, check),
    target.store.restorePgnTransfer(value, time, check),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (outcomes.find((r) => r.status === 'rejected') as PromiseRejectedResult)
      .reason.problemCode,
    'inventory_transfer.target_not_empty',
  );
  assert.equal(
    (await target.store.readPgnTransferSnapshot(check)).dataRevision,
    1,
  );
});

test('every budget checkpoint including after revision increment rolls back all tables and FTS', async (t) => {
  const source = fixture(t);
  await seed(source, 'Rollback', tree(false));
  const value = prepared(await source.store.readPgnTransferSnapshot(check));
  const probe = fixture(t);
  let checkpoints = 0;
  await probe.store.restorePgnTransfer(value, time, () => {
    checkpoints++;
  });
  for (let failAt = 1; failAt <= checkpoints; failAt++) {
    const target = fixture(t);
    let seen = 0;
    await assert.rejects(
      target.store.restorePgnTransfer(value, time, () => {
        if (++seen === failAt)
          throw new ApplicationProblem(
            'inventory_transfer.resource_exhausted',
            'Budget exceeded.',
          );
      }),
      { problemCode: 'inventory_transfer.resource_exhausted' },
    );
    assert.equal(
      (await target.store.inspectFreshRestoreTarget()).canRestore,
      true,
    );
    assert.equal(
      (await target.store.readPgnTransferSnapshot(check)).dataRevision,
      0,
    );
    assert.deepEqual(
      target.db.prepare('SELECT count(*) AS n FROM chess_position').get(),
      { n: 0 },
    );
    target.db
      .prepare(
        "INSERT INTO search_document_fts(search_document_fts, rank) VALUES ('integrity-check', 1)",
      )
      .run();
  }
});

test('SQLite search and revision failures roll back and permit a later clean retry', async (t) => {
  const source = fixture(t);
  await seed(source);
  const value = prepared(await source.store.readPgnTransferSnapshot(check));
  for (const table of ['search_document', 'runtime_store_state']) {
    const target = fixture(t);
    target.db.exec(
      `CREATE TRIGGER transfer_fail BEFORE ${table === 'search_document' ? 'INSERT' : 'UPDATE'} ON ${table} BEGIN SELECT RAISE(ABORT, 'test failure'); END`,
    );
    await assert.rejects(target.store.restorePgnTransfer(value, time, check));
    assert.equal(
      (await target.store.inspectFreshRestoreTarget()).canRestore,
      true,
    );
    assert.equal(
      (await target.store.readPgnTransferSnapshot(check)).dataRevision,
      0,
    );
    target.db.exec('DROP TRIGGER transfer_fail');
    await target.store.restorePgnTransfer(value, time, check);
    assert.equal(
      (await target.store.readPgnTransferSnapshot(check)).dataRevision,
      1,
    );
  }
});

test('snapshot rejects unsupported active items, missing heads and cyclic explicit origins', async (t) => {
  for (const type of ['source', 'missing'] as const) {
    const source = fixture(t);
    source.db
      .prepare(
        'INSERT INTO inventory_item(item_type, origin_kind, lifecycle, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        type === 'source' ? 'source' : 'analysis',
        'manual',
        'active',
        time,
        time,
      );
    await assert.rejects(source.store.readPgnTransferSnapshot(check), {
      problemCode: 'inventory_transfer.invalid_backup',
    });
  }
  const source = fixture(t);
  const item = await seed(source);
  const anchor = (
    source.db
      .prepare(
        "SELECT anchor_id AS id FROM chess_anchor WHERE anchor_kind = 'item'",
      )
      .get() as { id: number }
  ).id;
  source.db.exec(
    "UPDATE inventory_analysis_revision SET origin_mode = 'inventory_anchor'",
  );
  source.db
    .prepare('INSERT INTO inventory_analysis_origin VALUES (?, ?, ?, ?)')
    .run(
      item.revisionId.value,
      item.itemId.value,
      item.revisionId.value,
      anchor,
    );
  await assert.rejects(source.store.readPgnTransferSnapshot(check), {
    problemCode: 'inventory_transfer.invalid_backup',
  });
});

test('snapshot uses one read transaction while another connection changes stored notes', async (t) => {
  const source = fixture(t);
  await seed(source);
  let calls = 0;
  const snapshot = await source.store.readPgnTransferSnapshot(() => {
    if (++calls === 3)
      source.db.exec(
        "UPDATE workspace_contribution SET body = 'Concurrent change'",
      );
  });
  assert.equal(snapshot.manifest.contributions[0]!.body, 'Root note');
  assert.equal(
    (await source.store.readPgnTransferSnapshot(check)).manifest
      .contributions[0]!.body,
    'Concurrent change',
  );
});

test('all four anchor kinds preserve typed notes and exact continuation witnesses', async (t) => {
  const source = fixture(t);
  await seed(source);
  source.db
    .exec(`INSERT INTO chess_anchor(anchor_kind, position_id) SELECT 'position', position_id FROM chess_occurrence_snapshot WHERE is_root = 1;
    UPDATE workspace_contribution SET contribution_type = 'decision', author_role = 'engine', rationale = 'Because', contribution_version = 3;`);
  const anchors = source.db
    .prepare(
      `SELECT anchor_id AS id, anchor_kind AS kind FROM chess_anchor WHERE anchor_kind IN ('item', 'position', 'move_node') AND (move_node_id IS NULL OR move_node_id = 1) ORDER BY anchor_id`,
    )
    .all() as { id: number; kind: string }[];
  for (const anchor of anchors) {
    const id = Number(
      source.db
        .prepare(
          `INSERT INTO workspace_contribution(contribution_type, author_role, scope_kind, anchor_id, body, rationale, status, contribution_version, language_tag, created_at_utc, updated_at_utc) VALUES ('question', 'source', 'global', ?, 'Question', 'Exact reason', 'active', 4, 'de-DE', ?, ?)`,
        )
        .run(anchor.id, time, time).lastInsertRowid,
    );
    source.db
      .prepare(
        'INSERT INTO workspace_analysis_note_path_step VALUES (?, 0, ?, ?, NULL, ?)',
      )
      .run(
        id,
        anchor.kind === 'move_node' ? 'c7' : 'g1',
        anchor.kind === 'move_node' ? 'c5' : 'f3',
        anchor.kind === 'move_node' ? 'c5' : 'Nf3',
      );
  }
  const { snapshot, target } = await roundtrip(t, source);
  assert.deepEqual(
    new Set(snapshot.manifest.anchors.map((a) => a.kind)),
    new Set(['item', 'position', 'occurrence', 'move_node']),
  );
  assert.deepEqual(
    target.db
      .prepare(
        'SELECT from_square, to_square, san FROM workspace_analysis_note_path_step ORDER BY contribution_id',
      )
      .all(),
    source.db
      .prepare(
        'SELECT from_square, to_square, san FROM workspace_analysis_note_path_step ORDER BY contribution_id',
      )
      .all(),
  );
});

test('broken provenance membership and missing PlayState reject the complete snapshot', async (t) => {
  const source = await provenanceFixture(t);
  source.db.exec(
    `UPDATE inventory_analysis_origin SET source_anchor_id = (SELECT max(anchor_id) FROM chess_anchor WHERE anchor_kind = 'occurrence')`,
  );
  await assert.rejects(source.store.readPgnTransferSnapshot(check), {
    problemCode: 'inventory_transfer.invalid_backup',
  });
  const missing = fixture(t);
  await seed(missing);
  missing.db.exec(
    'DELETE FROM chess_play_state_snapshot WHERE occurrence_id = 2',
  );
  await assert.rejects(missing.store.readPgnTransferSnapshot(check), {
    problemCode: 'inventory_transfer.invalid_backup',
  });
});

test('duplicate shared identities and invalid base references roll back', async (t) => {
  const source = fixture(t);
  await seed(source);
  const value = prepared(await source.store.readPgnTransferSnapshot(check));
  const first = value.manifest.records[0]!;
  for (const record of [
    {
      ...first,
      nodes: first.nodes.map((n, index) =>
        index === 1 ? ([first.nodes[0]![0], n[1], n[2]] as const) : n,
      ),
    },
    { ...first, baseRevision: 'r999' },
  ]) {
    const target = fixture(t);
    await assert.rejects(
      target.store.restorePgnTransfer(
        { ...value, manifest: { ...value.manifest, records: [record] } },
        time,
        check,
      ),
      { problemCode: 'inventory_transfer.invalid_backup' },
    );
    assert.equal(
      (await target.store.inspectFreshRestoreTarget()).canRestore,
      true,
    );
  }
});

test('snapshot includes more than a UI page and excludes context and archived notes', async (t) => {
  const source = fixture(t),
    root = rules.initialState();
  const candidates = Array.from({ length: 137 }, (_, index) => ({
    sourceOrder: index,
    displayName: `Collection ${index}`,
    itemType: 'analysis' as const,
    content: {
      root,
      nodes: [],
      result: '*' as const,
      status: 'ready' as const,
      sourceOrder: index,
      suggestedName: `Collection ${index}`,
      initialComments: [],
      findings: [],
    },
  }));
  for (let offset = 0; offset < candidates.length; offset += 100) {
    await source.store.publishImport({
      languageTag: 'de-DE',
      occurredAt: time,
      folder: { kind: 'unfiled' },
      candidates: candidates.slice(offset, offset + 100),
    });
  }
  source.db
    .prepare(
      `INSERT INTO workspace_working_context(display_name, lifecycle, context_version, created_at_utc, updated_at_utc) VALUES ('Excluded context', 'active', 1, ?, ?)`,
    )
    .run(time, time);
  const anchor = (
    source.db
      .prepare('SELECT anchor_id AS id FROM chess_anchor LIMIT 1')
      .get() as { id: number }
  ).id;
  source.db
    .prepare(
      `INSERT INTO workspace_contribution(contribution_type, author_role, scope_kind, context_id, anchor_id, body, status, contribution_version, language_tag, created_at_utc, updated_at_utc) VALUES ('note', 'user', 'context', 1, ?, 'Context canary', 'active', 1, 'de-DE', ?, ?)`,
    )
    .run(anchor, time, time);
  source.db
    .prepare(
      `INSERT INTO workspace_contribution(contribution_type, author_role, scope_kind, anchor_id, body, status, contribution_version, language_tag, created_at_utc, updated_at_utc) VALUES ('note', 'user', 'global', ?, 'Archived canary', 'archived', 1, 'de-DE', ?, ?)`,
    )
    .run(anchor, time, time);
  const { snapshot, target } = await roundtrip(t, source);
  assert.equal(snapshot.manifest.items.length, 137);
  assert.equal(snapshot.manifest.contributions.length, 0);
  assert.deepEqual(
    target.db
      .prepare('SELECT count(*) AS n FROM workspace_working_context')
      .get(),
    { n: 0 },
  );
});

test('restoring into a configured fresh store preserves preferences and increments its existing revision once', async (t) => {
  const source = fixture(t);
  await seed(source);
  const target = fixture(t);
  target.db.exec(
    "UPDATE preference_state SET ui_locale = 'en-GB', preference_revision = 9; UPDATE runtime_store_state SET data_revision = 8",
  );
  const preferences = target.db.prepare('SELECT * FROM preference_state').get();
  const result = await target.store.restorePgnTransfer(
    prepared(await source.store.readPgnTransferSnapshot(check)),
    time,
    check,
  );
  assert.equal(result.dataRevision, 9);
  assert.deepEqual(
    target.db.prepare('SELECT * FROM preference_state').get(),
    preferences,
  );
});

test('folder keys remain stable when an older folder has been moved below a newer parent', async (t) => {
  const source = fixture(t);
  source.db.exec(
    "INSERT INTO inventory_folder(folder_id, display_name, name_key) VALUES (1, 'Child', 'child'), (8, 'Parent', 'parent'); UPDATE inventory_folder SET parent_folder_id = 8 WHERE folder_id = 1",
  );
  await roundtrip(t, source);
});

test('illegal note continuation and wrong continuation witness roll back the entire publication', async (t) => {
  const source = fixture(t);
  await seed(source);
  const value = prepared(await source.store.readPgnTransferSnapshot(check));
  for (const movesRoot of [
    { record: 'r1', node: 0 },
    { record: 'r1', node: 2 },
  ]) {
    const target = fixture(t);
    const note = value.manifest.contributions[0]!;
    const changed = {
      ...value,
      manifest: {
        ...value.manifest,
        contributions: [
          {
            ...note,
            moves: [{ from: 'e2', to: 'e5', promotion: null }],
            movesRoot,
          },
        ],
      },
    };
    await assert.rejects(
      target.store.restorePgnTransfer(changed, time, check),
      { problemCode: 'inventory_transfer.invalid_backup' },
    );
    assert.equal(
      (await target.store.inspectFreshRestoreTarget()).canRestore,
      true,
    );
  }
});
