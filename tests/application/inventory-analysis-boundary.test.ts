import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CreateAnalysisRecord,
  FreeAnalysisSession,
  type AnalysisRecordView,
  type AnalysisRecordWriter,
  type AnalysisScratchChanged,
  type ContextAnalysisReader,
  type ContextAnalysisWriter,
  type FreeAnalysisPersistence,
} from '../../app/application/analysis/index.ts';
import { PromoteAnalysisToInventoryRevision } from '../../app/application/inventory/index.ts';
import {
  appendAnalysisMove,
  moveAnalysisCursor,
  prepareAnalysisNote,
  startAnalysisScratch,
  type AnalysisScratch,
} from '../../app/domain/analysis/index.ts';
import { localId } from '../../app/domain/identity/index.ts';
import { planInventoryRevision } from '../../app/domain/inventory/index.ts';
import {
  contextWorkScope,
  freeWorkScope,
} from '../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

const rules = new ChessJsRulesAdapter();
const occurredAt = '2026-10-08T12:00:00.000Z';
const contextId = localId('working-context', 1);

for (const contextual of [false, true]) {
  for (const scenario of [
    'root_only',
    'rewound_root',
    'prefix',
    'tail',
  ] as const) {
    test(`record creation projects ${scenario} without changing its scratch (context: ${contextual})`, async () => {
      const record = openingRecord();
      const origin =
        scenario === 'prefix'
          ? {
              kind: 'inventory_anchor' as const,
              itemId: record.itemId,
              revisionId: record.revisionId,
              anchorId: record.rootAnchorId,
            }
          : {
              kind:
                scenario === 'rewound_root'
                  ? ('fen' as const)
                  : scenario === 'tail'
                    ? ('position_setup' as const)
                    : ('initial_position' as const),
            };
      let scratch = startAnalysisScratch('record-source', record.root, origin);
      if (scenario !== 'root_only') scratch = moves(scratch, ['e4', 'e5']);
      const cursor = scenario === 'tail' ? 2 : scenario === 'prefix' ? 1 : 0;
      scratch = moveAnalysisCursor(scratch, cursor);
      if (cursor > 0) scratch = prepareAnalysisNote(scratch, 'Selected path');
      const before = structuredClone(scratch);
      const fixture = workspace(scratch, contextual, record);
      const stored: Parameters<
        AnalysisRecordWriter['createAnalysisRecord']
      >[0][] = [];
      const create = new CreateAnalysisRecord({
        reader: fixture.context,
        writer: {
          createAnalysisRecord: async (request) => {
            stored.push(request);
            return {
              itemId: localId('inventory-item', 2),
              revisionId: localId('item-revision', 2),
              rootAnchorId: localId('anchor', 20),
              dataRevision: 8,
              resumeUpdates: [],
            };
          },
        },
        freeSession: fixture.freeSession,
        clock: { now: () => occurredAt },
        inventoryEvents: { publish: () => undefined },
        workspaceEvents: { publish: () => undefined },
      });
      await create.execute({
        scope: fixture.scope,
        expectedScratchId: scratch.scratchId,
        expectedScratchRevision: scratch.scratchRevision,
        displayName: 'Own analysis',
        languageTag: 'en-GB',
        ...(contextual ? { targetContextId: contextId } : {}),
      });
      assert.equal(stored.length, 1);
      assert.deepEqual(stored[0]!.steps, scratch.steps.slice(0, cursor));
      assert.deepEqual(stored[0]!.origin, origin);
      assert.deepEqual(stored[0]!.root, scratch.root);
      assert.equal(
        stored[0]!.sourceContextId?.value,
        contextual ? contextId.value : undefined,
      );
      assert.equal(stored[0]!.expectedScratchId, scratch.scratchId);
      assert.equal(stored[0]!.expectedScratchRevision, scratch.scratchRevision);
      assert.deepEqual(
        stored[0]!.note,
        cursor > 0 ? { body: 'Selected path', moves: [] } : undefined,
      );
      assert.deepEqual(
        stored[0]!.noteScope,
        cursor === 0
          ? undefined
          : contextual
            ? { kind: 'context', contextId }
            : { kind: 'global' },
      );
      assert.deepEqual(scratch, before);
      assert.equal(fixture.writes(), 0);
    });
  }

  for (const mode of [
    'truncate_after',
    'extend',
    'add_variation',
    'root_only',
  ] as const) {
    test(`application promotes ${mode} atomically and clears its note draft (context: ${contextual})`, async () => {
      const record = openingRecord(mode === 'root_only');
      const anchorId =
        mode === 'extend' || mode === 'root_only'
          ? (record.steps.at(-1)?.anchorId ?? record.rootAnchorId)
          : record.steps[1]!.anchorId;
      const plan = planInventoryRevision({
        line: record,
        mode: mode === 'root_only' ? 'extend' : mode,
        anchorId,
      });
      const scratch = prepareAnalysisNote(
        moves(
          startAnalysisScratch('promoted', plan.scratchRoot, {
            kind: 'inventory_anchor',
            itemId: record.itemId,
            revisionId: record.revisionId,
            anchorId,
          }),
          [mode === 'root_only' ? 'e4' : 'Bc4'],
        ),
        'Not transferred to revision',
      );
      const before = structuredClone(scratch);
      const fixture = workspace(scratch, contextual, record);
      const events: AnalysisScratchChanged[] = [];
      const result = await promotion(fixture, record, events).execute({
        scope: fixture.scope,
        itemId: record.itemId,
        baseRevisionId: record.revisionId,
        anchorId,
        ...(mode === 'add_variation' ? { mode } : {}),
        expectedScratchId: scratch.scratchId,
        expectedScratchRevision: scratch.scratchRevision,
      });
      const { noteDraft, ...withoutNote } = scratch;
      assert.equal(noteDraft?.body, 'Not transferred to revision');
      assert.deepEqual(result.scratch, {
        ...withoutNote,
        scratchRevision: scratch.scratchRevision + 1,
        intent: plan.intent,
      });
      assert.deepEqual(scratch, before);
      assert.equal(fixture.read(), result.scratch);
      assert.equal(fixture.writes(), 1);
      assert.equal(result.dataRevision, 7);
      assert.equal(result.resumeVersion, contextual ? 4 : undefined);
      assert.equal(events.length, 1);
      assert.equal(events[0]!.scratchRevision, scratch.scratchRevision + 1);
    });
  }

  test(`promotion rejects invalid origins, roots, cursors and stale CAS without writes (context: ${contextual})`, async () => {
    const record = openingRecord();
    const anchorId = record.steps.at(-1)!.anchorId;
    const plan = planInventoryRevision({
      line: record,
      mode: 'extend',
      anchorId,
    });
    const origin = {
      kind: 'inventory_anchor' as const,
      itemId: record.itemId,
      revisionId: record.revisionId,
      anchorId,
    };
    const empty = startAnalysisScratch('guarded', plan.scratchRoot, origin);
    const scratch = moves(empty, ['Bc4']);
    const invalid: readonly AnalysisScratch[] = [
      empty,
      moveAnalysisCursor(scratch, 0),
      { ...scratch, intent: plan.intent },
      { ...scratch, origin: { kind: 'initial_position' } },
      {
        ...scratch,
        origin: { ...origin, itemId: localId('inventory-item', 99) },
      },
      {
        ...scratch,
        origin: { ...origin, revisionId: localId('item-revision', 99) },
      },
      { ...scratch, origin: { ...origin, anchorId: record.rootAnchorId } },
      { ...scratch, root: { ...scratch.root, fen: record.root.fen } },
      { ...scratch, root: { ...scratch.root, position: record.root.position } },
    ];
    for (const current of invalid) {
      const fixture = workspace(current, contextual, record);
      const events: AnalysisScratchChanged[] = [];
      await assert.rejects(
        promotion(fixture, record, events).execute({
          scope: fixture.scope,
          itemId: record.itemId,
          baseRevisionId: record.revisionId,
          anchorId,
          expectedScratchId: current.scratchId,
          expectedScratchRevision: current.scratchRevision,
        }),
        { problemCode: 'inventory.invalid_revision' },
      );
      assert.equal(fixture.read(), current);
      assert.equal(fixture.writes(), 0);
      assert.deepEqual(events, []);
    }
    for (const stale of ['id', 'revision', 'commit'] as const) {
      const fixture = workspace(scratch, contextual, record);
      if (stale === 'commit') fixture.rejectWrites();
      const events: AnalysisScratchChanged[] = [];
      await assert.rejects(
        promotion(fixture, record, events).execute({
          scope: fixture.scope,
          itemId: record.itemId,
          baseRevisionId: record.revisionId,
          anchorId,
          expectedScratchId: stale === 'id' ? 'stale' : scratch.scratchId,
          expectedScratchRevision:
            scratch.scratchRevision - (stale === 'revision' ? 1 : 0),
        }),
        stale === 'commit'
          ? /Rejected commit/
          : { problemCode: 'analysis.scratch_revision_conflict' },
      );
      assert.equal(fixture.read(), scratch);
      assert.equal(fixture.writes(), 0);
      assert.deepEqual(events, []);
    }
  });

  test(`record creation rejects a revision scratch and stale CAS before persistence (context: ${contextual})`, async () => {
    const record = openingRecord();
    const plan = planInventoryRevision({
      line: record,
      mode: 'metadata',
      anchorId: record.rootAnchorId,
    });
    const scratch = startAnalysisScratch(
      'revision',
      plan.scratchRoot,
      { kind: 'initial_position' },
      plan.intent,
    );
    const fixture = workspace(scratch, contextual, record);
    const create = new CreateAnalysisRecord({
      reader: fixture.context,
      writer: {
        createAnalysisRecord: async () =>
          assert.fail('No record write expected.'),
      },
      freeSession: fixture.freeSession,
      clock: { now: () => occurredAt },
      inventoryEvents: { publish: () => assert.fail('No event expected.') },
      workspaceEvents: { publish: () => assert.fail('No event expected.') },
    });
    for (const stale of [false, true]) {
      await assert.rejects(
        create.execute({
          scope: fixture.scope,
          expectedScratchId: stale ? 'stale' : scratch.scratchId,
          expectedScratchRevision: scratch.scratchRevision,
          displayName: 'Rejected',
          languageTag: 'en-GB',
        }),
        {
          problemCode: stale
            ? 'analysis.scratch_revision_conflict'
            : 'analysis.invalid_record',
        },
      );
      assert.equal(fixture.read(), scratch);
      assert.equal(fixture.writes(), 0);
    }
  });
}

