import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import {
  SetManagementPresentation,
  type SetManagementPresentationRequest,
  type WorkspaceChanged,
} from '../../../app/application/workspace/index.ts';
import {
  freeWorkScope,
  contextWorkScope,
} from '../../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';
import { migrateStore } from '../../../app/infrastructure/adapters/persistence/sqlite/migrate.ts';
import { createAnalysisRecord } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-analysis-record.ts';
import {
  addContextReference,
  createWorkingContext,
  setWorkScopeResume,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-workspace.ts';
import { readDataRevision } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-store-helpers.ts';

const timestamp = '2026-09-30T12:00:00.000Z';
const later = '2026-09-30T12:01:00.000Z';
const free = freeWorkScope();

function fixture(t: TestContext) {
  const directory = mkdtempSync(
    join(tmpdir(), 'plysmith-management-presentation-'),
  );
  const databasePath = join(directory, 'store.sqlite');
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  migrateStore(db, true, timestamp);
  let store = new SqlitePersistenceAdapter({
    databasePath,
    now: () => timestamp,
  });
  const events: WorkspaceChanged[] = [];
  const useCase = () =>
    new SetManagementPresentation({
      writer: store,
      clock: { now: () => later },
      events: { publish: (event) => events.push(event) },
    });
  t.after(async () => {
    await store.close();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    db,
    events,
    get store() {
      return store;
    },
    execute: (request: SetManagementPresentationRequest) =>
      useCase().execute(request),
    async reopen() {
      await store.close();
      store = new SqlitePersistenceAdapter({ databasePath, now: () => later });
    },
    context: (displayName: string) =>
      createWorkingContext(db, { displayName }, timestamp).context.contextId,
    record: () =>
      createAnalysisRecord(db, {
        displayName: 'Selected',
        languageTag: 'en-GB',
        origin: { kind: 'initial_position' },
        root: new ChessJsRulesAdapter().initialState(),
        steps: [],
        occurredAt: timestamp,
      }),
  };
}

test('management presentation has independent free and context slots and survives cold reopening', async (t) => {
  const f = fixture(t);
  const first = contextWorkScope(f.context('First'));
  const second = contextWorkScope(f.context('Second'));
  assert.ok(first.kind === 'context' && second.kind === 'context');
  const untouched = contextWorkScope(f.context('Untouched'));
  const global = await f.execute({
    scope: free,
    expectedResumeVersion: null,
    presentation: 'origins',
  });
  const own = await f.execute({
    scope: first,
    expectedResumeVersion: null,
    presentation: 'folders',
  });
  const other = await f.execute({
    scope: second,
    expectedResumeVersion: null,
    presentation: 'origins',
  });
  assert.equal(global.resume.resumeVersion, 1);
  assert.equal(own.resume.resumeVersion, 1);
  assert.equal(other.resume.resumeVersion, 1);
  assert.equal(
    (await f.store.readWorkScopeWorkspace(untouched))?.managementResume,
    undefined,
  );
  await f.reopen();
  for (const [scope, expected] of [
    [free, global],
    [first, own],
    [second, other],
  ] as const) {
    assert.deepEqual(
      (await f.store.readWorkScopeWorkspace(scope))?.managementResume,
      expected.resume,
    );
  }
  assert.deepEqual(
    f.events.map((event) =>
      event.kind === 'workspace.resume-updated' ? event.contextId : undefined,
    ),
    [undefined, first.contextId, second.contextId],
  );
});

test('presentation changes preserve exact selections and pending revision impacts without work access checks', async (t) => {
  const f = fixture(t);
  const item = f.record();
  const contextId = f.context('Review');
  addContextReference(
    f.db,
    { contextId, itemId: item.itemId, anchorId: item.rootAnchorId },
    timestamp,
  );
  const scope = contextWorkScope(contextId);
  for (const target of [free, scope])
    setWorkScopeResume(
      f.db,
      {
        scope: target,
        area: 'manage',
        expectedResumeVersion: null,
        presentation: 'folders',
        selectedItemId: item.itemId,
        selectedAnchorId: item.rootAnchorId,
      },
      timestamp,
    );
  const inserted = f.db
    .prepare(
      `INSERT INTO workspace_pending_revision_impact
    (context_id, item_id, pinned_revision_id, target_revision_id, target_anchor_id,
     impact_version, created_at_utc, updated_at_utc)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      contextId.value,
      item.itemId.value,
      item.revisionId.value,
      item.revisionId.value,
      item.rootAnchorId.value,
      timestamp,
      timestamp,
    );
  f.db
    .prepare(
      `INSERT INTO workspace_revision_impact_entry
    (impact_id, entry_kind, subject_id, old_anchor_id)
    VALUES (?, 'management_resume', ?, ?)`,
    )
    .run(inserted.lastInsertRowid, contextId.value, item.rootAnchorId.value);
  const impacts = f.db
    .prepare('SELECT * FROM workspace_pending_revision_impact')
    .all();
  const entries = f.db
    .prepare('SELECT * FROM workspace_revision_impact_entry')
    .all();
  const membership = f.db.prepare('SELECT * FROM workspace_context_item').all();
  for (const target of [free, scope]) {
    const result = await f.execute({
      scope: target,
      expectedResumeVersion: 1,
      presentation: 'origins',
    });
    assert.deepEqual(result.resume, {
      resumeVersion: 2,
      presentation: 'origins',
      selectedItemId: item.itemId,
      selectedAnchorId: item.rootAnchorId,
      updatedAt: later,
    });
  }
  assert.deepEqual(
    f.db.prepare('SELECT * FROM workspace_pending_revision_impact').all(),
    impacts,
  );
  assert.deepEqual(
    f.db.prepare('SELECT * FROM workspace_revision_impact_entry').all(),
    entries,
  );
  assert.deepEqual(
    f.db.prepare('SELECT * FROM workspace_context_item').all(),
    membership,
  );
  assert.deepEqual(f.db.pragma('foreign_key_check'), []);
});

test('presentation CAS rejects stale and invalid writes, and matching values are no-ops only after CAS', async (t) => {
  const f = fixture(t);
  const initial = await f.execute({
    scope: free,
    expectedResumeVersion: null,
    presentation: 'folders',
  });
  const unchanged = await f.execute({
    scope: free,
    expectedResumeVersion: 1,
    presentation: 'folders',
  });
  assert.deepEqual(unchanged, initial);
  assert.equal(f.events.length, 1);
  const before = readDataRevision(f.db);
  await assert.rejects(
    f.execute({
      scope: free,
      expectedResumeVersion: null,
      presentation: 'folders',
    }),
    { problemCode: 'workspace.resume_revision_conflict' },
  );
  for (const presentation of ['list', 'atlas', 'unknown']) {
    await assert.rejects(
      f.execute({
        scope: free,
        expectedResumeVersion: 1,
        presentation,
      } as SetManagementPresentationRequest),
      { problemCode: 'workspace.invalid_resume' },
    );
    assert.throws(() =>
      f.db
        .prepare('UPDATE workspace_management_resume SET presentation = ?')
        .run(presentation),
    );
  }
  const concurrent = await Promise.allSettled(
    [2, 3].map(() =>
      f.execute({
        scope: free,
        expectedResumeVersion: 1,
        presentation: 'origins',
      }),
    ),
  );
  assert.equal(
    concurrent.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    concurrent.filter((result) => result.status === 'rejected').length,
    1,
  );
  assert.equal(readDataRevision(f.db), before + 1);
  assert.equal(f.events.length, 2);
});
