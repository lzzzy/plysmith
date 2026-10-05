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
  GetAnalysisWorkspace,
  UpdateAnalysisScratch,
} from '../../../app/application/analysis/index.ts';
import {
  GetInventoryRevision,
  GetPendingRevisionImpact,
  ListInventoryRevisions,
  PromoteAnalysisToInventoryRevision,
  PreviewInventoryRevision,
  ResolvePendingRevisionImpact,
  SaveInventoryRevision,
  StartInventoryRevision,
  type InventoryRevisionComment,
} from '../../../app/application/inventory/index.ts';
import {
  AddContextReference,
  CreateWorkingContext,
  GetWorkingContextWorkspace,
  RemoveContextItem,
  SetWorkScopeResume,
} from '../../../app/application/workspace/index.ts';
import { localId, type AnchorId } from '../../../app/domain/identity/index.ts';
import type { ChessTreeCandidate } from '../../../app/domain/inventory/chess-tree-candidate.ts';
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
  const freeSession = new FreeAnalysisSession({
    persistence: store,
    clock: { now: () => timestamp },
  });
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
    promoteRevision: new PromoteAnalysisToInventoryRevision({
      inventory: store,
      contextReader: store,
      contextWriter: store,
      freeSession,
      clock,
      events: noEvents,
      storeStatus: store,
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
    removeItem: new RemoveContextItem({
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
  moves: readonly string[] = ['e4', 'e6', 'd4', 'd5'],
) {
  const scope = freeWorkScope();
  let current = await cases.update.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  for (const value of moves) {
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

async function addIndependentContextUse(
  cases: ReturnType<typeof useCases>,
  base: Awaited<ReturnType<typeof createFrenchLine>>,
  displayName: string,
) {
  const context = await cases.createContext.execute({ displayName });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: base.itemId,
    anchorId: base.rootAnchorId,
  });
  return context;
}

async function createBranchingRecord(
  store: SqlitePersistenceAdapter,
  itemType: 'analysis' | 'game' = 'analysis',
) {
  const rules = new ChessJsRulesAdapter();
  const root = rules.initialState();
  const nodes: ChessTreeCandidate['nodes'][number][] = [];
  for (const [parentNodeIndex, siblingOrder, value] of [
    [null, 0, 'e4'],
    [0, 0, 'e5'],
    [null, 1, 'd4'],
    [2, 0, 'd5'],
    [3, 0, 'Nf3'],
    [3, 1, 'c4'],
    [2, 1, 'Nf6'],
    [null, 2, 'Nf3'],
    [7, 0, 'd5'],
    [8, 0, 'd4'],
  ] as const) {
    const applied = rules.applyMove(
      parentNodeIndex === null ? root : nodes[parentNodeIndex]!.after,
      [],
      { kind: 'notation', value, locale: 'en-GB' },
    );
    assert.ok(applied.ok);
    nodes.push({
      nodeIndex: nodes.length,
      parentNodeIndex,
      siblingOrder,
      move: applied.value.move,
      after: applied.value.after,
      comments: [`Note ${nodes.length}`],
      startingComments: [],
    });
  }
  const published = await store.publishImport({
    candidates: [
      {
        sourceOrder: 0,
        itemType,
        displayName: 'Tree',
        content: {
          sourceOrder: 0,
          suggestedName: 'Tree',
          status: 'ready',
          root,
          nodes,
          initialComments: ['Root note'],
          result: '*',
          findings: [],
        },
      },
    ],
    folder: { kind: 'unfiled' },
    languageTag: 'en-GB',
    occurredAt: timestamp,
  });
  const record = (await store.readAnalysisRevision({
    scope: freeWorkScope(),
    ...published.items[0]!,
  }))!;
  assert.equal(record.tree!.nodes.length, 10);
  return record;
}

for (const mode of ['metadata', 'truncate_after'] as const) {
  test(`release audit: unassigned metadata draft survives external ${mode}`, async (t) => {
    const store = storeFixture(t);
    const cases = useCases(store);
    const base = await createFrenchLine(cases);
    const context = await cases.createContext.execute({
      displayName: 'Unassigned',
    });
    const contextScope = contextWorkScope(context.context.contextId);
    const draft = await cases.startRevision.execute({
      scope: contextScope,
      itemId: base.itemId,
      baseRevisionId: base.revisionId,
      anchorId: base.rootAnchorId,
      mode: 'metadata',
      displayName: 'Unsaved name',
      expectedScratchId: null,
      expectedScratchRevision: null,
    });
    const draftExpected = {
      scope: contextScope,
      expectedScratchId: draft.scratch.scratchId,
      expectedScratchRevision: draft.scratch.scratchRevision,
    };
    const draftPreview = await cases.previewRevision.execute(draftExpected);
    const before = await store.readContextAnalysisWorkspace(
      context.context.contextId,
    );
    const scope = freeWorkScope();
    const started = await cases.startRevision.execute({
      scope,
      itemId: base.itemId,
      baseRevisionId: base.revisionId,
      anchorId: base.rootAnchorId,
      mode,
      displayName: 'Published name',
      expectedScratchId: null,
      expectedScratchRevision: null,
    });
    const expected = {
      scope,
      expectedScratchId: started.scratch.scratchId,
      expectedScratchRevision: started.scratch.scratchRevision,
    };
    const preview = await cases.previewRevision.execute(expected);
    assert.deepEqual(preview.affectedContexts, []);
    const saved = await cases.saveRevision.execute({
      ...expected,
      previewFingerprint: preview.previewFingerprint,
    });
    assert.deepEqual(saved.impacts, []);
    const after = await store.readContextAnalysisWorkspace(
      context.context.contextId,
    );
    assert.deepEqual(after?.scratch, before?.scratch);
    assert.equal(after?.resumeVersion, before?.resumeVersion);
    assert.equal(after?.record?.contextMember, false);
    assert.deepEqual(
      inspectStore(store, (db) =>
        db.prepare('SELECT * FROM workspace_context_item').all(),
      ),
      [],
    );
    await assert.rejects(
      cases.saveRevision.execute({
        ...draftExpected,
        previewFingerprint: draftPreview.previewFingerprint,
      }),
      { problemCode: 'inventory.revision_conflict' },
    );
    assert.deepEqual(
      (await store.readContextAnalysisWorkspace(context.context.contextId))
        ?.scratch,
      before?.scratch,
    );
  });
}

for (const resolution of [
  'keep_copy',
  'use_target',
  'remove_from_context',
] as const) {
  test(`release audit: game metadata impact supports ${resolution}`, async (t) => {
    const store = storeFixture(t);
    const cases = useCases(store);
    const base = await createBranchingRecord(store, 'game');
    const context = await addIndependentContextUse(cases, base, 'Game review');
    await addIndependentContextUse(cases, base, 'Other use');
    const contextScope = contextWorkScope(context.context.contextId);
    const note = await cases.createPositionNote.execute({
      scope: contextScope,
      itemId: base.itemId,
      revisionId: base.revisionId,
      anchorId: base.tree!.nodes[3]!.anchorId,
      body: 'Context insight',
      languageTag: 'en-GB',
      noteScope: { kind: 'context', contextId: context.context.contextId },
    });
    await cases.startRevision.execute({
      scope: contextScope,
      itemId: base.itemId,
      baseRevisionId: base.revisionId,
      anchorId: base.rootAnchorId,
      mode: 'metadata',
      displayName: 'Context name',
      expectedScratchId: null,
      expectedScratchRevision: null,
    });
    const scope = freeWorkScope();
    const started = await cases.startRevision.execute({
      scope,
      itemId: base.itemId,
      baseRevisionId: base.revisionId,
      anchorId: base.rootAnchorId,
      mode: 'metadata',
      displayName: 'New game name',
      expectedScratchId: null,
      expectedScratchRevision: null,
    });
    const expected = {
      scope,
      expectedScratchId: started.scratch.scratchId,
      expectedScratchRevision: started.scratch.scratchRevision,
    };
    const preview = await cases.previewRevision.execute(expected);
    const saved = await cases.saveRevision.execute({
      ...expected,
      previewFingerprint: preview.previewFingerprint,
    });
    const impact = await cases.getImpact.execute({
      impactId: saved.impacts[0]!.impactId,
    });
    const result = await cases.resolveImpact.execute({
      impactId: impact.impactId,
      expectedImpactVersion: impact.impactVersion,
      expectedDataRevision: impact.dataRevision,
      resolution:
        resolution === 'keep_copy'
          ? { kind: resolution, displayName: 'Retained analysis' }
          : { kind: resolution },
    });
    assert.equal(
      (await cases.getContext.execute({ contextId: context.context.contextId }))
        .context.pendingRevisionImpactCount,
      0,
    );
    const original = (await store.readAnalysisRevision({
      scope,
      itemId: base.itemId,
      revisionId: saved.revisionId,
    }))!;
    assert.equal(original.itemType, 'game');
    assert.deepEqual(original.contributions, base.contributions);
    if (resolution === 'keep_copy') {
      assert.ok(result.contextItemId);
      assert.ok(result.contextRevisionId);
      const copy = (await store.readAnalysisRevision({
        scope: contextScope,
        itemId: result.contextItemId,
        revisionId: result.contextRevisionId,
      }))!;
      assert.equal(copy.itemType, 'analysis');
      assert.deepEqual(
        copy.tree!.nodes,
        base.tree!.nodes.map((node, index) => ({
          ...node,
          anchorId: copy.tree!.nodes[index]!.anchorId,
        })),
      );
      assert.deepEqual(copy.origin, {
        kind: 'inventory_anchor',
        itemId: base.itemId,
        revisionId: base.revisionId,
        anchorId: base.rootAnchorId,
      });
      assert.equal(copy.contributions.length, 1);
      assert.equal(copy.contributions[0]!.body, 'Context insight');
      assert.deepEqual(
        copy.contributions[0]!.contributionId,
        note.contributionId,
      );
      assert.deepEqual(
        copy.contributions[0]!.anchorId,
        copy.tree!.nodes[3]!.anchorId,
      );
      const scratch = (await store.readContextAnalysisWorkspace(
        context.context.contextId,
      ))!.scratch!;
      assert.equal(scratch.origin.kind, 'inventory_anchor');
      if (scratch.origin.kind === 'inventory_anchor')
        assert.deepEqual(scratch.origin.itemId, copy.itemId);
      assert.deepEqual(
        inspectStore(store, (db) =>
          db.prepare('PRAGMA foreign_key_check').all(),
        ),
        [],
      );
    }
  });
}

for (const scenario of ['resume', 'scratch', 'removed_anchor'] as const) {
  test(`release audit: free resume follows only compatible revisions (${scenario})`, async (t) => {
    const store = storeFixture(t);
    const cases = useCases(store);
    const base = await createFrenchLine(cases);
    if (scenario !== 'resume') {
      const started = await cases.update.execute({
        scope: freeWorkScope(),
        expectedScratchId: null,
        expectedScratchRevision: null,
        action: {
          kind: 'start',
          origin: {
            kind: 'inventory_anchor',
            itemId: base.itemId,
            revisionId: base.revisionId,
            anchorId: base.steps.at(-1)!.anchorId,
          },
        },
      });
      await cases.update.execute({
        scope: freeWorkScope(),
        expectedScratchId: started.scratch!.scratchId,
        expectedScratchRevision: started.scratch!.scratchRevision,
        action: {
          kind: 'apply_move',
          move: { kind: 'notation', value: 'Nc3', locale: 'en-GB' },
        },
      });
    }
    const before = await store.readFreeAnalysisWorkspace();
    const context = await addIndependentContextUse(
      cases,
      base,
      'Revision source',
    );
    const scope = contextWorkScope(context.context.contextId);
    const started = await cases.startRevision.execute({
      scope,
      itemId: base.itemId,
      baseRevisionId: base.revisionId,
      anchorId: base.rootAnchorId,
      mode: scenario === 'removed_anchor' ? 'truncate_after' : 'metadata',
      displayName: 'Renamed analysis',
      expectedScratchId: null,
      expectedScratchRevision: null,
    });
    const expected = {
      scope,
      expectedScratchId: started.scratch.scratchId,
      expectedScratchRevision: started.scratch.scratchRevision,
    };
    const preview = await cases.previewRevision.execute(expected);
    const saved = await cases.saveRevision.execute({
      ...expected,
      previewFingerprint: preview.previewFingerprint,
    });
    const after = await store.readFreeAnalysisWorkspace();
    const storedResume = inspectStore(store, (db) =>
      db
        .prepare(
          'SELECT revision_id AS revisionId FROM workspace_analysis_resume WHERE context_id IS NULL',
        )
        .get(),
    ) as { revisionId: number };
    if (scenario === 'removed_anchor') {
      assert.equal(storedResume.revisionId, base.revisionId.value);
      assert.deepEqual(after.scratch, before.scratch);
      assert.equal(after.record?.historical, true);
    } else {
      assert.equal(storedResume.revisionId, saved.revisionId.value);
      assert.equal(after.record?.historical, false);
      assert.equal(after.record?.displayName, 'Renamed analysis');
      assert.equal(after.resumeVersion, before.resumeVersion! + 1);
      assert.deepEqual(after.scratch?.steps, before.scratch?.steps);
      if (scenario === 'scratch') {
        assert.equal(after.scratch?.origin.kind, 'inventory_anchor');
        if (after.scratch?.origin.kind === 'inventory_anchor')
          assert.deepEqual(after.scratch.origin.revisionId, saved.revisionId);
      }
    }
  });
}

for (const contextual of [false, true]) {
  test(`repeated truncation keeps the draft identity and rebases the stored root (context: ${contextual})`, async (t) => {
    const store = storeFixture(t);
    const cases = useCases(store);
    const getWorkspace = new GetAnalysisWorkspace({
      reader: store,
      freeSession: cases.freeSession,
      rules: new ChessJsRulesAdapter(),
      storeStatus: store,
    });
    const base = await createBranchingRecord(store);
    const nodes = base.tree!.nodes;
    const context = contextual
      ? await addIndependentContextUse(cases, base, 'Repeated takeback')
      : undefined;
    const scope =
      context === undefined
        ? freeWorkScope()
        : contextWorkScope(context.context.contextId);
    const primed = await cases.startRevision.execute({
      scope,
      itemId: base.itemId,
      baseRevisionId: base.revisionId,
      anchorId: nodes[4]!.anchorId,
      mode: 'extend',
      expectedScratchId: null,
      expectedScratchRevision: null,
    });
    assert.equal(primed.scratch.root.playState.halfmoveClock, 1);
    let scratchId = primed.scratch.scratchId;
    let scratchRevision = primed.scratch.scratchRevision;
    let previousPreview:
      Awaited<ReturnType<typeof cases.previewRevision.execute>> | undefined;
    for (const [cut, continuation] of [
      [nodes[3]!.anchorId, nodes[4]!.anchorId],
      [nodes[2]!.anchorId, nodes[3]!.anchorId],
      [base.rootAnchorId, nodes[2]!.anchorId],
    ] as const) {
      const request = {
        scope,
        itemId: base.itemId,
        baseRevisionId: base.revisionId,
        anchorId: cut,
        lineAnchorId: continuation,
        mode: 'truncate_after' as const,
        expectedScratchId: scratchId,
        expectedScratchRevision: scratchRevision,
      };
      const started = await cases.startRevision.execute(request);
      assert.equal(started.scratch.scratchId, scratchId);
      assert.equal(started.scratch.scratchRevision, scratchRevision + 1);
      await assert.rejects(cases.startRevision.execute(request), {
        problemCode: 'analysis.scratch_revision_conflict',
      });
      scratchId = started.scratch.scratchId;
      scratchRevision = started.scratch.scratchRevision;
      const workspace = await getWorkspace.execute({ scope });
      assert.deepEqual(workspace.scratch, started.scratch);
      assert.equal(workspace.scratch!.origin.kind, 'inventory_anchor');
      assert.equal(workspace.record!.currentAnchorId.value, continuation.value);
      const expectedRoot =
        cut.value === base.rootAnchorId.value
          ? base.root
          : nodes.find((node) => node.anchorId.value === cut.value)!.after;
      assert.deepEqual(workspace.scratch!.root, expectedRoot);
      const preview = await cases.previewRevision.execute({
        scope,
        expectedScratchId: scratchId,
        expectedScratchRevision: scratchRevision,
      });
      assert.deepEqual(
        preview.removedSteps[0]!.move,
        nodes.find((node) => node.anchorId.value === continuation.value)!.move,
      );
      if (previousPreview !== undefined) {
        await assert.rejects(
          cases.saveRevision.execute({
            scope,
            expectedScratchId: scratchId,
            expectedScratchRevision: scratchRevision,
            previewFingerprint: previousPreview.previewFingerprint,
          }),
        );
      }
      previousPreview = preview;
    }
    const saved = await cases.saveRevision.execute({
      scope,
      expectedScratchId: scratchId,
      expectedScratchRevision: scratchRevision,
      previewFingerprint: previousPreview!.previewFingerprint,
    });
    const current = await cases.getRevision.execute({
      scope,
      itemId: base.itemId,
      revisionId: saved.revisionId,
    });
    assert.deepEqual(
      current.steps.map((step) => step.move.san),
      ['e4', 'e5'],
    );
    assert.deepEqual(
      current.tree!.nodes.map((node) => node.anchorId.value),
      nodes
        .filter((_, index) => ![2, 3, 4, 5, 6].includes(index))
        .map((node) => node.anchorId.value),
    );
    assert.equal(
      current.tree!.nodes.some((node) => node.move.san === 'd4'),
      true,
    );
    assert.deepEqual(
      (
        await cases.getRevision.execute({
          scope,
          itemId: base.itemId,
          revisionId: base.revisionId,
        })
      ).tree,
      base.tree,
    );
  });
}

for (const selected of [5, 2, 6] as const) {
  test(`truncation selects the intended branch instead of its main sibling (node ${selected})`, async (t) => {
    const store = storeFixture(t);
    const cases = useCases(store);
    const base = await createBranchingRecord(store);
    const nodes = base.tree!.nodes;
    const node = nodes[selected]!;
    const parent =
      node.parentNodeIndex === null
        ? base.rootAnchorId
        : nodes[node.parentNodeIndex]!.anchorId;
    const started = await cases.startRevision.execute({
      scope: freeWorkScope(),
      itemId: base.itemId,
      baseRevisionId: base.revisionId,
      anchorId: parent,
      lineAnchorId: node.anchorId,
      mode: 'truncate_after',
      expectedScratchId: null,
      expectedScratchRevision: null,
    });
    const expected = {
      scope: freeWorkScope(),
      expectedScratchId: started.scratch.scratchId,
      expectedScratchRevision: started.scratch.scratchRevision,
    };
    const preview = await cases.previewRevision.execute(expected);
    assert.deepEqual(preview.removedSteps[0]!.move, node.move);
    assert.equal(preview.noOp, false);
    const removed = selected === 2 ? [2, 3, 4, 5, 6] : [selected];
    assert.equal(preview.historicalGlobalContributionCount, removed.length);
    const workspace = await store.readFreeAnalysisWorkspace();
    assert.equal(workspace.record!.currentAnchorId.value, node.anchorId.value);
    const saved = await cases.saveRevision.execute({
      ...expected,
      previewFingerprint: preview.previewFingerprint,
    });
    const current = await cases.getRevision.execute({
      scope: freeWorkScope(),
      itemId: base.itemId,
      revisionId: saved.revisionId,
    });
    assert.deepEqual(
      current.steps.map((step) => step.move.san),
      ['e4', 'e5'],
    );
    assert.deepEqual(
      current.tree!.nodes.map((entry) => entry.anchorId.value),
      nodes
        .filter((_, index) => !removed.includes(index))
        .map((entry) => entry.anchorId.value),
    );
    assert.equal(saved.currentAnchorId.value, parent.value);
    assert.deepEqual(
      (
        await cases.getRevision.execute({
          scope: freeWorkScope(),
          itemId: base.itemId,
          revisionId: base.revisionId,
        })
      ).tree,
      base.tree,
    );
  });
}

async function prepareVariation(
  cases: ReturnType<typeof useCases>,
  base: Awaited<ReturnType<typeof createBranchingRecord>>,
  anchorId: AnchorId,
  moves: readonly string[],
  scope = freeWorkScope(),
) {
  let { scratch } = await cases.startRevision.execute({
    scope,
    itemId: base.itemId,
    baseRevisionId: base.revisionId,
    anchorId,
    mode: 'add_variation',
    expectedScratchId: null,
    expectedScratchRevision: null,
  });
  for (const value of moves) {
    const updated = await cases.update.execute({
      scope,
      expectedScratchId: scratch.scratchId,
      expectedScratchRevision: scratch.scratchRevision,
      action: {
        kind: 'apply_move',
        move: { kind: 'notation', value, locale: 'en-GB' },
      },
    });
    scratch = updated.scratch!;
  }
  return {
    scope,
    expectedScratchId: scratch.scratchId,
    expectedScratchRevision: scratch.scratchRevision,
  };
}

for (const scenario of [
  { selected: -1, moves: ['d4', 'd5', 'Nc3'], reused: 2, added: 1 },
  { selected: 3, moves: ['Nc3', 'Nf6'], reused: 0, added: 2 },
  { selected: 0, moves: ['c5'], reused: 0, added: 1 },
  { selected: 1, moves: ['Nf3'], reused: 0, added: 1 },
  { selected: -1, moves: ['d4', 'd5', 'Nf3'], reused: 3, added: 0 },
  { selected: -1, moves: [], reused: 0, added: 0 },
] as const) {
  test(`native variation preserves the whole tree and reuses prefixes (${scenario.selected}: ${scenario.moves.join(' ')})`, async (t) => {
    const store = storeFixture(t);
    const cases = useCases(store);
    const base = await createBranchingRecord(store);
    const selected =
      scenario.selected < 0
        ? base.rootAnchorId
        : base.tree!.nodes[scenario.selected]!.anchorId;
    const request = await prepareVariation(
      cases,
      base,
      selected,
      scenario.moves,
    );
    const comment: InventoryRevisionComment = {
      body: 'Optional comment',
      languageTag: 'en-GB',
      noteScope: { kind: 'global' },
    };
    const preview = await cases.previewRevision.execute({
      ...request,
      comment,
    });
    assert.deepEqual(preview.removedSteps, []);
    assert.equal(preview.addedSteps.length, scenario.added);
    assert.deepEqual(
      preview.addedSteps.map((step) => step.move.san),
      scenario.moves.slice(scenario.reused),
    );
    assert.deepEqual(preview.affectedContexts, []);
    assert.equal(preview.noOp, scenario.added === 0);
    const saved = await cases.saveRevision.execute({
      ...request,
      comment,
      previewFingerprint: preview.previewFingerprint,
    });
    const current = (await store.readAnalysisRevision({
      scope: request.scope,
      itemId: base.itemId,
      revisionId: saved.revisionId,
    }))!;
    assert.equal(
      current.tree!.nodes.length,
      base.tree!.nodes.length + scenario.added,
    );
    for (const old of base.tree!.nodes) {
      const retained = current.tree!.nodes.find(
        (node) => node.anchorId.value === old.anchorId.value,
      )!;
      assert.ok(retained);
      assert.deepEqual(retained.move, old.move);
      assert.deepEqual(retained.after, old.after);
      assert.equal(retained.siblingOrder, old.siblingOrder);
      const parentAnchor = (record: typeof base, index: number | null) =>
        index === null
          ? record.rootAnchorId
          : record.tree!.nodes[index]!.anchorId;
      assert.deepEqual(
        parentAnchor(current, retained.parentNodeIndex),
        parentAnchor(base, old.parentNodeIndex),
      );
    }
    assert.deepEqual(
      current.steps.map((step) => step.move.san),
      ['e4', 'e5'],
    );
    const historical = (await store.readAnalysisRevision({
      scope: request.scope,
      itemId: base.itemId,
      revisionId: base.revisionId,
    }))!;
    assert.deepEqual(historical.tree, base.tree);
    if (scenario.added === 0) {
      assert.deepEqual(saved.revisionId, base.revisionId);
      assert.equal(saved.commentContributionId, undefined);
      assert.deepEqual(current.contributions, base.contributions);
      assert.equal(saved.dataRevision, preview.dataRevision);
      assert.equal(
        (await cases.freeSession.read())?.scratchId,
        request.expectedScratchId,
      );
    } else {
      assert.ok(saved.commentContributionId);
      const note = current.contributions.find(
        (entry) =>
          String(entry.contributionId.value) === saved.commentContributionId,
      )!;
      assert.deepEqual(note.anchorId, selected);
      assert.equal(note.body, comment.body);
      assert.deepEqual(note.moves, []);
      assert.equal(saved.dataRevision, preview.dataRevision + 1);
      assert.equal(await cases.freeSession.read(), undefined);
    }
  });
}

test('native variations keep transposed occurrences separate and preserve context following', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const base = await createBranchingRecord(store);
  const context = await addIndependentContextUse(cases, base, 'Training');
  const first = await prepareVariation(
    cases,
    base,
    base.tree!.nodes[4]!.anchorId,
    ['g6'],
  );
  const p1 = await cases.previewRevision.execute(first);
  const one = await cases.saveRevision.execute({
    ...first,
    previewFingerprint: p1.previewFingerprint,
  });
  const revised = (await store.readAnalysisRevision({
    scope: freeWorkScope(),
    itemId: base.itemId,
    revisionId: one.revisionId,
  }))!;
  const second = await prepareVariation(
    cases,
    revised,
    base.tree!.nodes[9]!.anchorId,
    ['g6'],
  );
  const p2 = await cases.previewRevision.execute(second);
  assert.equal(p2.noOp, false);
  const two = await cases.saveRevision.execute({
    ...second,
    previewFingerprint: p2.previewFingerprint,
  });
  const current = (await store.readAnalysisRevision({
    scope: contextWorkScope(context.context.contextId),
    itemId: base.itemId,
    revisionId: two.revisionId,
  }))!;
  const a = current.tree!.nodes.find(
    (node) => node.anchorId.value === one.currentAnchorId.value,
  )!;
  const b = current.tree!.nodes.find(
    (node) => node.anchorId.value === two.currentAnchorId.value,
  )!;
  assert.equal(a.after.position.positionKey, b.after.position.positionKey);
  assert.notEqual(a.anchorId.value, b.anchorId.value);
  assert.notEqual(a.parentNodeIndex, b.parentNodeIndex);
  assert.deepEqual(current.contributions, base.contributions);
  assert.equal(current.historical, false);
  assert.deepEqual(two.impacts, []);
});

for (const contextComment of [false, true]) {
  test(`native variation and editable comment commit atomically (context: ${contextComment})`, async (t) => {
    const store = storeFixture(t);
    const cases = useCases(store);
    const base = await createBranchingRecord(store);
    const context = await addIndependentContextUse(cases, base, 'Training');
    const scope = contextComment
      ? contextWorkScope(context.context.contextId)
      : freeWorkScope();
    const request = await prepareVariation(
      cases,
      base,
      base.tree!.nodes[0]!.anchorId,
      ['c5'],
      scope,
    );
    const comment: InventoryRevisionComment = {
      body: '  1... c5: Sicilian  ',
      languageTag: 'en-GB',
      noteScope: contextComment
        ? { kind: 'context', contextId: context.context.contextId }
        : { kind: 'global' },
    };
    const preview = await cases.previewRevision.execute({
      ...request,
      comment,
    });
    for (const changed of [
      { ...comment, body: 'Different' },
      { ...comment, languageTag: 'de-DE' },
    ]) {
      await assert.rejects(
        cases.saveRevision.execute({
          ...request,
          comment: changed,
          previewFingerprint: preview.previewFingerprint,
        }),
      );
    }
    await assert.rejects(
      cases.saveRevision.execute({
        ...request,
        comment,
        expectedScratchRevision: request.expectedScratchRevision - 1,
        previewFingerprint: preview.previewFingerprint,
      }),
    );
    await assert.rejects(
      cases.saveRevision.execute({
        ...request,
        previewFingerprint: preview.previewFingerprint,
      }),
    );
    const database = new Database(storeDatabasePaths.get(store)!);
    try {
      database.exec(
        "CREATE TRIGGER reject_variant_comment BEFORE INSERT ON workspace_contribution WHEN NEW.body = '1... c5: Sicilian' BEGIN SELECT RAISE(ABORT, 'injected note failure'); END",
      );
      await assert.rejects(
        cases.saveRevision.execute({
          ...request,
          comment,
          previewFingerprint: preview.previewFingerprint,
        }),
      );
      assert.equal(
        (
          database
            .prepare(
              'SELECT current_revision_id AS id FROM inventory_item WHERE item_id = ?',
            )
            .get(base.itemId.value) as { id: number }
        ).id,
        base.revisionId.value,
      );
      assert.equal(
        (await cases.previewRevision.execute({ ...request, comment }))
          .previewFingerprint,
        preview.previewFingerprint,
      );
      database.exec('DROP TRIGGER reject_variant_comment');
    } finally {
      database.close();
    }
    const saved = await cases.saveRevision.execute({
      ...request,
      comment: { ...comment, body: comment.body.trim() },
      previewFingerprint: preview.previewFingerprint,
    });
    assert.ok(saved.commentContributionId);
    assert.equal(saved.dataRevision, preview.dataRevision + 1);
    const record = (await store.readAnalysisRevision({
      scope,
      itemId: base.itemId,
      revisionId: saved.revisionId,
    }))!;
    const note = record.contributions.find(
      (entry) =>
        String(entry.contributionId.value) === saved.commentContributionId,
    )!;
    assert.equal(note.body, comment.body.trim());
    assert.deepEqual(note.anchorId, base.tree!.nodes[0]!.anchorId);
    assert.deepEqual(note.moves, []);
    await store.updateAnalysisNote({
      scope,
      contributionId: note.contributionId,
      expectedContributionVersion: 1,
      body: 'Edited normally',
      occurredAt: timestamp,
    });
    const edited = (await store.readAnalysisRevision({
      scope,
      itemId: base.itemId,
      revisionId: saved.revisionId,
    }))!;
    assert.equal(
      edited.contributions.find(
        (entry) => entry.contributionId.value === note.contributionId.value,
      )?.body,
      'Edited normally',
    );
    const global = (await store.readAnalysisRevision({
      scope: freeWorkScope(),
      itemId: base.itemId,
      revisionId: saved.revisionId,
    }))!;
    assert.equal(
      global.contributions.some(
        (entry) => entry.contributionId.value === note.contributionId.value,
      ),
      !contextComment,
    );
  });
}

test('native variation from a black-to-move FEN preserves move clocks and nested branches', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const scope = freeWorkScope();
  const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 17';
  const started = await cases.update.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'fen', fen } },
  });
  const created = await cases.createRecord.execute({
    scope,
    expectedScratchId: started.scratch!.scratchId,
    expectedScratchRevision: started.scratch!.scratchRevision,
    displayName: 'Black FEN',
    languageTag: 'en-GB',
  });
  let base = (await store.readAnalysisRevision({
    scope,
    itemId: created.itemId,
    revisionId: created.revisionId,
  }))!;
  const first = await prepareVariation(cases, base, base.rootAnchorId, [
    'e5',
    'Nf3',
    'Nc6',
  ]);
  const p1 = await cases.previewRevision.execute(first);
  const saved = await cases.saveRevision.execute({
    ...first,
    previewFingerprint: p1.previewFingerprint,
  });
  base = (await store.readAnalysisRevision({
    scope,
    itemId: base.itemId,
    revisionId: saved.revisionId,
  }))!;
  assert.equal(base.root.fen, fen);
  assert.deepEqual(base.steps, []);
  assert.equal(base.tree!.nodes[0]!.after.playState.fullmoveNumber, 18);
  assert.equal(base.tree!.nodes[0]!.siblingOrder, 1);
  const next = await prepareVariation(cases, base, base.rootAnchorId, [
    'e5',
    'Nc3',
    'Nf6',
  ]);
  const p2 = await cases.previewRevision.execute(next);
  assert.deepEqual(
    p2.addedSteps.map((step) => step.move.san),
    ['Nc3', 'Nf6'],
  );
  const second = await cases.saveRevision.execute({
    ...next,
    previewFingerprint: p2.previewFingerprint,
  });
  const current = (await store.readAnalysisRevision({
    scope,
    itemId: base.itemId,
    revisionId: second.revisionId,
  }))!;
  assert.equal(current.tree!.nodes.length, 5);
  assert.deepEqual(current.steps, []);
  const selected = (await store.readAnalysisRevision({
    scope,
    itemId: base.itemId,
    revisionId: second.revisionId,
    anchorId: base.tree!.nodes[2]!.anchorId,
  }))!;
  assert.deepEqual(
    selected.steps.map((step) => step.move.san),
    ['e5', 'Nf3', 'Nc6'],
  );
  const branch = current.tree!.nodes.find((node) => node.move.san === 'Nc3')!;
  assert.equal(branch.siblingOrder, 1);
  assert.deepEqual(
    current.tree!.nodes[branch.parentNodeIndex!]!.anchorId,
    base.tree!.nodes[0]!.anchorId,
  );
  const fingerprints = inspectStore(
    store,
    (database) =>
      database
        .prepare(
          'SELECT hex(content_fingerprint) AS value FROM item_revision WHERE item_id = ? ORDER BY revision_number',
        )
        .all(base.itemId.value) as { value: string }[],
  );
  assert.equal(new Set(fingerprints.map((row) => row.value)).size, 3);
});

