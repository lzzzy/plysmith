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
