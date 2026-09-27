import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import Database from 'better-sqlite3';

import {
  CreateAnalysisNote,
  CreateAnalysisRecord,
  CreatePositionNote,
  DeleteAnalysisNote,
  FreeAnalysisSession,
  GetAnalysisWorkspace,
  UpdateAnalysisScratch,
  UpdateAnalysisNote,
} from '../../../app/application/analysis/index.ts';
import { CompletePlayout } from '../../../app/application/playout/index.ts';
import {
  appendUserPlayoutMove,
  stopPlayoutDraft,
} from '../../../app/domain/playout/index.ts';
import {
  PreviewInventoryRevision,
  SaveInventoryRevision,
  SearchInventory,
  StartInventoryRevision,
} from '../../../app/application/inventory/index.ts';
import {
  AddContextReference,
  CreateWorkingContext,
  GetWorkingContextWorkspace,
  ListWorkingContexts,
  RemoveContextItem,
  SetWorkScopeResume,
} from '../../../app/application/workspace/index.ts';
import {
  contextWorkScope,
  freeWorkScope,
} from '../../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';

const timestamp = '2026-09-11T12:00:00.000Z';
const noEvents = { publish: () => undefined };

function storeFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'plysmith-analysis-'));
  const databasePath = join(directory, 'store.sqlite');
  const stores: SqlitePersistenceAdapter[] = [];
  t.after(async () => {
    for (const store of stores) await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    databasePath,
    open() {
      const store = new SqlitePersistenceAdapter({
        databasePath,
        now: () => timestamp,
      });
      stores.push(store);
      return store;
    },
  };
}

function analysisUseCases(
  store: SqlitePersistenceAdapter,
  freeSession = new FreeAnalysisSession({
    persistence: store,
    clock: { now: () => timestamp },
  }),
  scratchId: () => string = () => 'scratch-from-application',
) {
  const rules = new ChessJsRulesAdapter();
  return {
    freeSession,
    get: new GetAnalysisWorkspace({
      reader: store,
      freeSession,
      rules,
      storeStatus: store,
    }),
    update: new UpdateAnalysisScratch({
      reader: store,
      writer: store,
      freeSession,
      rules,
      storeStatus: store,
      clock: { now: () => timestamp },
      events: noEvents,
      scratchId,
    }),
    create: new CreateAnalysisRecord({
      reader: store,
      writer: store,
      freeSession,
      clock: { now: () => timestamp },
      inventoryEvents: noEvents,
      workspaceEvents: noEvents,
    }),
    createNote: new CreateAnalysisNote({
      reader: store,
      writer: store,
      freeSession,
      clock: { now: () => timestamp },
      analysisEvents: noEvents,
      workspaceEvents: noEvents,
    }),
    createPositionNote: new CreatePositionNote({
      writer: store,
      clock: { now: () => timestamp },
      events: noEvents,
    }),
    updateNote: new UpdateAnalysisNote({
      writer: store,
      clock: { now: () => timestamp },
      events: noEvents,
    }),
    deleteNote: new DeleteAnalysisNote({
      writer: store,
      clock: { now: () => timestamp },
      events: noEvents,
    }),
  };
}

function workspaceUseCases(store: SqlitePersistenceAdapter) {
  return {
    create: new CreateWorkingContext({
      writer: store,
      clock: { now: () => timestamp },
      events: noEvents,
    }),
    list: new ListWorkingContexts(store),
    get: new GetWorkingContextWorkspace(store),
    addReference: new AddContextReference({
      writer: store,
      clock: { now: () => timestamp },
      events: noEvents,
    }),
    removeItem: new RemoveContextItem({
      writer: store,
      clock: { now: () => timestamp },
      events: noEvents,
    }),
    setResume: new SetWorkScopeResume({
      writer: store,
      clock: { now: () => timestamp },
      events: noEvents,
    }),
  };
}

test('reads a fresh initial-position workspace without replacing analysis resume', async (t) => {
  const fixture = storeFixture(t);
  const store = fixture.open();
  const analysis = analysisUseCases(store);
  const scope = freeWorkScope();
  const started = await analysis.update.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: { kind: 'initial_position' },
      firstMove: { kind: 'coordinates', value: 'e2e4' },
    },
  });

  const fresh = await analysis.get.execute({
    scope,
    mode: 'initial_position',
  });
  assert.equal(fresh.scratch, undefined);
  assert.equal(fresh.record, undefined);
  assert.equal(fresh.currentState.position.sideToMove, 'white');
  assert.equal(fresh.legalMoves.length, 20);

  const resumed = await analysis.get.execute({ scope });
  assert.equal(resumed.scratch?.scratchId, started.scratch?.scratchId);
  assert.equal(resumed.scratch?.steps[0]?.move.san, 'e4');
});

