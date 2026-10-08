import assert from 'node:assert/strict';
import filesystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ApplicationProblem } from '../../../app/application/problems/application-problem.ts';
import {
  FileDiagnosticSettingsRepository,
  FileEngineProviderConfigurationRepository,
} from '../../../app/infrastructure/adapters/configuration/filesystem/index.ts';

test(
  'engine publication cannot lose an acknowledged diagnostic setting',
  { timeout: 10_000 },
  async (context) => {
    const f = await fixture(context);
    const before = await f.diagnostics.read();
    const paused = pausePublication(
      context,
      path.join(f.active, 'stockfish-main.json'),
    );
    const engineSave = f.engines.save({
      input: f.input,
      expectedConfigurationRevision: null,
    });
    try {
      await paused.reached(engineSave);
      const diagnosticResult = await outcome(
        f.diagnostics.setLevel({
          level: 'info',
          expectedConfigurationRevision: before.configurationRevision,
        }),
      );
      paused.release();
      await engineSave;
      if (diagnosticResult.status === 'fulfilled') {
        assert.equal(diagnosticResult.value.level, 'info');
        assert.equal(
          (await f.diagnostics.read()).level,
          'info',
          'A successful diagnostic save must survive the concurrent engine publication.',
        );
      } else {
        assertProblem(
          diagnosticResult.reason,
          'diagnostics.configuration_conflict',
        );
      }
      assert.deepEqual(
        (await f.engines.list()).map((provider) => provider.instanceId),
        ['stockfish-main'],
      );
      await assertNoWriteLocks(f.active);
    } finally {
      paused.release();
      await engineSave.catch(() => undefined);
      paused.restore();
    }
  },
);

test(
  'diagnostic publication cannot lose acknowledged engine bindings',
  { timeout: 10_000 },
  async (context) => {
    const f = await fixture(context);
    const before = await f.diagnostics.read();
    const paused = pausePublication(
      context,
      path.join(f.active, 'plysmith.json'),
    );
    const diagnosticSave = f.diagnostics.setLevel({
      level: 'info',
      expectedConfigurationRevision: before.configurationRevision,
    });
    try {
      await paused.reached(diagnosticSave);
      const engineResult = await outcome(
        f.engines.save({ input: f.input, expectedConfigurationRevision: null }),
      );
      paused.release();
      await diagnosticSave;
      if (engineResult.status === 'fulfilled') {
        assert.equal(engineResult.value.instanceId, 'stockfish-main');
        assert.deepEqual(
          (await f.engines.list()).map((provider) => provider.instanceId),
          ['stockfish-main'],
          'A successful engine save must remain bound after the concurrent diagnostic publication.',
        );
      } else {
        assertProblem(engineResult.reason, 'configuration.engine_conflict');
      }
      assert.equal((await f.diagnostics.read()).level, 'info');
      await assertNoWriteLocks(f.active);
    } finally {
      paused.release();
      await diagnosticSave.catch(() => undefined);
      paused.restore();
    }
  },
);

test('diagnostic CAS rejects a revision preceding an engine save without changing either setting', async (context) => {
  const f = await fixture(context);
  const before = await f.diagnostics.read();
  await f.engines.save({ input: f.input, expectedConfigurationRevision: null });
  const centralPath = path.join(f.active, 'plysmith.json');
  const centralBefore = await filesystem.readFile(centralPath);
  const stale = await outcome(
    f.diagnostics.setLevel({
      level: 'info',
      expectedConfigurationRevision: before.configurationRevision,
    }),
  );
  assert.equal(stale.status, 'rejected');
  if (stale.status === 'rejected') {
    assertProblem(stale.reason, 'diagnostics.configuration_conflict');
  }
  assert.deepEqual(await filesystem.readFile(centralPath), centralBefore);
  assert.equal((await f.diagnostics.read()).level, 'off');
  assert.deepEqual(
    (await f.engines.list()).map((provider) => provider.instanceId),
    ['stockfish-main'],
  );
  await assertNoWriteLocks(f.active);
});

