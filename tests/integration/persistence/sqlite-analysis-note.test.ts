import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { CreatePositionNote } from '../../../app/application/analysis/index.ts';

import { localId } from '../../../app/domain/identity/index.ts';
import type { WorkScope } from '../../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';

const time = '2026-10-02T12:00:00.000Z';

async function fixture(t: TestContext, published = true) {
  const directory = mkdtempSync(join(tmpdir(), 'plysmith-analysis-note-'));
  const databasePath = join(directory, 'store.sqlite');
  const store = new SqlitePersistenceAdapter({ databasePath, now: () => time });
  const db = new Database(databasePath);
  t.after(async () => {
    db.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await store.publishImport({
    languageTag: 'en-GB',
    occurredAt: time,
    folder: { kind: 'unfiled' },
    candidates: [
      {
        sourceOrder: 0,
        itemType: 'analysis',
        displayName: 'Note study',
        content: {
          sourceOrder: 0,
          suggestedName: 'Note study',
          status: 'ready',
          root: new ChessJsRulesAdapter().initialState(),
          nodes: [],
          initialComments: ['Imported note'],
          result: '*',
          findings: [],
        },
      },
    ],
  });
  if (!published)
    db.prepare('UPDATE inventory_item SET current_revision_id = NULL').run();
  const note = db
    .prepare(
      `SELECT contribution.contribution_id AS contributionId,
              contribution.anchor_id AS anchorId,
              coalesce(anchor.owner_item_id, anchor.item_id) AS itemId
         FROM workspace_contribution AS contribution
         JOIN chess_anchor AS anchor ON anchor.anchor_id = contribution.anchor_id
        WHERE contribution.body = 'Imported note'`,
    )
    .get() as { contributionId: number; anchorId: number; itemId: number };
  const contributionId = localId('contribution', note.contributionId);
  return {
    store,
    db,
    note,
    async snapshot() {
      return {
        note: db
          .prepare(
            'SELECT * FROM workspace_contribution WHERE contribution_id = ?',
          )
          .get(note.contributionId),
        search: db
          .prepare('SELECT * FROM search_document WHERE contribution_id = ?')
          .all(note.contributionId),
        dataRevision: (await store.readStoreStatus()).dataRevision,
      };
    },
    mutate(
      operation: 'update' | 'delete',
      scope: WorkScope = { kind: 'free' },
    ) {
      const request = {
        scope,
        contributionId,
        expectedContributionVersion: 1,
        occurredAt: time,
      };
      return operation === 'update'
        ? store.updateAnalysisNote({ ...request, body: 'Changed note' })
        : store.deleteAnalysisNote(request);
    },
  };
}

test('rejects position note creation after real trash without changing persisted state', async (t) => {
  const f = await fixture(t);
  const itemId = localId('inventory-item', f.note.itemId);
  const preview = (await f.store.previewInventoryItemDeletion({ itemId }))!;
  await f.store.deleteInventoryItem(
    {
      itemId,
      expectedCurrentRevisionId: preview.currentRevisionId,
      expectedDataRevision: preview.dataRevision,
    },
    time,
  );
  const before = f.db.serialize();
  const create = new CreatePositionNote({
    writer: f.store,
    clock: { now: () => time },
    events: {
      publish: () => assert.fail('Rejected note must not publish an event'),
    },
  });
  await assert.rejects(
    create.execute({
      scope: { kind: 'free' },
      itemId,
      revisionId: preview.currentRevisionId,
      anchorId: localId('anchor', f.note.anchorId),
      body: 'Late note',
      languageTag: 'en-GB',
      noteScope: { kind: 'global' },
    }),
    { problemCode: 'analysis.invalid_note' },
  );
  assert.deepEqual(f.db.serialize(), before);
});

test('creates notes at current root, item and snapshot position anchors in free and context scopes', async (t) => {
  const f = await fixture(t);
  const itemId = localId('inventory-item', f.note.itemId);
  const revisionId = (await f.store.previewInventoryItemDeletion({ itemId }))!
    .currentRevisionId;
  const { context } = await f.store.createWorkingContext(
    { displayName: 'Notes' },
    time,
  );
  await f.store.addContextReference(
    {
      contextId: context.contextId,
      itemId,
      anchorId: localId('anchor', f.note.anchorId),
    },
    time,
  );
  f.db
    .prepare(
      `INSERT INTO chess_anchor(anchor_kind, position_id)
    SELECT 'position', position_id FROM chess_occurrence_snapshot WHERE revision_id = ? AND is_root = 1`,
    )
    .run(revisionId.value);
  const anchors = f.db
    .prepare('SELECT anchor_id AS id FROM chess_anchor ORDER BY anchor_id')
    .all() as { id: number }[];
  assert.equal(anchors.length, 3);
  for (const scope of [
    { kind: 'free' },
    { kind: 'context', contextId: context.contextId },
  ] as const) {
    for (const anchor of anchors) {
      const before = (await f.store.readStoreStatus()).dataRevision;
      const result = await f.store.createPositionNote({
        scope,
        itemId,
        revisionId,
        anchorId: localId('anchor', anchor.id),
        note: { body: 'Current note', moves: [] },
        languageTag: 'en-GB',
        noteScope: scope.kind === 'free' ? { kind: 'global' } : scope,
        occurredAt: time,
      });
      assert.equal(result.dataRevision, before + 1);
      assert.equal(result.anchorId.value, anchor.id);
    }
  }
});

for (const lifecycle of ['archived', 'tombstone'] as const) {
  test(`rejects position note creation on an ${lifecycle} item without writes`, async (t) => {
    const f = await fixture(t);
    const itemId = localId('inventory-item', f.note.itemId);
    const revisionId = (await f.store.previewInventoryItemDeletion({ itemId }))!
      .currentRevisionId;
    f.db
      .prepare('UPDATE inventory_item SET lifecycle = ? WHERE item_id = ?')
      .run(lifecycle, itemId.value);
    const before = f.db.serialize();
    await assert.rejects(
      f.store.createPositionNote({
        scope: { kind: 'free' },
        itemId,
        revisionId,
        anchorId: localId('anchor', f.note.anchorId),
        note: { body: 'Late note', moves: [] },
        languageTag: 'en-GB',
        noteScope: { kind: 'global' },
        occurredAt: time,
      }),
      { problemCode: 'analysis.invalid_note' },
    );
    assert.deepEqual(f.db.serialize(), before);
  });
}

for (const operation of ['update', 'delete'] as const) {
  test(`rejects ${operation} of a note without a current item revision without changing persisted state`, async (t) => {
    const f = await fixture(t, false);
    assert.deepEqual(
      f.db
        .prepare(
          'SELECT current_revision_id FROM inventory_item WHERE item_id = ?',
        )
        .get(f.note.itemId),
      { current_revision_id: null },
    );
    const before = await f.snapshot();
    await assert.rejects(f.mutate(operation), {
      problemCode: 'analysis.invalid_note',
    });
    assert.deepEqual(await f.snapshot(), before);
  });

  for (const lifecycle of ['archived', 'trashed', 'tombstone']) {
    test(`rejects note ${operation} for a published ${lifecycle} item without changing persisted state`, async (t) => {
      const f = await fixture(t, true);
      f.db
        .prepare('UPDATE inventory_item SET lifecycle = ? WHERE item_id = ?')
        .run(lifecycle, f.note.itemId);
      const before = await f.snapshot();
      await assert.rejects(f.mutate(operation), {
        problemCode: 'analysis.invalid_note',
      });
      assert.deepEqual(await f.snapshot(), before);
    });
  }

  test(`rejects global note ${operation} through a context with an open revision impact`, async (t) => {
    const f = await fixture(t, true);
    const { context } = await f.store.createWorkingContext(
      { displayName: 'Blocked context' },
      time,
    );
    f.db
      .prepare(
        `INSERT INTO workspace_context_item
           (context_id, item_id, relationship_version, created_at_utc)
         VALUES (?, ?, 1, ?)`,
      )
      .run(context.contextId.value, f.note.itemId, time);
    f.db
      .prepare(
        `INSERT INTO workspace_pending_revision_impact
           (context_id, item_id, pinned_revision_id, target_revision_id,
            target_anchor_id, impact_version, created_at_utc, updated_at_utc)
         SELECT ?, item_id, current_revision_id, current_revision_id, ?, 1, ?, ?
           FROM inventory_item WHERE item_id = ?`,
      )
      .run(context.contextId.value, f.note.anchorId, time, time, f.note.itemId);
    const before = await f.snapshot();
    await assert.rejects(
      f.mutate(operation, { kind: 'context', contextId: context.contextId }),
      { problemCode: 'workspace.impact_conflict' },
    );
    assert.deepEqual(await f.snapshot(), before);

    const changed = await f.mutate(operation);
    assert.equal(changed.contributionVersion, 2);
    assert.equal(changed.dataRevision, before.dataRevision + 1);
  });

  for (const status of ['resolved', 'archived']) {
    test(`preserves rejection of ${status} note ${operation} on a published active item`, async (t) => {
      const f = await fixture(t, true);
      f.db
        .prepare(
          'UPDATE workspace_contribution SET status = ? WHERE contribution_id = ?',
        )
        .run(status, f.note.contributionId);
      const before = await f.snapshot();
      await assert.rejects(f.mutate(operation), {
        problemCode: 'analysis.invalid_note',
      });
      assert.deepEqual(await f.snapshot(), before);
    });
  }
}
