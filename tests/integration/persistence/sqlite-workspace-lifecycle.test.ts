import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import {
  appendAnalysisMove,
  prepareAnalysisNote,
  startAnalysisScratch,
} from '../../../app/domain/analysis/index.ts';
import { pausePlayoutDraft } from '../../../app/domain/playout/index.ts';
import {
  contextWorkScope,
  freeWorkScope,
} from '../../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { migrateStore } from '../../../app/infrastructure/adapters/persistence/sqlite/migrate.ts';
import {
  createAnalysisRecord,
  readAnalysisRecordView,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-analysis-record.ts';
import {
  createAnalysisNote,
  insertAnalysisNoteContribution,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-analysis-note.ts';
import { readFreeAnalysisWorkspace } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-context-analysis.ts';
import {
  readContextScratch,
  replaceContextAnalysisScratch,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-analysis-scratch.ts';
import {
  removeContextItemUsage,
  requireContextInventoryWorkAccess,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-context-item.ts';
import {
  createPlayout,
  readPlayout,
  removeContextPlayoutDraft,
  replacePlayout,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-playout.ts';
import { readDataRevision } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-store-helpers.ts';
import {
  addContextReference,
  createWorkingContext,
  deleteWorkingContext,
  previewContextItemRemoval,
  previewWorkingContextDeletion,
  readStartupResume,
  readWorkingContextWorkspace,
  readWorkScopeWorkspace,
  removeContextItem,
  setStartupResume,
  setWorkScopeResume,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-workspace.ts';

const timestamp = '2026-09-27T12:00:00.000Z';
const rules = new ChessJsRulesAdapter();
const free = freeWorkScope();

function fixture(t: TestContext) {
  const directory = mkdtempSync(
    join(tmpdir(), 'plysmith-workspace-lifecycle-'),
  );
  const path = join(directory, 'store.sqlite');
  let database = new Database(path);
  database.pragma('foreign_keys = ON');
  migrateStore(database, true, timestamp);
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    get db() {
      return database;
    },
    tx<T>(action: () => T): T {
      return database.transaction(action)();
    },
    reopen() {
      database.close();
      database = new Database(path);
      database.pragma('foreign_keys = ON');
      migrateStore(database, false, timestamp);
    },
    context(name = 'Context') {
      return createWorkingContext(database, { displayName: name }, timestamp)
        .context.contextId;
    },
    record(name = 'Record') {
      return createAnalysisRecord(database, {
        displayName: name,
        languageTag: 'en-GB',
        origin: { kind: 'initial_position' },
        root: rules.initialState(),
        steps: [],
        occurredAt: timestamp,
      });
    },
  };
}

function move(state: ReturnType<typeof rules.initialState>, value: string) {
  const result = rules.applyMove(state, [], { kind: 'coordinates', value });
  assert.ok(result.ok);
  return result.value;
}

test('free scratch and both resumes survive reopening independently without a hidden context', (t) => {
  const f = fixture(t);
  const record = f.tx(() => f.record());
  const managed = f.tx(() =>
    setWorkScopeResume(
      f.db,
      {
        scope: free,
        area: 'manage',
        expectedResumeVersion: null,
        presentation: 'list',
        selectedItemId: record.itemId,
        selectedAnchorId: record.rootAnchorId,
      },
      timestamp,
    ),
  );
  const scratch = appendAnalysisMove(
    startAnalysisScratch('free-scratch', rules.initialState(), {
      kind: 'initial_position',
    }),
    move(rules.initialState(), 'e2e4'),
  );
  const saved = f.tx(() =>
    replaceContextAnalysisScratch(f.db, {
      contextId: null,
      scratch,
      expectedScratchId: null,
      expectedScratchRevision: null,
      occurredAt: timestamp,
    }),
  );
  assert.equal(
    (
      f.db
        .prepare('SELECT count(*) AS n FROM workspace_working_context')
        .get() as { n: number }
    ).n,
    0,
  );
  const contextId = f.tx(() => f.context());
  const own = startAnalysisScratch('context-scratch', rules.initialState(), {
    kind: 'initial_position',
  });
  f.tx(() =>
    replaceContextAnalysisScratch(f.db, {
      contextId,
      scratch: own,
      expectedScratchId: null,
      expectedScratchRevision: null,
      occurredAt: timestamp,
    }),
  );
  f.reopen();
  assert.deepEqual(readContextScratch(f.db, null), scratch);
  assert.deepEqual(readContextScratch(f.db, contextId), own);
  const workspace = readWorkScopeWorkspace(f.db, free);
  assert.equal(
    workspace?.managementResume?.resumeVersion,
    managed.resume.resumeVersion,
  );
  assert.deepEqual(workspace?.managementResume?.selectedItemId, record.itemId);
  assert.equal(workspace?.analysisResume?.resumeVersion, saved.resumeVersion);
  assert.equal(workspace?.analysisResume?.scratchId, scratch.scratchId);
  const before = readDataRevision(f.db);
  assert.throws(
    () =>
      f.tx(() =>
        replaceContextAnalysisScratch(f.db, {
          contextId: null,
          scratch,
          expectedScratchId: null,
          expectedScratchRevision: null,
          occurredAt: timestamp,
        }),
      ),
    { problemCode: 'analysis.scratch_revision_conflict' },
  );
  assert.throws(
    () =>
      f.tx(() =>
        setWorkScopeResume(
          f.db,
          {
            scope: free,
            area: 'manage',
            expectedResumeVersion: null,
            presentation: 'list',
          },
          timestamp,
        ),
      ),
    { problemCode: 'workspace.resume_revision_conflict' },
  );
  assert.equal(readDataRevision(f.db), before);
});

test('startup resume uses CAS and explains deleted or missing contexts without reconstructing them', (t) => {
  const f = fixture(t);
  assert.deepEqual(readStartupResume(f.db), {
    scope: free,
    area: 'manage',
    startupVersion: null,
    dataRevision: 0,
  });
  const scratch = startAnalysisScratch('own-free-work', rules.initialState(), {
    kind: 'initial_position',
  });
  f.tx(() =>
    replaceContextAnalysisScratch(f.db, {
      contextId: null,
      scratch,
      expectedScratchId: null,
      expectedScratchRevision: null,
      occurredAt: timestamp,
    }),
  );
  const contextId = f.tx(() => f.context());
  const saved = f.tx(() =>
    setStartupResume(
      f.db,
      {
        scope: contextWorkScope(contextId),
        area: 'analyze',
        expectedStartupVersion: null,
      },
      timestamp,
    ),
  );
  f.reopen();
  assert.deepEqual(readStartupResume(f.db), saved);
  assert.throws(
    () =>
      f.tx(() =>
        setStartupResume(
          f.db,
          { scope: free, area: 'manage', expectedStartupVersion: null },
          timestamp,
        ),
      ),
    { problemCode: 'workspace.startup_revision_conflict' },
  );
  const preview = previewWorkingContextDeletion(f.db, { contextId });
  f.tx(() =>
    deleteWorkingContext(
      f.db,
      {
        contextId,
        expectedDataRevision: preview.dataRevision,
        expectedContextVersion: preview.contextVersion,
      },
      timestamp,
      (id) => removeContextPlayoutDraft(f.db, id.value),
    ),
  );
  const deleted = readStartupResume(f.db);
  assert.deepEqual(deleted.scope, free);
  assert.equal(deleted.area, 'analyze');
  assert.equal(deleted.unavailableContext?.reason, 'deleted');
  assert.equal(deleted.unavailableContext?.displayName, 'Context');
  assert.equal(
    readFreeAnalysisWorkspace(f.db).scratch?.scratchId,
    scratch.scratchId,
  );
  assert.equal(readWorkingContextWorkspace(f.db, contextId), undefined);
  assert.throws(
    () =>
      f.tx(() =>
        setStartupResume(
          f.db,
          {
            scope: contextWorkScope(contextId),
            area: 'manage',
            expectedStartupVersion: saved.startupVersion,
          },
          timestamp,
        ),
      ),
    { problemCode: 'workspace.context_not_found' },
  );
  f.db.prepare('UPDATE workspace_startup_resume SET context_id = 999').run();
  assert.equal(readStartupResume(f.db).unavailableContext?.reason, 'missing');
  assert.equal(
    f.db
      .prepare('SELECT 1 FROM workspace_working_context WHERE context_id = 999')
      .get(),
    undefined,
  );
});

test('item removal previews resolved notes and bound scratch without resume item, and rejects stale confirmation', (t) => {
  const f = fixture(t);
  const record = f.tx(() => f.record());
  const contextId = f.tx(() => f.context());
  const otherId = f.tx(() => f.context('Other'));
  for (const id of [contextId, otherId])
    f.tx(() =>
      addContextReference(
        f.db,
        { contextId: id, itemId: record.itemId, anchorId: record.rootAnchorId },
        timestamp,
      ),
    );
  const note = insertAnalysisNoteContribution(f.db, {
    itemId: record.itemId,
    anchorId: record.rootAnchorId,
    note: { body: 'Resolved but visible', moves: [] },
    noteScope: { kind: 'context', contextId },
    languageTag: 'en-GB',
    occurredAt: timestamp,
  });
  f.db
    .prepare(
      "UPDATE workspace_contribution SET status = 'resolved' WHERE contribution_id = ?",
    )
    .run(note.value);
  const origin = {
    kind: 'inventory_anchor' as const,
    itemId: record.itemId,
    revisionId: record.revisionId,
    anchorId: record.rootAnchorId,
  };
  const scratch = prepareAnalysisNote(
    appendAnalysisMove(
      startAnalysisScratch('bound', rules.initialState(), origin),
      move(rules.initialState(), 'd2d4'),
    ),
    'Unsaved branch',
  );
  f.tx(() =>
    replaceContextAnalysisScratch(f.db, {
      contextId,
      scratch,
      expectedScratchId: null,
      expectedScratchRevision: null,
      occurredAt: timestamp,
    }),
  );
  f.db
    .prepare(
      'UPDATE workspace_analysis_resume SET item_id = NULL, revision_id = NULL, anchor_id = NULL WHERE context_id = ?',
    )
    .run(contextId.value);
  const preview = previewContextItemRemoval(f.db, {
    contextId,
    itemId: record.itemId,
  });
  assert.equal(preview.losses.notes[0]?.body, 'Resolved but visible');
  assert.equal(preview.losses.scratch?.stepCount, 1);
  assert.equal(preview.losses.scratch?.noteBody, 'Unsaved branch');
  assert.equal(preview.losses.analysisResume?.scratchId, 'bound');
  f.tx(() =>
    setStartupResume(
      f.db,
      { scope: free, area: 'manage', expectedStartupVersion: null },
      timestamp,
    ),
  );
  assert.throws(
    () =>
      f.tx(() =>
        removeContextItem(
          f.db,
          {
            contextId,
            itemId: record.itemId,
            expectedContextVersion: preview.contextVersion,
            expectedDataRevision: preview.dataRevision,
          },
          timestamp,
        ),
      ),
    { problemCode: 'workspace.removal_preview_conflict' },
  );
  assert.deepEqual(readContextScratch(f.db, contextId), scratch);
  const fresh = previewContextItemRemoval(f.db, {
    contextId,
    itemId: record.itemId,
  });
  f.tx(() =>
    removeContextItem(
      f.db,
      {
        contextId,
        itemId: record.itemId,
        expectedContextVersion: fresh.contextVersion,
        expectedDataRevision: fresh.dataRevision,
      },
      timestamp,
    ),
  );
  assert.equal(readContextScratch(f.db, contextId), undefined);
  assert.equal(
    readWorkScopeWorkspace(f.db, contextWorkScope(contextId))?.analysisResume
      ?.itemId,
    undefined,
  );
  assert.equal(
    readWorkScopeWorkspace(f.db, contextWorkScope(contextId))?.analysisResume
      ?.scratchId,
    undefined,
  );
  assert.equal(
    (
      f.db
        .prepare(
          'SELECT status FROM workspace_contribution WHERE contribution_id = ?',
        )
        .get(note.value) as { status: string }
    ).status,
    'archived',
  );
  assert.equal(
    readWorkingContextWorkspace(f.db, otherId)?.references.length,
    1,
  );
  assert.ok(
    readAnalysisRecordView(f.db, {
      itemId: record.itemId,
      revisionId: record.revisionId,
      anchorId: record.rootAnchorId,
    }),
  );
});

test('context deletion removes its paused playout snapshot and unreferenced positions but preserves free work', (t) => {
  const f = fixture(t);
  const record = f.tx(() => f.record());
  const contextId = f.tx(() => f.context());
  const scope = contextWorkScope(contextId);
  f.tx(() =>
    addContextReference(
      f.db,
      { contextId, itemId: record.itemId, anchorId: record.rootAnchorId },
      timestamp,
    ),
  );
  const sourceMove = move(rules.initialState(), 'e2e4');
  const policy = {
    capability: 'best_move' as const,
    providerInstanceId: 'test',
    providerFingerprint: 'test:v1',
    providerType: 'test',
    providerDisplayName: 'Test',
  };
  const local = f.tx(() =>
    createPlayout(f.db, {
      scope,
      origin: {
        kind: 'inventory_anchor',
        itemId: record.itemId,
        revisionId: record.revisionId,
        anchorId: record.rootAnchorId,
      },
      root: sourceMove.after,
      sourcePath: {
        displayName: 'Record',
        root: rules.initialState(),
        steps: [sourceMove],
      },
      playerSide: 'black',
      policy,
      initialUserMove: move(sourceMove.after, 'e7e5'),
      occurredAt: timestamp,
    }),
  );
  f.tx(() =>
    replacePlayout(f.db, {
      scope,
      expectedDraftRevision: local.draft.draftRevision,
      draft: pausePlayoutDraft(local.draft),
      occurredAt: timestamp,
    }),
  );
  const independent = f.tx(() =>
    createPlayout(f.db, {
      scope: free,
      origin: { kind: 'initial_position' },
      root: rules.initialState(),
      playerSide: 'white',
      policy,
      occurredAt: timestamp,
    }),
  );
  const beforeFree = readPlayout(f.db, free)?.draft;
  const ids = f.db
    .prepare(
      'SELECT after_position_id AS id FROM playout_source_ply WHERE draft_id = ? UNION SELECT after_position_id AS id FROM playout_ply WHERE draft_id = ?',
    )
    .all(local.draft.draftId.value, local.draft.draftId.value) as {
    id: number;
  }[];
  assert.equal(ids.length, 2);
  const preview = previewWorkingContextDeletion(f.db, { contextId });
  assert.equal(preview.losses.playout?.status, 'paused');
  assert.equal(preview.losses.playout?.moveCount, 1);
  const itemPreview = previewContextItemRemoval(f.db, {
    contextId,
    itemId: record.itemId,
  });
  assert.equal(itemPreview.losses.playout, undefined);
  assert.equal(
    itemPreview.retainedPlayout?.draftId.value,
    local.draft.draftId.value,
  );
  f.tx(() =>
    setStartupResume(
      f.db,
      { scope, area: 'playout', expectedStartupVersion: null },
      timestamp,
    ),
  );
  let cleanupCalls = 0;
  const remove = (id: typeof contextId) => {
    cleanupCalls++;
    removeContextPlayoutDraft(f.db, id.value);
  };
  assert.throws(
    () =>
      f.tx(() =>
        deleteWorkingContext(
          f.db,
          {
            contextId,
            expectedContextVersion: preview.contextVersion,
            expectedDataRevision: preview.dataRevision,
          },
          timestamp,
          remove,
        ),
      ),
    { problemCode: 'workspace.removal_preview_conflict' },
  );
  assert.equal(cleanupCalls, 0);
  assert.ok(readPlayout(f.db, scope));
  const fresh = previewWorkingContextDeletion(f.db, { contextId });
  f.tx(() =>
    deleteWorkingContext(
      f.db,
      {
        contextId,
        expectedContextVersion: fresh.contextVersion,
        expectedDataRevision: fresh.dataRevision,
      },
      timestamp,
      remove,
    ),
  );
  assert.equal(cleanupCalls, 1);
  assert.equal(readPlayout(f.db, scope), undefined);
  assert.equal(
    f.db
      .prepare('SELECT 1 FROM playout_source_ply WHERE draft_id = ?')
      .get(local.draft.draftId.value),
    undefined,
  );
  assert.equal(
    f.db
      .prepare('SELECT 1 FROM playout_ply WHERE draft_id = ?')
      .get(local.draft.draftId.value),
    undefined,
  );
  for (const { id } of ids)
    assert.equal(
      f.db
        .prepare('SELECT 1 FROM chess_position WHERE position_id = ?')
        .get(id),
      undefined,
    );
  assert.deepEqual(readPlayout(f.db, free)?.draft, beforeFree);
  assert.equal(
    readPlayout(f.db, free)?.draft.draftId.value,
    independent.draft.draftId.value,
  );
  assert.ok(
    readAnalysisRecordView(f.db, {
      itemId: record.itemId,
      revisionId: record.revisionId,
      anchorId: record.rootAnchorId,
    }),
  );
  assert.equal(
    f.db
      .prepare('SELECT 1 FROM workspace_context_item WHERE context_id = ?')
      .get(contextId.value),
    undefined,
  );
  assert.deepEqual(f.db.pragma('foreign_key_check'), []);
});

test('free record and note commits consume scratch atomically and restore the correct persistent resume', (t) => {
  const f = fixture(t);
  const scratch = appendAnalysisMove(
    startAnalysisScratch('record', rules.initialState(), {
      kind: 'initial_position',
    }),
    move(rules.initialState(), 'e2e4'),
  );
  f.tx(() =>
    replaceContextAnalysisScratch(f.db, {
      contextId: null,
      scratch,
      expectedScratchId: null,
      expectedScratchRevision: null,
      occurredAt: timestamp,
    }),
  );
  const input = {
    sourceScope: free,
    expectedScratchId: scratch.scratchId,
    expectedScratchRevision: scratch.scratchRevision,
    displayName: 'Saved',
    languageTag: 'en-GB',
    origin: scratch.origin,
    root: scratch.root,
    steps: scratch.steps,
    occurredAt: timestamp,
  };
  assert.throws(
    () =>
      f.tx(() =>
        createAnalysisRecord(f.db, { ...input, expectedScratchRevision: 1 }),
      ),
    { problemCode: 'analysis.scratch_revision_conflict' },
  );
  assert.deepEqual(readContextScratch(f.db, null), scratch);
  const record = f.tx(() => createAnalysisRecord(f.db, input));
  assert.equal(readContextScratch(f.db, null), undefined);
  f.reopen();
  const workspace = readFreeAnalysisWorkspace(f.db);
  assert.equal(workspace.record?.itemId.value, record.itemId.value);
  assert.equal(workspace.record?.cursor, 1);
  const origin = {
    kind: 'inventory_anchor' as const,
    itemId: record.itemId,
    revisionId: record.revisionId,
    anchorId: record.rootAnchorId,
  };
  const noted = prepareAnalysisNote(
    appendAnalysisMove(
      startAnalysisScratch('note', scratch.root, origin),
      move(scratch.root, 'd2d4'),
    ),
    'Stored note',
  );
  f.tx(() =>
    replaceContextAnalysisScratch(f.db, {
      contextId: null,
      scratch: noted,
      expectedScratchId: null,
      expectedScratchRevision: null,
      occurredAt: timestamp,
    }),
  );
  f.tx(() =>
    createAnalysisNote(f.db, {
      sourceScope: free,
      expectedScratchId: noted.scratchId,
      expectedScratchRevision: noted.scratchRevision,
      origin,
      note: noted.noteDraft!,
      noteScope: { kind: 'global' },
      languageTag: 'en-GB',
      occurredAt: timestamp,
    }),
  );
  assert.equal(readContextScratch(f.db, null), undefined);
  assert.equal(readFreeAnalysisWorkspace(f.db).record?.cursor, 0);
});

test('global usage cleanup handles null scope and free work rejects trashed origins while historical reads remain available', (t) => {
  const f = fixture(t);
  const record = f.tx(() => f.record());
  const origin = {
    kind: 'inventory_anchor' as const,
    itemId: record.itemId,
    revisionId: record.revisionId,
    anchorId: record.rootAnchorId,
  };
  const scratch = startAnalysisScratch(
    'free-bound',
    rules.initialState(),
    origin,
  );
  f.tx(() =>
    replaceContextAnalysisScratch(f.db, {
      contextId: null,
      scratch,
      expectedScratchId: null,
      expectedScratchRevision: null,
      occurredAt: timestamp,
    }),
  );
  f.db
    .prepare(
      'UPDATE workspace_analysis_resume SET item_id = NULL, revision_id = NULL, anchor_id = NULL WHERE context_id IS NULL',
    )
    .run();
  const note = insertAnalysisNoteContribution(f.db, {
    itemId: record.itemId,
    anchorId: record.rootAnchorId,
    note: { body: 'Global', moves: [] },
    noteScope: { kind: 'global' },
    languageTag: 'en-GB',
    occurredAt: timestamp,
  });
  f.tx(() =>
    removeContextItemUsage(f.db, {
      contextId: null,
      itemId: record.itemId.value,
      occurredAt: timestamp,
    }),
  );
  assert.equal(readContextScratch(f.db, null), undefined);
  assert.equal(
    readWorkScopeWorkspace(f.db, free)?.analysisResume?.itemId,
    undefined,
  );
  assert.equal(
    readWorkScopeWorkspace(f.db, free)?.analysisResume?.scratchId,
    undefined,
  );
  assert.equal(
    (
      f.db
        .prepare(
          'SELECT status FROM workspace_contribution WHERE contribution_id = ?',
        )
        .get(note.value) as { status: string }
    ).status,
    'archived',
  );
  f.db
    .prepare(
      "UPDATE inventory_item SET lifecycle = 'trashed' WHERE item_id = ?",
    )
    .run(record.itemId.value);
  assert.throws(() =>
    requireContextInventoryWorkAccess(f.db, free, record.itemId),
  );
  assert.ok(
    readAnalysisRecordView(f.db, {
      itemId: record.itemId,
      revisionId: record.revisionId,
      anchorId: record.rootAnchorId,
    }),
  );
});
