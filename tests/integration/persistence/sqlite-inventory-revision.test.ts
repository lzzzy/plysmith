import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import Database from 'better-sqlite3';

import {
  CreateAnalysisRecord,
  CreatePositionNote,
  FreeAnalysisSession,
  UpdateAnalysisScratch,
} from '../../../app/application/analysis/index.ts';
import {
  GetInventoryRevision,
  GetPendingRevisionImpact,
  ListInventoryRevisions,
  PreviewInventoryRevision,
  ResolvePendingRevisionImpact,
  SaveInventoryRevision,
  StartInventoryRevision,
} from '../../../app/application/inventory/index.ts';
import {
  AddContextReference,
  CreateWorkingContext,
  GetWorkingContextWorkspace,
  SetWorkScopeResume,
} from '../../../app/application/workspace/index.ts';
import type { AnchorId } from '../../../app/domain/identity/index.ts';
import {
  contextWorkScope,
  freeWorkScope,
} from '../../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';
import { analysisContentFingerprint } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-analysis-content-fingerprint.ts';

const timestamp = '2026-09-14T12:00:00.000Z';
const noEvents = { publish: () => undefined };
const storeDatabasePaths = new WeakMap<SqlitePersistenceAdapter, string>();

function storeFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'plysmith-revision-'));
  const databasePath = join(directory, 'store.sqlite');
  const stores: SqlitePersistenceAdapter[] = [];
  t.after(async () => {
    for (const store of stores) await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const store = new SqlitePersistenceAdapter({
    databasePath,
    now: () => timestamp,
  });
  storeDatabasePaths.set(store, databasePath);
  stores.push(store);
  return store;
}

function inspectStore<T>(
  store: SqlitePersistenceAdapter,
  inspect: (database: Database.Database) => T,
): T {
  const databasePath = storeDatabasePaths.get(store);
  assert.ok(databasePath);
  const database = new Database(databasePath, { readonly: true });
  try {
    return inspect(database);
  } finally {
    database.close();
  }
}

function useCases(store: SqlitePersistenceAdapter) {
  const freeSession = new FreeAnalysisSession();
  const rules = new ChessJsRulesAdapter();
  let scratchSequence = 0;
  const clock = { now: () => timestamp };
  const update = new UpdateAnalysisScratch({
    reader: store,
    writer: store,
    freeSession,
    rules,
    storeStatus: store,
    clock,
    events: noEvents,
    scratchId: () => `scratch-${++scratchSequence}`,
  });
  return {
    freeSession,
    update,
    createRecord: new CreateAnalysisRecord({
      reader: store,
      writer: store,
      freeSession,
      clock,
      inventoryEvents: noEvents,
      workspaceEvents: noEvents,
    }),
    createPositionNote: new CreatePositionNote({
      writer: store,
      clock,
      events: noEvents,
    }),
    startRevision: new StartInventoryRevision({
      inventory: store,
      contextReader: store,
      contextWriter: store,
      freeSession,
      rules,
      clock,
      events: noEvents,
      storeStatus: store,
      scratchId: () => `scratch-${++scratchSequence}`,
    }),
    previewRevision: new PreviewInventoryRevision({
      inventory: store,
      contextReader: store,
      freeSession,
    }),
    saveRevision: new SaveInventoryRevision({
      reader: store,
      writer: store,
      freeSession,
      clock,
      inventoryEvents: noEvents,
      impactEvents: noEvents,
      scratchEvents: noEvents,
    }),
    getRevision: new GetInventoryRevision(store),
    listRevisions: new ListInventoryRevisions(store),
    getImpact: new GetPendingRevisionImpact(store),
    resolveImpact: new ResolvePendingRevisionImpact({
      writer: store,
      clock,
      events: noEvents,
    }),
    createContext: new CreateWorkingContext({
      writer: store,
      clock,
      events: noEvents,
    }),
    addReference: new AddContextReference({
      writer: store,
      clock,
      events: noEvents,
    }),
    setResume: new SetWorkScopeResume({
      writer: store,
      clock,
      events: noEvents,
    }),
    getContext: new GetWorkingContextWorkspace(store),
  };
}

async function createFrenchLine(
  cases: ReturnType<typeof useCases>,
  displayName = 'Französisch',
) {
  const scope = freeWorkScope();
  let current = await cases.update.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  for (const value of ['e4', 'e6', 'd4', 'd5'] as const) {
    current = await cases.update.execute({
      scope,
      expectedScratchId: current.scratch?.scratchId ?? '',
      expectedScratchRevision: current.scratch?.scratchRevision ?? -1,
      action: {
        kind: 'apply_move',
        move: { kind: 'notation', value, locale: 'de-DE' },
      },
    });
  }
  const record = await cases.createRecord.execute({
    scope,
    expectedScratchId: current.scratch?.scratchId ?? '',
    expectedScratchRevision: current.scratch?.scratchRevision ?? -1,
    displayName,
    languageTag: 'de-DE',
  });
  return cases.getRevision.execute({
    scope,
    itemId: record.itemId,
    revisionId: record.revisionId,
    anchorId: record.rootAnchorId,
  });
}

async function appendMove(
  cases: ReturnType<typeof useCases>,
  base: Awaited<ReturnType<typeof createFrenchLine>>,
  anchorId: AnchorId,
  move: string,
) {
  const scope = freeWorkScope();
  const started = await cases.startRevision.execute({
    scope,
    itemId: base.itemId,
    baseRevisionId: base.revisionId,
    anchorId,
    mode: 'extend',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: move, locale: 'de-DE' },
  });
  const preview = await cases.previewRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  });
  return cases.saveRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
    previewFingerprint: preview.previewFingerprint,
  });
}

