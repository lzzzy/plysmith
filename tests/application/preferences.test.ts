import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SetUiLanguage } from '../../app/application/preferences/index.ts';
import type {
  SetUiLanguageRequest,
  UiLanguageChanged,
} from '../../app/application/preferences/index.ts';
import { ApplicationProblem } from '../../app/application/problems/application-problem.ts';
import { GetSystemStatus } from '../../app/application/system/index.ts';
import type { RuntimeState } from '../../app/application/system/index.ts';
import { FakePreferencesStore } from './fake-preferences-store.ts';
import { preferencesStoreContract } from './preferences-store-contract.ts';

preferencesStoreContract(
  'Application preferences port contract',
  async () => new FakePreferencesStore(),
);

test('invalid language and revision problems are stable and transport independent', async () => {
  const command = new SetUiLanguage({
    unitOfWork: {
      run: () => {
        throw new Error('Validation must precede persistence.');
      },
    },
    clock: {
      now: () => {
        throw new Error('Validation must precede the clock.');
      },
    },
    events: { publish: () => assert.fail('Invalid requests must not emit.') },
  });
  const invalidLanguages: unknown[] = [
    'fr-FR',
    'de',
    'en-US',
    '',
    ' de-DE',
    null,
    undefined,
    42,
  ];
  for (const uiLocale of invalidLanguages) {
    await assert.rejects(
      command.execute({
        uiLocale,
        expectedRevision: 1,
      } as SetUiLanguageRequest),
      (error: unknown) => {
        assert.ok(error instanceof ApplicationProblem);
        assert.equal(error.problemCode, 'preference.invalid_ui_language');
        assert.equal(error.retryable, false);
        assert.deepEqual(error.parameters, {});
        assert.equal('status' in error, false);
        return true;
      },
    );
  }
  for (const expectedRevision of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    await assert.rejects(
      command.execute({ uiLocale: 'de-DE', expectedRevision }),
      {
        problemCode: 'preference.invalid_revision',
      },
    );
  }
});

test('a failed commit publishes nothing and preserves the previous snapshot', async () => {
  const store = new FakePreferencesStore();
  const before = await store.readUserPreferences();
  const events: UiLanguageChanged[] = [];
  const command = new SetUiLanguage({
    unitOfWork: store,
    clock: { now: () => '2026-09-08T11:00:00.000Z' },
    events: {
      publish: (event) => {
        events.push(event);
      },
    },
  });
  store.failCommit = true;
  await assert.rejects(
    command.execute({ uiLocale: 'en-GB', expectedRevision: 1 }),
  );
  assert.deepEqual(await store.readUserPreferences(), before);
  assert.deepEqual(events, []);
});

test('GetSystemStatus reads current runtime state and store metadata without changing it', async () => {
  const store = new FakePreferencesStore();
  let state: RuntimeState = 'ready';
  const query = new GetSystemStatus({
    runtime: { getState: () => state },
    store,
  });
  const before = await store.readUserPreferences();
  const result = await query.execute();
  assert.deepEqual(result, {
    state: 'ready',
    persistence: { schemaVersion: 1, dataRevision: 0 },
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.persistence));
  state = 'shutting_down';
  assert.equal((await query.execute()).state, 'shutting_down');
  assert.deepEqual(await store.readUserPreferences(), before);
});
