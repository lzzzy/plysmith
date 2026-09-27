import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CreateAnalysisRecord,
  FreeAnalysisSession,
  GetAnalysisWorkspace,
  UpdateAnalysisScratch,
  ValidateAnalysisSetup,
  type AnalysisRecordWriter,
  type AnalysisRecordView,
  type AnalysisScratchChanged,
  type ContextAnalysisReader,
  type ContextAnalysisWriter,
  type CreateAnalysisRecordResult,
  type FreeAnalysisPersistence,
} from '../../app/application/analysis/index.ts';
import {
  appendAnalysisMove,
  startAnalysisScratch,
  type AnalysisScratch,
} from '../../app/domain/analysis/index.ts';
import { PromoteAnalysisToInventoryRevision } from '../../app/application/inventory/index.ts';
import type { AnalysisRecordCreated } from '../../app/application/inventory/index.ts';
import type { WorkspaceChanged } from '../../app/application/workspace/index.ts';
import {
  contextWorkScope,
  freeWorkScope,
} from '../../app/domain/workspace/index.ts';
import { localId } from '../../app/domain/identity/index.ts';
import { ChessJsRulesAdapter } from '../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

const timestamp = '2026-09-11T10:00:00.000Z';
const rules = new ChessJsRulesAdapter();
const unavailableContext: ContextAnalysisReader & ContextAnalysisWriter = {
  readContextAnalysisWorkspace: async () => undefined,
  readAnalysisRecord: async () => undefined,
  replaceContextAnalysisScratch: async () => {
    throw new Error('Context persistence is not expected.');
  },
  discardContextAnalysisScratch: async () => {
    throw new Error('Context persistence is not expected.');
  },
};

function freeSessionFixture() {
  let scratch: AnalysisScratch | undefined;
  let resumeVersion = 0;
  const persistence: FreeAnalysisPersistence = {
    readFreeAnalysisWorkspace: async () => ({
      dataRevision: 0,
      ...(scratch === undefined ? {} : { scratch }),
    }),
    replaceFreeAnalysisScratch: async (request) => {
      assert.equal(request.expectedScratchId, scratch?.scratchId ?? null);
      assert.equal(
        request.expectedScratchRevision,
        scratch?.scratchRevision ?? null,
      );
      scratch = request.scratch;
      return { scratch, resumeVersion: ++resumeVersion, dataRevision: 0 };
    },
    discardFreeAnalysisScratch: async (request) => {
      assert.equal(request.expectedScratchId, scratch?.scratchId);
      assert.equal(request.expectedScratchRevision, scratch?.scratchRevision);
      scratch = undefined;
      return { resumeVersion: ++resumeVersion, dataRevision: 0 };
    },
  };
  return {
    freeSession: new FreeAnalysisSession({
      persistence,
      clock: { now: () => timestamp },
    }),
    persistence,
  };
}