test('publishes an immutable extension with stable prefix anchors', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const firstEnd = first.steps.at(-1)?.anchorId;
  assert.ok(firstEnd);
  const beforeSave = await store.readStoreStatus();

  const saved = await appendMove(cases, first, firstEnd, 'Nc3');
  assert.equal(saved.revisionNumber, 2);
  assert.equal(saved.impacts.length, 0);
  assert.equal(saved.dataRevision, beforeSave.dataRevision + 1);

  const historical = await cases.getRevision.execute({
    scope: freeWorkScope(),
    itemId: first.itemId,
    revisionId: first.revisionId,
    anchorId: first.rootAnchorId,
  });
  const current = await cases.getRevision.execute({
    scope: freeWorkScope(),
    itemId: first.itemId,
    revisionId: saved.revisionId,
    anchorId: saved.currentAnchorId,
  });
  assert.equal(historical.historical, true);
  assert.deepEqual(
    historical.steps.map((step) => step.move.san),
    ['e4', 'e6', 'd4', 'd5'],
  );
  assert.deepEqual(
    current.steps.map((step) => step.move.san),
    ['e4', 'e6', 'd4', 'd5', 'Nc3'],
  );
  assert.deepEqual(
    current.steps.slice(0, 4).map((step) => step.anchorId),
    first.steps.map((step) => step.anchorId),
  );

  const history = await cases.listRevisions.execute({
    itemId: first.itemId,
  });
  assert.deepEqual(
    history.revisions.map((revision) => [
      revision.revisionNumber,
      revision.current,
      revision.changeKind,
    ]),
    [
      [2, true, 'extend'],
      [1, false, 'created'],
    ],
  );
});

test('renames an analysis without changing its line and advances compatible contexts', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const contextA = await cases.createContext.execute({ displayName: 'A' });
  const contextB = await cases.createContext.execute({ displayName: 'B' });
  await cases.addReference.execute({
    contextId: contextA.context.contextId,
    itemId: first.itemId,
    anchorId: first.rootAnchorId,
  });
  await cases.addReference.execute({
    contextId: contextB.context.contextId,
    itemId: first.itemId,
    anchorId: first.steps.at(-1)!.anchorId,
  });

  const started = await cases.startRevision.execute({
    scope: freeWorkScope(),
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: first.steps[1]!.anchorId,
    mode: 'metadata',
    displayName: 'Französisch mit Plan',
    summary: 'Aktualisierte Beschreibung.',
    expectedScratchId: null,
    expectedScratchRevision: null,
  });
  const preview = await cases.previewRevision.execute({
    scope: freeWorkScope(),
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  });

  assert.equal(preview.displayName, 'Französisch mit Plan');
  assert.equal(preview.summary, 'Aktualisierte Beschreibung.');
  assert.equal(preview.preservedMoveCount, first.steps.length);
  assert.equal(preview.addedSteps.length, 0);
  assert.equal(preview.removedSteps.length, 0);
  assert.equal(preview.affectedContexts.length, 0);
  assert.deepEqual(
    preview.followingContexts.map((context) => context.contextName),
    ['A', 'B'],
  );

  const saved = await cases.saveRevision.execute({
    scope: freeWorkScope(),
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
    previewFingerprint: preview.previewFingerprint,
  });
  assert.equal(saved.impacts.length, 0);
  assert.equal(saved.currentAnchorId.value, first.steps[1]!.anchorId.value);

  for (const context of [contextA, contextB]) {
    const workspace = await cases.getContext.execute({
      contextId: context.context.contextId,
    });
    assert.equal(
      workspace.references[0]?.currentRevisionId.value,
      saved.revisionId.value,
    );
    assert.equal(workspace.context.pendingRevisionImpactCount, 0);
  }
});

test('rejects duplicate active analysis names', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  await createFrenchLine(cases, 'Französisch');

  await assert.rejects(createFrenchLine(cases, ' FRANZÖSISCH '), {
    problemCode: 'analysis.invalid_record',
  });
});

test('rejects renaming an analysis to another active analysis name', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  await createFrenchLine(cases, 'Französisch');
  const second = await createFrenchLine(cases, 'Sizilianisch');
  const started = await cases.startRevision.execute({
    scope: freeWorkScope(),
    itemId: second.itemId,
    baseRevisionId: second.revisionId,
    anchorId: second.rootAnchorId,
    mode: 'metadata',
    displayName: 'FRANZÖSISCH',
    expectedScratchId: null,
    expectedScratchRevision: null,
  });

  await assert.rejects(
    cases.previewRevision.execute({
      scope: freeWorkScope(),
      expectedScratchId: started.scratch.scratchId,
      expectedScratchRevision: started.scratch.scratchRevision,
    }),
    { problemCode: 'inventory.invalid_revision' },
  );
});

