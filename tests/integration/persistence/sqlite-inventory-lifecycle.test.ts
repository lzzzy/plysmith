import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { migrateStore } from '../../../app/infrastructure/adapters/persistence/sqlite/migrate.ts';
import {
  createAnalysisRecord,
  readAnalysisRecordView,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-analysis-record.ts';
import { searchInventory } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-inventory.ts';
import {
  appendAnalysisMove,
  prepareAnalysisNote,
  startAnalysisScratch,
} from '../../../app/domain/analysis/index.ts';
import { localId } from '../../../app/domain/identity/index.ts';
import { freeWorkScope } from '../../../app/domain/workspace/index.ts';
import {
  replaceContextAnalysisScratch,
  readContextScratch,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-analysis-scratch.ts';
import { insertAnalysisNoteContribution } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-analysis-note.ts';
import {
  addContextReference,
  createWorkingContext,
  setWorkScopeResume,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-workspace.ts';
import {
  deleteInventoryItem,
  previewInventoryItemDeletion,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-inventory-lifecycle.ts';
import {
  readPendingRevisionImpact,
  resolvePendingRevisionImpact,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-revision-impact.ts';
import {
  createPlayout,
  readPlayout,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-playout.ts';
import {
  incrementDataRevision,
  readDataRevision,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-store-helpers.ts';
import { requireContextInventoryWorkAccess } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-context-item.ts';

const timestamp = '2026-09-27T12:00:00.000Z';
const rules = new ChessJsRulesAdapter();

function fixture(t: TestContext) {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  migrateStore(database, true, timestamp);
  t.after(() => database.close());
  const root = createAnalysisRecord(database, {
    displayName: 'Root',
    languageTag: 'en-GB',
    origin: { kind: 'initial_position' },
    root: rules.initialState(),
    steps: [],
    occurredAt: timestamp,
  });
  const child = createAnalysisRecord(database, {
    displayName: 'Child',
    languageTag: 'en-GB',
    origin: {
      kind: 'inventory_anchor',
      itemId: root.itemId,
      revisionId: root.revisionId,
      anchorId: root.rootAnchorId,
    },
    root: rules.initialState(),
    steps: [],
    occurredAt: timestamp,
  });
  return { database, root, child };
}

function usageFixture(t: TestContext) {
  const base = fixture(t);
  const { database, root, child } = base;
  const { context } = createWorkingContext(
    database,
    { displayName: 'Preparation' },
    timestamp,
  );
  const { context: second } = createWorkingContext(
    database,
    { displayName: 'Openings' },
    timestamp,
  );
  for (const current of [context, second]) {
    addContextReference(
      database,
      {
        contextId: current.contextId,
        itemId: root.itemId,
        anchorId: root.rootAnchorId,
      },
      timestamp,
    );
  }
  addContextReference(
    database,
    {
      contextId: context.contextId,
      itemId: child.itemId,
      anchorId: child.rootAnchorId,
    },
    timestamp,
  );
  const firstResult = rules.applyMove(rules.initialState(), [], {
    kind: 'notation',
    value: 'e4',
    locale: 'en-GB',
  });
  assert.ok(firstResult.ok);
  const first = firstResult.value;
  const nextResult = rules.applyMove(rules.initialState(), [first.move], {
    kind: 'notation',
    value: 'e5',
    locale: 'en-GB',
  });
  assert.ok(nextResult.ok);
  const next = nextResult.value;
  const note = (item: typeof root, contextId?: typeof context.contextId) =>
    insertAnalysisNoteContribution(database, {
      itemId: item.itemId,
      anchorId: item.rootAnchorId,
      note: { body: 'Keep this line', moves: [first.move] },
      noteScope:
        contextId === undefined
          ? { kind: 'global' }
          : { kind: 'context', contextId },
      languageTag: 'en-GB',
      occurredAt: timestamp,
    });
  const affectedNote = note(root, context.contextId);
  note(root, context.contextId);
  note(root, second.contextId);
  note(root);
  const childNote = note(child, context.contextId);
  const origin = {
    kind: 'inventory_anchor' as const,
    itemId: root.itemId,
    revisionId: root.revisionId,
    anchorId: root.rootAnchorId,
  };
  const scratch = prepareAnalysisNote(
    appendAnalysisMove(
      appendAnalysisMove(
        startAnalysisScratch('draft', rules.initialState(), origin),
        first,
      ),
      next,
    ),
    'Unsaved note',
  );
  replaceContextAnalysisScratch(database, {
    contextId: context.contextId,
    scratch,
    expectedScratchId: null,
    expectedScratchRevision: null,
    occurredAt: timestamp,
  });
  setWorkScopeResume(
    database,
    {
      scope: { kind: 'context', contextId: context.contextId },
      area: 'manage',
      expectedResumeVersion: null,
      presentation: 'list',
      selectedItemId: root.itemId,
      selectedAnchorId: root.rootAnchorId,
    },
    timestamp,
  );
  createPlayout(database, {
    scope: freeWorkScope(),
    origin,
    root: rules.initialState(),
    playerSide: 'white',
    sourcePath: { displayName: 'Root', root: rules.initialState(), steps: [] },
    policy: {
      capability: 'best_move',
      providerInstanceId: 'stockfish',
      providerFingerprint: 'test',
      providerType: 'stockfish',
      providerDisplayName: 'Stockfish',
    },
    occurredAt: timestamp,
  });
  return { ...base, context, second, affectedNote, childNote };
}

test('keeps a trashed family root readable as provenance without returning it as active inventory', (t) => {
  const { database, root, child } = fixture(t);
  database
    .prepare(
      "UPDATE inventory_item SET lifecycle = 'trashed' WHERE item_id = ?",
    )
    .run(root.itemId.value);
  const result = searchInventory(database, { pageSize: 100 });
  assert.deepEqual(
    result.items.map((item) => item.itemId.value),
    [child.itemId.value],
  );
  assert.equal(result.ancestors[0]?.itemId.value, root.itemId.value);
  assert.equal(result.ancestors[0]?.lifecycle, 'trashed');
  const record = readAnalysisRecordView(database, {
    itemId: child.itemId,
    revisionId: child.revisionId,
    anchorId: child.rootAnchorId,
  });
  assert.equal(record?.sourceLine?.sourceItemId.value, root.itemId.value);
});

test('previews exact bound context work and retained families and playouts without writing', (t) => {
  const { database, root, context, second } = usageFixture(t);
  const before = readDataRevision(database);
  const preview = previewInventoryItemDeletion(database, {
    itemId: root.itemId,
  });
  assert.ok(preview);
  assert.equal(preview.retainedDerivedItemCount, 1);
  assert.equal(preview.retainedPlayoutCount, 1);
  assert.deepEqual(
    preview.contexts.map((value) => value.contextName),
    ['Openings', 'Preparation'],
  );
  assert.deepEqual(
    preview.contexts.find(
      (value) => value.contextId.value === context.contextId.value,
    ),
    {
      contextId: context.contextId,
      contextName: 'Preparation',
      referenceCount: 1,
      activeNoteCount: 2,
      noteMoveCount: 2,
      scratchCount: 1,
      scratchMoveCount: 2,
      scratchNoteCount: 1,
      managementResumeAffected: true,
      analysisResumeAffected: true,
    },
  );
  assert.equal(
    preview.contexts.find(
      (value) => value.contextId.value === second.contextId.value,
    )?.activeNoteCount,
    1,
  );
  assert.equal(preview.global.activeNoteCount, 1);
  assert.equal(readDataRevision(database), before);
});

test('trashes only the selected item and clears its bindings while preserving immutable source snapshots and independent games', (t) => {
  const { database, root, child, context, childNote } = usageFixture(t);
  const before = previewInventoryItemDeletion(database, {
    itemId: root.itemId,
  });
  assert.ok(before);
  const gameBefore = readPlayout(database, freeWorkScope());
  const result = database
    .transaction(() =>
      deleteInventoryItem(
        database,
        {
          itemId: root.itemId,
          expectedCurrentRevisionId: before.currentRevisionId,
          expectedDataRevision: before.dataRevision,
        },
        timestamp,
      ),
    )
    .immediate();
  assert.equal(result.dataRevision, before.dataRevision + 1);
  assert.equal(
    previewInventoryItemDeletion(database, { itemId: root.itemId }),
    undefined,
  );
  assert.equal(readContextScratch(database, context.contextId), undefined);
  assert.equal(
    database
      .prepare('SELECT 1 FROM workspace_context_item WHERE item_id = ?')
      .get(root.itemId.value),
    undefined,
  );
  assert.equal(
    database
      .prepare('SELECT 1 FROM search_document WHERE item_id = ?')
      .get(root.itemId.value),
    undefined,
  );
  assert.deepEqual(
    database
      .prepare(
        'SELECT status FROM workspace_contribution WHERE contribution_id = ?',
      )
      .get(childNote.value),
    { status: 'active' },
  );
  assert.deepEqual(
    searchInventory(database, { pageSize: 100 }).items.map(
      (item) => item.itemId.value,
    ),
    [child.itemId.value],
  );
  assert.equal(
    readAnalysisRecordView(database, {
      itemId: child.itemId,
      revisionId: child.revisionId,
      anchorId: child.rootAnchorId,
    })?.sourceLine?.sourceItemId.value,
    root.itemId.value,
  );
  assert.deepEqual(
    readPlayout(database, freeWorkScope())?.draft,
    gameBefore?.draft,
  );
  assert.deepEqual(database.pragma('foreign_key_check'), []);
  assert.throws(
    () =>
      requireContextInventoryWorkAccess(database, freeWorkScope(), root.itemId),
    { problemCode: 'inventory.item_not_found' },
  );
  requireContextInventoryWorkAccess(database, freeWorkScope(), child.itemId);
});

test('includes and clears the selected item work in the persistent full inventory scope', (t) => {
  const { database, root } = usageFixture(t);
  const applied = rules.applyMove(rules.initialState(), [], {
    kind: 'notation',
    value: 'd4',
    locale: 'en-GB',
  });
  assert.ok(applied.ok);
  const scratch = prepareAnalysisNote(
    appendAnalysisMove(
      startAnalysisScratch('free-draft', rules.initialState(), {
        kind: 'inventory_anchor',
        itemId: root.itemId,
        revisionId: root.revisionId,
        anchorId: root.rootAnchorId,
      }),
      applied.value,
    ),
    'Free note',
  );
  replaceContextAnalysisScratch(database, {
    contextId: null,
    scratch,
    expectedScratchId: null,
    expectedScratchRevision: null,
    occurredAt: timestamp,
  });
  setWorkScopeResume(
    database,
    {
      scope: freeWorkScope(),
      area: 'manage',
      expectedResumeVersion: null,
      presentation: 'list',
      selectedItemId: root.itemId,
    },
    timestamp,
  );
  const preview = previewInventoryItemDeletion(database, {
    itemId: root.itemId,
  });
  assert.ok(preview);
  assert.deepEqual(preview.global, {
    referenceCount: 0,
    activeNoteCount: 1,
    noteMoveCount: 1,
    scratchCount: 1,
    scratchMoveCount: 1,
    scratchNoteCount: 1,
    managementResumeAffected: true,
    analysisResumeAffected: true,
  });
  database
    .transaction(() =>
      deleteInventoryItem(
        database,
        {
          itemId: root.itemId,
          expectedCurrentRevisionId: root.revisionId,
          expectedDataRevision: preview.dataRevision,
        },
        timestamp,
      ),
    )
    .immediate();
  assert.equal(readContextScratch(database, null), undefined);
  assert.deepEqual(
    database
      .prepare(
        'SELECT selected_item_id AS itemId FROM workspace_management_resume WHERE context_id IS NULL',
      )
      .get(),
    { itemId: null },
  );
  assert.deepEqual(
    database
      .prepare(
        'SELECT item_id AS itemId, analysis_scratch_draft_id AS scratchId FROM workspace_analysis_resume WHERE context_id IS NULL',
      )
      .get(),
    { itemId: null, scratchId: null },
  );
  assert.ok(readPlayout(database, freeWorkScope()));
});

test('keeps unrelated unbound scratch work when deleting inventory', (t) => {
  const { database, root } = fixture(t);
  const scratch = startAnalysisScratch('independent', rules.initialState());
  replaceContextAnalysisScratch(database, {
    contextId: null,
    scratch,
    expectedScratchId: null,
    expectedScratchRevision: null,
    occurredAt: timestamp,
  });
  const preview = previewInventoryItemDeletion(database, {
    itemId: root.itemId,
  });
  assert.ok(preview);
  assert.equal(preview.global.scratchCount, 0);
  database
    .transaction(() =>
      deleteInventoryItem(
        database,
        {
          itemId: root.itemId,
          expectedCurrentRevisionId: root.revisionId,
          expectedDataRevision: preview.dataRevision,
        },
        timestamp,
      ),
    )
    .immediate();
  assert.deepEqual(readContextScratch(database, null), scratch);
});

test('rejects stale data or item revisions before deleting any local work', (t) => {
  const { database, root, context } = usageFixture(t);
  const preview = previewInventoryItemDeletion(database, {
    itemId: root.itemId,
  });
  assert.ok(preview);
  const originalScratch = readContextScratch(database, context.contextId);
  const confirm = (dataRevision: number, revisionId = root.revisionId) =>
    database
      .transaction(() =>
        deleteInventoryItem(
          database,
          {
            itemId: root.itemId,
            expectedCurrentRevisionId: revisionId,
            expectedDataRevision: dataRevision,
          },
          timestamp,
        ),
      )
      .immediate();
  assert.throws(
    () => confirm(preview.dataRevision, localId('item-revision', 999)),
    { problemCode: 'inventory.deletion_conflict' },
  );
  incrementDataRevision(database, timestamp);
  assert.throws(() => confirm(preview.dataRevision), {
    problemCode: 'inventory.deletion_conflict',
  });
  assert.deepEqual(
    readContextScratch(database, context.contextId),
    originalScratch,
  );
  assert.equal(
    previewInventoryItemDeletion(database, { itemId: root.itemId })?.contexts
      .length,
    2,
  );
});

test('rolls back context cleanup if the final lifecycle write fails', (t) => {
  const { database, root, context } = usageFixture(t);
  const preview = previewInventoryItemDeletion(database, {
    itemId: root.itemId,
  });
  assert.ok(preview);
  const originalScratch = readContextScratch(database, context.contextId);
  database.exec(
    "CREATE TRIGGER reject_trash BEFORE UPDATE OF lifecycle ON inventory_item BEGIN SELECT RAISE(ABORT, 'injected'); END",
  );
  assert.throws(
    () =>
      database
        .transaction(() =>
          deleteInventoryItem(
            database,
            {
              itemId: root.itemId,
              expectedCurrentRevisionId: preview.currentRevisionId,
              expectedDataRevision: preview.dataRevision,
            },
            timestamp,
          ),
        )
        .immediate(),
    /injected/,
  );
  assert.deepEqual(
    previewInventoryItemDeletion(database, { itemId: root.itemId }),
    preview,
  );
  assert.deepEqual(
    readContextScratch(database, context.contextId),
    originalScratch,
  );
});

test('reports targeted revision losses separately from all work removed with context membership', (t) => {
  const { database, root, context, affectedNote } = usageFixture(t);
  const inserted = database
    .prepare(
      `INSERT INTO workspace_pending_revision_impact
    (context_id, item_id, pinned_revision_id, target_revision_id, target_anchor_id, impact_version, created_at_utc, updated_at_utc)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      context.contextId.value,
      root.itemId.value,
      root.revisionId.value,
      root.revisionId.value,
      root.rootAnchorId.value,
      timestamp,
      timestamp,
    );
  const impactId = localId('revision-impact', Number(inserted.lastInsertRowid));
  for (const [kind, subjectId] of [
    ['contribution', affectedNote.value],
    ['analysis_resume', context.contextId.value],
  ] as const) {
    database
      .prepare(
        'INSERT INTO workspace_revision_impact_entry (impact_id, entry_kind, subject_id, old_anchor_id) VALUES (?, ?, ?, ?)',
      )
      .run(impactId.value, kind, subjectId, root.rootAnchorId.value);
  }
  const impact = readPendingRevisionImpact(database, impactId);
  assert.ok(impact);
  assert.deepEqual(impact.useTargetLoss, {
    referenceCount: 0,
    activeNoteCount: 1,
    noteMoveCount: 1,
    scratchCount: 1,
    scratchMoveCount: 2,
    scratchNoteCount: 1,
    managementResumeAffected: false,
    analysisResumeAffected: true,
  });
  assert.deepEqual(impact.removeFromContextLoss, {
    referenceCount: 1,
    activeNoteCount: 2,
    noteMoveCount: 2,
    scratchCount: 1,
    scratchMoveCount: 2,
    scratchNoteCount: 1,
    managementResumeAffected: true,
    analysisResumeAffected: true,
  });
  insertAnalysisNoteContribution(database, {
    itemId: root.itemId,
    anchorId: root.rootAnchorId,
    note: { body: 'Added after the preview', moves: [] },
    noteScope: { kind: 'context', contextId: context.contextId },
    languageTag: 'en-GB',
    occurredAt: timestamp,
  });
  incrementDataRevision(database, timestamp);
  const changed = readPendingRevisionImpact(database, impactId);
  assert.equal(changed?.impactVersion, impact.impactVersion);
  assert.equal(changed?.removeFromContextLoss.activeNoteCount, 3);
  assert.throws(
    () =>
      database
        .transaction(() =>
          resolvePendingRevisionImpact(
            database,
            {
              impactId,
              expectedImpactVersion: impact.impactVersion,
              expectedDataRevision: impact.dataRevision,
              resolution: { kind: 'remove_from_context' },
            },
            timestamp,
          ),
        )
        .immediate(),
    { problemCode: 'workspace.impact_conflict' },
  );
  assert.deepEqual(readPendingRevisionImpact(database, impactId), changed);
  assert.ok(readContextScratch(database, context.contextId));
  const preview = previewInventoryItemDeletion(database, {
    itemId: root.itemId,
  });
  assert.ok(preview);
  database
    .transaction(() =>
      deleteInventoryItem(
        database,
        {
          itemId: root.itemId,
          expectedCurrentRevisionId: preview.currentRevisionId,
          expectedDataRevision: preview.dataRevision,
        },
        timestamp,
      ),
    )
    .immediate();
  assert.equal(readPendingRevisionImpact(database, impactId), undefined);
  assert.equal(
    database
      .prepare(
        'SELECT 1 FROM workspace_revision_impact_entry WHERE impact_id = ?',
      )
      .get(impactId.value),
    undefined,
  );
  assert.deepEqual(database.pragma('foreign_key_check'), []);
});