test('the free analysis workspace applies localized moves and rejects stale updates', async () => {
  const { freeSession } = freeSessionFixture();
  const events: AnalysisScratchChanged[] = [];
  let scratchSequence = 0;
  const update = new UpdateAnalysisScratch({
    reader: unavailableContext,
    writer: unavailableContext,
    freeSession,
    rules,
    clock: { now: () => timestamp },
    events: { publish: (event) => events.push(event) },
    storeStatus: {
      readStoreStatus: async () => ({ schemaVersion: 4, dataRevision: 7 }),
    },
    scratchId: () => `free-scratch-${++scratchSequence}`,
  });

  const started = await update.execute({
    scope: freeWorkScope(),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  assert.equal(started.scratch?.scratchRevision, 1);
  const moved = await update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'free-scratch-1',
    expectedScratchRevision: 1,
    action: {
      kind: 'apply_move',
      move: { kind: 'notation', value: 'Sf3', locale: 'de-DE' },
    },
  });
  assert.equal(moved.scratch?.steps[0]?.move.san, 'Nf3');
  assert.equal(moved.dataRevision, 7);
  await assert.rejects(
    update.execute({
      scope: freeWorkScope(),
      expectedScratchId: 'free-scratch-1',
      expectedScratchRevision: 1,
      action: { kind: 'move_cursor', cursor: 0 },
    }),
    { problemCode: 'analysis.scratch_revision_conflict' },
  );

  const get = new GetAnalysisWorkspace({
    reader: unavailableContext,
    freeSession,
    rules,
    storeStatus: {
      readStoreStatus: async () => ({ schemaVersion: 4, dataRevision: 7 }),
    },
  });
  const prepared = await update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'free-scratch-1',
    expectedScratchRevision: 2,
    action: { kind: 'prepare_note', body: '' },
  });
  assert.equal(prepared.scratch?.scratchRevision, 3);
  const preparedWorkspace = await get.execute({ scope: freeWorkScope() });
  assert.ok(preparedWorkspace.allowedActions.includes('clear_note'));
  const cleared = await update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'free-scratch-1',
    expectedScratchRevision: 3,
    action: { kind: 'clear_note' },
  });
  assert.equal(cleared.scratch?.scratchRevision, 4);
  assert.equal(cleared.scratch?.cursor, 1);
  assert.equal(cleared.scratch?.noteDraft, undefined);
  const workspace = await get.execute({ scope: freeWorkScope() });
  assert.equal(workspace.currentState.position.sideToMove, 'black');
  assert.equal(workspace.scratch?.cursor, 1);
  assert.ok(workspace.legalMoves.length > 0);
  await update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'free-scratch-1',
    expectedScratchRevision: 4,
    action: { kind: 'discard' },
  });
  await update.execute({
    scope: freeWorkScope(),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  await assert.rejects(
    update.execute({
      scope: freeWorkScope(),
      expectedScratchId: 'free-scratch-1',
      expectedScratchRevision: 1,
      action: { kind: 'move_cursor', cursor: 0 },
    }),
    { problemCode: 'analysis.scratch_revision_conflict' },
  );
  assert.equal((await freeSession.read())?.scratchId, 'free-scratch-2');
  assert.equal(events.length, 6);
});

for (const inContext of [false, true]) {
  test(`root-only exploration offers record creation without path notes (context: ${inContext})`, async () => {
    const { freeSession } = freeSessionFixture();
    const contextId = localId('working-context', 1);
    const scope = inContext ? contextWorkScope(contextId) : freeWorkScope();
    const scratch = startAnalysisScratch('root-only', rules.initialState());
    await freeSession.run(() => ({ scratch, result: undefined }));
    const reader: ContextAnalysisReader = {
      ...unavailableContext,
      readContextAnalysisWorkspace: async () => ({
        contextId,
        contextName: 'Opening library',
        dataRevision: 0,
        scratch,
      }),
    };
    const get = new GetAnalysisWorkspace({
      reader,
      freeSession,
      rules,
      storeStatus: {
        readStoreStatus: async () => ({ schemaVersion: 7, dataRevision: 0 }),
      },
    });

    const workspace = await get.execute({ scope });

    assert.equal(
      workspace.allowedActions.includes('create_analysis_record'),
      true,
    );
    assert.equal(workspace.allowedActions.includes('prepare_note'), false);
    assert.equal(
      workspace.allowedActions.includes('create_analysis_note'),
      false,
    );
    assert.equal(
      workspace.allowedActions.includes('continue_exploration'),
      false,
    );
    assert.deepEqual(workspace.scratch, scratch);
    assert.deepEqual(await freeSession.read(), scratch);
  });
}