for (const inContext of [false, true]) {
  test(`promotes exploration explicitly to a native variation (context: ${inContext})`, async (t) => {
    const store = storeFixture(t);
    const cases = useCases(store);
    const base = await createBranchingRecord(store);
    const context = await addIndependentContextUse(cases, base, 'Training');
    const scope = inContext
      ? contextWorkScope(context.context.contextId)
      : freeWorkScope();
    const anchorId = base.tree!.nodes[0]!.anchorId;
    const explored = await cases.update.execute({
      scope,
      expectedScratchId: null,
      expectedScratchRevision: null,
      action: {
        kind: 'start',
        origin: {
          kind: 'inventory_anchor',
          itemId: base.itemId,
          revisionId: base.revisionId,
          anchorId,
        },
        firstMove: { kind: 'notation', value: 'c5', locale: 'en-GB' },
      },
    });
    const promoted = await cases.promoteRevision.execute({
      scope,
      itemId: base.itemId,
      baseRevisionId: base.revisionId,
      anchorId,
      mode: 'add_variation',
      expectedScratchId: explored.scratch!.scratchId,
      expectedScratchRevision: explored.scratch!.scratchRevision,
    });
    assert.deepEqual(promoted.scratch.steps, explored.scratch!.steps);
    assert.equal(promoted.scratch.intent.kind, 'inventory_revision');
    assert.ok(
      promoted.scratch.intent.kind === 'inventory_revision' &&
        promoted.scratch.intent.mode === 'add_variation',
    );
    const request = {
      scope,
      expectedScratchId: promoted.scratch.scratchId,
      expectedScratchRevision: promoted.scratch.scratchRevision,
    };
    if (inContext) {
      await assert.rejects(
        cases.previewRevision.execute({
          ...request,
          comment: {
            body: 'Other context',
            languageTag: 'en-GB',
            noteScope: {
              kind: 'context',
              contextId: localId('working-context', 999),
            },
          },
        }),
      );
    }
    const preview = await cases.previewRevision.execute(request);
    const saved = await cases.saveRevision.execute({
      ...request,
      previewFingerprint: preview.previewFingerprint,
    });
    const current = (await store.readAnalysisRevision({
      scope,
      itemId: base.itemId,
      revisionId: saved.revisionId,
    }))!;
    assert.deepEqual(
      current.steps.map((step) => step.move.san),
      ['e4', 'e5'],
    );
    assert.equal(current.tree!.nodes.length, 11);
    assert.equal(saved.commentContributionId, undefined);
    assert.deepEqual(current.contributions, base.contributions);
  });
}

