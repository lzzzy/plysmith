import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { FreeAnalysisSession } from '../../../app/application/analysis/index.ts';
import {
  GetInventoryRevision,
  PreviewInventoryRevision,
  SaveInventoryRevision,
  StartInventoryRevision,
} from '../../../app/application/inventory/index.ts';
import { CompletePlayout } from '../../../app/application/playout/index.ts';
import { stopPlayoutDraft } from '../../../app/domain/playout/index.ts';
import { freeWorkScope } from '../../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';
import {
  buildFixture,
  headers,
  occurredAt,
} from '../../contract/api/fixtures.ts';

test('manual draw provenance survives API completion and a metadata revision', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'plysmith-outcome-channel-'));
  const persistence = new SqlitePersistenceAdapter({
    databasePath: join(directory, 'store.sqlite'),
    now: () => occurredAt,
  });
  t.after(async () => {
    await persistence.close();
    await rm(directory, { recursive: true, force: true });
  });
  const clock = { now: () => occurredAt };
  const rules = new ChessJsRulesAdapter();
  const freeSession = new FreeAnalysisSession({ persistence, clock });
  const events = { publish: () => undefined };
  const { host } = await buildFixture(t, {
    completePlayout: new CompletePlayout({
      reader: persistence,
      writer: persistence,
      clock,
    }),
    getInventoryRevision: new GetInventoryRevision(persistence),
    startInventoryRevision: new StartInventoryRevision({
      inventory: persistence,
      contextReader: persistence,
      contextWriter: persistence,
      freeSession,
      rules,
      clock,
      events,
      storeStatus: persistence,
      scratchId: () => 'outcome-metadata-scratch',
    }),
    previewInventoryRevision: new PreviewInventoryRevision({
      inventory: persistence,
      contextReader: persistence,
      freeSession,
    }),
    saveInventoryRevision: new SaveInventoryRevision({
      reader: persistence,
      writer: persistence,
      freeSession,
      clock,
      inventoryEvents: events,
      impactEvents: events,
      scratchEvents: events,
    }),
  });
  const scope = freeWorkScope();
  const created = await persistence.createPlayout({
    scope,
    origin: { kind: 'initial_position' },
    root: rules.initialState(),
    playerSide: 'white',
    policy: {
      capability: 'best_move',
      providerInstanceId: 'stockfish-main',
      providerFingerprint: 'stockfish-main:reference',
      providerType: 'stockfish-uci',
      providerDisplayName: 'Stockfish',
    },
    occurredAt,
  });
  const stopped = stopPlayoutDraft(created.draft);
  await persistence.replacePlayout({
    scope,
    expectedDraftRevision: created.draft.draftRevision,
    draft: stopped,
    occurredAt,
  });
  const completion = {
    scope: { kind: 'free' },
    draftId: String(stopped.draftId.value),
    expectedDraftRevision: stopped.draftRevision,
    completionId: 'outcome-channel-completion',
    displayName: 'Manual draw',
    languageTag: 'en-GB',
    manualResult: 'draw',
  };
  const completed = await host.inject({
    method: 'POST',
    url: '/playout/complete',
    headers,
    payload: completion,
  });
  assert.equal(completed.statusCode, 200, completed.body);
  const saved = completed.json();
  assert.deepEqual(saved.outcome, { kind: 'draw' });
  assert.equal(saved.outcomeSource, 'manual');
  const replay = await host.inject({
    method: 'POST',
    url: '/playout/complete',
    headers,
    payload: completion,
  });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), saved);
  const original = await host.inject({
    url: `/inventory/items/${saved.itemId}/revisions/${saved.revisionId}?scopeKind=free`,
    headers,
  });
  assert.equal(original.statusCode, 200, original.body);
  assert.deepEqual(original.json().game.outcome, { kind: 'draw' });
  assert.equal(original.json().game.outcomeSource, 'manual');

  const started = await host.inject({
    method: 'POST',
    url: `/inventory/items/${saved.itemId}/revision-edits`,
    headers,
    payload: {
      scope: { kind: 'free' },
      baseRevisionId: saved.revisionId,
      anchorId: saved.rootAnchorId,
      mode: 'metadata',
      displayName: 'Renamed manual draw',
      expectedScratchId: null,
      expectedScratchRevision: null,
    },
  });
  assert.equal(started.statusCode, 200, started.body);
  const scratch = started.json().scratch;
  const confirmation = {
    scope: { kind: 'free' },
    expectedScratchId: scratch.scratchId,
    expectedScratchRevision: scratch.scratchRevision,
  };
  const preview = await host.inject({
    method: 'POST',
    url: '/inventory/revision-edits/preview',
    headers,
    payload: confirmation,
  });
  assert.equal(preview.statusCode, 200, preview.body);
  const revised = await host.inject({
    method: 'POST',
    url: '/inventory/revision-edits/save',
    headers,
    payload: {
      ...confirmation,
      previewFingerprint: preview.json().previewFingerprint,
    },
  });
  assert.equal(revised.statusCode, 200, revised.body);
  const latest = await host.inject({
    url: `/inventory/items/${saved.itemId}/revisions/${revised.json().revisionId}?scopeKind=free`,
    headers,
  });
  assert.equal(latest.statusCode, 200, latest.body);
  assert.equal(latest.json().displayName, 'Renamed manual draw');
  assert.deepEqual(latest.json().game, original.json().game);
});
