import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ApplicationProblem } from '../../../app/application/problems/application-problem.ts';
import {
  RemoveEngineProviderConfiguration,
  GetEngineProviderConfigurations,
  SaveEngineProviderConfiguration,
} from '../../../app/application/playout/index.ts';
import { FileEngineProviderConfigurationRepository } from '../../../app/infrastructure/adapters/configuration/filesystem/index.ts';

test('engine provider settings are previewed, bound, versioned and removed atomically', async (t) => {
  const home = await configuredHome(t);
  const executablePath = path.join(home, 'stockfish.exe');
  const weights1100Path = path.join(home, 'maia-1100.pb.gz');
  const weights1900Path = path.join(home, 'maia-1900.pb.gz');
  await writeFile(executablePath, 'fake engine', 'utf8');
  await writeFile(weights1100Path, 'fake Maia 1100 weights', 'utf8');
  await writeFile(weights1900Path, 'fake Maia 1900 weights', 'utf8');
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
  assert.deepEqual(
    await repository.preview(
      maiaInput(
        executablePath,
        path.join(home, 'missing.pb.gz'),
        'maia-missing',
        1500,
      ),
    ),
    { valid: false, issues: ['weights_not_found'] },
  );
  const created = await save.execute({
    input: input(executablePath),
    expectedConfigurationRevision: null,
  });
  const maia1100 = await save.execute({
    input: maiaInput(executablePath, weights1100Path, 'maia-1100', 1100),
    expectedConfigurationRevision: null,
  });
  await save.execute({
    input: maiaInput(executablePath, weights1900Path, 'maia-1900', 1900),
    expectedConfigurationRevision: null,
  });
  const listed = await repository.list();
  assert.equal(listed.length, 3);
  assert.equal(
    listed.find((provider) => provider.instanceId === 'stockfish-main')
      ?.configurationRevision,
    created.configurationRevision,
  );
  assert.deepEqual(
    listed
      .filter((provider) => provider.providerType === 'maia-chess')
      .map((provider) => ({
        instanceId: provider.instanceId,
        providerType: provider.providerType,
        displayName: provider.displayName,
      })),
    [
      {
        instanceId: 'maia-1100',
        providerType: 'maia-chess',
        displayName: 'Maia 1100',
      },
      {
        instanceId: 'maia-1900',
        providerType: 'maia-chess',
        displayName: 'Maia 1900',
      },
    ],
  );
  const central = JSON.parse(
    await readFile(
      path.join(home, 'configuration', 'active', 'plysmith.json'),
      'utf8',
    ),
  ) as {
    bindings: { analysisEngines: string[]; playoutEngines: string[] };
  };
  assert.deepEqual(central.bindings.analysisEngines, [
    'stockfish-main',
    'maia-1100',
    'maia-1900',
  ]);
  assert.deepEqual(central.bindings.playoutEngines, [
    'stockfish-main',
    'maia-1100',
    'maia-1900',
  ]);

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
    input: { ...input(executablePath), moveTimeMs: 600 },
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

  const remove = new RemoveEngineProviderConfiguration(repository);
  await remove.execute({
    instanceId: 'stockfish-main',
    expectedConfigurationRevision: replaced.configurationRevision,
  });
  await assert.rejects(
    readFile(
      path.join(home, 'configuration', 'active', 'stockfish-main.json'),
      'utf8',
    ),
    hasCode('ENOENT'),
  );

  await rm(weights1100Path);
  await remove.execute({
    instanceId: 'maia-1100',
    expectedConfigurationRevision: maia1100.configurationRevision,
  });
  const afterRemoval = JSON.parse(
    await readFile(
      path.join(home, 'configuration', 'active', 'plysmith.json'),
      'utf8',
    ),
  ) as {
    bindings: { analysisEngines: string[]; playoutEngines: string[] };
  };
  assert.deepEqual(afterRemoval.bindings.analysisEngines, ['maia-1900']);
  assert.deepEqual(afterRemoval.bindings.playoutEngines, ['maia-1900']);
});

test('an engine configuration cannot overwrite another provider document', async (t) => {
  const home = await configuredHome(t);
  const active = path.join(home, 'configuration', 'active');
  const executablePath = path.join(home, 'stockfish.exe');
  const sqlitePath = path.join(active, 'sqlite-main.json');
  const sqliteSource = '{"provider":"sqlite","sentinel":true}\n';
  await writeFile(executablePath, 'fake engine', 'utf8');
  await writeFile(sqlitePath, sqliteSource, 'utf8');
  const repository = new FileEngineProviderConfigurationRepository(home);
  const save = new SaveEngineProviderConfiguration(repository);

  await assert.rejects(
    save.execute({
      input: {
        ...input(executablePath),
        instanceId: 'sqlite-main',
        displayName: 'SQLite Main',
      },
      expectedConfigurationRevision: null,
    }),
    isProblem('configuration.engine_conflict'),
  );

  assert.equal(await readFile(sqlitePath, 'utf8'), sqliteSource);
  const central = JSON.parse(
    await readFile(path.join(active, 'plysmith.json'), 'utf8'),
  ) as {
    bindings: { analysisEngines: string[]; playoutEngines: string[] };
  };
  assert.deepEqual(central.bindings.analysisEngines, []);
  assert.deepEqual(central.bindings.playoutEngines, []);
});

function input(executablePath: string) {
  return {
    instanceId: 'stockfish-main',
    providerType: 'stockfish-uci' as const,
    displayName: 'Stockfish',
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

function maiaInput(
  executablePath: string,
  weightsPath: string,
  instanceId: string,
  elo: number,
) {
  return {
    instanceId,
    providerType: 'maia-chess' as const,
    displayName: `Maia ${elo}`,
    executablePath,
    weightsPath,
    startupTimeoutMs: 30_000,
    moveTimeoutMs: 30_000,
    stopTimeoutMs: 1_000,
    maxOutputBytes: 1_048_576,
  };
}

function isProblem(code: string) {
  return (error: unknown) =>
    error instanceof ApplicationProblem && error.problemCode === code;
}

function hasCode(code: string) {
  return (error: unknown) =>
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code;
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