test('continue exploration is offered only for valid revisions and rejects invalid or stale updates atomically', async () => {
  const { freeSession } = freeSessionFixture();
  const root = rules.initialState();
  const origin = {
    kind: 'inventory_anchor' as const,
    itemId: localId('inventory-item', 1),
    revisionId: localId('item-revision', 1),
    anchorId: localId('anchor', 1),
  };
  const intent = {
    kind: 'inventory_revision' as const,
    mode: 'extend' as const,
    itemId: origin.itemId,
    baseRevisionId: origin.revisionId,
    cutAnchorId: origin.anchorId,
    returnAnchorId: origin.anchorId,
    displayName: 'Source',
  };
  const empty = startAnalysisScratch('existing-revision', root, origin, intent);
  const applied = rules.applyMove(root, [], {
    kind: 'notation',
    value: 'e4',
    locale: 'en-GB',
  });
  if (!applied.ok) throw new Error('Expected a legal move.');
  const valid = appendAnalysisMove(empty, applied.value);
  const record: AnalysisRecordView = {
    itemType: 'analysis',
    itemId: origin.itemId,
    revisionId: origin.revisionId,
    currentRevisionId: origin.revisionId,
    revisionNumber: 1,
    rootAnchorId: origin.anchorId,
    currentAnchorId: origin.anchorId,
    displayName: 'Source',
    languageTag: 'en-GB',
    origin: { kind: 'initial_position' },
    root,
    steps: [],
    cursor: 0,
    contributions: [],
    contextMember: true,
    historical: false,
  };
  const events: AnalysisScratchChanged[] = [];
  const reader: ContextAnalysisReader = {
    ...unavailableContext,
    readAnalysisRecord: async () => record,
  };
  const storeStatus = {
    readStoreStatus: async () => ({ schemaVersion: 7, dataRevision: 1 }),
  };
  const update = new UpdateAnalysisScratch({
    reader,
    writer: unavailableContext,
    freeSession,
    rules,
    clock: { now: () => timestamp },
    events: { publish: (event) => events.push(event) },
    storeStatus,
    scratchId: () => 'unused',
  });
  const get = new GetAnalysisWorkspace({
    reader,
    freeSession,
    rules,
    storeStatus,
  });
  const invalid: AnalysisScratch[] = [
    empty,
    { ...valid, intent: { kind: 'exploration' } },
    { ...valid, intent: { ...intent, mode: 'metadata' } },
    { ...valid, origin: { kind: 'initial_position' } },
  ];
  for (const scratch of invalid) {
    await freeSession.run(() => ({ scratch, result: undefined }));
    const workspace = await get.execute({ scope: freeWorkScope() });
    if (scratch.intent.kind === 'inventory_revision') {
      assert.equal(
        workspace.allowedActions.includes('create_analysis_record'),
        false,
      );
      assert.equal(workspace.allowedActions.includes('prepare_note'), false);
      assert.equal(
        workspace.allowedActions.includes('create_analysis_note'),
        false,
      );
    }
    assert.equal(
      workspace.allowedActions.includes('continue_exploration'),
      false,
    );
    await assert.rejects(
      update.execute({
        scope: freeWorkScope(),
        expectedScratchId: scratch.scratchId,
        expectedScratchRevision: scratch.scratchRevision,
        action: { kind: 'continue_exploration' },
      }),
      { problemCode: 'analysis.invalid_update' },
    );
    assert.deepEqual(await freeSession.read(), scratch);
  }
  await freeSession.run(() => ({ scratch: valid, result: undefined }));
  assert.equal(
    (await get.execute({ scope: freeWorkScope() })).allowedActions.includes(
      'continue_exploration',
    ),
    true,
  );
  for (const stale of [
    {
      expectedScratchId: 'other',
      expectedScratchRevision: valid.scratchRevision,
    },
    {
      expectedScratchId: valid.scratchId,
      expectedScratchRevision: valid.scratchRevision - 1,
    },
  ]) {
    await assert.rejects(
      update.execute({
        scope: freeWorkScope(),
        ...stale,
        action: { kind: 'continue_exploration' },
      }),
      { problemCode: 'analysis.scratch_revision_conflict' },
    );
    assert.deepEqual(await freeSession.read(), valid);
  }
  assert.equal(events.length, 0);
  const continued = await update.execute({
    scope: freeWorkScope(),
    expectedScratchId: valid.scratchId,
    expectedScratchRevision: valid.scratchRevision,
    action: { kind: 'continue_exploration' },
  });
  assert.deepEqual(continued.scratch, {
    ...valid,
    scratchRevision: valid.scratchRevision + 1,
    intent: { kind: 'exploration' },
  });
  assert.equal(events.length, 1);
  assert.equal(
    (await get.execute({ scope: freeWorkScope() })).allowedActions.includes(
      'continue_exploration',
    ),
    false,
  );

  const contextId = localId('working-context', 1);
  const contextReader: ContextAnalysisReader = {
    ...reader,
    readContextAnalysisWorkspace: async () => ({
      contextId,
      contextName: 'Revoked access',
      dataRevision: 1,
      scratch: valid,
      record: { ...record, contextMember: false },
    }),
  };
  const deniedUpdate = new UpdateAnalysisScratch({
    reader: contextReader,
    writer: unavailableContext,
    freeSession,
    rules,
    clock: { now: () => timestamp },
    events: { publish: (event) => events.push(event) },
    storeStatus,
    scratchId: () => 'unused',
  });
  await assert.rejects(
    deniedUpdate.execute({
      scope: contextWorkScope(contextId),
      expectedScratchId: valid.scratchId,
      expectedScratchRevision: valid.scratchRevision,
      action: { kind: 'continue_exploration' },
    }),
    { problemCode: 'workspace.inventory_work_not_allowed' },
  );
  await assert.rejects(
    new GetAnalysisWorkspace({
      reader: contextReader,
      freeSession,
      rules,
      storeStatus,
    }).execute({ scope: contextWorkScope(contextId) }),
    { problemCode: 'workspace.inventory_work_not_allowed' },
  );
  assert.equal(events.length, 1);
});

