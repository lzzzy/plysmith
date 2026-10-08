import assert from 'node:assert/strict';
import test from 'node:test';

import { closeHostResources } from '../../../app/bootstrap/host/host-cleanup.ts';

for (const failedStep of [
  'discovery',
  'live',
  'host',
  'engine',
  'imports',
  'store',
  'lease',
  'diagnostics',
]) {
  test(`host cleanup still releases every resource after ${failedStep} fails`, async () => {
    const calls: string[] = [];
    const failure = new Error(failedStep);
    const close = (name: string) => async () => {
      calls.push(name);
      if (name === failedStep) throw failure;
    };
    const failures = await closeHostResources({
      clearDiscovery: close('discovery'),
      live: { close: close('live') },
      host: { close: close('host') },
      engineRuntimes: [{ close: close('engine') }],
      importPreparations: { close: close('imports') },
      persistence: { close: close('store') },
      lease: { release: close('lease') },
      diagnostics: { close: close('diagnostics') },
    });
    assert.deepEqual(failures, [failure]);
    assert.deepEqual(calls, [
      'discovery',
      'live',
      'host',
      'engine',
      'imports',
      'store',
      'lease',
      'diagnostics',
    ]);
  });
}

test('host cleanup aborts imports while HTTP close waits for the pending request', async () => {
  const requestStopped = Promise.withResolvers<void>();
  const importsClosed = Promise.withResolvers<void>();
  const calls: string[] = [];
  const cleanup = closeHostResources({
    live: undefined,
    host: {
      close: () => {
        calls.push('host');
        return requestStopped.promise;
      },
    },
    engineRuntimes: [],
    importPreparations: {
      close: () => {
        calls.push('imports');
        requestStopped.resolve();
        return importsClosed.promise;
      },
    },
    persistence: {
      close: () => {
        calls.push('store');
      },
    },
    lease: {
      release: async () => {
        calls.push('lease');
      },
    },
    diagnostics: undefined,
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual([...calls], ['host', 'imports']);
    importsClosed.resolve();
    assert.deepEqual(await cleanup, []);
    assert.deepEqual(calls, ['host', 'imports', 'store', 'lease']);
  } finally {
    // Release the stubbed waits even when the ordering assertion fails.
    requestStopped.resolve();
    importsClosed.resolve();
    await cleanup;
  }
});

test('host cleanup waits for all producers before releasing persistence', async () => {
  const host = Promise.withResolvers<void>();
  const engine = Promise.withResolvers<void>();
  const calls: string[] = [];
  const cleanup = closeHostResources({
    live: undefined,
    host: { close: () => host.promise },
    engineRuntimes: [{ close: () => engine.promise }],
    importPreparations: undefined,
    persistence: {
      close: () => {
        calls.push('store');
      },
    },
    lease: {
      release: async () => {
        calls.push('lease');
      },
    },
    diagnostics: undefined,
  });
  host.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, []);
  engine.resolve();
  assert.deepEqual(await cleanup, []);
  assert.deepEqual(calls, ['store', 'lease']);
});

test('partial startup cleanup survives synchronous closer and diagnostic failures', async () => {
  const failures = [new Error('store'), new Error('diagnostic event')];
  const calls: string[] = [];
  assert.deepEqual(
    await closeHostResources({
      live: undefined,
      host: undefined,
      engineRuntimes: [],
      importPreparations: undefined,
      persistence: {
        close: () => {
          throw failures[0];
        },
      },
      lease: {
        release: async () => {
          calls.push('lease');
        },
      },
      beforeDiagnosticsClose: () => {
        throw failures[1];
      },
      diagnostics: {
        close: () => {
          calls.push('diagnostics');
        },
      },
    }),
    failures,
  );
  assert.deepEqual(calls, ['lease', 'diagnostics']);
});