test('native variation reuses a complete linear record and retains its scratch on no-op', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const base = await createFrenchLine(cases);
  assert.equal(base.tree, undefined);
  const request = await prepareVariation(cases, base, base.steps[0]!.anchorId, [
    'e6',
    'd4',
    'd5',
  ]);
  const comment: InventoryRevisionComment = {
    body: 'Must not be published',
    languageTag: 'en-GB',
    noteScope: { kind: 'global' },
  };
  const preview = await cases.previewRevision.execute({ ...request, comment });
  assert.equal(preview.noOp, true);
  assert.deepEqual(preview.addedSteps, []);
  const saved = await cases.saveRevision.execute({
    ...request,
    comment,
    previewFingerprint: preview.previewFingerprint,
  });
  assert.equal(saved.commentContributionId, undefined);
  assert.deepEqual(saved.currentAnchorId, base.steps.at(-1)!.anchorId);
  assert.equal(
    (await cases.freeSession.read())?.scratchId,
    request.expectedScratchId,
  );
  assert.equal(
    (
      await store.readAnalysisRevision({
        scope: request.scope,
        itemId: base.itemId,
        revisionId: base.revisionId,
      })
    )?.contributions.length,
    0,
  );
});

test('a competing revision invalidates a variation preview without publishing its comment', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const base = await createBranchingRecord(store);
  const context = await addIndependentContextUse(
    cases,
    base,
    'Concurrent work',
  );
  const request = await prepareVariation(cases, base, base.rootAnchorId, [
    'c4',
  ]);
  const comment: InventoryRevisionComment = {
    body: 'Stale note',
    languageTag: 'en-GB',
    noteScope: { kind: 'global' },
  };
  const preview = await cases.previewRevision.execute({ ...request, comment });
  const other = await prepareVariation(
    cases,
    base,
    base.rootAnchorId,
    ['f4'],
    contextWorkScope(context.context.contextId),
  );
  const competing = await cases.previewRevision.execute(other);
  const saved = await cases.saveRevision.execute({
    ...other,
    previewFingerprint: competing.previewFingerprint,
  });
  await assert.rejects(
    cases.saveRevision.execute({
      ...request,
      comment,
      previewFingerprint: preview.previewFingerprint,
    }),
  );
  const current = (await store.readAnalysisRevision({
    scope: freeWorkScope(),
    itemId: base.itemId,
    revisionId: saved.revisionId,
  }))!;
  assert.equal(
    current.contributions.some((entry) => entry.body === comment.body),
    false,
  );
  assert.equal(
    current.tree!.nodes.some(
      (node) => node.parentNodeIndex === null && node.move.san === 'c4',
    ),
    false,
  );
  assert.equal(
    (await cases.freeSession.read())?.scratchId,
    request.expectedScratchId,
  );
});

