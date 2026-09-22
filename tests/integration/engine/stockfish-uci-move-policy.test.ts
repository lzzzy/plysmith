import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MovePolicyProviderError } from '../../../app/application/playout/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import {
  createStockfishUciRuntime,
  StockfishUciMovePolicyAdapter,
} from '../../../app/infrastructure/adapters/engine/index.ts';
import { LineProcessSupervisor } from '../../../app/infrastructure/adapters/process/index.ts';

const fakeEngine = fileURLToPath(
  new URL('../../fixtures/uci/fake-uci-engine.mjs', import.meta.url),
);
const rules = new ChessJsRulesAdapter();

test('reuses one prepared UCI process across move decisions', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'plysmith-uci-pool-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tracePath = path.join(directory, 'uci.trace');
  const configuration = {
    instanceId: 'stockfish-reused',
    displayName: 'Stockfish reused',
    executablePath: process.execPath,
    arguments: [fakeEngine, 'normal', tracePath],
    threads: 1,
    hashMb: 16,
    moveTimeMs: 10,
    startupTimeoutMs: 1_000,
    moveTimeoutMs: 1_000,
    stopTimeoutMs: 500,
    maxOutputBytes: 64_000,
  };
  const runtime = createStockfishUciRuntime(
    configuration,
    new LineProcessSupervisor(),
  );
  t.after(() => runtime.close());
  const provider = new StockfishUciMovePolicyAdapter(configuration, runtime);
  const root = rules.initialState();

  assert.equal(provider.descriptor.readiness, 'cold');
  await provider.chooseMove({ root, moves: [], current: root, decisionId: 1 });
  await provider.chooseMove({ root, moves: [], current: root, decisionId: 2 });
  assert.equal(provider.descriptor.readiness, 'ready');

  const trace = await readFile(tracePath, 'utf8');
  assert.equal(trace.match(/^argv /gm)?.length, 1);
  assert.equal(trace.match(/^uci$/gm)?.length, 1);
  assert.equal(trace.match(/^ucinewgame$/gm)?.length, 2);
  assert.equal(trace.match(/^go movetime 10$/gm)?.length, 2);
});

test('reports warming up while the persistent process is prepared', async (t) => {
  const configuration = stockfishConfiguration('slow-ready');
  const runtime = createStockfishUciRuntime(
    configuration,
    new LineProcessSupervisor(),
  );
  t.after(() => runtime.close());
  const provider = new StockfishUciMovePolicyAdapter(configuration, runtime);
  const root = rules.initialState();

  const choosing = provider.chooseMove({
    root,
    moves: [],
    current: root,
    decisionId: 1,
  });
  await waitUntil(() => provider.descriptor.readiness === 'warming_up');
  await choosing;

  assert.equal(provider.descriptor.readiness, 'ready');
});

test('aborts a hanging warmup and retries with a fresh process', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'plysmith-uci-warmup-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tracePath = path.join(directory, 'uci.trace');
  const configuration = {
    ...stockfishConfiguration('hang-ready-once'),
    arguments: [fakeEngine, 'hang-ready-once', tracePath],
  };
  const runtime = createStockfishUciRuntime(
    configuration,
    new LineProcessSupervisor(),
  );
  t.after(() => runtime.close());
  const provider = new StockfishUciMovePolicyAdapter(configuration, runtime);
  const root = rules.initialState();
  const controller = new AbortController();

  const warming = provider.chooseMove(
    { root, moves: [], current: root, decisionId: 1 },
    controller.signal,
  );
  await waitUntil(() => provider.descriptor.readiness === 'warming_up');
  await waitForTrace(tracePath, 'argv ');
  controller.abort();

  await assert.rejects(
    warming,
    (error) =>
      error instanceof MovePolicyProviderError && error.code === 'interrupted',
  );
  assert.equal(provider.descriptor.readiness, 'cold');
  await provider.chooseMove({ root, moves: [], current: root, decisionId: 2 });

  const trace = await readFile(tracePath, 'utf8');
  assert.equal(trace.match(/^argv /gm)?.length, 2);
  assert.equal(provider.descriptor.readiness, 'ready');
});

test('resets the output budget for each lease', async (t) => {
  const configuration = {
    ...stockfishConfiguration('bounded-chatter'),
    maxOutputBytes: 1_024,
  };
  const runtime = createStockfishUciRuntime(
    configuration,
    new LineProcessSupervisor(),
  );
  t.after(() => runtime.close());
  const provider = new StockfishUciMovePolicyAdapter(configuration, runtime);
  const root = rules.initialState();

  await provider.chooseMove({ root, moves: [], current: root, decisionId: 1 });
  await provider.chooseMove({ root, moves: [], current: root, decisionId: 2 });

  assert.equal(provider.descriptor.readiness, 'ready');
});

