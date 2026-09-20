import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ApplicationProblem } from '../../../app/application/problems/application-problem.ts';
import {
  DisableEngineProviderConfiguration,
  GetEngineProviderConfigurations,
  SaveEngineProviderConfiguration,
} from '../../../app/application/playout/index.ts';
import { FileEngineProviderConfigurationRepository } from '../../../app/infrastructure/adapters/configuration/filesystem/index.ts';

test('engine provider settings are previewed, bound, versioned and disabled atomically', async (t) => {
  const home = await configuredHome(t);
  const executablePath = path.join(home, 'stockfish.exe');
  await writeFile(executablePath, 'fake engine', 'utf8');
  const repository = new FileEngineProviderConfigurationRepository(home);
  const save = new SaveEngineProviderConfiguration(repository);

  assert.deepEqual(await repository.list(), []);
  assert.deepEqual(await repository.preview(input('missing.exe')), {
    valid: false,
    issues: ['configuration_invalid'],
  });
  assert.deepEqual(await repository.preview(input(executablePath)), {
    valid: true,
    issues: [],
  });

  const created = await save.execute({
    input: input(executablePath),
    expectedConfigurationRevision: null,
  });
  const listed = await repository.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.configurationRevision, created.configurationRevision);
  const central = JSON.parse(
    await readFile(
      path.join(home, 'configuration', 'active', 'plysmith.json'),
      'utf8',
    ),
  ) as { bindings: { playoutEngines: string[] } };
  assert.deepEqual(central.bindings.playoutEngines, ['stockfish-main']);

  const getBeforeRestart = new GetEngineProviderConfigurations({
    repository,
    activeFingerprints: new Map(),
  });
  assert.equal(
    (await getBeforeRestart.execute()).providers[0]?.restartRequired,
    true,
  );

  await writeFile(executablePath, 'replacement engine', 'utf8');
  const replaced = await save.execute({
    input: input(executablePath),
    expectedConfigurationRevision: created.configurationRevision,
  });
  assert.notEqual(replaced.effectiveFingerprint, created.effectiveFingerprint);

  await assert.rejects(
    save.execute({
      input: { ...input(executablePath), moveTimeMs: 750 },
      expectedConfigurationRevision: created.configurationRevision,
    }),
    isProblem('configuration.engine_conflict'),
  );

  const disable = new DisableEngineProviderConfiguration(repository);
  const disabled = await disable.execute({
    instanceId: 'stockfish-main',
    expectedConfigurationRevision: replaced.configurationRevision,
  });
  assert.equal(disabled.enabled, false);
});

function input(executablePath: string) {
  return {
    instanceId: 'stockfish-main',
    providerType: 'stockfish-uci' as const,
    displayName: 'Stockfish',
    enabled: true,
    executablePath,
    arguments: [] as readonly string[],
    threads: 1,
    hashMb: 64,
    moveTimeMs: 500,
    startupTimeoutMs: 5_000,
    moveTimeoutMs: 10_000,
    stopTimeoutMs: 1_000,
    maxOutputBytes: 1_048_576,
  };
}

function isProblem(code: string) {
  return (error: unknown) =>
    error instanceof ApplicationProblem && error.problemCode === code;
}

async function configuredHome(t: test.TestContext): Promise<string> {
  const home = await mkdtemp(
    path.join(os.tmpdir(), 'plysmith-engine-settings-'),
  );
  t.after(() => rm(home, { recursive: true, force: true }));
  const active = path.join(home, 'configuration', 'active');
  await mkdir(active, { recursive: true });
  await writeFile(
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
    'utf8',
  );
  return home;
}