test('pins an affected context until all replace impacts are resolved', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const root = first.rootAnchorId;
  const replaced = first.steps.at(-1)?.anchorId;
  assert.ok(replaced);
  const contextA = await cases.createContext.execute({ displayName: 'A' });
  const contextB = await cases.createContext.execute({ displayName: 'B' });
  await cases.addReference.execute({
    contextId: contextA.context.contextId,
    itemId: first.itemId,
    anchorId: root,
  });
  await cases.addReference.execute({
    contextId: contextB.context.contextId,
    itemId: first.itemId,
    anchorId: replaced,
  });
  await cases.createPositionNote.execute({
    scope: contextWorkScope(contextB.context.contextId),
    itemId: first.itemId,
    revisionId: first.revisionId,
    anchorId: replaced,
    body: 'Die alte Fortsetzung im Context.',
    languageTag: 'de-DE',
    noteScope: {
      kind: 'context',
      contextId: contextB.context.contextId,
    },
  });
  await cases.setResume.execute({
    contextId: contextB.context.contextId,
    area: 'analyze',
    expectedResumeVersion: null,
    mode: 'analyze',
    itemId: first.itemId,
    revisionId: first.revisionId,
    anchorId: replaced,
  });

  const scope = freeWorkScope();
  const started = await cases.startRevision.execute({
    scope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: replaced,
    mode: 'replace_move',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: 'Nf6', locale: 'de-DE' },
  });
  const preview = await cases.previewRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  });
  assert.equal(preview.affectedContexts.length, 1);
  assert.deepEqual(
    {
      contextId: preview.affectedContexts[0]?.contextId,
      references: preview.affectedContexts[0]?.referenceCount,
      contributions: preview.affectedContexts[0]?.contributionCount,
      analysisResumes: preview.affectedContexts[0]?.analysisResumeCount,
    },
    {
      contextId: contextB.context.contextId,
      references: 1,
      contributions: 1,
      analysisResumes: 1,
    },
  );
  const saved = await cases.saveRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
    previewFingerprint: preview.previewFingerprint,
  });
  assert.equal(saved.impacts.length, 1);
  const impactId = saved.impacts[0]?.impactId;
  assert.ok(impactId);

  const pinned = await cases.getContext.execute({
    contextId: contextB.context.contextId,
  });
  assert.equal(
    pinned.references[0]?.currentRevisionId.value,
    first.revisionId.value,
  );
  assert.equal(pinned.context.pendingRevisionImpactCount, 1);
  assert.deepEqual(
    pinned.pendingRevisionImpacts.map((summary) => ({
      impactId: summary.impactId,
      itemId: summary.itemId,
      pinnedRevisionId: summary.pinnedRevisionId,
      targetRevisionId: summary.targetRevisionId,
      impactVersion: summary.impactVersion,
      entryCount: summary.entryCount,
    })),
    [
      {
        impactId,
        itemId: first.itemId,
        pinnedRevisionId: first.revisionId,
        targetRevisionId: saved.revisionId,
        impactVersion: 1,
        entryCount: 3,
      },
    ],
  );
  assert.equal(pinned.context.pendingRevisionImpactCount, 1);
  assert.deepEqual(
    pinned.pendingRevisionImpacts.map((summary) => ({
      impactId: summary.impactId,
      itemId: summary.itemId,
      pinnedRevisionId: summary.pinnedRevisionId,
      targetRevisionId: summary.targetRevisionId,
      impactVersion: summary.impactVersion,
      entryCount: summary.entryCount,
    })),
    [
      {
        impactId,
        itemId: first.itemId,
        pinnedRevisionId: first.revisionId,
        targetRevisionId: saved.revisionId,
        impactVersion: 1,
        entryCount: 3,
      },
    ],
  );
  const following = await cases.getContext.execute({
    contextId: contextA.context.contextId,
  });
  assert.equal(
    following.references[0]?.currentRevisionId.value,
    saved.revisionId.value,
  );

  const impact = await cases.getImpact.execute({ impactId });
  assert.equal(impact.targetAnchorId.value, saved.currentAnchorId.value);
  assert.equal(impact.referenceCount, 1);
  assert.equal(impact.contributionCount, 1);
  assert.equal(impact.analysisResumeAffected, true);
  await cases.resolveImpact.execute({
    impactId,
    expectedImpactVersion: impact.impactVersion,
    resolution: { kind: 'use_target' },
  });

  const resolved = await cases.getContext.execute({
    contextId: contextB.context.contextId,
  });
  assert.equal(
    resolved.references[0]?.currentRevisionId.value,
    saved.revisionId.value,
  );
  assert.equal(
    resolved.references[0]?.anchorId.value,
    saved.currentAnchorId.value,
  );
  assert.equal(
    resolved.analysisResume?.revisionId?.value,
    saved.revisionId.value,
  );
  assert.equal(
    resolved.analysisResume?.anchorId?.value,
    saved.currentAnchorId.value,
  );
  assert.equal(resolved.context.pendingRevisionImpactCount, 0);
  assert.deepEqual(resolved.pendingRevisionImpacts, []);
  assert.equal(resolved.context.pendingRevisionImpactCount, 0);
  assert.deepEqual(resolved.pendingRevisionImpacts, []);

  const oldRecord = await cases.getRevision.execute({
    scope: contextWorkScope(contextB.context.contextId),
    itemId: first.itemId,
    revisionId: first.revisionId,
    anchorId: replaced,
  });
  const newRecord = await cases.getRevision.execute({
    scope: contextWorkScope(contextB.context.contextId),
    itemId: first.itemId,
    revisionId: saved.revisionId,
    anchorId: saved.currentAnchorId,
  });
  assert.equal(oldRecord.contributions.length, 0);
  assert.equal(newRecord.contributions.length, 0);
});