test('persists analysis, note, context reference and resume as one recoverable workflow', async (t) => {
  const fixture = storeFixture(t);
  const store = fixture.open();
  const workspace = workspaceUseCases(store);
  const context = await workspace.create.execute({
    displayName: 'Eröffnungsrepertoire',
    purpose: 'Eigene Hauptwege mit Weiß aufbauen.',
    nextStep: 'Mit 1.e4 beginnen.',
  });
  const scope = contextWorkScope(context.context.contextId);
  const analysis = analysisUseCases(store);

  const started = await analysis.update.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  const moved = await analysis.update.execute({
    scope,
    expectedScratchId: started.scratch?.scratchId ?? '',
    expectedScratchRevision: started.scratch?.scratchRevision ?? -1,
    action: {
      kind: 'apply_move',
      move: { kind: 'notation', value: 'e4', locale: 'de-DE' },
    },
  });
  const noted = await analysis.update.execute({
    scope,
    expectedScratchId: moved.scratch?.scratchId ?? '',
    expectedScratchRevision: moved.scratch?.scratchRevision ?? -1,
    action: {
      kind: 'prepare_note',
      body: 'Dieser Zug hält viele Repertoirewege offen.',
    },
  });
  const saved = await analysis.create.execute({
    scope,
    expectedScratchId: noted.scratch?.scratchId ?? '',
    expectedScratchRevision: noted.scratch?.scratchRevision ?? -1,
    displayName: 'Repertoire nach 1.e4',
    languageTag: 'de-DE',
    targetContextId: context.context.contextId,
  });

  assert.equal(saved.dataRevision, 5);
  assert.equal(saved.resumeUpdates.length, 1);
  const found = await new SearchInventory(store).execute({
    query: 'Repertoire nach 1.e4',
  });
  assert.equal(found.items.length, 1);
  assert.deepEqual(found.items[0]?.contextIds, [context.context.contextId]);
  assert.equal(found.items[0]?.rootAnchorId.value, saved.rootAnchorId.value);
  const contexts = await workspace.list.execute({});
  assert.equal(contexts.contexts[0]?.referenceCount, 1);

  const contextWorkspace = await workspace.get.execute({
    contextId: context.context.contextId,
  });
  assert.equal(contextWorkspace.references.length, 1);
  assert.equal(
    contextWorkspace.analysisResume?.itemId?.value,
    saved.itemId.value,
  );
  assert.equal(contextWorkspace.analysisResume?.scratchId, undefined);
  const resumed = await analysis.get.execute({ scope });
  assert.equal(resumed.scratch, undefined);
  assert.equal(resumed.record?.displayName, 'Repertoire nach 1.e4');
  assert.equal(resumed.record?.cursor, 1);
  assert.equal(resumed.currentState.position.sideToMove, 'black');
  const stepAnchorId = resumed.record?.steps[0]?.anchorId;
  assert.notEqual(stepAnchorId, undefined);
  assert.notEqual(stepAnchorId?.value, saved.rootAnchorId.value);
  const atRoot = await analysis.get.execute({
    scope,
    preview: {
      itemId: saved.itemId,
      revisionId: saved.revisionId,
      anchorId: saved.rootAnchorId,
    },
  });
  assert.equal(atRoot.record?.cursor, 0);
  assert.equal(atRoot.currentState.position.sideToMove, 'white');
  const atMove = await analysis.get.execute({
    scope,
    preview: {
      itemId: saved.itemId,
      revisionId: saved.revisionId,
      anchorId: stepAnchorId!,
    },
  });
  assert.equal(atMove.record?.cursor, 1);
  assert.equal(atMove.currentState.position.sideToMove, 'black');
  assert.deepEqual(
    resumed.record?.contributions.map((entry) => entry.body),
    ['Dieser Zug hält viele Repertoirewege offen.'],
  );
  assert.deepEqual(resumed.record?.contributions[0]?.moves, []);

  await store.close();
  const reopened = fixture.open();
  const afterRestart = await analysisUseCases(reopened).get.execute({ scope });
  assert.equal(afterRestart.record?.itemId.value, saved.itemId.value);
  assert.equal(afterRestart.record?.cursor, 1);
  assert.equal(afterRestart.dataRevision, 5);
  const inspection = new Database(fixture.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assert.equal(inspection.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(inspection.pragma('foreign_key_check'), []);
    assert.equal(
      (
        inspection
          .prepare('SELECT count(*) AS count FROM analysis_scratch_draft')
          .get() as { count: number }
      ).count,
      0,
    );
    assert.equal(
      (
        inspection
          .prepare(
            'SELECT count(*) AS count FROM workspace_analysis_note_path_step',
          )
          .get() as { count: number }
      ).count,
      0,
    );
  } finally {
    inspection.close();
  }
});

for (const inContext of [false, true]) {
  test(`persists an initial-position library root and its derived family (context: ${inContext})`, async (t) => {
    const fixture = storeFixture(t);
    const store = fixture.open();
    const context = inContext
      ? (
          await workspaceUseCases(store).create.execute({
            displayName: 'Opening library',
          })
        ).context
      : undefined;
    const scope = context
      ? contextWorkScope(context.contextId)
      : freeWorkScope();
    const analysis = analysisUseCases(store);
    const started = await analysis.update.execute({
      scope,
      expectedScratchId: null,
      expectedScratchRevision: null,
      action: { kind: 'start', origin: { kind: 'initial_position' } },
    });
    const library = await analysis.create.execute({
      scope,
      expectedScratchId: started.scratch!.scratchId,
      expectedScratchRevision: started.scratch!.scratchRevision,
      displayName: 'Opening library',
      languageTag: 'en-GB',
      ...(context ? { targetContextId: context.contextId } : {}),
    });
    const root = (await analysis.get.execute({ scope })).record!;
    assert.equal(root.steps.length, 0);
    assert.equal(root.origin.kind, 'initial_position');
    assert.equal(root.root.fen, new ChessJsRulesAdapter().initialState().fen);
    const childScratch = await analysis.update.execute({
      scope,
      expectedScratchId: null,
      expectedScratchRevision: null,
      action: {
        kind: 'start',
        origin: {
          kind: 'inventory_anchor',
          itemId: library.itemId,
          revisionId: library.revisionId,
          anchorId: root.rootAnchorId,
        },
        firstMove: { kind: 'notation', value: 'e4', locale: 'en-GB' },
      },
    });
    const child = await analysis.create.execute({
      scope,
      expectedScratchId: childScratch.scratch!.scratchId,
      expectedScratchRevision: childScratch.scratch!.scratchRevision,
      displayName: 'King pawn openings',
      languageTag: 'en-GB',
      ...(context ? { targetContextId: context.contextId } : {}),
    });
    await store.close();
    const reopened = fixture.open();
    const restored = await analysisUseCases(reopened).get.execute({ scope });
    assert.equal(restored.record?.itemId.value, child.itemId.value);
    const family = await new SearchInventory(reopened).execute({});
    assert.deepEqual(
      family.provenanceEdges.map((edge) => [
        edge.sourceItemId.value,
        edge.itemId.value,
      ]),
      [[library.itemId.value, child.itemId.value]],
    );
    const unchanged = await analysisUseCases(reopened).get.execute({
      scope,
      preview: {
        itemId: library.itemId,
        revisionId: library.revisionId,
        anchorId: root.rootAnchorId,
      },
    });
    assert.equal(unchanged.record?.steps.length, 0);
    assert.equal(unchanged.record?.revisionId.value, library.revisionId.value);
  });
}

test('persists a root-only analysis created from a structured position', async (t) => {
  const fixture = storeFixture(t);
  const store = fixture.open();
  const workspace = workspaceUseCases(store);
  const context = await workspace.create.execute({
    displayName: 'Stellungsanalyse',
    purpose: 'Eine frei aufgebaute Stellung untersuchen.',
  });
  const scope = contextWorkScope(context.context.contextId);
  const analysis = analysisUseCases(store);
  const setup = {
    pieces: [
      { square: 'e1', color: 'white' as const, role: 'king' as const },
      { square: 'a1', color: 'white' as const, role: 'rook' as const },
      { square: 'e8', color: 'black' as const, role: 'king' as const },
    ],
    sideToMove: 'white' as const,
    castlingRights: {
      whiteKingSide: false,
      whiteQueenSide: false,
      blackKingSide: false,
      blackQueenSide: false,
    },
    halfmoveClock: 0,
    fullmoveNumber: 1,
  };
  const started = await analysis.update.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'position_setup', setup } },
  });
  const saved = await analysis.create.execute({
    scope,
    expectedScratchId: started.scratch?.scratchId ?? '',
    expectedScratchRevision: started.scratch?.scratchRevision ?? -1,
    displayName: 'Turmendspiel Ausgangsstellung',
    languageTag: 'de-DE',
    targetContextId: context.context.contextId,
  });

  const current = await analysis.get.execute({ scope });
  assert.equal(current.record?.steps.length, 0);
  assert.equal(current.record?.root.position.sideToMove, 'white');
  assert.match(current.record?.root.fen ?? '', /^4k3\/8\/8\/8\/8\/8\/8\/R3K3/);

  await store.close();
  const reopened = fixture.open();
  const afterRestart = await analysisUseCases(reopened).get.execute({ scope });
  assert.equal(afterRestart.record?.itemId.value, saved.itemId.value);
  assert.equal(afterRestart.record?.steps.length, 0);
  assert.equal(afterRestart.record?.origin.kind, 'position_setup');
});