test('native variation rejects game changes and invalid comment scopes without writes', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const game = await createBranchingRecord(store, 'game');
  await assert.rejects(
    prepareVariation(cases, game, game.rootAnchorId, ['c4']),
  );
  const base = await createFrenchLine(cases);
  const request = await prepareVariation(cases, base, base.rootAnchorId, [
    'd4',
  ]);
  for (const comment of [
    { body: '', languageTag: 'en-GB', noteScope: { kind: 'global' } },
    {
      body: 'x'.repeat(128001),
      languageTag: 'en-GB',
      noteScope: { kind: 'global' },
    },
    { body: 'Note', languageTag: 'bad tag', noteScope: { kind: 'global' } },
    {
      body: 'Note',
      languageTag: 'en-GB',
      noteScope: {
        kind: 'context',
        contextId: localId('working-context', 999),
      },
    },
  ] satisfies InventoryRevisionComment[]) {
    await assert.rejects(
      cases.previewRevision.execute({ ...request, comment }),
    );
  }
  assert.equal(
    (await cases.freeSession.read())?.scratchId,
    request.expectedScratchId,
  );
});

for (const scenario of [
  {
    moves: ['d4', 'd5', 'Nf3'],
    preserved: 3,
    removed: [],
    added: 0,
    mode: 'metadata',
    noOp: true,
  },
  {
    moves: ['d4', 'd5'],
    preserved: 2,
    removed: [4],
    added: 0,
    mode: 'truncate_after',
    noOp: false,
  },
  {
    moves: ['d4', 'd5', 'Nc3'],
    preserved: 2,
    removed: [4],
    added: 1,
    mode: 'replace_move',
    noOp: false,
  },
  {
    moves: ['Nf3', 'd5', 'd4'],
    preserved: 0,
    removed: [2, 3, 4, 5, 6],
    added: 3,
    mode: 'replace_move',
    noOp: false,
  },
] as const) {
  test(`reentered branch prefix retains only its own identities (${scenario.moves.join(' ')})`, async (t) => {
    const store = storeFixture(t);
    const cases = useCases(store);
    const base = await createBranchingRecord(store);
    const nodes = base.tree!.nodes;
    const scope = freeWorkScope();
    const started = await cases.startRevision.execute({
      scope,
      itemId: base.itemId,
      baseRevisionId: base.revisionId,
      anchorId: nodes[2]!.anchorId,
      mode: 'replace_move',
      expectedScratchId: null,
      expectedScratchRevision: null,
      firstMove: {
        kind: 'notation',
        value: scenario.moves[0],
        locale: 'en-GB',
      },
    });
    let scratch = started.scratch;
    for (const value of scenario.moves.slice(1)) {
      const updated = await cases.update.execute({
        scope,
        expectedScratchId: scratch.scratchId,
        expectedScratchRevision: scratch.scratchRevision,
        action: {
          kind: 'apply_move',
          move: { kind: 'notation', value, locale: 'en-GB' },
        },
      });
      scratch = updated.scratch!;
    }
    const expected = {
      scope,
      expectedScratchId: scratch.scratchId,
      expectedScratchRevision: scratch.scratchRevision,
    };
    const preview = await cases.previewRevision.execute(expected);
    assert.equal(preview.mode, scenario.mode);
    assert.equal(preview.noOp, scenario.noOp);
    assert.equal(preview.preservedMoveCount, scenario.preserved);
    assert.equal(preview.addedSteps.length, scenario.added);
    assert.equal(
      preview.historicalGlobalContributionCount,
      scenario.removed.length,
    );
    const saved = await cases.saveRevision.execute({
      ...expected,
      previewFingerprint: preview.previewFingerprint,
    });
    assert.equal(saved.noOp, scenario.noOp);
    const current = await cases.getRevision.execute({
      scope,
      itemId: base.itemId,
      revisionId: saved.revisionId,
      anchorId: saved.currentAnchorId,
    });
    const removed = new Set<number>(scenario.removed);
    assert.equal(
      current.tree!.nodes.length,
      nodes.length - removed.size + scenario.added,
    );
    for (const [index, node] of nodes.entries()) {
      assert.equal(
        current.tree!.nodes.some(
          (entry) => entry.anchorId.value === node.anchorId.value,
        ),
        !removed.has(index),
      );
    }
    assert.deepEqual(
      current.contributions.map((note) => note.body).sort(),
      base.contributions
        .filter(
          (note) =>
            !nodes.some(
              (node, index) =>
                removed.has(index) &&
                node.anchorId.value === note.anchorId.value,
            ),
        )
        .map((note) => note.body)
        .sort(),
    );
    const historical = await cases.getRevision.execute({
      scope,
      itemId: base.itemId,
      revisionId: base.revisionId,
    });
    assert.deepEqual(historical.tree, base.tree);
  });
}

for (const mode of ['truncate_after', 'replace_move'] as const) {
  test(`reentered prefix preserves move identity and notes before extending (${mode})`, async (t) => {
    const store = storeFixture(t);
    const cases = useCases(store);
    const base = await createFrenchLine(cases, 'Italian prefix', [
      'e4',
      'e5',
      'Nf3',
      'Nc6',
      'Bc4',
      'Bc5',
      'O-O',
      'Nf6',
      'd3',
      'O-O',
      'Nc3',
      'h6',
    ]);
    const h6 = base.steps.at(-1)!;
    const context = await addIndependentContextUse(
      cases,
      base,
      'Annotated line',
    );
    const contextScope = contextWorkScope(context.context.contextId);
    for (const noteScope of [
      { kind: 'global' as const },
      { kind: 'context' as const, contextId: context.context.contextId },
    ]) {
      await cases.createPositionNote.execute({
        scope: contextScope,
        itemId: base.itemId,
        revisionId: base.revisionId,
        anchorId: h6.anchorId,
        body: `${noteScope.kind} h6 note`,
        languageTag: 'en-GB',
        noteScope,
      });
    }
    await cases.setResume.execute({
      scope: contextScope,
      area: 'analyze',
      expectedResumeVersion: null,
      mode: 'analyze',
      itemId: base.itemId,
      revisionId: base.revisionId,
      anchorId: h6.anchorId,
    });
    const scope = freeWorkScope();
    const started = await cases.startRevision.execute({
      scope,
      itemId: base.itemId,
      baseRevisionId: base.revisionId,
      anchorId:
        mode === 'replace_move' ? h6.anchorId : base.steps.at(-2)!.anchorId,
      mode,
      expectedScratchId: null,
      expectedScratchRevision: null,
      firstMove: { kind: 'notation', value: 'h6', locale: 'en-GB' },
    });
    const extended = await cases.update.execute({
      scope,
      expectedScratchId: started.scratch.scratchId,
      expectedScratchRevision: started.scratch.scratchRevision,
      action: {
        kind: 'apply_move',
        move: { kind: 'notation', value: 'h3', locale: 'en-GB' },
      },
    });
    const expected = {
      scope,
      expectedScratchId: extended.scratch!.scratchId,
      expectedScratchRevision: extended.scratch!.scratchRevision,
    };
    const preview = await cases.previewRevision.execute(expected);
    assert.equal(preview.mode, 'extend');
    assert.equal(preview.preservedMoveCount, base.steps.length);
    assert.deepEqual(
      preview.addedSteps.map((step) => step.move.san),
      ['h3'],
    );
    assert.deepEqual(preview.removedSteps, []);
    assert.equal(preview.historicalGlobalContributionCount, 0);
    assert.deepEqual(preview.affectedContexts, []);
    const saved = await cases.saveRevision.execute({
      ...expected,
      previewFingerprint: preview.previewFingerprint,
    });
    assert.equal(saved.noOp, false);
    assert.deepEqual(saved.impacts, []);
    const current = await cases.getRevision.execute({
      scope: contextScope,
      itemId: base.itemId,
      revisionId: saved.revisionId,
      anchorId: saved.currentAnchorId,
    });
    assert.deepEqual(
      current.steps.slice(0, -1).map((step) => step.anchorId),
      base.steps.map((step) => step.anchorId),
    );
    assert.deepEqual(current.contributions.map((note) => note.body).sort(), [
      'context h6 note',
      'global h6 note',
    ]);
    assert.ok(
      current.contributions.every(
        (note) => note.anchorId.value === h6.anchorId.value,
      ),
    );
    const revisions = await cases.listRevisions.execute({
      itemId: base.itemId,
    });
    assert.equal(revisions.revisions[0]!.changeKind, 'extend');
    const workspace = await cases.getContext.execute({
      contextId: context.context.contextId,
    });
    assert.equal(workspace.context.pendingRevisionImpactCount, 0);
    assert.equal(
      workspace.references[0]!.currentRevisionId.value,
      saved.revisionId.value,
    );
  });
}