test('moves an impacted reference to the changed line and keeps surviving references', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const replaced = first.steps[0]?.anchorId;
  assert.ok(replaced);
  const context = await cases.createContext.execute({
    displayName: 'Zusammenfuehren',
  });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: first.itemId,
    anchorId: first.rootAnchorId,
  });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: first.itemId,
    anchorId: replaced,
  });

  const scope = freeWorkScope();
  const started = await cases.startRevision.execute({
    scope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: replaced,
    mode: 'replace_move',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: 'd4', locale: 'de-DE' },
  });
  const preview = await cases.previewRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  });
  const saved = await cases.saveRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
    previewFingerprint: preview.previewFingerprint,
  });
  const impactId = saved.impacts[0]?.impactId;
  assert.ok(impactId);
  const impact = await cases.getImpact.execute({ impactId });
  assert.equal(impact.referenceCount, 1);
  assert.equal(impact.targetAnchorId.value, saved.currentAnchorId.value);

  await cases.resolveImpact.execute({
    impactId,
    expectedImpactVersion: impact.impactVersion,
    resolution: { kind: 'use_target' },
  });

  const resolved = await cases.getContext.execute({
    contextId: context.context.contextId,
  });
  assert.equal(resolved.context.pendingRevisionImpactCount, 0);
  assert.deepEqual(
    resolved.references.map((reference) => reference.anchorId.value).sort(),
    [first.rootAnchorId.value, saved.currentAnchorId.value].sort(),
  );
  assert.ok(
    resolved.references.every(
      (reference) =>
        reference.currentRevisionId.value === saved.revisionId.value,
    ),
  );
});

test('keeps the previous version as a separately named analysis in the context', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const replaced = first.steps.at(-1)?.anchorId;
  assert.ok(replaced);
  const context = await cases.createContext.execute({
    displayName: 'Alte Variante',
  });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: first.itemId,
    anchorId: replaced,
  });
  await cases.createPositionNote.execute({
    scope: contextWorkScope(context.context.contextId),
    itemId: first.itemId,
    revisionId: first.revisionId,
    anchorId: replaced,
    body: 'Diese Variante bleibt erhalten.',
    languageTag: 'de-DE',
    noteScope: { kind: 'context', contextId: context.context.contextId },
  });

  const scope = freeWorkScope();
  const started = await cases.startRevision.execute({
    scope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: replaced,
    mode: 'replace_move',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: 'Nf6', locale: 'de-DE' },
  });
  const preview = await cases.previewRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  });
  const saved = await cases.saveRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
    previewFingerprint: preview.previewFingerprint,
  });
  const impactId = saved.impacts[0]?.impactId;
  assert.ok(impactId);
  const impact = await cases.getImpact.execute({ impactId });
  const resolution = await cases.resolveImpact.execute({
    impactId,
    expectedImpactVersion: impact.impactVersion,
    resolution: {
      kind: 'keep_copy',
      displayName: 'Französisch – bisherige Fassung',
    },
  });

  assert.equal(resolution.resolution, 'keep_copy');
  assert.ok(resolution.contextItemId);
  assert.ok(resolution.contextRevisionId);
  assert.notEqual(resolution.contextItemId.value, first.itemId.value);
  const workspace = await cases.getContext.execute({
    contextId: context.context.contextId,
  });
  assert.equal(workspace.context.pendingRevisionImpactCount, 0);
  assert.equal(workspace.references.length, 1);
  assert.equal(
    workspace.references[0]?.itemId.value,
    resolution.contextItemId.value,
  );
  assert.equal(
    workspace.references[0]?.currentRevisionId.value,
    resolution.contextRevisionId.value,
  );

  const copied = await cases.getRevision.execute({
    scope: contextWorkScope(context.context.contextId),
    itemId: resolution.contextItemId,
    revisionId: resolution.contextRevisionId,
    anchorId: workspace.references[0]!.anchorId,
  });
  assert.equal(copied.displayName, 'Französisch – bisherige Fassung');
  assert.deepEqual(
    copied.steps.map((step) => step.move.san),
    first.steps.map((step) => step.move.san),
  );
  assert.equal(copied.contributions.length, 1);

  const inventory = await store.searchInventory({
    query: 'Französisch – bisherige Fassung',
    pageSize: 10,
  });
  assert.equal(inventory.items.length, 1);
  assert.equal(
    inventory.items[0]?.itemId.value,
    resolution.contextItemId.value,
  );
});