test('navigates inner record anchors independently from every referencing context', async (t) => {
  const store = storeFixture(t).open();
  const workspace = workspaceUseCases(store);
  const firstContext = await workspace.create.execute({
    displayName: 'e:d5',
  });
  const secondContext = await workspace.create.execute({
    displayName: 'MCP-Checkpoint',
  });
  const firstScope = contextWorkScope(firstContext.context.contextId);
  const analysis = analysisUseCases(store);

  let current = await analysis.update.execute({
    scope: firstScope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  for (const move of ['e4', 'd5', 'exd5']) {
    current = await analysis.update.execute({
      scope: firstScope,
      expectedScratchId: current.scratch?.scratchId ?? '',
      expectedScratchRevision: current.scratch?.scratchRevision ?? -1,
      action: {
        kind: 'apply_move',
        move: { kind: 'notation', value: move, locale: 'de-DE' },
      },
    });
  }
  current = await analysis.update.execute({
    scope: firstScope,
    expectedScratchId: current.scratch?.scratchId ?? '',
    expectedScratchRevision: current.scratch?.scratchRevision ?? -1,
    action: { kind: 'prepare_note', body: 'e:d5 untersuchen' },
  });
  const saved = await analysis.create.execute({
    scope: firstScope,
    expectedScratchId: current.scratch?.scratchId ?? '',
    expectedScratchRevision: current.scratch?.scratchRevision ?? -1,
    displayName: 'e:d5',
    languageTag: 'de-DE',
    targetContextId: firstContext.context.contextId,
  });
  await workspace.addReference.execute({
    contextId: secondContext.context.contextId,
    itemId: saved.itemId,
    anchorId: saved.rootAnchorId,
  });

  const record = await analysis.get.execute({ scope: firstScope });
  const finalAnchorId = record.record?.steps.at(-1)?.anchorId;
  assert.notEqual(finalAnchorId, undefined);

  for (const context of [firstContext.context, secondContext.context]) {
    const contextWorkspace = await workspace.get.execute({
      contextId: context.contextId,
    });
    await workspace.setResume.execute({
      area: 'analyze',
      scope: { kind: 'context', contextId: context.contextId },
      expectedResumeVersion:
        contextWorkspace.analysisResume?.resumeVersion ?? null,
      mode: 'analyze',
      itemId: saved.itemId,
      revisionId: saved.revisionId,
      anchorId: finalAnchorId!,
    });
    const resumed = await analysis.get.execute({
      scope: contextWorkScope(context.contextId),
    });
    assert.equal(resumed.record?.currentAnchorId.value, finalAnchorId?.value);
    assert.equal(resumed.record?.cursor, 3);
  }
});

test('an inventory-only record is referenced only by an explicit later command', async (t) => {
  const fixture = storeFixture(t);
  const store = fixture.open();
  const analysis = analysisUseCases(store);
  await analysis.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  await analysis.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'scratch-from-application',
    expectedScratchRevision: 1,
    action: {
      kind: 'apply_move',
      move: { kind: 'coordinates', value: 'd2d4' },
    },
  });
  await analysis.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'scratch-from-application',
    expectedScratchRevision: 2,
    action: { kind: 'prepare_note', body: 'Separat im Bestand.' },
  });
  const record = await analysis.create.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'scratch-from-application',
    expectedScratchRevision: 3,
    displayName: 'Damenbauernspiel',
    languageTag: 'de-DE',
  });
  const workspace = workspaceUseCases(store);
  const context = await workspace.create.execute({
    displayName: 'Später zugeordnet',
  });
  await assert.rejects(
    analysis.get.execute({
      scope: contextWorkScope(context.context.contextId),
      preview: {
        itemId: record.itemId,
        revisionId: record.revisionId,
        anchorId: record.rootAnchorId,
      },
    }),
    { problemCode: 'workspace.inventory_work_not_allowed' },
  );
  assert.equal(
    (await workspace.get.execute({ contextId: context.context.contextId }))
      .references.length,
    0,
  );
  await workspace.addReference.execute({
    contextId: context.context.contextId,
    itemId: record.itemId,
    anchorId: record.rootAnchorId,
  });
  const memberPreview = await analysis.get.execute({
    scope: contextWorkScope(context.context.contextId),
    preview: {
      itemId: record.itemId,
      revisionId: record.revisionId,
      anchorId: record.rootAnchorId,
    },
  });
  assert.equal(memberPreview.record?.contextMember, true);
  assert.deepEqual(memberPreview.allowedActions, ['start_scratch']);
  const resume = await workspace.setResume.execute({
    scope: { kind: 'context', contextId: context.context.contextId },
    area: 'analyze',
    expectedResumeVersion: null,
    mode: 'analyze',
    itemId: record.itemId,
    revisionId: record.revisionId,
    anchorId: record.rootAnchorId,
  });
  assert.equal(resume.resume.resumeVersion, 1);
  assert.equal(
    (await workspace.get.execute({ contextId: context.context.contextId }))
      .references.length,
    1,
  );
  const opened = await analysis.get.execute({
    scope: contextWorkScope(context.context.contextId),
  });
  assert.equal(opened.record?.contextMember, true);

  await workspace.setResume.execute({
    scope: { kind: 'context', contextId: context.context.contextId },
    area: 'manage',
    expectedResumeVersion: null,
    presentation: 'list',
    selectedItemId: record.itemId,
    selectedAnchorId: record.rootAnchorId,
  });
  const exploration = await analysis.update.execute({
    scope: contextWorkScope(context.context.contextId),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: record.itemId,
        revisionId: record.revisionId,
        anchorId: record.rootAnchorId,
      },
      firstMove: { kind: 'coordinates', value: 'e2e4' },
    },
  });
  assert.ok(exploration.scratch);
  const contextNote = await analysis.createPositionNote.execute({
    scope: contextWorkScope(context.context.contextId),
    itemId: record.itemId,
    revisionId: record.revisionId,
    anchorId: record.rootAnchorId,
    body: 'Nur in diesem Context.',
    languageTag: 'de-DE',
    noteScope: {
      kind: 'context',
      contextId: context.context.contextId,
    },
  });

  const removal = await store.previewContextItemRemoval({
    contextId: context.context.contextId,
    itemId: record.itemId,
  });
  const removed = await workspace.removeItem.execute({
    contextId: context.context.contextId,
    itemId: record.itemId,
    expectedDataRevision: removal.dataRevision,
    expectedContextVersion: removal.contextVersion,
  });
  assert.equal(removed.contextId.value, context.context.contextId.value);
  assert.equal(removed.itemId.value, record.itemId.value);

  const afterRemoval = await workspace.get.execute({
    contextId: context.context.contextId,
  });
  assert.deepEqual(afterRemoval.references, []);
  assert.equal(afterRemoval.managementResume?.selectedItemId, undefined);
  assert.equal(afterRemoval.managementResume?.selectedAnchorId, undefined);
  assert.equal(afterRemoval.analysisResume?.itemId, undefined);
  assert.equal(afterRemoval.analysisResume?.revisionId, undefined);
  assert.equal(afterRemoval.analysisResume?.anchorId, undefined);
  assert.equal(afterRemoval.analysisResume?.scratchId, undefined);

  await assert.rejects(
    analysis.get.execute({
      scope: contextWorkScope(context.context.contextId),
      preview: {
        itemId: record.itemId,
        revisionId: record.revisionId,
        anchorId: record.rootAnchorId,
      },
    }),
    { problemCode: 'workspace.inventory_work_not_allowed' },
  );

  const inventory = await new SearchInventory(store).execute({
    query: 'Damenbauernspiel',
  });
  assert.equal(inventory.items.length, 1);
  assert.deepEqual(inventory.items[0]?.contextIds, []);

  const inspection = new Database(fixture.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assert.equal(
      (
        inspection
          .prepare(
            'SELECT status FROM workspace_contribution WHERE contribution_id = ?',
          )
          .get(Number(contextNote.contributionId.value)) as { status: string }
      ).status,
      'archived',
    );
    assert.equal(
      (
        inspection
          .prepare(
            'SELECT count(*) AS count FROM analysis_scratch_draft WHERE context_id = ?',
          )
          .get(Number(context.context.contextId.value)) as { count: number }
      ).count,
      0,
    );
  } finally {
    inspection.close();
  }
});

