import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { FreeAnalysisSession } from '../../../app/application/analysis/index.ts';
import {
  PreviewInventoryRevision,
  SaveInventoryRevision,
  StartInventoryRevision,
} from '../../../app/application/inventory/index.ts';
import type { ChessTreeCandidate } from '../../../app/domain/inventory/chess-tree-candidate.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';
import { readChessTree } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-import-graph.ts';
import { analysisRecordDto } from '../../../app/infrastructure/channels/api/dto-mappers.ts';
import { chessTreePath } from '../../../app/infrastructure/channels/ui/renderer/chess-tree-presentation.ts';

const time = '2026-10-01T12:00:00.000Z';
const scope = { kind: 'free' } as const;

async function fixture(t: TestContext, withBranch = true) {
  const directory = mkdtempSync(join(tmpdir(), 'plysmith-chess-tree-'));
  const databasePath = join(directory, 'store.sqlite');
  const store = new SqlitePersistenceAdapter({
    databasePath,
    now: () => time,
  });
  const db = new Database(databasePath);
  t.after(async () => {
    db.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const rules = new ChessJsRulesAdapter();
  const root = rules.initialState();
  const nodes: ChessTreeCandidate['nodes'][number][] = [];
  for (const [parentNodeIndex, siblingOrder, value] of [
    [null, 0, 'd2d4'],
    [0, 0, 'd7d5'],
    ...(withBranch ? [[0, 1, 'g8f6'] as const] : []),
  ] as const) {
    const applied = rules.applyMove(
      parentNodeIndex === null ? root : nodes[parentNodeIndex]!.after,
      [],
      { kind: 'coordinates', value },
    );
    assert(applied.ok);
    nodes.push({
      nodeIndex: nodes.length,
      parentNodeIndex,
      siblingOrder,
      move: applied.value.move,
      after: applied.value.after,
      comments: [],
      startingComments: [],
    });
  }
  const published = await store.publishImport({
    languageTag: 'en-GB',
    occurredAt: time,
    folder: { kind: 'unfiled' },
    candidates: [
      {
        sourceOrder: 0,
        itemType: 'analysis',
        displayName: 'Tree',
        content: {
          sourceOrder: 0,
          suggestedName: 'Tree',
          status: 'ready',
          root,
          nodes,
          initialComments: [],
          result: '*',
          findings: [],
        },
      },
    ],
  });
  return { store, db, item: published.items[0]!, rules };
}

test('truncate preserves a selectable side branch and extend projects the actual main line from a later database slot', async (t) => {
  const { store, db, item, rules } = await fixture(t);
  const original = (await store.readAnalysisRevision({ scope, ...item }))!;
  const d4 = original.tree!.nodes.find((node) => node.move.san === 'd4')!;
  const knight = original.tree!.nodes.find((node) => node.move.san === 'Nf6')!;
  const clock = { now: () => time };
  const events = { publish: () => undefined };
  const freeSession = new FreeAnalysisSession({ persistence: store, clock });
  const start = new StartInventoryRevision({
    inventory: store,
    contextReader: store,
    contextWriter: store,
    freeSession,
    rules,
    clock,
    events,
    storeStatus: store,
    scratchId: () => 'tree-edit',
  });
  const preview = new PreviewInventoryRevision({
    inventory: store,
    contextReader: store,
    freeSession,
  });
  const save = new SaveInventoryRevision({
    reader: store,
    writer: store,
    freeSession,
    clock,
    inventoryEvents: events,
    impactEvents: events,
    scratchEvents: events,
  });
  const revise = async (
    baseRevisionId: typeof item.revisionId,
    mode: 'truncate_after' | 'extend',
  ) => {
    const started = await start.execute({
      scope,
      itemId: item.itemId,
      baseRevisionId,
      anchorId: d4.anchorId,
      mode,
      ...(mode === 'extend'
        ? { firstMove: { kind: 'coordinates' as const, value: 'e7e6' } }
        : {}),
      expectedScratchId: null,
      expectedScratchRevision: null,
    });
    const expected = {
      scope,
      expectedScratchId: started.scratch.scratchId,
      expectedScratchRevision: started.scratch.scratchRevision,
    };
    const impact = await preview.execute(expected);
    return save.execute({
      ...expected,
      previewFingerprint: impact.previewFingerprint,
    });
  };
  const truncated = await revise(item.revisionId, 'truncate_after');
  const cut = (await store.readAnalysisRevision({
    scope,
    itemId: item.itemId,
    revisionId: truncated.revisionId,
    anchorId: d4.anchorId,
  }))!;
  assert.deepEqual(
    cut.steps.map((step) => step.move.san),
    ['d4'],
  );
  assert.deepEqual(
    cut.tree!.nodes.map((node) => [node.move.san, node.siblingOrder]),
    [
      ['d4', 0],
      ['Nf6', 1],
    ],
  );
  const reachable = (await store.readAnalysisRevision({
    scope,
    itemId: item.itemId,
    revisionId: truncated.revisionId,
    anchorId: knight.anchorId,
  }))!;
  assert.deepEqual(
    reachable.steps.map((step) => step.move.san),
    ['d4', 'Nf6'],
  );
  assert.deepEqual(
    chessTreePath(analysisRecordDto(cut), String(d4.anchorId.value)).steps.map(
      (step) => step.move.san,
    ),
    ['d4'],
  );

  const extended = await revise(truncated.revisionId, 'extend');
  const updated = (await store.readAnalysisRevision({
    scope,
    itemId: item.itemId,
    revisionId: extended.revisionId,
    anchorId: d4.anchorId,
  }))!;
  const stored = db
    .prepare(
      'SELECT san, sibling_order AS siblingOrder, is_main_line AS isMainLine FROM chess_move_node_snapshot WHERE revision_id = ? ORDER BY sibling_order',
    )
    .all(extended.revisionId.value);
  assert.deepEqual(stored, [
    { san: 'd4', siblingOrder: 0, isMainLine: 1 },
    { san: 'Nf6', siblingOrder: 1, isMainLine: 0 },
    { san: 'e6', siblingOrder: 2, isMainLine: 1 },
  ]);
  assert.deepEqual(
    updated.tree!.nodes.map((node) => [
      node.move.san,
      node.parentNodeIndex,
      node.siblingOrder,
    ]),
    [
      ['d4', null, 0],
      ['e6', 0, 0],
      ['Nf6', 0, 1],
    ],
  );
  assert.deepEqual(
    updated.tree!.nodes.find((node) => node.move.san === 'Nf6')?.anchorId,
    knight.anchorId,
  );
  const dto = analysisRecordDto(updated);
  assert.deepEqual(
    chessTreePath(dto, dto.rootAnchorId).steps.map((step) => step.move.san),
    ['d4', 'e6'],
  );
  assert.deepEqual(
    chessTreePath(dto, String(knight.anchorId.value)).steps.map(
      (step) => step.move.san,
    ),
    ['d4', 'Nf6'],
  );
  assert.deepEqual(
    (await store.readAnalysisRevision({ scope, ...item }))!.tree,
    original.tree,
  );
});

test('a main-only graph needs no tree projection even when its database sibling slots are positive', async (t) => {
  const { db, item } = await fixture(t, false);
  db.prepare(
    'UPDATE chess_move_node_snapshot SET sibling_order = 7 WHERE revision_id = ?',
  ).run(item.revisionId.value);
  assert.equal(readChessTree(db, item.revisionId.value), undefined);
});