test('removes an affected analysis and its context content from the context', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const replaced = first.steps.at(-1)?.anchorId;
  assert.ok(replaced);
  const context = await cases.createContext.execute({
    displayName: 'Ohne Variante',
  });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: first.itemId,
    anchorId: replaced,
  });
  await cases.createPositionNote.execute({
    scope: contextWorkScope(context.context.contextId),
    itemId: first.itemId,
    revisionId: first.revisionId,
    anchorId: replaced,
    body: 'Wird mit der Analyse entfernt.',
    languageTag: 'de-DE',
    noteScope: { kind: 'context', contextId: context.context.contextId },
  });
  await cases.setResume.execute({
    contextId: context.context.contextId,
    area: 'analyze',
    expectedResumeVersion: null,
    mode: 'analyze',
    itemId: first.itemId,
    revisionId: first.revisionId,
    anchorId: replaced,
  });

  const scope = freeWorkScope();
  const started = await cases.startRevision.execute({
    scope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: replaced,
    mode: 'replace_move',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: 'Nf6', locale: 'de-DE' },
  });
  const preview = await cases.previewRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  });
  const saved = await cases.saveRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
    previewFingerprint: preview.previewFingerprint,
  });
  const impactId = saved.impacts[0]?.impactId;
  assert.ok(impactId);
  const impact = await cases.getImpact.execute({ impactId });
  const resolution = await cases.resolveImpact.execute({
    impactId,
    expectedImpactVersion: impact.impactVersion,
    resolution: { kind: 'remove_from_context' },
  });

  assert.equal(resolution.resolution, 'remove_from_context');
  assert.equal(resolution.contextItemId, undefined);
  assert.equal(resolution.contextRevisionId, undefined);
  const workspace = await cases.getContext.execute({
    contextId: context.context.contextId,
  });
  assert.equal(workspace.context.pendingRevisionImpactCount, 0);
  assert.deepEqual(workspace.references, []);
  assert.equal(workspace.analysisResume?.itemId, undefined);
  assert.equal(workspace.analysisResume?.revisionId, undefined);
  assert.equal(workspace.analysisResume?.anchorId, undefined);

  const current = await cases.getRevision.execute({
    scope: freeWorkScope(),
    itemId: first.itemId,
    revisionId: saved.revisionId,
    anchorId: saved.currentAnchorId,
  });
  assert.equal(current.historical, false);
});

test('supports root-only truncation and keeps a true no-op unpublished', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const scope = freeWorkScope();
  const beforeNoOp = await store.readStoreStatus();
  const noOpScratch = await cases.startRevision.execute({
    scope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: first.steps.at(-1)!.anchorId,
    mode: 'extend',
    expectedScratchId: null,
    expectedScratchRevision: null,
  });
  const noOpPreview = await cases.previewRevision.execute({
    scope,
    expectedScratchId: noOpScratch.scratch.scratchId,
    expectedScratchRevision: noOpScratch.scratch.scratchRevision,
  });
  assert.equal(noOpPreview.noOp, true);
  const noOp = await cases.saveRevision.execute({
    scope,
    expectedScratchId: noOpScratch.scratch.scratchId,
    expectedScratchRevision: noOpScratch.scratch.scratchRevision,
    previewFingerprint: noOpPreview.previewFingerprint,
  });
  assert.equal(noOp.noOp, true);
  assert.deepEqual(await store.readStoreStatus(), beforeNoOp);
  assert.equal(
    cases.freeSession.read()?.scratchId,
    noOpScratch.scratch.scratchId,
  );
  await cases.update.execute({
    scope,
    expectedScratchId: noOpScratch.scratch.scratchId,
    expectedScratchRevision: noOpScratch.scratch.scratchRevision,
    action: { kind: 'discard' },
  });

  const truncateScratch = await cases.startRevision.execute({
    scope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: first.rootAnchorId,
    mode: 'truncate_after',
    expectedScratchId: null,
    expectedScratchRevision: null,
    displayName: 'Französisch Ausgangsstellung',
    summary: 'Bewusst auf die Ausgangsstellung gekürzt.',
  });
  const truncatePreview = await cases.previewRevision.execute({
    scope,
    expectedScratchId: truncateScratch.scratch.scratchId,
    expectedScratchRevision: truncateScratch.scratch.scratchRevision,
  });
  assert.equal(truncatePreview.preservedMoveCount, 0);
  assert.equal(truncatePreview.removedSteps.length, 4);
  const truncated = await cases.saveRevision.execute({
    scope,
    expectedScratchId: truncateScratch.scratch.scratchId,
    expectedScratchRevision: truncateScratch.scratch.scratchRevision,
    previewFingerprint: truncatePreview.previewFingerprint,
  });
  const record = await cases.getRevision.execute({
    scope,
    itemId: first.itemId,
    revisionId: truncated.revisionId,
    anchorId: truncated.currentAnchorId,
  });
  assert.equal(record.steps.length, 0);
  assert.equal(record.displayName, 'Französisch Ausgangsstellung');
  assert.equal(record.summary, 'Bewusst auf die Ausgangsstellung gekürzt.');
  assert.equal(record.rootAnchorId.value, first.rootAnchorId.value);
});

test('rejects a preview after a newly affected dependency appears', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const replaced = first.steps.at(-1)!.anchorId;
  const scope = freeWorkScope();
  const started = await cases.startRevision.execute({
    scope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: replaced,
    mode: 'replace_move',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: 'Nf6', locale: 'de-DE' },
  });
  const preview = await cases.previewRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  });
  assert.equal(preview.affectedContexts.length, 0);
  const context = await cases.createContext.execute({ displayName: 'Spät' });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: first.itemId,
    anchorId: replaced,
  });
  await assert.rejects(
    cases.saveRevision.execute({
      scope,
      expectedScratchId: started.scratch.scratchId,
      expectedScratchRevision: started.scratch.scratchRevision,
      previewFingerprint: preview.previewFingerprint,
    }),
    { problemCode: 'inventory.preview_conflict' },
  );
  assert.equal(cases.freeSession.read()?.scratchId, started.scratch.scratchId);
  assert.equal(
    (await cases.listRevisions.execute({ itemId: first.itemId })).revisions
      .length,
    1,
  );
});

