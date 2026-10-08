import assert from 'node:assert/strict';
import test from 'node:test';

import * as analysis from '../../app/application/analysis/public.ts';
import { PositionAnalysisProviderError } from '../../app/application/analysis/index.ts';
import * as inventory from '../../app/application/inventory/public.ts';
import { inventoryItemNotFound } from '../../app/application/inventory/index.ts';
import * as live from '../../app/application/live/index.ts';
import { FairPlayGate } from '../../app/application/live/fair-play-gate.ts';
import {
  assertInventoryWorkAccess,
  requireInventoryWorkAccess,
} from '../../app/application/workspace/index.ts';
import * as workAccess from '../../app/application/workspace/inventory-work-access.ts';

test('analysis public contracts do not export use-case orchestration or a session constructor', () => {
  assert.deepEqual(Object.keys(analysis).sort(), [
    'PositionAnalysisProviderError',
    'analysisScratchNotFound',
    'analysisScratchRevisionConflict',
    'chessRulesProblem',
    'validatePositionNoteInput',
  ]);
  assert.equal(
    analysis.PositionAnalysisProviderError,
    PositionAnalysisProviderError,
  );
  assert.ok(
    new analysis.PositionAnalysisProviderError('provider_timeout') instanceof
      PositionAnalysisProviderError,
  );
  assert.equal(
    analysis.analysisScratchRevisionConflict(1, 2).problemCode,
    'analysis.scratch_revision_conflict',
  );
});

test('inventory public contracts expose the existing problem identity without revision use cases', () => {
  assert.deepEqual(Object.keys(inventory), ['inventoryItemNotFound']);
  assert.equal(inventory.inventoryItemNotFound, inventoryItemNotFound);
});

test('live public API stays limited to the existing fair-play gate', () => {
  assert.deepEqual(Object.keys(live), ['FairPlayGate']);
  assert.equal(live.FairPlayGate, FairPlayGate);
  const gate = new live.FairPlayGate();
  gate.setBlocked(true);
  assert.throws(() => gate.assertAllowed(), {
    problemCode: 'live.fair_play_blocked',
  });
});

test('workspace public access functions preserve their existing implementations', () => {
  assert.equal(assertInventoryWorkAccess, workAccess.assertInventoryWorkAccess);
  assert.equal(
    requireInventoryWorkAccess,
    workAccess.requireInventoryWorkAccess,
  );
});
