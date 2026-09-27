import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  ActiveMovePolicyDecisions,
  MovePolicyProviderError,
  StartPlayout,
  type MovePolicyProvider,
} from '../../../app/application/playout/index.ts';
import {
  CreateWorkingContext,
  DeleteWorkingContext,
  PreviewWorkingContextDeletion,
  type WorkspaceChanged,
} from '../../../app/application/workspace/index.ts';
import {
  contextWorkScope,
  freeWorkScope,
} from '../../../app/domain/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';
import {
  buildFixture,
  headers,
  occurredAt,
} from '../../contract/api/fixtures.ts';

test('context deletion aborts and drains an active policy only after a successful commit', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'plysmith-context-policy-'));
  const persistence = new SqlitePersistenceAdapter({
    databasePath: join(directory, 'store.sqlite'),
    now: () => occurredAt,
  });
  const clock = { now: () => occurredAt };
  const decisions = new ActiveMovePolicyDecisions();
  const entered = Promise.withResolvers<AbortSignal>();
  const aborted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let busy = false;
  let calls = 0;
  const provider: MovePolicyProvider = {
    descriptor: {
      instanceId: 'exclusive-test',
      providerType: 'test-engine',
      displayName: 'Exclusive test',
      fingerprint: 'exclusive:v1',
      capabilities: ['best_move'],
      readiness: 'cold',
      status: 'available',
    },
    async chooseMove(_request, signal) {
      assert.ok(signal);
      if (busy)
        throw new MovePolicyProviderError('provider_resource_exhausted');
      busy = true;
      calls++;
      try {
        if (calls === 1) {
          entered.resolve(signal);
          await new Promise<never>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                aborted.resolve();
                void release.promise.then(() =>
                  reject(new MovePolicyProviderError('interrupted')),
                );
              },
              { once: true },
            );
          });
        }
        return {
          providerInstanceId: 'exclusive-test',
          providerFingerprint: 'exclusive:v1',
          reproducibility: 'deterministic',
          move: { from: 'e7', to: 'e5', san: 'e5' },
        };
      } finally {
        busy = false;
      }
    },
  };
  const published: WorkspaceChanged[] = [];
  const events = {
    publish: (event: WorkspaceChanged) => published.push(event),
  };
  const created = await new CreateWorkingContext({
    writer: persistence,
    clock,
    events,
  }).execute({ displayName: 'Context to delete' });
  const contextId = created.context.contextId;
  t.after(async () => {
    release.resolve();
    const draft = await persistence.readPlayout(contextWorkScope(contextId));
    if (draft !== undefined) await decisions.cancelAndWait(draft.draft.draftId);
    await persistence.close();
    await rm(directory, { recursive: true, force: true });
  });
  const rules = new ChessJsRulesAdapter();
  const { host } = await buildFixture(t, {
    startPlayout: new StartPlayout({
      reader: persistence,
      writer: persistence,
      analysis: persistence,
      rules,
      policies: { list: () => [provider.descriptor], resolve: () => provider },
      decisions,
      clock,
      events: { publish: () => undefined },
    }),
    previewWorkingContextDeletion: new PreviewWorkingContextDeletion(
      persistence,
    ),
    deleteWorkingContext: new DeleteWorkingContext({
      writer: persistence,
      playout: decisions,
      clock,
      events,
    }),
  });
  const opening = {
    start: { kind: 'initial_position' },
    providerInstanceId: 'exclusive-test',
    capability: 'best_move',
    opening: {
      kind: 'user_move',
      move: { kind: 'coordinates', value: 'e2e4' },
    },
  };
  const running = host.inject({
    method: 'POST',
    url: '/playout',
    headers,
    payload: {
      ...opening,
      scope: { kind: 'context', contextId: String(contextId.value) },
    },
  });
  const signal = await entered.promise;
  const stored = await persistence.readPlayout(contextWorkScope(contextId));
  assert.equal(stored?.draft.status.kind, 'awaiting_policy');
  assert.ok(stored);
  t.after(async () => {
    release.resolve();
    await decisions.cancelAndWait(stored.draft.draftId);
    await running;
  });
  const url = `/working-contexts/${contextId.value}`;
  const preview = await host.inject({
    url: `${url}/deletion-preview`,
    headers,
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().losses.playout.status, 'awaiting_policy');
  const confirmation = {
    expectedContextVersion: preview.json().contextVersion,
    expectedDataRevision: preview.json().dataRevision,
  };
  const stale = await host.inject({
    method: 'DELETE',
    url,
    headers,
    payload: {
      ...confirmation,
      expectedDataRevision: confirmation.expectedDataRevision - 1,
    },
  });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(signal.aborted, false);
  assert.equal(busy, true);
  assert.ok(await persistence.readPlayout(contextWorkScope(contextId)));
  assert.equal(
    published.filter((event) => event.kind === 'workspace.context-deleted')
      .length,
    0,
  );

  let deletionFinished = false;
  const removing = host
    .inject({ method: 'DELETE', url, headers, payload: confirmation })
    .then((response) => {
      deletionFinished = true;
      return response;
    });
  await Promise.race([aborted.promise, removing.then(() => undefined)]);
  assert.equal(signal.aborted, true);
  assert.equal(deletionFinished, false);
  assert.equal(
    await persistence.readPlayout(contextWorkScope(contextId)),
    undefined,
  );
  assert.equal(busy, true);
  release.resolve();
  const removed = await removing;
  assert.equal(removed.statusCode, 200, removed.body);
  assert.deepEqual(removed.json(), {
    contextId: String(contextId.value),
    dataRevision: confirmation.expectedDataRevision + 1,
  });
  assert.equal(busy, false);
  assert.notEqual((await running).statusCode, 200);
  assert.equal(
    published.filter((event) => event.kind === 'workspace.context-deleted')
      .length,
    1,
  );
  const next = await host.inject({
    method: 'POST',
    url: '/playout',
    headers,
    payload: { ...opening, scope: { kind: 'free' } },
  });
  assert.equal(next.statusCode, 200, next.body);
  assert.equal(calls, 2);
  assert.deepEqual(
    (await persistence.readPlayout(freeWorkScope()))?.draft.steps.map(
      (step) => step.move.san,
    ),
    ['e4', 'e5'],
  );
});