test('consumes a context revision scratch and resumes at the new line end', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const context = await cases.createContext.execute({ displayName: 'Context' });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: first.itemId,
    anchorId: first.rootAnchorId,
  });
  const scope = contextWorkScope(context.context.contextId);
  const started = await cases.startRevision.execute({
    scope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: first.steps.at(-1)!.anchorId,
    mode: 'extend',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: 'Nc3', locale: 'de-DE' },
  });
  const preview = await cases.previewRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  });
  const saved = await cases.saveRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
    previewFingerprint: preview.previewFingerprint,
  });
  const workspace = await store.readContextAnalysisWorkspace(
    context.context.contextId,
  );
  assert.equal(workspace?.scratch, undefined);
  assert.equal(workspace?.record?.revisionId.value, saved.revisionId.value);
  assert.equal(
    workspace?.record?.currentAnchorId.value,
    saved.currentAnchorId.value,
  );
});

test('using the new version discards a competing context revision draft', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const lineEnd = first.steps.at(-1)!.anchorId;
  const context = await cases.createContext.execute({
    displayName: 'Parallel',
  });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: first.itemId,
    anchorId: first.rootAnchorId,
  });
  const contextScope = contextWorkScope(context.context.contextId);
  const competing = await cases.startRevision.execute({
    scope: contextScope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: lineEnd,
    mode: 'extend',
    expectedScratchId: null,
    expectedScratchRevision: null,
  });

  const publisherScope = freeWorkScope();
  const started = await cases.startRevision.execute({
    scope: publisherScope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: lineEnd,
    mode: 'extend',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: 'Nc3', locale: 'de-DE' },
  });
  const preview = await cases.previewRevision.execute({
    scope: publisherScope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  });
  assert.equal(preview.affectedContexts.length, 1);
  assert.equal(preview.affectedContexts[0]?.analysisResumeCount, 1);
  const saved = await cases.saveRevision.execute({
    scope: publisherScope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
    previewFingerprint: preview.previewFingerprint,
  });
  const impactId = saved.impacts[0]?.impactId;
  assert.ok(impactId);
  const impact = await cases.getImpact.execute({ impactId });
  await cases.resolveImpact.execute({
    impactId,
    expectedImpactVersion: impact.impactVersion,
    resolution: { kind: 'use_target' },
  });
  const workspace = await cases.getContext.execute({
    contextId: context.context.contextId,
  });
  assert.equal(
    workspace.analysisResume?.revisionId?.value,
    saved.revisionId.value,
  );
  await assert.rejects(
    cases.update.execute({
      scope: contextScope,
      expectedScratchId: competing.scratch.scratchId,
      expectedScratchRevision: competing.scratch.scratchRevision,
      action: { kind: 'discard' },
    }),
    { problemCode: 'analysis.scratch_revision_conflict' },
  );
});

test('rebases a compatible exploration scratch to the new revision', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const lineEnd = first.steps.at(-1)!.anchorId;
  const context = await cases.createContext.execute({ displayName: 'Analyse' });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: first.itemId,
    anchorId: first.rootAnchorId,
  });
  const scope = contextWorkScope(context.context.contextId);
  const exploration = await cases.update.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: first.itemId,
        revisionId: first.revisionId,
        anchorId: lineEnd,
      },
    },
  });

  const saved = await appendMove(cases, first, lineEnd, 'Nc3');
  const workspace = await store.readContextAnalysisWorkspace(
    context.context.contextId,
  );
  assert.equal(workspace?.scratch?.scratchId, exploration.scratch?.scratchId);
  assert.equal(workspace?.scratch?.origin.kind, 'inventory_anchor');
  if (workspace?.scratch?.origin.kind !== 'inventory_anchor') {
    assert.fail('Expected inventory-backed exploration scratch.');
  }
  assert.equal(
    workspace.scratch.origin.revisionId.value,
    saved.revisionId.value,
  );
  assert.equal(workspace.record?.revisionId.value, saved.revisionId.value);
});

test('rejects context writes while a revision impact is open', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const replaced = first.steps.at(-1)!.anchorId;
  const context = await cases.createContext.execute({
    displayName: 'Gesperrt',
  });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: first.itemId,
    anchorId: replaced,
  });
  const scope = freeWorkScope();
  const started = await cases.startRevision.execute({
    scope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: replaced,
    mode: 'replace_move',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: 'Nf6', locale: 'de-DE' },
  });
  const preview = await cases.previewRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  });
  await cases.saveRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
    previewFingerprint: preview.previewFingerprint,
  });

  await assert.rejects(
    cases.addReference.execute({
      contextId: context.context.contextId,
      itemId: first.itemId,
      anchorId: first.rootAnchorId,
    }),
    { problemCode: 'workspace.impact_conflict' },
  );
});