test('discards a crashed worker before retrying', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'plysmith-uci-retry-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tracePath = path.join(directory, 'uci.trace');
  const configuration = {
    ...stockfishConfiguration('crash-once'),
    arguments: [fakeEngine, 'crash-once', tracePath],
  };
  const runtime = createStockfishUciRuntime(
    configuration,
    new LineProcessSupervisor(),
  );
  t.after(() => runtime.close());
  const provider = new StockfishUciMovePolicyAdapter(configuration, runtime);
  const root = rules.initialState();

  await assert.rejects(
    provider.chooseMove({ root, moves: [], current: root, decisionId: 1 }),
    (error) =>
      error instanceof MovePolicyProviderError &&
      error.code === 'provider_protocol_error',
  );
  assert.equal(provider.descriptor.readiness, 'cold');
  await provider.chooseMove({ root, moves: [], current: root, decisionId: 2 });

  const trace = await readFile(tracePath, 'utf8');
  assert.equal(trace.match(/^argv /gm)?.length, 2);
  assert.equal(provider.descriptor.readiness, 'ready');
});

test('aborts one search and serves the queued decision with a fresh process', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'plysmith-uci-abort-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tracePath = path.join(directory, 'uci.trace');
  const configuration = {
    ...stockfishConfiguration('timeout-once'),
    arguments: [fakeEngine, 'timeout-once', tracePath],
  };
  const runtime = createStockfishUciRuntime(
    configuration,
    new LineProcessSupervisor(),
  );
  t.after(() => runtime.close());
  const provider = new StockfishUciMovePolicyAdapter(configuration, runtime);
  const root = rules.initialState();
  const controller = new AbortController();

  const interrupted = provider.chooseMove(
    { root, moves: [], current: root, decisionId: 1 },
    controller.signal,
  );
  await waitForTrace(tracePath, 'go movetime 10');
  const queued = provider.chooseMove({
    root,
    moves: [],
    current: root,
    decisionId: 2,
  });
  controller.abort();

  await assert.rejects(
    interrupted,
    (error) =>
      error instanceof MovePolicyProviderError && error.code === 'interrupted',
  );
  await queued;

  const trace = await readFile(tracePath, 'utf8');
  assert.equal(trace.match(/^argv /gm)?.length, 2);
  assert.equal(trace.match(/^go movetime 10$/gm)?.length, 2);
  assert.equal(provider.descriptor.readiness, 'ready');
});

test('normalizes one Fake-UCI best move behind the move-policy port', async (t) => {
  const provider = adapter(t, 'normal');
  const root = rules.initialState();
  const user = rules.applyMove(root, [], {
    kind: 'coordinates',
    value: 'e2e4',
  });
  assert.equal(user.ok, true);
  if (!user.ok) throw new Error('Expected a legal move.');
  const selected = await provider.chooseMove({
    root,
    moves: [user.value.move],
    current: user.value.after,
    decisionId: 1,
  });

  assert.deepEqual(selected.move, {
    from: 'e7',
    to: 'e5',
    san: 'e7e5',
  });
  assert.equal(selected.providerInstanceId, 'stockfish-test');
  assert.equal(provider.descriptor.providerType, 'stockfish-uci');
  assert.deepEqual(provider.descriptor.capabilities, ['best_move']);
});

for (const [mode, code] of [
  ['timeout', 'provider_timeout'],
  ['chatter', 'provider_timeout'],
  ['crash', 'provider_protocol_error'],
  ['flood', 'provider_resource_exhausted'],
  ['missing-option', 'capability_missing'],
] as const) {
  test(`maps Fake-UCI ${mode} to ${code}`, async (t) => {
    await assert.rejects(
      adapter(t, mode).chooseMove({
        root: rules.initialState(),
        moves: [],
        current: rules.initialState(),
        decisionId: 1,
      }),
      (error) =>
        error instanceof MovePolicyProviderError && error.code === code,
    );
  });
}

function adapter(t: TestContext, mode: string): StockfishUciMovePolicyAdapter {
  const configuration = stockfishConfiguration(mode);
  const runtime = createStockfishUciRuntime(
    configuration,
    new LineProcessSupervisor(),
  );
  t.after(() => runtime.close());
  return new StockfishUciMovePolicyAdapter(configuration, runtime);
}

function stockfishConfiguration(mode: string) {
  return {
    instanceId: 'stockfish-test',
    displayName: 'Stockfish test',
    executablePath: process.execPath,
    arguments: [fakeEngine, mode],
    threads: 1,
    hashMb: 16,
    moveTimeMs: 10,
    startupTimeoutMs: 1_000,
    moveTimeoutMs: mode === 'timeout' || mode === 'chatter' ? 30 : 1_000,
    stopTimeoutMs: 100,
    maxOutputBytes: mode === 'flood' ? 1_000 : 64_000,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for engine readiness.');
}

async function waitForTrace(
  tracePath: string,
  expected: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const trace = await readFile(tracePath, 'utf8').catch(() => '');
    if (trace.includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for trace entry: ${expected}`);
}