test('promotion still rejects games, historical or noncurrent revisions and missing context rights', async () => {
  const { freeSession } = freeSessionFixture();
  const itemId = localId('inventory-item', 1);
  const revisionId = localId('item-revision', 1);
  const anchorId = localId('anchor', 1);
  const base: AnalysisRecordView = {
    itemType: 'analysis',
    itemId,
    revisionId,
    currentRevisionId: revisionId,
    revisionNumber: 1,
    rootAnchorId: anchorId,
    currentAnchorId: anchorId,
    displayName: 'Source',
    languageTag: 'en-GB',
    origin: { kind: 'initial_position' },
    root: rules.initialState(),
    steps: [],
    cursor: 0,
    contributions: [],
    contextMember: true,
    historical: false,
  };
  for (const record of [
    undefined,
    { ...base, itemType: 'game' as const },
    { ...base, historical: true },
    { ...base, currentRevisionId: localId('item-revision', 2) },
    { ...base, contextMember: false },
  ]) {
    const promote = new PromoteAnalysisToInventoryRevision({
      inventory: {
        readAnalysisRevision: async () => record,
        previewInventoryRevision: async () =>
          assert.fail('No preview expected.'),
        listInventoryRevisions: async () =>
          assert.fail('No history read expected.'),
        readPendingRevisionImpact: async () =>
          assert.fail('No impact read expected.'),
      },
      contextReader: unavailableContext,
      contextWriter: unavailableContext,
      freeSession,
      clock: { now: () => timestamp },
      events: {
        publish: () => assert.fail('Rejected promotion must not publish.'),
      },
      storeStatus: {
        readStoreStatus: async () => ({ schemaVersion: 7, dataRevision: 1 }),
      },
    });
    await assert.rejects(
      promote.execute({
        scope: contextWorkScope(localId('working-context', 1)),
        itemId,
        baseRevisionId: revisionId,
        anchorId,
        expectedScratchId: 'exploration',
        expectedScratchRevision: 2,
      }),
      { problemCode: 'inventory.invalid_revision' },
    );
  }
});