test('copies a later pinned revision without reviving archived notes', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const firstEnd = first.steps.at(-1)!.anchorId;
  const context = await cases.createContext.execute({
    displayName: 'Historische Notiz',
  });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: first.itemId,
    anchorId: firstEnd,
  });
  await cases.createPositionNote.execute({
    scope: contextWorkScope(context.context.contextId),
    itemId: first.itemId,
    revisionId: first.revisionId,
    anchorId: firstEnd,
    body: 'Nur an der ersten Fassung.',
    languageTag: 'de-DE',
    noteScope: { kind: 'context', contextId: context.context.contextId },
  });

  const secondScratch = await cases.startRevision.execute({
    scope: freeWorkScope(),
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: firstEnd,
    mode: 'replace_move',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: 'Nf6', locale: 'de-DE' },
  });
  const secondPreview = await cases.previewRevision.execute({
    scope: freeWorkScope(),
    expectedScratchId: secondScratch.scratch.scratchId,
    expectedScratchRevision: secondScratch.scratch.scratchRevision,
  });
  const second = await cases.saveRevision.execute({
    scope: freeWorkScope(),
    expectedScratchId: secondScratch.scratch.scratchId,
    expectedScratchRevision: secondScratch.scratch.scratchRevision,
    previewFingerprint: secondPreview.previewFingerprint,
  });
  const firstImpactId = second.impacts[0]?.impactId;
  assert.ok(firstImpactId);
  const firstImpact = await cases.getImpact.execute({
    impactId: firstImpactId,
  });
  await cases.resolveImpact.execute({
    impactId: firstImpactId,
    expectedImpactVersion: firstImpact.impactVersion,
    resolution: { kind: 'use_target' },
  });

  const secondRecord = await cases.getRevision.execute({
    scope: freeWorkScope(),
    itemId: first.itemId,
    revisionId: second.revisionId,
    anchorId: second.currentAnchorId,
  });
  const thirdScratch = await cases.startRevision.execute({
    scope: freeWorkScope(),
    itemId: first.itemId,
    baseRevisionId: second.revisionId,
    anchorId: second.currentAnchorId,
    mode: 'replace_move',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: 'd5', locale: 'de-DE' },
  });
  const thirdPreview = await cases.previewRevision.execute({
    scope: freeWorkScope(),
    expectedScratchId: thirdScratch.scratch.scratchId,
    expectedScratchRevision: thirdScratch.scratch.scratchRevision,
  });
  const third = await cases.saveRevision.execute({
    scope: freeWorkScope(),
    expectedScratchId: thirdScratch.scratch.scratchId,
    expectedScratchRevision: thirdScratch.scratch.scratchRevision,
    previewFingerprint: thirdPreview.previewFingerprint,
  });
  const secondImpactId = third.impacts[0]?.impactId;
  assert.ok(secondImpactId);
  const secondImpact = await cases.getImpact.execute({
    impactId: secondImpactId,
  });
  const resolution = await cases.resolveImpact.execute({
    impactId: secondImpactId,
    expectedImpactVersion: secondImpact.impactVersion,
    resolution: {
      kind: 'keep_copy',
      displayName: 'Französisch – zweite Fassung',
    },
  });
  assert.ok(resolution.contextItemId);
  assert.ok(resolution.contextRevisionId);
  const copiedRevisionId = resolution.contextRevisionId;
  const workspace = await cases.getContext.execute({
    contextId: context.context.contextId,
  });
  const copied = await cases.getRevision.execute({
    scope: contextWorkScope(context.context.contextId),
    itemId: resolution.contextItemId,
    revisionId: resolution.contextRevisionId,
    anchorId: workspace.references[0]!.anchorId,
  });
  assert.deepEqual(
    copied.steps.map((step) => step.move.san),
    secondRecord.steps.map((step) => step.move.san),
  );
  assert.equal(copied.contributions.length, 0);

  inspectStore(store, (database) => {
    const counts = database
      .prepare(
        `SELECT
           (SELECT count(*) FROM workspace_pending_revision_impact) AS impacts,
           (SELECT count(*) FROM workspace_revision_impact_entry) AS entries,
           (SELECT count(*) FROM workspace_contribution
             WHERE status = 'archived') AS archivedContributions`,
      )
      .get() as {
      impacts: number;
      entries: number;
      archivedContributions: number;
    };
    assert.deepEqual(counts, {
      impacts: 0,
      entries: 0,
      archivedContributions: 1,
    });
    const fingerprint = database
      .prepare(
        `SELECT content_fingerprint AS fingerprint FROM item_revision
          WHERE revision_id = ?`,
      )
      .get(copiedRevisionId.value) as { fingerprint: Buffer };
    assert.deepEqual(
      fingerprint.fingerprint,
      analysisContentFingerprint({
        displayName: copied.displayName,
        ...(copied.summary === undefined ? {} : { summary: copied.summary }),
        languageTag: copied.languageTag,
        originMode: copied.origin.kind,
        root: copied.root,
        steps: copied.steps,
      }),
    );
  });
});

