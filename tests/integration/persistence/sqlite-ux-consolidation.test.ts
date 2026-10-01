import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import {
  CreateAnalysisRecord,
  FreeAnalysisSession,
  UpdateAnalysisScratch,
} from '../../../app/application/analysis/index.ts';
import {
  CreateWorkingContext,
  UpdateWorkingContextMetadata,
  AddContextReference,
  SetWorkScopeResume,
} from '../../../app/application/workspace/index.ts';
import { SearchInventory } from '../../../app/application/inventory/index.ts';
import { freeWorkScope } from '../../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';

const clock = { now: () => '2026-09-27T12:00:00.000Z' };
const events = { publish: () => undefined };

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'plysmith-ux-'));
  const store = new SqlitePersistenceAdapter({
    databasePath: join(directory, 'store.sqlite'),
    now: clock.now,
  });
  t.after(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const freeSession = new FreeAnalysisSession({ persistence: store, clock });
  const update = new UpdateAnalysisScratch({
    reader: store,
    writer: store,
    freeSession,
    rules: new ChessJsRulesAdapter(),
    storeStatus: store,
    clock,
    events,
    scratchId: () => 'ux-scratch',
  });
  const create = new CreateAnalysisRecord({
    reader: store,
    writer: store,
    freeSession,
    clock,
    inventoryEvents: events,
    workspaceEvents: events,
  });
  const createContext = new CreateWorkingContext({
    writer: store,
    clock,
    events,
  });
  const addReference = new AddContextReference({
    writer: store,
    clock,
    events,
  });
  async function record(
    displayName: string,
    parent?: Awaited<ReturnType<CreateAnalysisRecord['execute']>>,
  ) {
    const started = await update.execute({
      scope: freeWorkScope(),
      expectedScratchId: null,
      expectedScratchRevision: null,
      action: {
        kind: 'start',
        origin:
          parent === undefined
            ? { kind: 'initial_position' }
            : {
                kind: 'inventory_anchor',
                itemId: parent.itemId,
                revisionId: parent.revisionId,
                anchorId: parent.rootAnchorId,
              },
      },
    });
    assert.ok(started.scratch);
    return create.execute({
      scope: freeWorkScope(),
      expectedScratchId: started.scratch.scratchId,
      expectedScratchRevision: started.scratch.scratchRevision,
      displayName,
      languageTag: 'en-GB',
    });
  }
  return { store, record, createContext, addReference };
}

test('context metadata uses CAS and preserves references and independent resumes', async (t) => {
  const f = fixture(t);
  const record = await f.record('Source');
  const created = await f.createContext.execute({
    displayName: 'Original',
    purpose: 'Initial purpose',
    boundary: 'Kept boundary',
    nextStep: 'Kept next step',
  });
  const contextId = created.context.contextId;
  await f.addReference.execute({
    contextId,
    itemId: record.itemId,
    anchorId: record.rootAnchorId,
  });
  await new SetWorkScopeResume({ writer: f.store, clock, events }).execute({
    scope: { kind: 'context', contextId },
    area: 'manage',
    expectedResumeVersion: null,
    presentation: 'folders',
    selectedItemId: record.itemId,
    selectedAnchorId: record.rootAnchorId,
  });
  const before = await f.store.readWorkingContextWorkspace(contextId);
  assert.ok(before);
  const published: unknown[] = [];
  const update = new UpdateWorkingContextMetadata({
    writer: f.store,
    clock,
    events: { publish: (event) => published.push(event) },
  });
  const renamed = await update.execute({
    contextId,
    expectedContextVersion: before.context.contextVersion,
    displayName: 'Renamed',
    purpose: 'New description',
  });
  assert.equal(
    renamed.context.contextVersion,
    before.context.contextVersion + 1,
  );
  assert.equal(renamed.dataRevision, before.dataRevision + 1);
  assert.equal(renamed.context.purpose, 'New description');
  assert.equal(renamed.context.boundary, 'Kept boundary');
  assert.equal(renamed.context.nextStep, 'Kept next step');
  const after = await f.store.readWorkingContextWorkspace(contextId);
  assert.deepEqual(after?.references, before.references);
  assert.deepEqual(after?.managementResume, before.managementResume);
  assert.deepEqual(after?.analysisResume, before.analysisResume);
  await assert.rejects(
    update.execute({
      contextId,
      expectedContextVersion: before.context.contextVersion,
      displayName: 'Stale',
    }),
    { problemCode: 'workspace.context_version_conflict' },
  );
  assert.equal(
    (await f.store.readStoreStatus()).dataRevision,
    renamed.dataRevision,
  );
  assert.equal(published.length, 1);
  const unchanged = await update.execute({
    contextId,
    expectedContextVersion: renamed.context.contextVersion,
    displayName: 'Renamed again',
  });
  assert.equal(unchanged.context.purpose, 'New description');
  const cleared = await update.execute({
    contextId,
    expectedContextVersion: unchanged.context.contextVersion,
    displayName: 'Renamed again',
    purpose: null,
  });
  assert.equal(cleared.context.purpose, undefined);
  await assert.rejects(
    update.execute({
      contextId,
      expectedContextVersion: cleared.context.contextVersion,
      displayName: '   ',
    }),
    { problemCode: 'workspace.invalid_context' },
  );
});