for (const scenario of [
  {
    mode: 'metadata',
    type: 'analysis',
    selected: 5,
    removed: [],
    added: undefined,
  },
  {
    mode: 'metadata',
    type: 'game',
    selected: 5,
    removed: [],
    added: undefined,
  },
  { mode: 'extend', type: 'analysis', selected: 5, removed: [], added: 'e6' },
  {
    mode: 'truncate_after',
    type: 'analysis',
    selected: 2,
    removed: [3, 4, 5],
    added: undefined,
  },
  {
    mode: 'replace_move',
    type: 'analysis',
    selected: 2,
    removed: [2, 3, 4, 5, 6],
    added: 'c4',
  },
  {
    mode: 'truncate_after',
    type: 'analysis',
    selected: -1,
    removed: [0, 1],
    added: undefined,
  },
] as const) {
  test(`tree revision preserves unrelated branches and notes (${scenario.type}, ${scenario.mode}, anchor ${scenario.selected})`, async (t) => {
    const store = storeFixture(t);
    const cases = useCases(store);
    const base = await createBranchingRecord(store, scenario.type);
    const nodes = base.tree!.nodes;
    const selected =
      scenario.selected < 0
        ? base.rootAnchorId
        : nodes[scenario.selected]!.anchorId;
    const started = await cases.startRevision.execute({
      scope: freeWorkScope(),
      itemId: base.itemId,
      baseRevisionId: base.revisionId,
      anchorId: selected,
      mode: scenario.mode,
      displayName: 'Revised tree',
      expectedScratchId: null,
      expectedScratchRevision: null,
      ...(scenario.added === undefined
        ? {}
        : {
            firstMove: {
              kind: 'notation',
              value: scenario.added,
              locale: 'en-GB',
            },
          }),
    });
    const expected = {
      scope: freeWorkScope(),
      expectedScratchId: started.scratch.scratchId,
      expectedScratchRevision: started.scratch.scratchRevision,
    };
    const preview = await cases.previewRevision.execute(expected);
    assert.equal(
      preview.historicalGlobalContributionCount,
      scenario.removed.length,
    );
    const saved = await cases.saveRevision.execute({
      ...expected,
      previewFingerprint: preview.previewFingerprint,
    });
    const current = await cases.getRevision.execute({
      scope: freeWorkScope(),
      itemId: base.itemId,
      revisionId: saved.revisionId,
      anchorId: saved.currentAnchorId,
    });
    const removed = new Set<number>(scenario.removed);
    const retained = nodes.filter((_, index) => !removed.has(index));
    assert.equal(
      current.tree!.nodes.length,
      retained.length + Number(scenario.added !== undefined),
    );
    for (const [index, node] of nodes.entries()) {
      const copied = current.tree!.nodes.find(
        (entry) => entry.anchorId.value === node.anchorId.value,
      );
      assert.equal(copied !== undefined, !removed.has(index));
      if (copied) {
        assert.deepEqual(copied.move, node.move);
        assert.deepEqual(copied.after, node.after);
        assert.equal(copied.siblingOrder, node.siblingOrder);
        assert.deepEqual(
          copied.parentNodeIndex === null
            ? null
            : current.tree!.nodes[copied.parentNodeIndex]!.anchorId,
          node.parentNodeIndex === null
            ? null
            : nodes[node.parentNodeIndex]!.anchorId,
        );
      }
    }
    assert.deepEqual(
      current.contributions.map((note) => note.contributionId),
      base.contributions
        .filter(
          (note) =>
            !nodes.some(
              (node, index) =>
                removed.has(index) &&
                node.anchorId.value === note.anchorId.value,
            ),
        )
        .map((note) => note.contributionId),
    );
    const historical = await cases.getRevision.execute({
      scope: freeWorkScope(),
      itemId: base.itemId,
      revisionId: base.revisionId,
    });
    assert.deepEqual(historical.tree, base.tree);
    assert.deepEqual(historical.contributions, base.contributions);
    if (scenario.mode === 'metadata') {
      assert.deepEqual(current.tree, base.tree);
      assert.deepEqual(saved.currentAnchorId, selected);
    }
    if (scenario.mode === 'replace_move') {
      const main = await cases.getRevision.execute({
        scope: freeWorkScope(),
        itemId: base.itemId,
        revisionId: saved.revisionId,
        anchorId: base.rootAnchorId,
      });
      assert.deepEqual(
        main.steps.map((step) => step.move.san),
        ['e4', 'e5'],
      );
      assert.deepEqual(
        current.steps.map((step) => step.move.san),
        ['c4'],
      );
      assert.equal(
        current.tree!.nodes.find(
          (node) => node.anchorId.value === saved.currentAnchorId.value,
        )!.siblingOrder,
        1,
      );
    }
    if (scenario.selected === -1) {
      const extended = await appendMove(
        cases,
        current,
        base.rootAnchorId,
        'c4',
      );
      const resumed = await cases.getRevision.execute({
        scope: freeWorkScope(),
        itemId: base.itemId,
        revisionId: extended.revisionId,
      });
      assert.deepEqual(
        resumed.steps.map((step) => step.move.san),
        ['c4'],
      );
      assert.equal(resumed.tree!.nodes.length, retained.length + 1);
    }
  });
}

test('tree replacement reports nested occurrence, move and lost position anchors but retains transposed positions', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const base = await createBranchingRecord(store);
  const nodes = base.tree!.nodes;
  const database = new Database(storeDatabasePaths.get(store)!);
  const positionAnchor = (anchorId: AnchorId) => {
    const inserted = database
      .prepare(
        `INSERT INTO chess_anchor (anchor_kind, position_id)
       SELECT 'position', occurrence.position_id FROM chess_occurrence_snapshot occurrence
       JOIN chess_anchor anchor ON anchor.occurrence_id = occurrence.occurrence_id
       WHERE anchor.anchor_id = ? AND occurrence.revision_id = ?`,
      )
      .run(anchorId.value, base.revisionId.value);
    return localId('anchor', Number(inserted.lastInsertRowid));
  };
  let uniquePosition: AnchorId;
  let sharedPosition: AnchorId;
  let moveAnchor: AnchorId;
  try {
    uniquePosition = positionAnchor(nodes[5]!.anchorId);
    sharedPosition = positionAnchor(nodes[4]!.anchorId);
    const move = database
      .prepare(
        `SELECT move_anchor.anchor_id AS id FROM chess_anchor occurrence_anchor
       JOIN chess_move_node_snapshot move ON move.child_occurrence_id = occurrence_anchor.occurrence_id
       JOIN chess_anchor move_anchor ON move_anchor.move_node_id = move.move_node_id
       WHERE occurrence_anchor.anchor_id = ? AND move.revision_id = ?`,
      )
      .get(nodes[5]!.anchorId.value, base.revisionId.value) as { id: number };
    moveAnchor = localId('anchor', move.id);
  } finally {
    database.close();
  }
  assert.equal(
    nodes[4]!.after.position.positionKey,
    nodes[9]!.after.position.positionKey,
  );
  const context = await cases.createContext.execute({
    displayName: 'Branch references',
  });
  for (const anchorId of [
    nodes[6]!.anchorId,
    moveAnchor,
    uniquePosition,
    sharedPosition,
  ]) {
    await cases.addReference.execute({
      contextId: context.context.contextId,
      itemId: base.itemId,
      anchorId,
    });
  }
  await addIndependentContextUse(cases, base, 'Other user');
  const started = await cases.startRevision.execute({
    scope: freeWorkScope(),
    itemId: base.itemId,
    baseRevisionId: base.revisionId,
    anchorId: nodes[2]!.anchorId,
    mode: 'replace_move',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: 'c4', locale: 'en-GB' },
  });
  const expected = {
    scope: freeWorkScope(),
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  };
  const preview = await cases.previewRevision.execute(expected);
  assert.equal(preview.historicalGlobalContributionCount, 5);
  assert.equal(preview.affectedContexts.length, 1);
  assert.equal(preview.affectedContexts[0]!.referenceCount, 3);
  const saved = await cases.saveRevision.execute({
    ...expected,
    previewFingerprint: preview.previewFingerprint,
  });
  const impact = await cases.getImpact.execute({
    impactId: saved.impacts[0]!.impactId,
  });
  assert.equal(impact.referenceCount, 3);
  const retainedPosition = await cases.getRevision.execute({
    scope: freeWorkScope(),
    itemId: base.itemId,
    revisionId: saved.revisionId,
    anchorId: sharedPosition,
  });
  assert.equal(retainedPosition.revisionId.value, saved.revisionId.value);
});

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
  assert.equal(saved.dataRevision, beforeSave.dataRevision + 2);
  assert.equal(
    (await store.readStoreStatus()).dataRevision,
    saved.dataRevision,
  );
  const resumed = await store.readFreeAnalysisWorkspace();
  assert.equal(resumed.scratch, undefined);
  assert.equal(resumed.record?.revisionId.value, saved.revisionId.value);
  assert.equal(
    resumed.record?.currentAnchorId.value,
    saved.currentAnchorId.value,
  );

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

test('promotes an explored continuation to a revision draft without replaying it', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const cutAnchor = first.steps[1]!.anchorId;
  const explored = await cases.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: first.itemId,
        revisionId: first.revisionId,
        anchorId: cutAnchor,
      },
      firstMove: { kind: 'notation', value: 'Bc4', locale: 'en-GB' },
    },
  });

  const promoted = await cases.promoteRevision.execute({
    scope: freeWorkScope(),
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: cutAnchor,
    expectedScratchId: explored.scratch!.scratchId,
    expectedScratchRevision: explored.scratch!.scratchRevision,
  });
  const preview = await cases.previewRevision.execute({
    scope: freeWorkScope(),
    expectedScratchId: promoted.scratch.scratchId,
    expectedScratchRevision: promoted.scratch.scratchRevision,
  });

  assert.equal(promoted.scratch.intent.kind, 'inventory_revision');
  assert.equal(preview.mode, 'replace_move');
  assert.deepEqual(
    preview.removedSteps.map((step) => step.move.san),
    ['d4', 'd5'],
  );
  assert.deepEqual(
    preview.addedSteps.map((step) => step.move.san),
    ['Bc4'],
  );
});

