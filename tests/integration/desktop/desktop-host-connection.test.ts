import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DesktopHostConnectionMonitor,
  type DiscoverDesktopHost,
} from '../../../app/infrastructure/channels/ui/desktop/desktop-host-connection.ts';
import type { HostConnection } from '../../../app/infrastructure/channels/host_client/index.ts';

const firstConnection: HostConnection = {
  endpoint: 'http://127.0.0.1:41001/',
  productRelease: '0.0.0',
  contractFingerprint: 'sha256:first',
  token: 'first-desktop-test-token-000000000000',
};
const secondConnection: HostConnection = {
  ...firstConnection,
  endpoint: 'http://127.0.0.1:41002/',
  token: 'second-desktop-test-token-00000000000',
};

test('desktop connection monitor starts unavailable without owning the host', async () => {
  let discoveries = 0;
  const diagnostics: unknown[] = [];
  const monitor = new DesktopHostConnectionMonitor({
    discover: async () => {
      discoveries += 1;
      throw new Error('missing');
    },
    validate: async () => assert.fail('nothing should be validated'),
    diagnostics: { write: (event) => diagnostics.push(event) },
  });

  await monitor.start();

  assert.deepEqual(monitor.getSnapshot(), {
    kind: 'unavailable',
    generation: 0,
  });
  assert.equal(discoveries, 1);
  assert.deepEqual(diagnostics, [
    {
      level: 'error',
      eventCode: 'desktop.host_connection.unavailable',
      status: 'unavailable',
      generation: 0,
    },
  ]);
  monitor.close();
});

test('desktop connection monitor publishes only validated replacements', async () => {
  let candidate: HostConnection | Error = firstConnection;
  const validated: HostConnection[] = [];
  const published: number[] = [];
  const discover: DiscoverDesktopHost = async () => {
    if (candidate instanceof Error) {
      throw candidate;
    }
    return candidate;
  };
  const monitor = new DesktopHostConnectionMonitor({
    discover,
    unavailableAfterConsecutiveFailures: 3,
    validate: async (connection) => {
      validated.push(connection);
      if (connection === secondConnection && validated.length === 2) {
        throw new Error('replacement not ready');
      }
    },
  });
  monitor.subscribe((snapshot) => published.push(snapshot.generation));

  await monitor.start();
  assert.equal(monitor.getSnapshot().kind, 'ready');
  assert.deepEqual(published, [1]);

  candidate = new Error('brief discovery gap');
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().generation, 1);

  candidate = secondConnection;
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().generation, 1);
  await monitor.refresh();

  assert.deepEqual(published, [1, 2]);
  assert.deepEqual(monitor.getSnapshot(), {
    kind: 'ready',
    generation: 2,
    connection: secondConnection,
  });
  monitor.close();
});

test('desktop connection monitor publishes sustained host loss', async () => {
  let available = true;
  const published: Array<{
    readonly kind: string;
    readonly generation: number;
  }> = [];
  const monitor = new DesktopHostConnectionMonitor({
    discover: async () => {
      if (!available) {
        throw new Error('host unavailable');
      }
      return firstConnection;
    },
    validate: async () => undefined,
    unavailableAfterConsecutiveFailures: 2,
  });
  monitor.subscribe((snapshot) => published.push(snapshot));

  await monitor.start();
  available = false;
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().kind, 'ready');
  await monitor.refresh();

  assert.deepEqual(monitor.getSnapshot(), {
    kind: 'unavailable',
    generation: 2,
  });
  assert.deepEqual(
    published.map(({ kind, generation }) => ({ kind, generation })),
    [
      { kind: 'ready', generation: 1 },
      { kind: 'unavailable', generation: 2 },
    ],
  );
  monitor.close();
});

test('desktop connection monitor revalidates an unchanged discovery record', async () => {
  let valid = true;
  let validations = 0;
  const monitor = new DesktopHostConnectionMonitor({
    discover: async () => firstConnection,
    validate: async () => {
      validations += 1;
      if (!valid) {
        throw new Error('host unavailable');
      }
    },
    unavailableAfterConsecutiveFailures: 1,
  });

  await monitor.start();
  valid = false;
  await monitor.refresh();

  assert.equal(validations, 2);
  assert.deepEqual(monitor.getSnapshot(), {
    kind: 'unavailable',
    generation: 2,
  });
  monitor.close();
});

test('desktop connection monitor times out hung validations and ignores their late completion', async () => {
  let validations = 0;
  const lateCompletions: Array<() => void> = [];
  const validationSignals: AbortSignal[] = [];
  const published: Array<{
    readonly kind: string;
    readonly generation: number;
  }> = [];
  const monitor = new DesktopHostConnectionMonitor({
    discover: async () => firstConnection,
    validate: async (_connection, signal) => {
      validations += 1;
      if (validations === 1) {
        return;
      }
      validationSignals.push(signal);
      await new Promise<void>((resolve) => lateCompletions.push(resolve));
    },
    validationTimeoutMilliseconds: 5,
    unavailableAfterConsecutiveFailures: 2,
  });
  monitor.subscribe((snapshot) => published.push(snapshot));

  await monitor.start();
  await monitor.refresh();
  assert.equal(monitor.getSnapshot().kind, 'ready');
  assert.equal(validationSignals[0]?.aborted, true);

  await monitor.refresh();
  assert.deepEqual(monitor.getSnapshot(), {
    kind: 'unavailable',
    generation: 2,
  });
  assert.equal(validationSignals[1]?.aborted, true);

  for (const complete of lateCompletions) {
    complete();
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(
    published.map(({ kind, generation }) => ({ kind, generation })),
    [
      { kind: 'ready', generation: 1 },
      { kind: 'unavailable', generation: 2 },
    ],
  );
  monitor.close();
});