test('an inventory record opened without context remains writable', async (t) => {
  const store = storeFixture(t).open();
  const analysis = analysisUseCases(store);
  await analysis.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  await analysis.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'scratch-from-application',
    expectedScratchRevision: 1,
    action: {
      kind: 'apply_move',
      move: { kind: 'coordinates', value: 'e2e4' },
    },
  });
  await analysis.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'scratch-from-application',
    expectedScratchRevision: 2,
    action: { kind: 'prepare_note', body: 'Freie Analyse.' },
  });
  const record = await analysis.create.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'scratch-from-application',
    expectedScratchRevision: 3,
    displayName: 'Contextfreie Analyse',
    languageTag: 'de-DE',
  });

  const opened = await analysis.get.execute({
    scope: freeWorkScope(),
    preview: {
      itemId: record.itemId,
      revisionId: record.revisionId,
      anchorId: record.rootAnchorId,
    },
  });

  assert.deepEqual(opened.allowedActions, ['start_scratch']);
  const resume = (await store.readWorkScopeWorkspace(freeWorkScope()))
    ?.analysisResume;
  assert.ok(resume);
  assert.equal(opened.resumeVersion, resume.resumeVersion);
  await workspaceUseCases(store).setResume.execute({
    scope: freeWorkScope(),
    area: 'analyze',
    expectedResumeVersion: opened.resumeVersion!,
    itemId: record.itemId,
    revisionId: record.revisionId,
    anchorId: record.rootAnchorId,
    mode: 'analyze',
  });
});

test('a free scratch stays visible while its inventory preview remains focused', async (t) => {
  const store = storeFixture(t).open();
  const analysis = analysisUseCases(store);
  const record = await createFreeRecord(store, 'Contextfreie Herkunft', 'e2e4');
  const opened = await analysis.get.execute({
    scope: freeWorkScope(),
    preview: {
      itemId: record.itemId,
      revisionId: record.revisionId,
      anchorId: record.rootAnchorId,
    },
  });
  const moveAnchorId = opened.record?.steps[0]?.anchorId;
  assert.notEqual(moveAnchorId, undefined);

  await analysis.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: record.itemId,
        revisionId: record.revisionId,
        anchorId: moveAnchorId!,
      },
    },
  });

  const continued = await analysis.get.execute({
    scope: freeWorkScope(),
    preview: {
      itemId: record.itemId,
      revisionId: record.revisionId,
      anchorId: record.rootAnchorId,
    },
  });
  assert.equal(continued.scratch?.origin.kind, 'inventory_anchor');
  assert.equal(continued.record?.currentAnchorId.value, moveAnchorId?.value);
  assert.deepEqual(continued.allowedActions, [
    'apply_move',
    'move_cursor',
    'discard_scratch',
    'create_analysis_record',
  ]);
});

test('discarding an anchored context exploration restores its saved position', async (t) => {
  const store = storeFixture(t).open();
  const base = await createFreeRecord(store, 'Ausgangsanalyse', 'e2e4');
  const workspace = workspaceUseCases(store);
  const context = await workspace.create.execute({ displayName: 'Repertoire' });
  const analysis = analysisUseCases(store);
  const opened = await analysis.get.execute({
    scope: freeWorkScope(),
    preview: {
      itemId: base.itemId,
      revisionId: base.revisionId,
      anchorId: base.rootAnchorId,
    },
  });
  const sourceAnchorId = opened.record?.steps[0]?.anchorId;
  assert.notEqual(sourceAnchorId, undefined);
  await workspace.addReference.execute({
    contextId: context.context.contextId,
    itemId: base.itemId,
    anchorId: sourceAnchorId!,
  });
  const scope = contextWorkScope(context.context.contextId);
  const draft = await analysis.update.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: base.itemId,
        revisionId: base.revisionId,
        anchorId: sourceAnchorId!,
      },
      firstMove: { kind: 'coordinates', value: 'c7c5' },
    },
  });
  assert.equal(
    (await analysis.get.execute({ scope })).scratch?.steps.length,
    1,
  );

  await analysis.update.execute({
    scope,
    expectedScratchId: draft.scratch!.scratchId,
    expectedScratchRevision: draft.scratch!.scratchRevision,
    action: { kind: 'discard' },
  });

  const restored = await analysis.get.execute({ scope });
  assert.equal(restored.scratch, undefined);
  assert.equal(restored.record?.currentAnchorId.value, sourceAnchorId?.value);
});