for (const inContext of [false, true]) {
  for (const rootOnly of [false, true]) {
    test(`promotes end exploration explicitly and saves once (context: ${inContext}, root-only: ${rootOnly})`, async (t) => {
      const store = storeFixture(t);
      const cases = useCases(store);
      const first = await createFrenchLine(
        cases,
        'Source',
        rootOnly ? [] : undefined,
      );
      const context = inContext
        ? await addIndependentContextUse(cases, first, 'Exploration')
        : undefined;
      const scope =
        context === undefined
          ? freeWorkScope()
          : contextWorkScope(context.context.contextId);
      const anchorId = first.steps.at(-1)?.anchorId ?? first.rootAnchorId;
      const origin = {
        kind: 'inventory_anchor' as const,
        itemId: first.itemId,
        revisionId: first.revisionId,
        anchorId,
      };
      const explored = await cases.update.execute({
        scope,
        expectedScratchId: null,
        expectedScratchRevision: null,
        action: {
          kind: 'start',
          origin,
          firstMove: {
            kind: 'notation',
            value: rootOnly ? 'e4' : 'Nc3',
            locale: 'en-GB',
          },
        },
      });
      const scratch = explored.scratch!;
      assert.equal(scratch.intent.kind, 'exploration');
      const readSource = () =>
        cases.getRevision.execute({
          scope,
          itemId: first.itemId,
          revisionId: first.revisionId,
          anchorId: first.rootAnchorId,
        });
      const assertSourceUnchanged = async () => {
        const source = await readSource();
        assert.equal(source.currentRevisionId.value, first.revisionId.value);
        assert.deepEqual(source.root, first.root);
        assert.deepEqual(source.steps, first.steps);
        assert.deepEqual(source.origin, first.origin);
      };
      await assertSourceUnchanged();
      const request = {
        scope,
        itemId: first.itemId,
        baseRevisionId: first.revisionId,
        anchorId,
        expectedScratchId: scratch.scratchId,
        expectedScratchRevision: scratch.scratchRevision,
      };
      await assert.rejects(
        cases.promoteRevision.execute({
          ...request,
          expectedScratchRevision: scratch.scratchRevision - 1,
        }),
        { problemCode: 'analysis.scratch_revision_conflict' },
      );
      const promoted = await cases.promoteRevision.execute(request);
      assert.equal(promoted.scratch.intent.kind, 'inventory_revision');
      assert.deepEqual(promoted.scratch.origin, origin);
      assert.deepEqual(promoted.scratch.root, scratch.root);
      assert.deepEqual(promoted.scratch.steps, scratch.steps);
      assert.equal(promoted.scratch.scratchId, scratch.scratchId);
      assert.equal(
        promoted.scratch.scratchRevision,
        scratch.scratchRevision + 1,
      );
      assert.equal(promoted.scratch.cursor, scratch.cursor);
      const expected = {
        scope,
        expectedScratchId: promoted.scratch.scratchId,
        expectedScratchRevision: promoted.scratch.scratchRevision,
      };
      const preview = await cases.previewRevision.execute(expected);
      assert.equal(preview.mode, 'extend');
      assert.equal(preview.preservedMoveCount, first.steps.length);
      assert.deepEqual(preview.removedSteps, []);
      assert.deepEqual(preview.addedSteps, scratch.steps);
      await assertSourceUnchanged();
      const saveRequest = {
        ...expected,
        previewFingerprint: preview.previewFingerprint,
      };
      const saved = await cases.saveRevision.execute(saveRequest);
      assert.equal(saved.revisionNumber, 2);
      const current = await cases.getRevision.execute({
        scope,
        itemId: first.itemId,
        revisionId: saved.revisionId,
        anchorId: saved.currentAnchorId,
      });
      assert.deepEqual(current.root, first.root);
      assert.deepEqual(current.steps.slice(0, first.steps.length), first.steps);
      assert.deepEqual(
        current.steps.map((step) => step.move),
        [...first.steps, ...scratch.steps].map((step) => step.move),
      );
      const beforeRetry = await store.readStoreStatus();
      await assert.rejects(cases.saveRevision.execute(saveRequest), {
        problemCode: 'analysis.scratch_not_found',
      });
      assert.deepEqual(await store.readStoreStatus(), beforeRetry);
      assert.deepEqual(
        (
          await cases.listRevisions.execute({ itemId: first.itemId })
        ).revisions.map((revision) => revision.changeKind),
        ['extend', 'created'],
      );
    });
  }

  test(`continues an existing six-move revision as exploration and saves a genuine derived analysis (context: ${inContext})`, async (t) => {
    const store = storeFixture(t);
    const cases = useCases(store);
    const first = await createFrenchLine(cases);
    const context = inContext
      ? await addIndependentContextUse(cases, first, 'Existing draft')
      : undefined;
    const scope =
      context === undefined
        ? freeWorkScope()
        : contextWorkScope(context.context.contextId);
    const anchorId = first.steps.at(-1)!.anchorId;
    const started = await cases.startRevision.execute({
      scope,
      itemId: first.itemId,
      baseRevisionId: first.revisionId,
      anchorId,
      mode: 'extend',
      expectedScratchId: null,
      expectedScratchRevision: null,
    });
    let scratch = started.scratch;
    for (const value of ['Nc3', 'Nf6', 'Bg5', 'Be7', 'e5', 'Nfd7']) {
      scratch = (
        await cases.update.execute({
          scope,
          expectedScratchId: scratch.scratchId,
          expectedScratchRevision: scratch.scratchRevision,
          action: {
            kind: 'apply_move',
            move: { kind: 'notation', value, locale: 'en-GB' },
          },
        })
      ).scratch!;
    }
    scratch = (
      await cases.update.execute({
        scope,
        expectedScratchId: scratch.scratchId,
        expectedScratchRevision: scratch.scratchRevision,
        action: { kind: 'move_cursor', cursor: 2 },
      })
    ).scratch!;
    const request = {
      scope,
      expectedScratchId: scratch.scratchId,
      expectedScratchRevision: scratch.scratchRevision,
      action: { kind: 'continue_exploration' as const },
    };
    const continued = (await cases.update.execute(request)).scratch!;
    assert.deepEqual(continued, {
      ...scratch,
      scratchRevision: scratch.scratchRevision + 1,
      intent: { kind: 'exploration' },
    });
    await assert.rejects(cases.update.execute(request), {
      problemCode: 'analysis.scratch_revision_conflict',
    });
    const completed = (
      await cases.update.execute({
        scope,
        expectedScratchId: continued.scratchId,
        expectedScratchRevision: continued.scratchRevision,
        action: { kind: 'move_cursor', cursor: 6 },
      })
    ).scratch!;
    const promoted = await cases.promoteRevision.execute({
      scope,
      itemId: first.itemId,
      baseRevisionId: first.revisionId,
      anchorId,
      expectedScratchId: completed.scratchId,
      expectedScratchRevision: completed.scratchRevision,
    });
    const back = (
      await cases.update.execute({
        scope,
        expectedScratchId: promoted.scratch.scratchId,
        expectedScratchRevision: promoted.scratch.scratchRevision,
        action: { kind: 'continue_exploration' },
      })
    ).scratch!;
    assert.deepEqual(back.steps, scratch.steps);
    assert.equal(back.scratchId, scratch.scratchId);
    const child = await cases.createRecord.execute({
      scope,
      expectedScratchId: back.scratchId,
      expectedScratchRevision: back.scratchRevision,
      displayName: 'Derived exploration',
      languageTag: 'en-GB',
    });
    const derived = await cases.getRevision.execute({
      scope: freeWorkScope(),
      itemId: child.itemId,
      revisionId: child.revisionId,
      anchorId: child.rootAnchorId,
    });
    assert.notEqual(child.itemId.value, first.itemId.value);
    assert.deepEqual(derived.root, scratch.root);
    assert.deepEqual(
      derived.steps.map((step) => step.move),
      scratch.steps.map((step) => step.move),
    );
    assert.deepEqual(derived.origin, scratch.origin);
    assert.deepEqual(derived.sourceLine?.root, first.root);
    assert.deepEqual(
      derived.sourceLine?.steps,
      first.steps.map((step) => ({
        ...step,
        itemId: first.itemId,
        revisionId: first.revisionId,
      })),
    );
    assert.deepEqual(derived.sourceLine?.sourceAnchorId, anchorId);
    const source = await cases.getRevision.execute({
      scope,
      itemId: first.itemId,
      revisionId: first.revisionId,
      anchorId: first.rootAnchorId,
    });
    assert.equal(source.currentRevisionId.value, first.revisionId.value);
    assert.deepEqual(source.root, first.root);
    assert.deepEqual(source.steps, first.steps);
    assert.deepEqual(source.origin, first.origin);
    assert.equal(
      (await cases.listRevisions.execute({ itemId: first.itemId })).revisions
        .length,
      1,
    );
  });
}

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

test('allows global metadata maintenance from an unassigned context without granting analysis membership', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const base = await createFrenchLine(cases);
  const context = await cases.createContext.execute({
    displayName: 'Unassigned context',
  });
  const scope = contextWorkScope(context.context.contextId);
  const started = await cases.startRevision.execute({
    scope,
    itemId: base.itemId,
    baseRevisionId: base.revisionId,
    anchorId: base.rootAnchorId,
    mode: 'metadata',
    displayName: 'Renamed globally',
    expectedScratchId: null,
    expectedScratchRevision: null,
  });
  const expected = {
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  };
  const getWorkspace = new GetAnalysisWorkspace({
    reader: store,
    freeSession: cases.freeSession,
    rules: new ChessJsRulesAdapter(),
    storeStatus: store,
  });
  const beforeRead = await store.readStoreStatus();
  const openWorkspace = await getWorkspace.execute({ scope });
  assert.equal(openWorkspace.record, undefined);
  assert.equal(openWorkspace.scratch, undefined);
  assert.deepEqual(openWorkspace.allowedActions, []);
  assert.equal(
    openWorkspace.currentState.fen,
    new ChessJsRulesAdapter().initialState().fen,
  );
  assert.deepEqual(await store.readStoreStatus(), beforeRead);
  assert.equal(
    (await store.readContextAnalysisWorkspace(context.context.contextId))
      ?.scratch?.scratchId,
    started.scratch.scratchId,
  );
  await assert.rejects(
    getWorkspace.execute({
      scope,
      preview: {
        itemId: base.itemId,
        revisionId: base.revisionId,
        anchorId: base.rootAnchorId,
      },
    }),
    { problemCode: 'workspace.inventory_work_not_allowed' },
  );
  const preview = await cases.previewRevision.execute(expected);
  const saved = await cases.saveRevision.execute({
    ...expected,
    previewFingerprint: preview.previewFingerprint,
  });
  const revised = await cases.getRevision.execute({
    scope: freeWorkScope(),
    itemId: base.itemId,
    revisionId: saved.revisionId,
  });
  assert.equal(revised.displayName, 'Renamed globally');
  assert.deepEqual(revised.steps, base.steps);
  const workspace = await store.readWorkingContextWorkspace(
    context.context.contextId,
  );
  assert.deepEqual(workspace?.references, []);
  assert.equal(workspace?.analysisResume?.itemId, undefined);
  const discarded = await cases.startRevision.execute({
    scope,
    itemId: base.itemId,
    baseRevisionId: saved.revisionId,
    anchorId: base.rootAnchorId,
    mode: 'metadata',
    displayName: 'Not saved',
    expectedScratchId: null,
    expectedScratchRevision: null,
  });
  await cases.update.execute({
    scope,
    expectedScratchId: discarded.scratch.scratchId,
    expectedScratchRevision: discarded.scratch.scratchRevision,
    action: { kind: 'discard' },
  });
  assert.equal(
    (await store.readWorkingContextWorkspace(context.context.contextId))
      ?.analysisResume?.itemId,
    undefined,
  );
});