test('an exploration starts with its first move atomically and can take it back', async () => {
  const { freeSession } = freeSessionFixture();
  const update = new UpdateAnalysisScratch({
    reader: unavailableContext,
    writer: unavailableContext,
    freeSession,
    rules,
    clock: { now: () => timestamp },
    events: { publish: () => undefined },
    storeStatus: {
      readStoreStatus: async () => ({ schemaVersion: 5, dataRevision: 9 }),
    },
    scratchId: () => 'atomic-exploration',
  });
  const started = await update.execute({
    scope: freeWorkScope(),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: { kind: 'initial_position' },
      firstMove: { kind: 'coordinates', value: 'e2e4' },
    },
  });

  assert.equal(started.scratch?.scratchRevision, 2);
  assert.equal(started.scratch?.steps[0]?.move.san, 'e4');
  const beforeTakeBack = await new GetAnalysisWorkspace({
    reader: unavailableContext,
    freeSession,
    rules,
    storeStatus: {
      readStoreStatus: async () => ({ schemaVersion: 5, dataRevision: 9 }),
    },
  }).execute({ scope: freeWorkScope() });
  assert.ok(beforeTakeBack.allowedActions.includes('remove_last_move'));

  const shortened = await update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'atomic-exploration',
    expectedScratchRevision: 2,
    action: { kind: 'remove_last_move' },
  });

  assert.equal(shortened.scratch?.scratchRevision, 3);
  assert.equal(shortened.scratch?.steps.length, 0);
  assert.equal(shortened.scratch?.cursor, 0);
  const afterTakeBack = await new GetAnalysisWorkspace({
    reader: unavailableContext,
    freeSession,
    rules,
    storeStatus: {
      readStoreStatus: async () => ({ schemaVersion: 5, dataRevision: 9 }),
    },
  }).execute({ scope: freeWorkScope() });
  assert.equal(
    afterTakeBack.allowedActions.includes('remove_last_move'),
    false,
  );
});

test('a structured position is validated before it becomes an analysis root', async () => {
  const { freeSession } = freeSessionFixture();
  const validate = new ValidateAnalysisSetup({ rules });
  const update = new UpdateAnalysisScratch({
    reader: unavailableContext,
    writer: unavailableContext,
    freeSession,
    rules,
    clock: { now: () => timestamp },
    events: { publish: () => undefined },
    storeStatus: {
      readStoreStatus: async () => ({ schemaVersion: 5, dataRevision: 9 }),
    },
    scratchId: () => 'position-setup',
  });
  const setup = {
    pieces: [
      { square: 'e1', color: 'white' as const, role: 'king' as const },
      { square: 'd4', color: 'white' as const, role: 'queen' as const },
      { square: 'e8', color: 'black' as const, role: 'king' as const },
    ],
    sideToMove: 'black' as const,
    castlingRights: {
      whiteKingSide: false,
      whiteQueenSide: false,
      blackKingSide: false,
      blackQueenSide: false,
    },
    halfmoveClock: 0,
    fullmoveNumber: 12,
  };

  const validation = await validate.execute({
    input: { kind: 'position_setup', setup },
  });
  assert.equal(validation.valid, true);
  const started = await update.execute({
    scope: freeWorkScope(),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'position_setup', setup } },
  });
  assert.equal(started.scratch?.origin.kind, 'position_setup');
  assert.equal(started.scratch?.root.position.sideToMove, 'black');
  assert.equal(started.scratch?.root.playState.fullmoveNumber, 12);
  assert.match(started.scratch?.root.fen ?? '', /^4k3\/8\/8\/8\/3Q4/);

  const invalidSetup = {
    ...setup,
    pieces: [{ square: 'e1', color: 'white' as const, role: 'king' as const }],
  };
  const invalid = await validate.execute({
    input: { kind: 'position_setup', setup: invalidSetup },
  });
  assert.equal(invalid.valid, false);
  assert.deepEqual(
    invalid.valid ? [] : invalid.issues.map((issue) => issue.code),
    ['black_king_required'],
  );
});