test('stores a context note at the source anchor without creating another inventory item', async (t) => {
  const store = storeFixture(t).open();
  const base = await createFreeRecord(store, 'Ausgangsanalyse', 'h2h3');
  const workspace = workspaceUseCases(store);
  const context = await workspace.create.execute({
    displayName: 'Repertoire',
  });
  await workspace.addReference.execute({
    contextId: context.context.contextId,
    itemId: base.itemId,
    anchorId: base.rootAnchorId,
  });
  const scope = contextWorkScope(context.context.contextId);
  const analysis = analysisUseCases(store);
  const source = await analysis.get.execute({
    scope,
    preview: {
      itemId: base.itemId,
      revisionId: base.revisionId,
      anchorId: base.rootAnchorId,
    },
  });
  const sourceAnchorId = source.record?.steps[0]?.anchorId;
  assert.notEqual(sourceAnchorId, undefined);

  let current = await analysis.update.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: base.itemId,
        revisionId: base.revisionId,
        anchorId: sourceAnchorId!,
      },
    },
  });
  current = await analysis.update.execute({
    scope,
    expectedScratchId: current.scratch?.scratchId ?? '',
    expectedScratchRevision: current.scratch?.scratchRevision ?? -1,
    action: {
      kind: 'apply_move',
      move: { kind: 'coordinates', value: 'e7e5' },
    },
  });
  current = await analysis.update.execute({
    scope,
    expectedScratchId: current.scratch?.scratchId ?? '',
    expectedScratchRevision: current.scratch?.scratchRevision ?? -1,
    action: { kind: 'prepare_note', body: 'Schwarz besetzt das Zentrum.' },
  });
  current = await analysis.update.execute({
    scope,
    expectedScratchId: current.scratch?.scratchId ?? '',
    expectedScratchRevision: current.scratch?.scratchRevision ?? -1,
    action: { kind: 'clear_note' },
  });
  const restoredPath = await analysis.get.execute({ scope });
  assert.equal(restoredPath.scratch?.cursor, 1);
  assert.equal(restoredPath.scratch?.steps[0]?.move.san, 'e5');
  assert.equal(restoredPath.scratch?.noteDraft, undefined);
  current = await analysis.update.execute({
    scope,
    expectedScratchId: current.scratch?.scratchId ?? '',
    expectedScratchRevision: current.scratch?.scratchRevision ?? -1,
    action: { kind: 'prepare_note', body: 'Schwarz besetzt das Zentrum.' },
  });
  const note = await analysis.createNote.execute({
    scope,
    expectedScratchId: current.scratch?.scratchId ?? '',
    expectedScratchRevision: current.scratch?.scratchRevision ?? -1,
    languageTag: 'de-DE',
    noteScope: { kind: 'context', contextId: context.context.contextId },
  });

  assert.equal(note.itemId.value, base.itemId.value);
  assert.equal(note.anchorId.value, sourceAnchorId?.value);
  assert.equal(note.scopeKind, 'context');
  assert.equal(note.contextId?.value, context.context.contextId.value);
  assert.equal((await new SearchInventory(store).execute({})).items.length, 1);
  const resumed = await analysis.get.execute({ scope });
  assert.equal(resumed.scratch, undefined);
  assert.equal(resumed.record?.currentAnchorId.value, sourceAnchorId?.value);
  const storedNote = resumed.record?.contributions.find(
    (entry) => entry.contributionId.value === note.contributionId.value,
  );
  assert.equal(storedNote?.body, 'Schwarz besetzt das Zentrum.');
  assert.equal(storedNote?.anchorId.value, sourceAnchorId?.value);
  assert.deepEqual(
    storedNote?.moves.map((move) => move.san),
    ['e5'],
  );

  const freeView = await analysis.get.execute({
    scope: freeWorkScope(),
    preview: {
      itemId: base.itemId,
      revisionId: base.revisionId,
      anchorId: sourceAnchorId!,
    },
  });
  assert.equal(
    freeView.record?.contributions.some(
      (entry) => entry.contributionId.value === note.contributionId.value,
    ),
    false,
  );
});

test('creates, updates and archives a note on an exact persisted position', async (t) => {
  const fixture = storeFixture(t);
  const store = fixture.open();
  const saved = await createFreeRecord(store, 'Notizanker', 'e2e4');
  const analysis = analysisUseCases(store);
  const source = await analysis.get.execute({
    scope: freeWorkScope(),
    preview: {
      itemId: saved.itemId,
      revisionId: saved.revisionId,
      anchorId: saved.rootAnchorId,
    },
  });
  const moveAnchor = source.record?.steps[0]?.anchorId;
  assert.ok(moveAnchor);

  const created = await analysis.createPositionNote.execute({
    scope: freeWorkScope(),
    itemId: saved.itemId,
    revisionId: saved.revisionId,
    anchorId: moveAnchor,
    body: '  Der Vorstoss beansprucht das Zentrum.  ',
    languageTag: 'de-DE',
    noteScope: { kind: 'global' },
  });
  assert.equal(created.contributionVersion, 1);

  let workspace = await analysis.get.execute({
    scope: freeWorkScope(),
    preview: {
      itemId: saved.itemId,
      revisionId: saved.revisionId,
      anchorId: moveAnchor,
    },
  });
  const stored = workspace.record?.contributions.find(
    (entry) => entry.contributionId.value === created.contributionId.value,
  );
  assert.equal(stored?.body, 'Der Vorstoss beansprucht das Zentrum.');
  assert.equal(stored?.anchorId.value, moveAnchor.value);
  assert.equal(stored?.contributionVersion, 1);

  const updated = await analysis.updateNote.execute({
    scope: freeWorkScope(),
    contributionId: created.contributionId,
    expectedContributionVersion: 1,
    body: 'Weiss beansprucht Raum im Zentrum.',
  });
  assert.equal(updated.contributionVersion, 2);
  await assert.rejects(
    analysis.updateNote.execute({
      scope: freeWorkScope(),
      contributionId: created.contributionId,
      expectedContributionVersion: 1,
      body: 'Veraltete Aenderung',
    }),
    { problemCode: 'analysis.note_revision_conflict' },
  );

  workspace = await analysis.get.execute({
    scope: freeWorkScope(),
    preview: {
      itemId: saved.itemId,
      revisionId: saved.revisionId,
      anchorId: moveAnchor,
    },
  });
  assert.equal(
    workspace.record?.contributions.find(
      (entry) => entry.contributionId.value === created.contributionId.value,
    )?.body,
    'Weiss beansprucht Raum im Zentrum.',
  );

  const foreignContext = await workspaceUseCases(store).create.execute({
    displayName: 'Fremde Vorschau',
  });
  const foreignScope = contextWorkScope(foreignContext.context.contextId);
  await assert.rejects(
    analysis.createPositionNote.execute({
      scope: foreignScope,
      itemId: saved.itemId,
      revisionId: saved.revisionId,
      anchorId: moveAnchor,
      body: 'Nicht aus einer fremden Vorschau.',
      languageTag: 'de-DE',
      noteScope: { kind: 'global' },
    }),
    { problemCode: 'analysis.invalid_note' },
  );
  await assert.rejects(
    analysis.updateNote.execute({
      scope: foreignScope,
      contributionId: created.contributionId,
      expectedContributionVersion: 2,
      body: 'Nicht aus einer fremden Vorschau.',
    }),
    { problemCode: 'analysis.invalid_note' },
  );
  await assert.rejects(
    analysis.deleteNote.execute({
      scope: foreignScope,
      contributionId: created.contributionId,
      expectedContributionVersion: 2,
    }),
    { problemCode: 'analysis.invalid_note' },
  );
  await workspaceUseCases(store).addReference.execute({
    contextId: foreignContext.context.contextId,
    itemId: saved.itemId,
    anchorId: saved.rootAnchorId,
  });
  const contextUpdated = await analysis.updateNote.execute({
    scope: foreignScope,
    contributionId: created.contributionId,
    expectedContributionVersion: 2,
    body: 'Im zugeordneten Context bearbeitet.',
  });
  assert.equal(contextUpdated.contributionVersion, 3);

  const deleted = await analysis.deleteNote.execute({
    scope: freeWorkScope(),
    contributionId: created.contributionId,
    expectedContributionVersion: 3,
  });
  assert.equal(deleted.contributionVersion, 4);
  workspace = await analysis.get.execute({
    scope: freeWorkScope(),
    preview: {
      itemId: saved.itemId,
      revisionId: saved.revisionId,
      anchorId: moveAnchor,
    },
  });
  assert.equal(
    workspace.record?.contributions.some(
      (entry) => entry.contributionId.value === created.contributionId.value,
    ),
    false,
  );
});