test('rejects duplicate active analysis names', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  await createFrenchLine(cases, 'Französisch');

  await assert.rejects(createFrenchLine(cases, 'FRANZÖSISCH'), {
    problemCode: 'inventory.display_name_conflict',
  });
  const scratch = await cases.freeSession.read();
  assert.ok(scratch);
  const saved = await cases.createRecord.execute({
    scope: freeWorkScope(),
    expectedScratchId: scratch.scratchId,
    expectedScratchRevision: scratch.scratchRevision,
    displayName: 'French alternative',
    languageTag: 'de-DE',
  });
  assert.ok(saved.itemId);
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
    { problemCode: 'inventory.display_name_conflict' },
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
    scope: { kind: 'context', contextId: contextB.context.contextId },
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
    expectedDataRevision: impact.dataRevision,
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
  await addIndependentContextUse(cases, first, 'Unabhaengig A');

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
    expectedDataRevision: impact.dataRevision,
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
  await addIndependentContextUse(cases, first, 'Unabhaengig B');

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
  const beforeConflict = {
    status: await store.readStoreStatus(),
    context: await cases.getContext.execute({
      contextId: context.context.contextId,
    }),
    inventory: await store.searchInventory({ pageSize: 10 }),
  };
  await assert.rejects(
    cases.resolveImpact.execute({
      impactId,
      expectedImpactVersion: impact.impactVersion,
      expectedDataRevision: impact.dataRevision,
      resolution: {
        kind: 'keep_copy',
        displayName: first.displayName.toUpperCase(),
      },
    }),
    { problemCode: 'inventory.display_name_conflict' },
  );
  assert.deepEqual(await cases.getImpact.execute({ impactId }), impact);
  assert.deepEqual(await store.readStoreStatus(), beforeConflict.status);
  assert.deepEqual(
    await cases.getContext.execute({ contextId: context.context.contextId }),
    beforeConflict.context,
  );
  assert.deepEqual(
    await store.searchInventory({ pageSize: 10 }),
    beforeConflict.inventory,
  );
  const resolution = await cases.resolveImpact.execute({
    impactId,
    expectedImpactVersion: impact.impactVersion,
    expectedDataRevision: impact.dataRevision,
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
    scope: { kind: 'context', contextId: context.context.contextId },
    area: 'analyze',
    expectedResumeVersion: null,
    mode: 'analyze',
    itemId: first.itemId,
    revisionId: first.revisionId,
    anchorId: replaced,
  });
  await addIndependentContextUse(cases, first, 'Unabhaengig C');

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
    expectedDataRevision: impact.dataRevision,
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
  const noOpScratch = await cases.startRevision.execute({
    scope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: first.steps.at(-1)!.anchorId,
    mode: 'extend',
    expectedScratchId: null,
    expectedScratchRevision: null,
  });
  const beforeNoOp = await store.readStoreStatus();
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
    (await cases.freeSession.read())?.scratchId,
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

for (const change of ['add', 'remove'] as const) {
  test(`rejects a branch deletion preview after an unaffected membership ${change}`, async (t) => {
    const store = storeFixture(t);
    const cases = useCases(store);
    const first = await createBranchingRecord(store);
    const removed = first.tree!.nodes[3]!.anchorId;
    const retained = first.tree!.nodes[2]!.anchorId;
    const context = await cases.createContext.execute({
      displayName: 'Affected',
    });
    const contextId = context.context.contextId;
    await cases.addReference.execute({
      contextId,
      itemId: first.itemId,
      anchorId: removed,
    });
    await cases.createPositionNote.execute({
      scope: contextWorkScope(contextId),
      itemId: first.itemId,
      revisionId: first.revisionId,
      anchorId: removed,
      body: 'Keep this context note',
      languageTag: 'en-GB',
      noteScope: { kind: 'context', contextId },
    });
    const other = await cases.createContext.execute({
      displayName: 'Unaffected',
    });
    const otherId = other.context.contextId;
    const addOther = () =>
      cases.addReference.execute({
        contextId: otherId,
        itemId: first.itemId,
        anchorId: first.rootAnchorId,
      });
    if (change === 'remove') await addOther();
    const scope = freeWorkScope();
    const started = await cases.startRevision.execute({
      scope,
      itemId: first.itemId,
      baseRevisionId: first.revisionId,
      anchorId: retained,
      lineAnchorId: removed,
      mode: 'truncate_after',
      expectedScratchId: null,
      expectedScratchRevision: null,
    });
    const expected = {
      scope,
      expectedScratchId: started.scratch.scratchId,
      expectedScratchRevision: started.scratch.scratchRevision,
    };
    const preview = await cases.previewRevision.execute(expected);
    assert.equal(preview.affectedContexts.length, change === 'remove' ? 1 : 0);
    if (change === 'add') {
      await addOther();
    } else {
      const removal = await store.previewContextItemRemoval({
        contextId: otherId,
        itemId: first.itemId,
      });
      await cases.removeItem.execute({
        contextId: otherId,
        itemId: first.itemId,
        expectedDataRevision: removal.dataRevision,
        expectedContextVersion: removal.contextVersion,
      });
    }
    const before = inspectStore(store, (db) => db.serialize());
    await assert.rejects(
      cases.saveRevision.execute({
        ...expected,
        previewFingerprint: preview.previewFingerprint,
      }),
      { problemCode: 'inventory.preview_conflict' },
    );
    assert.deepEqual(
      inspectStore(store, (db) => db.serialize()),
      before,
    );
    const refreshed = await cases.previewRevision.execute(expected);
    assert.notEqual(refreshed.previewFingerprint, preview.previewFingerprint);
    assert.equal(refreshed.affectedContexts.length, change === 'add' ? 1 : 0);
    await cases.createContext.execute({ displayName: 'Unrelated' });
    assert.equal(
      (await cases.previewRevision.execute(expected)).previewFingerprint,
      refreshed.previewFingerprint,
    );
    const saved = await cases.saveRevision.execute({
      ...expected,
      previewFingerprint: refreshed.previewFingerprint,
    });
    assert.equal(saved.impacts.length, change === 'add' ? 1 : 0);
    assert.equal(
      inspectStore(
        store,
        (db) =>
          (
            db
              .prepare(
                "SELECT status FROM workspace_contribution WHERE body = 'Keep this context note'",
              )
              .get() as { status: string }
          ).status,
      ),
      change === 'add' ? 'active' : 'archived',
    );
  });
}

test('binds a resolved context pin to a later variation preview and keeps pinned notes read-only', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createBranchingRecord(store);
  const removed = first.tree!.nodes[3]!.anchorId;
  const context = await cases.createContext.execute({ displayName: 'Pinned' });
  const contextId = context.context.contextId;
  const scope = freeWorkScope();
  await cases.addReference.execute({
    contextId,
    itemId: first.itemId,
    anchorId: removed,
  });
  await addIndependentContextUse(cases, first, 'Following');
  const cut = await cases.startRevision.execute({
    scope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: first.tree!.nodes[2]!.anchorId,
    lineAnchorId: removed,
    mode: 'truncate_after',
    expectedScratchId: null,
    expectedScratchRevision: null,
  });
  const cutExpected = {
    scope,
    expectedScratchId: cut.scratch.scratchId,
    expectedScratchRevision: cut.scratch.scratchRevision,
  };
  const cutPreview = await cases.previewRevision.execute(cutExpected);
  const saved = await cases.saveRevision.execute({
    ...cutExpected,
    previewFingerprint: cutPreview.previewFingerprint,
  });
  assert.equal(saved.impacts.length, 1);
  const pinned = await cases.getContext.execute({ contextId });
  assert.equal(
    pinned.references[0]!.currentRevisionId.value,
    first.revisionId.value,
  );
  assert.ok(
    await store.readAnalysisRevision({
      scope: contextWorkScope(contextId),
      itemId: first.itemId,
      revisionId: first.revisionId,
      anchorId: removed,
    }),
  );
  for (const revisionId of [first.revisionId, saved.revisionId]) {
    for (const noteScope of [
      { kind: 'global' },
      { kind: 'context', contextId },
    ] as const) {
      const before = inspectStore(store, (db) => db.serialize());
      await assert.rejects(
        cases.createPositionNote.execute({
          scope: contextWorkScope(contextId),
          itemId: first.itemId,
          revisionId,
          anchorId: first.rootAnchorId,
          body: 'Blocked',
          languageTag: 'en-GB',
          noteScope,
        }),
        { problemCode: 'workspace.impact_conflict' },
      );
      assert.deepEqual(
        inspectStore(store, (db) => db.serialize()),
        before,
      );
    }
  }
  await cases.createPositionNote.execute({
    scope,
    itemId: first.itemId,
    revisionId: saved.revisionId,
    anchorId: first.rootAnchorId,
    body: 'Free current note',
    languageTag: 'en-GB',
    noteScope: { kind: 'global' },
  });
  const started = await cases.startRevision.execute({
    scope,
    itemId: first.itemId,
    baseRevisionId: saved.revisionId,
    anchorId: first.rootAnchorId,
    mode: 'add_variation',
    firstMove: { kind: 'notation', value: 'a3', locale: 'en-GB' },
    expectedScratchId: null,
    expectedScratchRevision: null,
  });
  const expected = {
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  };
  const preview = await cases.previewRevision.execute(expected);
  const impact = await cases.getImpact.execute({
    impactId: saved.impacts[0]!.impactId,
  });
  await cases.resolveImpact.execute({
    impactId: impact.impactId,
    expectedImpactVersion: impact.impactVersion,
    expectedDataRevision: impact.dataRevision,
    resolution: { kind: 'use_target' },
  });
  const before = inspectStore(store, (db) => db.serialize());
  await assert.rejects(
    cases.saveRevision.execute({
      ...expected,
      previewFingerprint: preview.previewFingerprint,
    }),
    { problemCode: 'inventory.preview_conflict' },
  );
  assert.deepEqual(
    inspectStore(store, (db) => db.serialize()),
    before,
  );
  const refreshed = await cases.previewRevision.execute(expected);
  assert.equal(refreshed.affectedContexts.length, 0);
  const current = await cases.saveRevision.execute({
    ...expected,
    previewFingerprint: refreshed.previewFingerprint,
  });
  await cases.createPositionNote.execute({
    scope: contextWorkScope(contextId),
    itemId: first.itemId,
    revisionId: current.revisionId,
    anchorId: first.rootAnchorId,
    body: 'Resolved context note',
    languageTag: 'en-GB',
    noteScope: { kind: 'context', contextId },
  });
});

