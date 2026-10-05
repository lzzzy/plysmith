import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  ConfigurationProblem,
  initializeConfiguration,
  loadCentralConfiguration,
  loadConfiguration,
} from '../../../app/infrastructure/adapters/configuration/filesystem/index.ts';

const defaultsDirectory = path.resolve('configuration', 'defaults');

test('loads an immutable runtime snapshot with a managed database path', async (context) => {
  const applicationHome = await createApplicationHome(context);
  await initializeConfiguration({ applicationHome, defaultsDirectory });

  const runtime = await loadConfiguration(applicationHome);

  assert.equal(runtime.persistence.instanceId, 'sqlite-main');
  assert.equal(
    runtime.persistence.databasePath,
    path.join(applicationHome, 'data', 'plysmith.db'),
  );
  assert.ok(Object.isFrozen(runtime.central));
  assert.ok(Object.isFrozen(runtime.central.bindings));
  assert.ok(Object.isFrozen(runtime.central.bindings.analysisEngines));
  assert.equal(runtime.central.diagnostics.logging.level, 'off');
});

test('loads central diagnostics without requiring a persistence provider', async (context) => {
  const applicationHome = await createApplicationHome(context);
  await initializeConfiguration({ applicationHome, defaultsDirectory });
  await rm(
    path.join(applicationHome, 'configuration', 'active', 'sqlite-main.json'),
  );

  const central = await loadCentralConfiguration(applicationHome);

  assert.equal(central.diagnostics.logging.level, 'off');
  assert.ok(Object.isFrozen(central));
});

test('loads Stockfish and Maia playout instances and isolates invalid optional providers', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const initialized = await initializeConfiguration({
    applicationHome,
    defaultsDirectory,
  });
  const centralPath = path.join(initialized.activeDirectory, 'plysmith.json');
  const executablePath = path.join(applicationHome, 'stockfish.exe');
  const weightsPath = path.join(applicationHome, 'maia-1500.pb.gz');
  await writeFile(executablePath, 'fake stockfish', 'utf8');
  await writeFile(weightsPath, 'fake Maia weights', 'utf8');
  const central = JSON.parse(await readFile(centralPath, 'utf8')) as {
    bindings: { playoutEngines: string[] };
  };
  central.bindings.playoutEngines = [
    'stockfish-main',
    'maia-1500',
    'broken-engine',
  ];
  await writeFile(centralPath, `${JSON.stringify(central)}\n`, 'utf8');
  await writeFile(
    path.join(initialized.activeDirectory, 'maia-1500.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      provider: 'maia-chess',
      displayName: 'Maia 1500',
      maia: {
        executablePath,
        weightsPath,
        startupTimeoutMs: 30_000,
        moveTimeoutMs: 30_000,
        stopTimeoutMs: 1_000,
        maxOutputBytes: 1_048_576,
      },
    })}\n`,
    'utf8',
  );
  await writeFile(
    path.join(initialized.activeDirectory, 'stockfish-main.json'),
    `${JSON.stringify({
      schemaVersion: 2,
      provider: 'stockfish-uci',
      displayName: 'Stockfish',
      stockfish: {
        executablePath,
        arguments: [],
        threads: 1,
        hashMb: 64,
        detailLevels: { fast: 250, thorough: 1_500, very_deep: 5_000 },
        playoutBudget: 'fast',
        startupTimeoutMs: 2_000,
        moveTimeoutMs: 3_000,
        stopTimeoutMs: 500,
        maxOutputBytes: 262_144,
      },
    })}\n`,
    'utf8',
  );
  await writeFile(
    path.join(initialized.activeDirectory, 'broken-engine.json'),
    '{}\n',
    'utf8',
  );

  const runtime = await loadConfiguration(applicationHome);

  assert.deepEqual(
    runtime.playoutEngines.map((entry) => [entry.instanceId, entry.status]),
    [
      ['stockfish-main', 'available'],
      ['maia-1500', 'available'],
      ['broken-engine', 'unavailable'],
    ],
  );
  assert.ok(Object.isFrozen(runtime.playoutEngines));
  const stockfish = runtime.playoutEngines[0];
  assert.ok(stockfish?.provider === 'stockfish-uci');
  assert.ok(Object.isFrozen(stockfish.configuration.stockfish.detailLevels));
  assert.equal(runtime.playoutEngines[1]?.provider, 'maia-chess');

  await writeFile(executablePath, 'replaced stockfish', 'utf8');
  const changedBinary = await loadConfiguration(applicationHome);
  assert.equal(changedBinary.playoutEngines[0]?.status, 'available');

  await writeFile(weightsPath, 'replaced Maia weights', 'utf8');
  const changedWeights = await loadConfiguration(applicationHome);
  assert.equal(changedWeights.playoutEngines[1]?.status, 'available');

  const stockfishPath = path.join(
    initialized.activeDirectory,
    'stockfish-main.json',
  );
  const original = JSON.parse(await readFile(stockfishPath, 'utf8'));
  original.schemaVersion = 1;
  original.stockfish.moveTimeMs = 5_000;
  delete original.stockfish.detailLevels;
  delete original.stockfish.playoutBudget;
  const incompatible = `${JSON.stringify(original)}\n`;
  await writeFile(stockfishPath, incompatible, 'utf8');
  const withoutStockfish = await loadConfiguration(applicationHome);
  assert.deepEqual(withoutStockfish.playoutEngines[0], {
    instanceId: 'stockfish-main',
    provider: 'unknown',
    status: 'unavailable',
    problemCode: 'configuration.provider_invalid',
  });
  assert.equal(withoutStockfish.playoutEngines[1]?.status, 'available');
  assert.equal(await readFile(stockfishPath, 'utf8'), incompatible);
});

test('reports a missing active configuration without seeding it', async (context) => {
  const applicationHome = await createApplicationHome(context);

  await assert.rejects(
    loadConfiguration(applicationHome),
    hasConfigurationCode('configuration.active_missing'),
  );
});

test('does not repair an invalid active central document', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const activeDirectory = path.join(applicationHome, 'configuration', 'active');
  await mkdir(activeDirectory, { recursive: true });
  await writeFile(
    path.join(activeDirectory, 'plysmith.json'),
    'invalid',
    'utf8',
  );

  await assert.rejects(
    loadConfiguration(applicationHome),
    hasConfigurationCode('configuration.central_invalid'),
  );
  assert.equal(
    await readFile(path.join(activeDirectory, 'plysmith.json'), 'utf8'),
    'invalid',
  );
});

test('rejects a database path outside the application home', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const result = await initializeConfiguration({
    applicationHome,
    defaultsDirectory,
  });
  const providerPath = path.join(result.activeDirectory, 'sqlite-main.json');
  const provider = JSON.parse(await readFile(providerPath, 'utf8')) as {
    sqlite: { databasePath: string };
  };
  provider.sqlite.databasePath = '../outside.db';
  await writeFile(providerPath, `${JSON.stringify(provider)}\n`, 'utf8');

  await assert.rejects(
    loadConfiguration(applicationHome),
    hasConfigurationCode('configuration.persistence_path_invalid'),
  );
});

function hasConfigurationCode(code: string): (error: unknown) => boolean {
  return (error) =>
    error instanceof ConfigurationProblem && error.code === code;
}

async function createApplicationHome(context: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'plysmith-loader-'));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