test('an open context scratch cannot be displaced and keeps monotonic identity', async (t) => {
  const store = storeFixture(t).open();
  const workspace = workspaceUseCases(store);
  const target = await workspace.create.execute({ displayName: 'Ziel' });
  const record = await createFreeRecord(store, 'Referenz', 'e2e4');
  await workspace.addReference.execute({
    contextId: target.context.contextId,
    itemId: record.itemId,
    anchorId: record.rootAnchorId,
  });
  let scratchSequence = 0;
  const analysis = analysisUseCases(
    store,
    new FreeAnalysisSession({
      persistence: store,
      clock: { now: () => timestamp },
    }),
    () => `stable-scratch-${++scratchSequence}`,
  );
  const targetScope = contextWorkScope(target.context.contextId);
  const targetScratch = await analysis.update.execute({
    scope: targetScope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  const targetWorkspace = await workspace.get.execute({
    contextId: target.context.contextId,
  });
  await assert.rejects(
    workspace.setResume.execute({
      area: 'analyze',
      scope: { kind: 'context', contextId: target.context.contextId },
      expectedResumeVersion:
        targetWorkspace.analysisResume?.resumeVersion ?? null,
      mode: 'analyze',
      itemId: record.itemId,
      revisionId: record.revisionId,
      anchorId: record.rootAnchorId,
    }),
    { problemCode: 'workspace.invalid_resume' },
  );

  const freeScratch = await analysis.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  const freeMoved = await analysis.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: freeScratch.scratch?.scratchId ?? '',
    expectedScratchRevision: freeScratch.scratch?.scratchRevision ?? -1,
    action: {
      kind: 'apply_move',
      move: { kind: 'coordinates', value: 'd2d4' },
    },
  });
  await assert.rejects(
    analysis.create.execute({
      scope: freeWorkScope(),
      expectedScratchId: freeMoved.scratch?.scratchId ?? '',
      expectedScratchRevision: freeMoved.scratch?.scratchRevision ?? -1,
      displayName: 'Darf Zielentwurf nicht verdraengen',
      languageTag: 'de-DE',
      targetContextId: target.context.contextId,
    }),
    { problemCode: 'analysis.invalid_record' },
  );
  assert.equal(
    (await analysis.get.execute({ scope: targetScope })).scratch?.scratchId,
    targetScratch.scratch?.scratchId,
  );

  const discarded = await analysis.update.execute({
    scope: targetScope,
    expectedScratchId: targetScratch.scratch?.scratchId ?? '',
    expectedScratchRevision: targetScratch.scratch?.scratchRevision ?? -1,
    action: { kind: 'discard' },
  });
  assert.equal(discarded.resumeVersion, 2);
  const replacement = await analysis.update.execute({
    scope: targetScope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  assert.equal(replacement.resumeVersion, 3);
  await assert.rejects(
    analysis.update.execute({
      scope: targetScope,
      expectedScratchId: targetScratch.scratch?.scratchId ?? '',
      expectedScratchRevision: 1,
      action: { kind: 'move_cursor', cursor: 0 },
    }),
    { problemCode: 'analysis.scratch_revision_conflict' },
  );
  assert.notEqual(
    replacement.scratch?.scratchId,
    targetScratch.scratch?.scratchId,
  );
});

test('persists exact source provenance for a separately stored analysis without a note', async (t) => {
  const fixture = storeFixture(t);
  const store = fixture.open();
  const base = await createFreeRecord(store, 'Ausgangsanalyse', 'e2e4');
  const analysis = analysisUseCases(store);
  const source = await analysis.get.execute({
    scope: freeWorkScope(),
    preview: {
      itemId: base.itemId,
      revisionId: base.revisionId,
      anchorId: base.rootAnchorId,
    },
  });
  const sourceAnchorId = source.record?.steps[0]?.anchorId;
  assert.notEqual(sourceAnchorId, undefined);
  let current = await analysis.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: base.itemId,
        revisionId: base.revisionId,
        anchorId: sourceAnchorId!,
      },
    },
  });
  current = await analysis.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: current.scratch?.scratchId ?? '',
    expectedScratchRevision: current.scratch?.scratchRevision ?? -1,
    action: {
      kind: 'apply_move',
      move: { kind: 'coordinates', value: 'c7c5' },
    },
  });
  const child = await analysis.create.execute({
    scope: freeWorkScope(),
    expectedScratchId: current.scratch?.scratchId ?? '',
    expectedScratchRevision: current.scratch?.scratchRevision ?? -1,
    displayName: 'Sizilianische Antwort',
    languageTag: 'de-DE',
  });
  assert.equal(child.contributionId, undefined);

  await store.close();
  const reopened = fixture.open();
  const recovered = await analysisUseCases(reopened).get.execute({
    scope: freeWorkScope(),
    preview: {
      itemId: child.itemId,
      revisionId: child.revisionId,
      anchorId: child.rootAnchorId,
    },
  });
  assert.deepEqual(recovered.record?.origin, {
    kind: 'inventory_anchor',
    itemId: base.itemId,
    revisionId: base.revisionId,
    anchorId: sourceAnchorId,
  });
  assert.equal(
    recovered.record?.sourceLine?.sourceDisplayName,
    'Ausgangsanalyse',
  );
  assert.equal(recovered.record?.sourceLine?.sourceItemType, 'analysis');
  assert.deepEqual(
    recovered.record?.sourceLine?.steps.map((step) => step.move.san),
    ['e4'],
  );
  assert.equal(recovered.record?.sourceLine?.root.position.sideToMove, 'white');
  assert.deepEqual(recovered.record?.contributions, []);
});