test('rejects a position note on a removed historical branch without writes', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createBranchingRecord(store);
  const removed = first.tree!.nodes[3]!.anchorId;
  const retained = first.tree!.nodes[2]!.anchorId;
  const context = await cases.createContext.execute({
    displayName: 'Following',
  });
  const contextId = context.context.contextId;
  await cases.addReference.execute({
    contextId,
    itemId: first.itemId,
    anchorId: removed,
  });
  const scope = freeWorkScope();
  const started = await cases.startRevision.execute({
    scope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: retained,
    lineAnchorId: removed,
    mode: 'truncate_after',
    expectedScratchId: null,
    expectedScratchRevision: null,
  });
  const expected = {
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  };
  const preview = await cases.previewRevision.execute(expected);
  const saved = await cases.saveRevision.execute({
    ...expected,
    previewFingerprint: preview.previewFingerprint,
  });
  for (const noteScope of [freeWorkScope(), contextWorkScope(contextId)]) {
    for (const anchorId of [removed, first.rootAnchorId]) {
      const before = inspectStore(store, (db) => db.serialize());
      await assert.rejects(
        cases.createPositionNote.execute({
          scope: noteScope,
          itemId: first.itemId,
          revisionId: first.revisionId,
          anchorId,
          body: 'Late historical note',
          languageTag: 'en-GB',
          noteScope: noteScope.kind === 'free' ? { kind: 'global' } : noteScope,
        }),
        { problemCode: 'analysis.invalid_note' },
      );
      assert.deepEqual(
        inspectStore(store, (db) => db.serialize()),
        before,
      );
    }
    await cases.createPositionNote.execute({
      scope: noteScope,
      itemId: first.itemId,
      revisionId: saved.revisionId,
      anchorId: retained,
      body: 'Current note',
      languageTag: 'en-GB',
      noteScope: noteScope.kind === 'free' ? { kind: 'global' } : noteScope,
    });
  }
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
  assert.equal(
    (await cases.freeSession.read())?.scratchId,
    started.scratch.scratchId,
  );
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

test('the publishing context follows a truncation without reviewing its own change', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const removed = first.steps.at(-1)!.anchorId;
  const retained = first.steps.at(-2)!.anchorId;
  const context = await cases.createContext.execute({ displayName: 'Editor' });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: first.itemId,
    anchorId: removed,
  });
  await cases.createPositionNote.execute({
    scope: contextWorkScope(context.context.contextId),
    itemId: first.itemId,
    revisionId: first.revisionId,
    anchorId: removed,
    body: 'Only relevant to the removed move.',
    languageTag: 'en-GB',
    noteScope: { kind: 'context', contextId: context.context.contextId },
  });
  await cases.setResume.execute({
    scope: { kind: 'context', contextId: context.context.contextId },
    area: 'analyze',
    expectedResumeVersion: null,
    mode: 'analyze',
    itemId: first.itemId,
    revisionId: first.revisionId,
    anchorId: removed,
  });
  const scope = contextWorkScope(context.context.contextId);
  const started = await cases.startRevision.execute({
    scope,
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: retained,
    mode: 'truncate_after',
    expectedScratchId: null,
    expectedScratchRevision: null,
  });
  const preview = await cases.previewRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  });

  assert.equal(preview.affectedContexts.length, 0);
  assert.deepEqual(
    preview.followingContexts.map((entry) => entry.contextId),
    [context.context.contextId],
  );
  assert.deepEqual(preview.followingContexts[0], {
    contextId: context.context.contextId,
    contextName: 'Editor',
    updatedAutomatically: true,
    referenceCount: 1,
    contributionCount: 1,
    changedScratchCount: 0,
    managementResumeCount: 0,
    analysisResumeCount: 0,
  });
  const saved = await cases.saveRevision.execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
    previewFingerprint: preview.previewFingerprint,
  });
  assert.equal(saved.impacts.length, 0);
  const workspace = await cases.getContext.execute({
    contextId: context.context.contextId,
  });
  assert.equal(workspace.context.pendingRevisionImpactCount, 0);
  assert.equal(
    workspace.references[0]?.anchorId.value,
    saved.currentAnchorId.value,
  );
  assert.equal(
    workspace.analysisResume?.revisionId?.value,
    saved.revisionId.value,
  );
  const current = await cases.getRevision.execute({
    scope,
    itemId: first.itemId,
    revisionId: saved.revisionId,
    anchorId: saved.currentAnchorId,
  });
  assert.equal(current.contributions.length, 0);
});

test('one sole context follows an externally published truncation automatically', async (t) => {
  const store = storeFixture(t);
  const cases = useCases(store);
  const first = await createFrenchLine(cases);
  const removed = first.steps.at(-1)!.anchorId;
  const retained = first.steps.at(-2)!.anchorId;
  const context = await cases.createContext.execute({
    displayName: 'Only use',
  });
  await cases.addReference.execute({
    contextId: context.context.contextId,
    itemId: first.itemId,
    anchorId: removed,
  });
  const started = await cases.startRevision.execute({
    scope: freeWorkScope(),
    itemId: first.itemId,
    baseRevisionId: first.revisionId,
    anchorId: retained,
    mode: 'truncate_after',
    expectedScratchId: null,
    expectedScratchRevision: null,
  });
  const preview = await cases.previewRevision.execute({
    scope: freeWorkScope(),
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  });

  assert.equal(preview.affectedContexts.length, 0);
  assert.equal(preview.followingContexts.length, 1);
  assert.deepEqual(preview.followingContexts[0], {
    contextId: context.context.contextId,
    contextName: 'Only use',
    updatedAutomatically: true,
    referenceCount: 1,
    contributionCount: 0,
    changedScratchCount: 0,
    managementResumeCount: 0,
    analysisResumeCount: 0,
  });
  const saved = await cases.saveRevision.execute({
    scope: freeWorkScope(),
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
    previewFingerprint: preview.previewFingerprint,
  });
  assert.equal(saved.impacts.length, 0);
  const workspace = await cases.getContext.execute({
    contextId: context.context.contextId,
  });
  assert.equal(workspace.context.pendingRevisionImpactCount, 0);
  assert.equal(
    workspace.references[0]?.anchorId.value,
    saved.currentAnchorId.value,
  );
});

for (const scenario of ['empty', 'moves', 'retained', 'metadata'] as const) {
  test(`automatic revision preview counts actual scratch loss: ${scenario}`, async (t) => {
    const store = storeFixture(t);
    const cases = useCases(store);
    const first = await createFrenchLine(cases);
    const context = await addIndependentContextUse(
      cases,
      first,
      'Automatic context',
    );
    const contextScope = contextWorkScope(context.context.contextId);
    const lineEnd = first.steps.at(-1)!.anchorId;
    const retained = first.steps.at(-2)!.anchorId;
    const competing =
      scenario === 'metadata'
        ? await cases.startRevision.execute({
            scope: contextScope,
            itemId: first.itemId,
            baseRevisionId: first.revisionId,
            anchorId: lineEnd,
            mode: 'metadata',
            displayName: 'Unsaved context name',
            expectedScratchId: null,
            expectedScratchRevision: null,
          })
        : await cases.update.execute({
            scope: contextScope,
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
    let scratch = competing.scratch!;
    if (scenario === 'moves' || scenario === 'retained') {
      scratch = (
        await cases.update.execute({
          scope: contextScope,
          expectedScratchId: scratch.scratchId,
          expectedScratchRevision: scratch.scratchRevision,
          action: {
            kind: 'apply_move',
            move: { kind: 'notation', value: 'Nc3', locale: 'en-GB' },
          },
        })
      ).scratch!;
    }
    const publisher = await cases.startRevision.execute({
      scope: freeWorkScope(),
      itemId: first.itemId,
      baseRevisionId: first.revisionId,
      anchorId: scenario === 'metadata' ? lineEnd : retained,
      mode:
        scenario === 'metadata' || scenario === 'retained'
          ? 'metadata'
          : 'truncate_after',
      displayName: 'Published name',
      expectedScratchId: null,
      expectedScratchRevision: null,
    });
    const request = {
      scope: freeWorkScope(),
      expectedScratchId: publisher.scratch.scratchId,
      expectedScratchRevision: publisher.scratch.scratchRevision,
    };
    const preview = await cases.previewRevision.execute(request);
    assert.equal(preview.affectedContexts.length, 0);
    assert.equal(
      preview.followingContexts[0]?.changedScratchCount,
      scenario === 'moves' || scenario === 'metadata' ? 1 : 0,
    );
    assert.deepEqual(
      (await store.readContextAnalysisWorkspace(context.context.contextId))
        ?.scratch,
      scratch,
    );

    let finalPreview = preview;
    if (scenario === 'empty') {
      scratch = (
        await cases.update.execute({
          scope: contextScope,
          expectedScratchId: scratch.scratchId,
          expectedScratchRevision: scratch.scratchRevision,
          action: {
            kind: 'apply_move',
            move: { kind: 'notation', value: 'Nc3', locale: 'en-GB' },
          },
        })
      ).scratch!;
      await cases.update.execute({
        scope: contextScope,
        expectedScratchId: scratch.scratchId,
        expectedScratchRevision: scratch.scratchRevision,
        action: { kind: 'prepare_note', body: 'Unsaved thought' },
      });
      await assert.rejects(
        cases.saveRevision.execute({
          ...request,
          previewFingerprint: preview.previewFingerprint,
        }),
        { problemCode: 'inventory.preview_conflict' },
      );
      finalPreview = await cases.previewRevision.execute(request);
      assert.equal(finalPreview.followingContexts[0]?.changedScratchCount, 1);
    }
    const saved = await cases.saveRevision.execute({
      ...request,
      previewFingerprint: finalPreview.previewFingerprint,
    });
    assert.equal(saved.impacts.length, 0);
    const after = await store.readContextAnalysisWorkspace(
      context.context.contextId,
    );
    if (scenario === 'retained') {
      assert.equal(after?.scratch?.scratchId, scratch.scratchId);
      assert.deepEqual(after?.scratch?.steps, scratch.steps);
    } else {
      assert.equal(after?.scratch, undefined);
    }
  });
}

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
  await addIndependentContextUse(cases, first, 'Unabhaengig D');

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
    expectedDataRevision: impact.dataRevision,
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
  await addIndependentContextUse(cases, first, 'Unabhaengig E');
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
  const removal = await store.previewContextItemRemoval({
    contextId: context.context.contextId,
    itemId: first.itemId,
  });
  await assert.rejects(
    cases.removeItem.execute({
      contextId: context.context.contextId,
      itemId: first.itemId,
      expectedDataRevision: removal.dataRevision,
      expectedContextVersion: removal.contextVersion,
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
  await addIndependentContextUse(cases, first, 'Unabhaengig F');

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
    expectedDataRevision: firstImpact.dataRevision,
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
    expectedDataRevision: secondImpact.dataRevision,
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
  assert.deepEqual(copied.origin, {
    kind: 'inventory_anchor',
    itemId: secondRecord.itemId,
    revisionId: secondRecord.revisionId,
    anchorId: secondRecord.rootAnchorId,
  });
  const family = await store.searchInventory({
    pageSize: 1,
    query: copied.displayName,
  });
  assert.deepEqual(
    family.provenanceEdges.find(
      (edge) => edge.itemId.value === copied.itemId.value,
    ),
    {
      itemId: copied.itemId,
      sourceItemId: secondRecord.itemId,
      sourceRevisionId: secondRecord.revisionId,
      sourceAnchorId: secondRecord.rootAnchorId,
    },
  );

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
    scope: { kind: 'context', contextId: context.context.contextId },
    area: 'analyze',
    expectedResumeVersion: null,
    mode: 'analyze',
    itemId: affected.itemId,
    revisionId: affected.revisionId,
    anchorId: affectedEnd,
  });
  await addIndependentContextUse(cases, affected, 'Unabhaengig G');

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
    scope: { kind: 'context', contextId: context.context.contextId },
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
    expectedDataRevision: impact.dataRevision,
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
      scope: { kind: 'context', contextId: context.context.contextId },
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
    scope: { kind: 'context', contextId: context.context.contextId },
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
