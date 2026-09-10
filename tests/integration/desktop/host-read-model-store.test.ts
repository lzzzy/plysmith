import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HostReadModelStore,
  type HostReadClient,
} from '../../../app/infrastructure/channels/ui/renderer/host-read-model-store.ts';
import type {
  HostConnection,
  UserPreferencesDto,
} from '../../../app/infrastructure/channels/host_client/index.ts';

const connection: HostConnection = {
  endpoint: 'http://127.0.0.1:43121/',
  productRelease: '0.0.0',
  contractFingerprint: 'sha256:store-test',
  token: 'desktop-store-test-token-000000000000',
};
const status = {
  state: 'ready' as const,
  persistence: { schemaVersion: 1, dataRevision: 0 },
  productRelease: '0.0.0',
  contractFingerprint: 'sha256:store-test',
};
const preferences = {
  uiLocale: 'de-DE' as const,
  preferenceRevision: 1,
  dataRevision: 0,
  updatedAt: '2026-09-09T18:00:00.000Z',
};

test('renderer subscribes to events before loading its snapshots', async () => {
  const order: string[] = [];
  let markSubscriptionReady: (() => void) | undefined;
  const subscriptionReady = new Promise<void>((resolve) => {
    markSubscriptionReady = resolve;
  });
  const client: HostReadClient = {
    getSystemStatus: async () => {
      order.push('status');
      return status;
    },
    getUserPreferences: async () => {
      order.push('preferences');
      return preferences;
    },
    setUiLanguage: async () => assert.fail('no write expected'),
  };
  const store = new HostReadModelStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: () => {
      order.push('events');
      return { ready: subscriptionReady, close: () => undefined };
    },
  });

  const start = store.start();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(order, ['events']);
  markSubscriptionReady?.();
  await start;

  assert.deepEqual(order, ['events', 'status', 'preferences']);
  assert.equal(store.getSnapshot().phase, 'ready');
  store.close();
});

test('renderer coalesces event refreshes and never repeats a write', async () => {
  let releaseStatus: (() => void) | undefined;
  let statusReads = 0;
  let writes = 0;
  let onChange: () => void = () => undefined;
  const client: HostReadClient = {
    getSystemStatus: async () => {
      statusReads += 1;
      if (statusReads === 2) {
        await new Promise<void>((resolve) => {
          releaseStatus = resolve;
        });
      }
      return status;
    },
    getUserPreferences: async () => preferences,
    setUiLanguage: async (request) => {
      writes += 1;
      return {
        changed: true,
        preferences: {
          ...preferences,
          uiLocale: request.uiLocale,
          preferenceRevision: 2,
          dataRevision: 1,
        },
      };
    },
  };
  const store = new HostReadModelStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: (_connection, change) => {
      onChange = change;
      return { ready: Promise.resolve(), close: () => undefined };
    },
  });
  await store.start();

  onChange();
  onChange();
  onChange();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(statusReads, 2);
  releaseStatus?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(statusReads, 3);

  await store.setUiLanguage('en-GB');
  assert.equal(writes, 1);
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.preferences.uiLocale : undefined,
    'en-GB',
  );
  store.close();
});

test('renderer resyncs authoritative snapshots after an event reconnect', async () => {
  let currentPreferences: UserPreferencesDto = preferences;
  let onReconnect: () => void = () => undefined;
  const client: HostReadClient = {
    getSystemStatus: async () => ({
      ...status,
      persistence: {
        ...status.persistence,
        dataRevision: currentPreferences.dataRevision,
      },
    }),
    getUserPreferences: async () => currentPreferences,
    setUiLanguage: async () => assert.fail('no write expected'),
  };
  const store = new HostReadModelStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: (_connection, _change, reconnect) => {
      onReconnect = reconnect;
      return { ready: Promise.resolve(), close: () => undefined };
    },
  });
  await store.start();

  currentPreferences = {
    ...preferences,
    uiLocale: 'en-GB',
    preferenceRevision: 2,
    dataRevision: 1,
  };
  onReconnect();
  await new Promise<void>((resolve) => setImmediate(resolve));

  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.preferences.uiLocale : undefined,
    'en-GB',
  );
  store.close();
});

test('a delayed command response cannot replace a newer refreshed preference', async () => {
  let releaseWrite: (() => void) | undefined;
  let currentPreferences: UserPreferencesDto = preferences;
  const client: HostReadClient = {
    getSystemStatus: async () => ({
      ...status,
      persistence: {
        ...status.persistence,
        dataRevision: currentPreferences.dataRevision,
      },
    }),
    getUserPreferences: async () => currentPreferences,
    setUiLanguage: async () => {
      await new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      return {
        changed: true,
        preferences: {
          ...preferences,
          uiLocale: 'en-GB',
          preferenceRevision: 2,
          dataRevision: 1,
        },
      };
    },
  };
  const store = new HostReadModelStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: () => ({
      ready: Promise.resolve(),
      close: () => undefined,
    }),
  });
  await store.start();

  const write = store.setUiLanguage('en-GB');
  currentPreferences = {
    ...preferences,
    uiLocale: 'de-DE',
    preferenceRevision: 3,
    dataRevision: 2,
  };
  await store.refresh();
  releaseWrite?.();
  await write;

  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.preferences.preferenceRevision
      : undefined,
    3,
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.preferences.uiLocale : undefined,
    'de-DE',
  );
  store.close();
});

test('a delayed read cannot replace a newer confirmed write', async () => {
  let releaseRead: (() => void) | undefined;
  let delayNextRead = false;
  const client: HostReadClient = {
    getSystemStatus: async () => {
      if (delayNextRead) {
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
      }
      return status;
    },
    getUserPreferences: async () => preferences,
    setUiLanguage: async () => ({
      changed: true,
      preferences: {
        ...preferences,
        uiLocale: 'en-GB',
        preferenceRevision: 2,
        dataRevision: 1,
      },
    }),
  };
  const store = new HostReadModelStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: () => ({
      ready: Promise.resolve(),
      close: () => undefined,
    }),
  });
  await store.start();

  delayNextRead = true;
  const staleRead = store.refresh();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const write = store.setUiLanguage('en-GB');
  await new Promise<void>((resolve) => setImmediate(resolve));
  delayNextRead = false;
  releaseRead?.();
  await Promise.all([staleRead, write]);

  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.preferences.preferenceRevision
      : undefined,
    2,
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.preferences.uiLocale : undefined,
    'en-GB',
  );
  store.close();
});
