import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { ApplicationProblem } from '../../app/application/problems/application-problem.ts';
import {
  GetUserPreferences,
  SetUiLanguage,
} from '../../app/application/preferences/index.ts';
import type {
  PreferencesUnitOfWork,
  UiLanguageChanged,
  UserPreferences,
  UserPreferencesReader,
} from '../../app/application/preferences/index.ts';
import type { StoreStatusReader } from '../../app/application/system/index.ts';

export type PreferencesTestStore = UserPreferencesReader &
  PreferencesUnitOfWork &
  StoreStatusReader;

export function preferencesStoreContract(
  name: string,
  createStore: (context: TestContext) => Promise<PreferencesTestStore>,
  skip: false | string = false,
): void {
  describe(name, { skip }, () => {
    it('starts in German with an independent positive preference revision', async (t) => {
      const store = await createStore(t);
      const preferences = await new GetUserPreferences(store).execute();
      assert.equal(preferences.uiLocale, 'de-DE');
      assert.equal(preferences.preferenceRevision, 1);
      assert.equal(preferences.dataRevision, 0);
      assert.deepEqual(await store.readStoreStatus(), {
        schemaVersion: 1,
        dataRevision: 0,
      });
      assert.ok(Object.isFrozen(preferences));
    });

    it('publishes exactly once and only after both revisions are committed', async (t) => {
      const store = await createStore(t);
      const events: UiLanguageChanged[] = [];
      const observed: Promise<UserPreferences>[] = [];
      const setLanguage = new SetUiLanguage({
        unitOfWork: store,
        clock: { now: () => '2026-09-08T11:00:00.000Z' },
        events: {
          publish(event) {
            events.push(event);
            observed.push(store.readUserPreferences());
          },
        },
      });
      const result = await setLanguage.execute({
        uiLocale: 'en-GB',
        expectedRevision: 1,
      });
      assert.equal(result.changed, true);
      assert.deepEqual(result.preferences, {
        uiLocale: 'en-GB',
        preferenceRevision: 2,
        dataRevision: 1,
        updatedAt: '2026-09-08T11:00:00.000Z',
      });
      assert.deepEqual(await Promise.all(observed), [result.preferences]);
      assert.deepEqual(events, [
        {
          kind: 'preference.ui-language-changed',
          occurredAt: '2026-09-08T11:00:00.000Z',
          dataRevision: 1,
          preferenceRevision: 2,
          payload: { previousUiLocale: 'de-DE', uiLocale: 'en-GB' },
        },
      ]);
      assert.deepEqual(await store.readStoreStatus(), {
        schemaVersion: 1,
        dataRevision: 1,
      });
    });

    it('does not write, read the clock or emit on an identical current selection', async (t) => {
      const store = await createStore(t);
      const before = await store.readUserPreferences();
      const command = new SetUiLanguage({
        unitOfWork: store,
        clock: {
          now: () => {
            throw new Error('No-op must not read the clock.');
          },
        },
        events: { publish: () => assert.fail('No-op must not emit.') },
      });
      const result = await command.execute({
        uiLocale: 'de-DE',
        expectedRevision: 1,
      });
      assert.deepEqual(result, { changed: false, preferences: before });
      assert.deepEqual(await store.readUserPreferences(), before);
    });

    it('rejects a stale revision even when the requested language is now selected', async (t) => {
      const store = await createStore(t);
      const events: UiLanguageChanged[] = [];
      const command = makeCommand(store, events);
      const accepted = await command.execute({
        uiLocale: 'en-GB',
        expectedRevision: 1,
      });
      for (const uiLocale of ['de-DE', 'en-GB']) {
        await assert.rejects(
          command.execute({ uiLocale, expectedRevision: 1 }),
          (error: unknown) => {
            assert.ok(error instanceof ApplicationProblem);
            assert.equal(error.problemCode, 'preference.revision_conflict');
            assert.deepEqual(error.parameters, {
              expectedRevision: 1,
              currentRevision: 2,
            });
            return true;
          },
        );
      }
      assert.deepEqual(await store.readUserPreferences(), accepted.preferences);
      assert.equal(events.length, 1);
    });

    it('allows exactly one of two concurrent commands with the same revision', async (t) => {
      const store = await createStore(t);
      const events: UiLanguageChanged[] = [];
      const command = makeCommand(store, events);
      const results = await Promise.allSettled([
        command.execute({ uiLocale: 'en-GB', expectedRevision: 1 }),
        command.execute({ uiLocale: 'en-GB', expectedRevision: 1 }),
      ]);
      assert.deepEqual(
        results.map((result) => result.status),
        ['fulfilled', 'rejected'],
      );
      const second = results[1];
      assert.equal(second?.status, 'rejected');
      if (second?.status === 'rejected') {
        assert.equal(second.reason.problemCode, 'preference.revision_conflict');
      }
      assert.equal(events.length, 1);
      assert.equal((await store.readUserPreferences()).dataRevision, 1);
    });

    it('rolls back a failed unit of work and keeps the next command usable', async (t) => {
      const store = await createStore(t);
      const before = await store.readUserPreferences();
      await assert.rejects(
        store.run((transaction) => {
          transaction.setUiLanguage('en-GB', '2026-09-08T11:00:00.000Z');
          throw new Error('Abort after writing.');
        }),
      );
      assert.deepEqual(await store.readUserPreferences(), before);
      const result = await makeCommand(store, []).execute({
        uiLocale: 'en-GB',
        expectedRevision: 1,
      });
      assert.equal(result.preferences.preferenceRevision, 2);
      assert.equal(result.preferences.dataRevision, 1);
    });

    it('increments each revision once when switching back to German', async (t) => {
      const store = await createStore(t);
      const events: UiLanguageChanged[] = [];
      const command = makeCommand(store, events);
      await command.execute({ uiLocale: 'en-GB', expectedRevision: 1 });
      const result = await command.execute({
        uiLocale: 'de-DE',
        expectedRevision: 2,
      });
      assert.equal(result.preferences.uiLocale, 'de-DE');
      assert.equal(result.preferences.preferenceRevision, 3);
      assert.equal(result.preferences.dataRevision, 2);
      assert.equal(events.length, 2);
    });
  });
}

function makeCommand(store: PreferencesTestStore, events: UiLanguageChanged[]) {
  return new SetUiLanguage({
    unitOfWork: store,
    clock: { now: () => '2026-09-08T11:00:00.000Z' },
    events: {
      publish: (event) => {
        events.push(event);
      },
    },
  });
}