function moves(
  scratch: AnalysisScratch,
  notations: readonly string[],
): AnalysisScratch {
  for (const value of notations) {
    const applied = rules.applyMove(
      scratch.root,
      scratch.steps.map((step) => step.move),
      { kind: 'notation', value, locale: 'en-GB' },
    );
    if (!applied.ok) throw new Error('Expected a legal test move.');
    scratch = appendAnalysisMove(scratch, applied.value);
  }
  return scratch;
}

function openingRecord(rootOnly = false): AnalysisRecordView {
  const scratch = moves(
    startAnalysisScratch('base', rules.initialState()),
    rootOnly ? [] : ['e4', 'e5', 'Nf3', 'Nc6'],
  );
  const steps = scratch.steps.map((step, index) => ({
    ...step,
    anchorId: localId('anchor', index + 2),
  }));
  const revisionId = localId('item-revision', 1);
  return {
    itemType: 'analysis',
    itemId: localId('inventory-item', 1),
    revisionId,
    currentRevisionId: revisionId,
    revisionNumber: 1,
    rootAnchorId: localId('anchor', 1),
    currentAnchorId: steps.at(-1)?.anchorId ?? localId('anchor', 1),
    displayName: 'Source',
    languageTag: 'en-GB',
    origin: { kind: 'initial_position' },
    root: scratch.root,
    steps,
    cursor: steps.length,
    contributions: [],
    contextMember: true,
    historical: false,
  };
}