test('identifies a played game as the source of a derived analysis', async (t) => {
  const store = storeFixture(t).open();
  const rules = new ChessJsRulesAdapter();
  const scope = freeWorkScope();
  const playout = await store.createPlayout({
    scope,
    origin: { kind: 'initial_position' },
    root: rules.initialState(),
    playerSide: 'white',
    policy: {
      capability: 'best_move',
      providerInstanceId: 'stockfish-test',
      providerFingerprint: 'stockfish-test:reference',
      providerType: 'stockfish-uci',
      providerDisplayName: 'Stockfish',
    },
    occurredAt: timestamp,
  });
  const opening = rules.applyMove(playout.draft.root, [], {
    kind: 'coordinates',
    value: 'e2e4',
  });
  assert.equal(opening.ok, true);
  if (!opening.ok) throw new Error('Expected a legal opening move.');
  const stopped = stopPlayoutDraft(
    appendUserPlayoutMove(playout.draft, opening.value),
  );
  await store.replacePlayout({
    scope,
    expectedDraftRevision: playout.draft.draftRevision,
    draft: stopped,
    occurredAt: timestamp,
  });
  const game = await new CompletePlayout({
    reader: store,
    writer: store,
    clock: { now: () => timestamp },
  }).execute({
    scope,
    draftId: playout.draft.draftId,
    expectedDraftRevision: stopped.draftRevision,
    completionId: 'game-origin-test',
    manualResult: 'unfinished',
    displayName: 'Gespielte Partie',
    languageTag: 'de-DE',
  });
  const analysis = analysisUseCases(store);
  const gameView = await analysis.get.execute({
    scope,
    preview: {
      itemId: game.itemId,
      revisionId: game.revisionId,
      anchorId: game.rootAnchorId,
    },
  });
  assert.equal(gameView.record?.itemType, 'game');
  const gameMoveAnchor = gameView.record?.steps[0]?.anchorId;
  assert.notEqual(gameMoveAnchor, undefined);
  let scratch = await analysis.update.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: game.itemId,
        revisionId: game.revisionId,
        anchorId: gameMoveAnchor!,
      },
    },
  });
  scratch = await analysis.update.execute({
    scope,
    expectedScratchId: scratch.scratch?.scratchId ?? '',
    expectedScratchRevision: scratch.scratch?.scratchRevision ?? -1,
    action: {
      kind: 'apply_move',
      move: { kind: 'coordinates', value: 'c7c5' },
    },
  });
  const child = await analysis.create.execute({
    scope,
    expectedScratchId: scratch.scratch?.scratchId ?? '',
    expectedScratchRevision: scratch.scratch?.scratchRevision ?? -1,
    displayName: 'Fortsetzung',
    languageTag: 'de-DE',
  });
  const recovered = await analysis.get.execute({
    scope,
    preview: {
      itemId: child.itemId,
      revisionId: child.revisionId,
      anchorId: child.rootAnchorId,
    },
  });
  assert.equal(recovered.record?.sourceLine?.sourceItemType, 'game');
  const family = await new SearchInventory(store).execute({
    query: 'Fortsetzung',
    pageSize: 1,
  });
  assert.deepEqual(
    family.items.map((item) => item.itemId),
    [child.itemId],
  );
  assert.deepEqual(
    family.ancestors.map((item) => [item.itemId, item.itemType]),
    [[game.itemId, 'game']],
  );
  assert.deepEqual(family.provenanceEdges, [
    {
      itemId: child.itemId,
      sourceItemId: game.itemId,
      sourceRevisionId: game.revisionId,
      sourceAnchorId: gameMoveAnchor,
    },
  ]);
  assert.equal(
    recovered.record?.sourceLine?.sourceDisplayName,
    'Gespielte Partie',
  );
  assert.deepEqual(
    recovered.record?.sourceLine?.steps.map((step) => step.move.san),
    ['e4'],
  );
});

test('renames a game as a metadata revision without changing played moves', async (t) => {
  const store = storeFixture(t).open();
  const scope = freeWorkScope();
  const rules = new ChessJsRulesAdapter();
  const analysis = analysisUseCases(store);
  const sourceScratch = await analysis.update.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  const source = await analysis.create.execute({
    scope,
    expectedScratchId: sourceScratch.scratch?.scratchId ?? '',
    expectedScratchRevision: sourceScratch.scratch?.scratchRevision ?? -1,
    displayName: 'Ausgangsanalyse',
    languageTag: 'de-DE',
  });
  const playout = await store.createPlayout({
    scope,
    origin: {
      kind: 'inventory_anchor',
      itemId: source.itemId,
      revisionId: source.revisionId,
      anchorId: source.rootAnchorId,
    },
    root: rules.initialState(),
    playerSide: 'white',
    policy: {
      capability: 'best_move',
      providerInstanceId: 'stockfish-test',
      providerFingerprint: 'stockfish-test:reference',
      providerType: 'stockfish-uci',
      providerDisplayName: 'Stockfish',
    },
    occurredAt: timestamp,
  });
  const opening = rules.applyMove(playout.draft.root, [], {
    kind: 'coordinates',
    value: 'e2e4',
  });
  assert.equal(opening.ok, true);
  if (!opening.ok) throw new Error('Expected a legal opening move.');
  const stopped = stopPlayoutDraft(
    appendUserPlayoutMove(playout.draft, opening.value),
  );
  await store.replacePlayout({
    scope,
    expectedDraftRevision: playout.draft.draftRevision,
    draft: stopped,
    occurredAt: timestamp,
  });
  const complete = new CompletePlayout({
    reader: store,
    writer: store,
    clock: { now: () => timestamp },
  });
  const completion = {
    scope,
    draftId: playout.draft.draftId,
    expectedDraftRevision: stopped.draftRevision,
    completionId: 'game-rename-test',
    manualResult: 'unfinished' as const,
    displayName: 'Gespielte Partie',
    languageTag: 'de-DE',
  };
  const beforeConflict = {
    status: await store.readStoreStatus(),
    playout: await store.readPlayout(scope),
    inventory: await store.searchInventory({ pageSize: 10 }),
  };
  await assert.rejects(
    complete.execute({ ...completion, displayName: 'AUSGANGSANALYSE' }),
    { problemCode: 'inventory.display_name_conflict' },
  );
  assert.deepEqual(await store.readStoreStatus(), beforeConflict.status);
  assert.deepEqual(await store.readPlayout(scope), beforeConflict.playout);
  assert.deepEqual(
    await store.searchInventory({ pageSize: 10 }),
    beforeConflict.inventory,
  );
  assert.equal(await store.readPlayoutCompletion(completion), undefined);
  const game = await complete.execute(completion);
  assert.equal(await store.readPlayout(scope), undefined);
  const afterCompletion = await store.readStoreStatus();
  assert.deepEqual(await complete.execute(completion), game);
  assert.deepEqual(await store.readStoreStatus(), afterCompletion);
  const context = await workspaceUseCases(store).create.execute({
    displayName: 'Training',
  });
  await workspaceUseCases(store).addReference.execute({
    contextId: context.context.contextId,
    itemId: game.itemId,
    anchorId: game.rootAnchorId,
  });
  const freeSession = new FreeAnalysisSession({
    persistence: store,
    clock: { now: () => timestamp },
  });
  const clock = { now: () => timestamp };
  const started = await new StartInventoryRevision({
    inventory: store,
    contextReader: store,
    contextWriter: store,
    freeSession,
    rules,
    clock,
    events: noEvents,
    storeStatus: store,
    scratchId: () => 'game-rename-scratch',
  }).execute({
    scope,
    itemId: game.itemId,
    baseRevisionId: game.revisionId,
    anchorId: game.rootAnchorId,
    mode: 'metadata',
    displayName: 'Umbenannte Partie',
    expectedScratchId: null,
    expectedScratchRevision: null,
  });
  const preview = await new PreviewInventoryRevision({
    inventory: store,
    contextReader: store,
    freeSession,
  }).execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
  });
  assert.equal(preview.preservedMoveCount, 1);
  assert.equal(preview.affectedContexts.length, 0);
  const saved = await new SaveInventoryRevision({
    reader: store,
    writer: store,
    freeSession,
    clock,
    inventoryEvents: noEvents,
    impactEvents: noEvents,
    scratchEvents: noEvents,
  }).execute({
    scope,
    expectedScratchId: started.scratch.scratchId,
    expectedScratchRevision: started.scratch.scratchRevision,
    previewFingerprint: preview.previewFingerprint,
  });
  const original = await analysisUseCases(store).get.execute({
    scope,
    preview: {
      itemId: game.itemId,
      revisionId: game.revisionId,
      anchorId: game.rootAnchorId,
    },
  });
  const renamed = await analysisUseCases(store).get.execute({
    scope,
    preview: {
      itemId: game.itemId,
      revisionId: saved.revisionId,
      anchorId: game.rootAnchorId,
    },
  });
  assert.equal(original.record?.displayName, 'Gespielte Partie');
  assert.equal(renamed.record?.displayName, 'Umbenannte Partie');
  assert.equal(renamed.record?.itemType, 'game');
  assert.deepEqual(
    renamed.record?.steps.map((step) => step.move.san),
    ['e4'],
  );
  assert.deepEqual(renamed.record?.game, original.record?.game);
  assert.deepEqual(renamed.record?.origin, original.record?.origin);
  assert.equal(
    renamed.record?.sourceLine?.sourceDisplayName,
    'Ausgangsanalyse',
  );
  const workspace = await workspaceUseCases(store).get.execute({
    contextId: context.context.contextId,
  });
  assert.equal(
    workspace.references[0]?.currentRevisionId.value,
    saved.revisionId.value,
  );
  const inventory = await new SearchInventory(store).execute({
    query: 'Umbenannte',
    pageSize: 10,
  });
  assert.equal(inventory.items[0]?.displayName, 'Umbenannte Partie');
  await assert.rejects(
    new StartInventoryRevision({
      inventory: store,
      contextReader: store,
      contextWriter: store,
      freeSession: new FreeAnalysisSession({
        persistence: store,
        clock: { now: () => timestamp },
      }),
      rules,
      clock,
      events: noEvents,
      storeStatus: store,
      scratchId: () => 'illegal-game-extension',
    }).execute({
      scope,
      itemId: game.itemId,
      baseRevisionId: saved.revisionId,
      anchorId: game.rootAnchorId,
      mode: 'extend',
      expectedScratchId: null,
      expectedScratchRevision: null,
    }),
    { problemCode: 'inventory.invalid_revision' },
  );
});