test('keeps an unaffected analysis usable while another analysis needs review', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const affected = await createFrenchLine(cases, 'Betroffene Analyse');
  const unaffected = await createFrenchLine(cases, 'Unbetroffene Analyse');
  const affectedEnd = affected.steps.at(-1)!.anchorId;
  const context = await cases.createContext.execute({
    displayName: 'Zwei Analysen',
  });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: affected.itemId,
    anchorId: affectedEnd,
  });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: unaffected.itemId,
    anchorId: unaffected.rootAnchorId,
  });
  const affectedResume = await cases.setResume.execute({
    contextId: context.context.contextId,
    area: 'analyze',
    expectedResumeVersion: null,
    mode: 'analyze',
    itemId: affected.itemId,
    revisionId: affected.revisionId,
    anchorId: affectedEnd,
  });

  const revision = await cases.startRevision.execute({
    scope: freeWorkScope(),
    itemId: affected.itemId,
    baseRevisionId: affected.revisionId,
    anchorId: affectedEnd,
    mode: 'replace_move',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: 'Nf6', locale: 'de-DE' },
  });
  const preview = await cases.previewRevision.execute({
    scope: freeWorkScope(),
    expectedScratchId: revision.scratch.scratchId,
    expectedScratchRevision: revision.scratch.scratchRevision,
  });
  const saved = await cases.saveRevision.execute({
    scope: freeWorkScope(),
    expectedScratchId: revision.scratch.scratchId,
    expectedScratchRevision: revision.scratch.scratchRevision,
    previewFingerprint: preview.previewFingerprint,
  });
  const impactId = saved.impacts[0]?.impactId;
  assert.ok(impactId);

  const switched = await cases.setResume.execute({
    contextId: context.context.contextId,
    area: 'analyze',
    expectedResumeVersion: affectedResume.resume.resumeVersion,
    mode: 'analyze',
    itemId: unaffected.itemId,
    revisionId: unaffected.revisionId,
    anchorId: unaffected.rootAnchorId,
  });
  const exploration = await cases.update.execute({
    scope: contextWorkScope(context.context.contextId),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: unaffected.itemId,
        revisionId: unaffected.revisionId,
        anchorId: unaffected.rootAnchorId,
      },
    },
  });
  assert.ok(exploration.scratch);
  assert.ok(switched.resume.resumeVersion < exploration.resumeVersion!);
  const impact = await cases.getImpact.execute({ impactId });
  assert.equal(impact.analysisResumeAffected, false);
  await cases.resolveImpact.execute({
    impactId,
    expectedImpactVersion: impact.impactVersion,
    resolution: { kind: 'use_target' },
  });
  const workspace = await cases.getContext.execute({
    contextId: context.context.contextId,
  });
  assert.equal(
    workspace.analysisResume?.itemId?.value,
    unaffected.itemId.value,
  );
  const analysisWorkspace = await store.readContextAnalysisWorkspace(
    context.context.contextId,
  );
  assert.equal(analysisWorkspace?.scratch?.origin.kind, 'inventory_anchor');
});

test('rejects a historical analysis resume when the context follows a newer revision', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const context = await cases.createContext.execute({ displayName: 'Aktuell' });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: first.itemId,
    anchorId: first.rootAnchorId,
  });
  const second = await appendMove(
    cases,
    first,
    first.steps.at(-1)!.anchorId,
    'Nc3',
  );

  await assert.rejects(
    cases.setResume.execute({
      contextId: context.context.contextId,
      area: 'analyze',
      expectedResumeVersion: null,
      mode: 'analyze',
      itemId: first.itemId,
      revisionId: first.revisionId,
      anchorId: first.rootAnchorId,
    }),
    { problemCode: 'workspace.invalid_resume' },
  );
  await assert.rejects(
    cases.update.execute({
      scope: contextWorkScope(context.context.contextId),
      expectedScratchId: null,
      expectedScratchRevision: null,
      action: {
        kind: 'start',
        origin: {
          kind: 'inventory_anchor',
          itemId: first.itemId,
          revisionId: first.revisionId,
          anchorId: first.rootAnchorId,
        },
      },
    }),
    { problemCode: 'analysis.invalid_update' },
  );
  const resumed = await cases.setResume.execute({
    contextId: context.context.contextId,
    area: 'analyze',
    expectedResumeVersion: null,
    mode: 'analyze',
    itemId: first.itemId,
    revisionId: second.revisionId,
    anchorId: first.rootAnchorId,
  });
  assert.equal(resumed.area, 'analyze');
  assert.equal(resumed.resume.revisionId?.value, second.revisionId.value);
});

test('removes positions that only belonged to a discarded analysis scratch', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const context = await cases.createContext.execute({ displayName: 'Scratch' });
  const scope = contextWorkScope(context.context.contextId);
  let current = await cases.update.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  const rootPositionCount = inspectStore(store, (database) =>
    Number(
      (
        database
          .prepare('SELECT count(*) AS count FROM chess_position')
          .get() as {
          count: number;
        }
      ).count,
    ),
  );
  for (const value of ['a3', 'a6', 'h3'] as const) {
    current = await cases.update.execute({
      scope,
      expectedScratchId: current.scratch!.scratchId,
      expectedScratchRevision: current.scratch!.scratchRevision,
      action: {
        kind: 'apply_move',
        move: { kind: 'notation', value, locale: 'de-DE' },
      },
    });
  }
  const expandedPositionCount = inspectStore(store, (database) =>
    Number(
      (
        database
          .prepare('SELECT count(*) AS count FROM chess_position')
          .get() as {
          count: number;
        }
      ).count,
    ),
  );
  assert.ok(expandedPositionCount > rootPositionCount);
  await cases.update.execute({
    scope,
    expectedScratchId: current.scratch!.scratchId,
    expectedScratchRevision: current.scratch!.scratchRevision,
    action: { kind: 'discard' },
  });
  const discardedPositionCount = inspectStore(store, (database) =>
    Number(
      (
        database
          .prepare('SELECT count(*) AS count FROM chess_position')
          .get() as {
          count: number;
        }
      ).count,
    ),
  );
  assert.equal(discardedPositionCount, rootPositionCount);
});