function workspace(
  initial: AnalysisScratch,
  contextual: boolean,
  record: AnalysisRecordView,
) {
  let scratch = initial;
  let writeCount = 0;
  let reject = false;
  const replace: FreeAnalysisPersistence['replaceFreeAnalysisScratch'] = async (
    request,
  ) => {
    assert.equal(request.expectedScratchId, scratch.scratchId);
    assert.equal(request.expectedScratchRevision, scratch.scratchRevision);
    if (reject) throw new Error('Rejected commit');
    scratch = request.scratch;
    writeCount += 1;
    return { scratch, dataRevision: 7, resumeVersion: 4 };
  };
  const context: ContextAnalysisReader & ContextAnalysisWriter = {
    readContextAnalysisWorkspace: async () => ({
      contextId,
      contextName: 'Work',
      dataRevision: 7,
      scratch,
      record,
    }),
    readAnalysisRecord: async () => record,
    replaceContextAnalysisScratch: replace,
    discardContextAnalysisScratch: async () =>
      assert.fail('No discard expected.'),
  };
  const freeSession = new FreeAnalysisSession({
    persistence: {
      readFreeAnalysisWorkspace: async () => ({ dataRevision: 7, scratch }),
      replaceFreeAnalysisScratch: replace,
      discardFreeAnalysisScratch: async () =>
        assert.fail('No discard expected.'),
    },
    clock: { now: () => occurredAt },
  });
  return {
    context,
    freeSession,
    scope: contextual ? contextWorkScope(contextId) : freeWorkScope(),
    read: () => scratch,
    writes: () => writeCount,
    rejectWrites: () => {
      reject = true;
    },
  };
}

function promotion(
  fixture: ReturnType<typeof workspace>,
  record: AnalysisRecordView,
  events: AnalysisScratchChanged[],
) {
  return new PromoteAnalysisToInventoryRevision({
    inventory: {
      readAnalysisRevision: async () => record,
      previewInventoryRevision: async () => assert.fail('No preview expected.'),
      listInventoryRevisions: async () =>
        assert.fail('No history read expected.'),
      readPendingRevisionImpact: async () =>
        assert.fail('No impact read expected.'),
    },
    contextReader: fixture.context,
    contextWriter: fixture.context,
    freeSession: fixture.freeSession,
    clock: { now: () => occurredAt },
    events: { publish: (event) => events.push(event) },
    storeStatus: {
      readStoreStatus: async () => ({ schemaVersion: 10, dataRevision: 7 }),
    },
  });
}