test('a context scratch resumes after reopening and remains writable', async (t) => {
  const fixture = storeFixture(t);
  const first = fixture.open();
  const context = await workspaceUseCases(first).create.execute({
    displayName: 'Unterbrochene Analyse',
  });
  const scope = contextWorkScope(context.context.contextId);
  const beforeRestart = analysisUseCases(first);
  const started = await beforeRestart.update.execute({
    scope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  await beforeRestart.update.execute({
    scope,
    expectedScratchId: started.scratch?.scratchId ?? '',
    expectedScratchRevision: 1,
    action: {
      kind: 'apply_move',
      move: { kind: 'coordinates', value: 'g1f3' },
    },
  });
  await first.close();

  const reopened = fixture.open();
  const afterRestart = analysisUseCases(reopened);
  const resumed = await afterRestart.get.execute({ scope });
  assert.equal(resumed.scratch?.scratchRevision, 2);
  assert.equal(resumed.scratch?.steps[0]?.move.san, 'Nf3');
  assert.equal(resumed.currentState.position.sideToMove, 'black');
  const continued = await afterRestart.update.execute({
    scope,
    expectedScratchId: resumed.scratch?.scratchId ?? '',
    expectedScratchRevision: 2,
    action: {
      kind: 'apply_move',
      move: { kind: 'coordinates', value: 'g8f6' },
    },
  });
  assert.equal(continued.scratch?.steps[1]?.move.san, 'Nf6');
});

test('context and inventory cursors remain stable for equal timestamps', async (t) => {
  const store = storeFixture(t).open();
  const workspace = workspaceUseCases(store);
  for (const displayName of ['A', 'B', 'C']) {
    await workspace.create.execute({ displayName });
  }
  const firstContexts = await workspace.list.execute({ pageSize: 2 });
  assert.deepEqual(
    firstContexts.contexts.map((context) => context.displayName),
    ['C', 'B'],
  );
  assert.ok(firstContexts.nextCursor);
  const secondContexts = await workspace.list.execute({
    pageSize: 2,
    cursor: firstContexts.nextCursor,
  });
  assert.deepEqual(
    secondContexts.contexts.map((context) => context.displayName),
    ['A'],
  );

  for (const [title, move] of [
    ['Alpha', 'a2a3'],
    ['Beta', 'b2b3'],
    ['Gamma', 'c2c3'],
  ] as const) {
    await createFreeRecord(store, title, move);
  }
  const inventory = new SearchInventory(store);
  const firstItems = await inventory.execute({ pageSize: 2 });
  assert.deepEqual(
    firstItems.items.map((item) => item.displayName),
    ['Gamma', 'Beta'],
  );
  assert.ok(firstItems.nextCursor);
  const secondItems = await inventory.execute({
    pageSize: 2,
    cursor: firstItems.nextCursor,
  });
  assert.deepEqual(
    secondItems.items.map((item) => item.displayName),
    ['Alpha'],
  );
});

test('stale context scratch writes and unrelated anchors change no persisted state', async (t) => {
  const store = storeFixture(t).open();
  const workspace = workspaceUseCases(store);
  const firstContext = await workspace.create.execute({ displayName: 'A' });
  const secondContext = await workspace.create.execute({ displayName: 'B' });
  const analysis = analysisUseCases(store, undefined, () => 'context-scratch');
  const firstScope = contextWorkScope(firstContext.context.contextId);
  const firstScratch = await analysis.update.execute({
    scope: firstScope,
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  assert.notEqual(firstScratch.scratch?.scratchId, undefined);
  const before = await store.readStoreStatus();
  await assert.rejects(
    analysis.update.execute({
      scope: firstScope,
      expectedScratchId: null,
      expectedScratchRevision: null,
      action: { kind: 'start', origin: { kind: 'initial_position' } },
    }),
    { problemCode: 'analysis.scratch_revision_conflict' },
  );
  assert.deepEqual(await store.readStoreStatus(), before);

  const free = analysisUseCases(store);
  await free.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  await free.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'scratch-from-application',
    expectedScratchRevision: 1,
    action: {
      kind: 'apply_move',
      move: { kind: 'coordinates', value: 'c2c4' },
    },
  });
  await free.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'scratch-from-application',
    expectedScratchRevision: 2,
    action: { kind: 'prepare_note', body: 'Englische Eröffnung.' },
  });
  const record = await free.create.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'scratch-from-application',
    expectedScratchRevision: 3,
    displayName: 'Englisch',
    languageTag: 'de-DE',
  });
  const otherRecord = await createFreeRecord(store, 'Anderes Item', 'h2h3');
  await assert.rejects(
    workspace.addReference.execute({
      contextId: secondContext.context.contextId,
      itemId: otherRecord.itemId,
      anchorId: record.rootAnchorId,
    }),
    { problemCode: 'workspace.reference_target_not_found' },
  );
});

async function createFreeRecord(
  store: SqlitePersistenceAdapter,
  displayName: string,
  move: string,
) {
  const analysis = analysisUseCases(store);
  await analysis.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  await analysis.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'scratch-from-application',
    expectedScratchRevision: 1,
    action: {
      kind: 'apply_move',
      move: { kind: 'coordinates', value: move },
    },
  });
  await analysis.update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'scratch-from-application',
    expectedScratchRevision: 2,
    action: { kind: 'prepare_note', body: `${displayName} Notiz` },
  });
  return analysis.create.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'scratch-from-application',
    expectedScratchRevision: 3,
    displayName,
    languageTag: 'de-DE',
  });
}