test('inventory families include real ancestors beyond query, scope and page without inventing memberships', async (t) => {
  const f = fixture(t);
  const root = await f.record('Original root');
  const middle = await f.record('Middle branch', root);
  const leaf = await f.record('Needle leaf', middle);
  const independent = await f.record('Needle independent');
  const context = await f.createContext.execute({
    displayName: 'Leaf context',
  });
  await f.addReference.execute({
    contextId: context.context.contextId,
    itemId: leaf.itemId,
    anchorId: leaf.rootAnchorId,
  });
  const search = new SearchInventory(f.store);
  const scoped = await search.execute({
    query: 'Needle',
    contextId: context.context.contextId,
    pageSize: 1,
  });
  assert.deepEqual(
    scoped.items.map((item) => item.itemId),
    [leaf.itemId],
  );
  assert.deepEqual(
    scoped.ancestors.map((item) => item.itemId),
    [middle.itemId, root.itemId],
  );
  assert.ok(scoped.ancestors.every((item) => item.contextIds.length === 0));
  assert.equal(scoped.nextCursor, undefined);
  assert.deepEqual(scoped.provenanceEdges, [
    {
      itemId: leaf.itemId,
      sourceItemId: middle.itemId,
      sourceRevisionId: middle.revisionId,
      sourceAnchorId: middle.rootAnchorId,
    },
    {
      itemId: middle.itemId,
      sourceItemId: root.itemId,
      sourceRevisionId: root.revisionId,
      sourceAnchorId: root.rootAnchorId,
    },
  ]);
  const first = await search.execute({ query: 'Needle', pageSize: 1 });
  assert.deepEqual(
    first.items.map((item) => item.itemId),
    [independent.itemId],
  );
  assert.deepEqual(first.ancestors, []);
  assert.deepEqual(first.provenanceEdges, []);
  assert.ok(first.nextCursor);
  const second = await search.execute({
    query: 'Needle',
    pageSize: 1,
    cursor: first.nextCursor,
  });
  assert.deepEqual(
    second.items.map((item) => item.itemId),
    [leaf.itemId],
  );
  assert.deepEqual(second.provenanceEdges, scoped.provenanceEdges);
  await assert.rejects(
    search.execute({ query: 'Middle', cursor: first.nextCursor }),
    { problemCode: 'inventory.invalid_search' },
  );
  await f.createContext.execute({ displayName: 'Changed data' });
  await assert.rejects(
    search.execute({ query: 'Needle', cursor: first.nextCursor }),
    { problemCode: 'inventory.invalid_search' },
  );
});