test('engine updates preserve diagnostic settings and keep provider CAS intact', async (context) => {
  const f = await fixture(context);
  const created = await f.engines.save({
    input: f.input,
    expectedConfigurationRevision: null,
  });
  const before = await f.diagnostics.read();
  await f.diagnostics.setLevel({
    level: 'info',
    expectedConfigurationRevision: before.configurationRevision,
  });
  const updated = await f.engines.save({
    input: { ...f.input, displayName: 'Updated engine' },
    expectedConfigurationRevision: created.configurationRevision,
  });
  assert.notEqual(updated.configurationRevision, created.configurationRevision);
  assert.equal((await f.diagnostics.read()).level, 'info');
  const stale = await outcome(
    f.engines.save({
      input: { ...f.input, displayName: 'Stale engine' },
      expectedConfigurationRevision: created.configurationRevision,
    }),
  );
  assert.equal(stale.status, 'rejected');
  if (stale.status === 'rejected') {
    assertProblem(stale.reason, 'configuration.engine_conflict');
  }
  assert.equal((await f.engines.list())[0]?.displayName, 'Updated engine');
  assert.equal((await f.diagnostics.read()).level, 'info');
  await assertNoWriteLocks(f.active);
});

test('engine removal preserves diagnostic settings and releases the shared writer lock', async (context) => {
  const f = await fixture(context);
  const created = await f.engines.save({
    input: f.input,
    expectedConfigurationRevision: null,
  });
  const before = await f.diagnostics.read();
  await f.diagnostics.setLevel({
    level: 'info',
    expectedConfigurationRevision: before.configurationRevision,
  });
  await f.engines.remove({
    instanceId: f.input.instanceId,
    expectedConfigurationRevision: created.configurationRevision,
  });
  assert.deepEqual(await f.engines.list(), []);
  assert.equal((await f.diagnostics.read()).level, 'info');
  await assertNoWriteLocks(f.active);
});

async function assertNoWriteLocks(active: string): Promise<void> {
  assert.deepEqual(
    (await filesystem.readdir(active)).filter(
      (name) => name.endsWith('.lock') || name.endsWith('.tmp'),
    ),
    [],
  );
}

function pausePublication(context: test.TestContext, target: string) {
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const rename = filesystem.rename;
  let intercepted = false;
  const mocked = context.mock.method(
    filesystem,
    'rename',
    async (
      source: Parameters<typeof filesystem.rename>[0],
      destination: Parameters<typeof filesystem.rename>[1],
    ) => {
      if (!intercepted && destination === target) {
        intercepted = true;
        entered.resolve();
        await resume.promise;
      }
      return rename(source, destination);
    },
  );
  syncBuiltinESMExports();
  return {
    reached: (operation: Promise<unknown>) =>
      Promise.race([
        entered.promise,
        operation.then(() => {
          throw new Error(
            'The write completed without reaching its publication boundary.',
          );
        }),
      ]),
    release: () => resume.resolve(),
    restore: () => {
      mocked.mock.restore();
      syncBuiltinESMExports();
    },
  };
}

function outcome<T>(operation: Promise<T>) {
  return operation.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
}

function assertProblem(error: unknown, code: string): void {
  assert.ok(error instanceof ApplicationProblem);
  assert.equal(error.problemCode, code);
}

async function fixture(context: test.TestContext) {
  const home = await filesystem.mkdtemp(
    path.join(os.tmpdir(), 'plysmith-configuration-race-'),
  );
  context.after(async () => {
    assert.equal(path.dirname(home), path.resolve(os.tmpdir()));
    assert.equal((await filesystem.lstat(home)).isSymbolicLink(), false);
    await filesystem.rm(home, { recursive: true, force: true });
  });
  const active = path.join(home, 'configuration', 'active');
  await filesystem.mkdir(active, { recursive: true });
  await filesystem.writeFile(
    path.join(active, 'plysmith.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        diagnostics: { logging: { level: 'off' } },
        bindings: {
          persistence: 'sqlite-main',
          analysisEngines: [],
          playoutEngines: [],
          liveProviders: [],
        },
      },
      null,
      2,
    )}\n`,
  );
  const input = {
    instanceId: 'stockfish-main',
    providerType: 'stockfish-uci' as const,
    displayName: 'Stockfish',
    executablePath: path.join(home, 'stockfish.exe'),
    arguments: [],
    threads: 1,
    hashMb: 64,
    detailLevels: { fast: 500, thorough: 1_500, very_deep: 5_000 },
    playoutBudget: 'thorough' as const,
    startupTimeoutMs: 5_000,
    moveTimeoutMs: 10_000,
    stopTimeoutMs: 1_000,
    maxOutputBytes: 1_048_576,
  };
  await filesystem.writeFile(
    input.executablePath,
    'fixture executable; never started',
  );
  return {
    active,
    input,
    engines: new FileEngineProviderConfigurationRepository(home),
    diagnostics: new FileDiagnosticSettingsRepository(home),
  };
}
