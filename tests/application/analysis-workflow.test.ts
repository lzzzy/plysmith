import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CreateAnalysisRecord,
  FreeAnalysisSession,
  GetAnalysisWorkspace,
  UpdateAnalysisScratch,
  type AnalysisRecordWriter,
  type AnalysisScratchChanged,
  type ContextAnalysisReader,
  type ContextAnalysisWriter,
  type CreateAnalysisRecordResult,
} from '../../app/application/analysis/index.ts';
import type { AnalysisRecordCreated } from '../../app/application/inventory/index.ts';
import type { WorkspaceChanged } from '../../app/application/workspace/index.ts';
import { freeWorkScope } from '../../app/domain/workspace/index.ts';
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

test('the free analysis workspace applies localized moves and rejects stale updates', async () => {
  const freeSession = new FreeAnalysisSession();
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
  assert.equal(freeSession.read()?.scratchId, 'free-scratch-2');
  assert.equal(events.length, 6);
});

test('saving consumes free scratch only after a successful record commit', async () => {
  const freeSession = new FreeAnalysisSession();
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
  assert.equal(freeSession.read()?.scratchRevision, 3);
  fail = false;
  const result = await create.execute({
    scope: freeWorkScope(),
    expectedScratchId: 'free-scratch',
    expectedScratchRevision: 3,
    displayName: '1.e4 untersuchen',
    languageTag: 'de-DE',
  });
  assert.deepEqual(result, persistedRecord());
  assert.equal(freeSession.read(), undefined);
  assert.equal(stored[1]?.steps.length, 1);
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