test('invalid FEN validation returns a stable issue without starting a scratch', async () => {
  const { freeSession } = freeSessionFixture();
  const validation = await new ValidateAnalysisSetup({ rules }).execute({
    input: { kind: 'fen', fen: 'not-a-position' },
  });

  assert.deepEqual(validation, {
    valid: false,
    issues: [{ code: 'invalid_fen', field: 'fen' }],
  });
  assert.equal(await freeSession.read(), undefined);
});

test('saving consumes free scratch only after a successful record commit', async () => {
  const { freeSession, persistence } = freeSessionFixture();
  const update = new UpdateAnalysisScratch({
    reader: unavailableContext,
    writer: unavailableContext,
    freeSession,
    rules,
    clock: { now: () => timestamp },
    events: { publish: () => undefined },
    storeStatus: {
      readStoreStatus: async () => ({ schemaVersion: 4, dataRevision: 0 }),
    },
    scratchId: () => 'free-scratch',
  });
  await update.execute({
    scope: freeWorkScope(),
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'initial_position' } },
  });
  await update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'free-scratch',
    expectedScratchRevision: 1,
    action: {
      kind: 'apply_move',
      move: { kind: 'coordinates', value: 'e2e4' },
    },
  });
  const noted = await update.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'free-scratch',
    expectedScratchRevision: 2,
    action: { kind: 'prepare_note', body: 'Praktischer Ausgangspunkt.' },
  });
  assert.equal(noted.scratch?.scratchRevision, 3);

  let fail = true;
  const stored: Parameters<AnalysisRecordWriter['createAnalysisRecord']>[0][] =
    [];
  const writer: AnalysisRecordWriter = {
    async createAnalysisRecord(request) {
      stored.push(request);
      if (fail) throw new Error('Simulated commit failure.');
      await persistence.discardFreeAnalysisScratch({
        expectedScratchId: request.expectedScratchId!,
        expectedScratchRevision: request.expectedScratchRevision!,
        occurredAt: timestamp,
      });
      return persistedRecord();
    },
  };
  const inventoryEvents: AnalysisRecordCreated[] = [];
  const workspaceEvents: WorkspaceChanged[] = [];
  const create = new CreateAnalysisRecord({
    reader: unavailableContext,
    writer,
    freeSession,
    clock: { now: () => timestamp },
    inventoryEvents: { publish: (event) => inventoryEvents.push(event) },
    workspaceEvents: { publish: (event) => workspaceEvents.push(event) },
  });

  await assert.rejects(
    create.execute({
      scope: freeWorkScope(),
      expectedScratchId: 'free-scratch',
      expectedScratchRevision: 3,
      displayName: '1.e4 untersuchen',
      languageTag: 'de-DE',
    }),
  );
  assert.equal((await freeSession.read())?.scratchRevision, 3);
  fail = false;
  const result = await create.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'free-scratch',
    expectedScratchRevision: 3,
    displayName: '1.e4 untersuchen',
    languageTag: 'de-DE',
  });
  assert.deepEqual(result, persistedRecord());
  assert.equal(await freeSession.read(), undefined);
  assert.equal(stored[1]?.steps.length, 1);
  assert.deepEqual(stored[1]?.note?.moves, []);
  assert.equal(inventoryEvents.length, 1);
  assert.equal(workspaceEvents.length, 0);
});

function persistedRecord(): CreateAnalysisRecordResult {
  return Object.freeze({
    itemId: localId('inventory-item', 1),
    revisionId: localId('item-revision', 1),
    rootAnchorId: localId('anchor', 1),
    contributionId: localId('contribution', 1),
    resumeUpdates: Object.freeze([]),
    dataRevision: 1,
  });
}
