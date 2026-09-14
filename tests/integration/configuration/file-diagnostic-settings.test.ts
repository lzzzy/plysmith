import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ApplicationProblem } from '../../../app/application/problems/application-problem.ts';
import { FileDiagnosticSettingsRepository } from '../../../app/infrastructure/adapters/configuration/filesystem/index.ts';

test('diagnostic settings update is atomic and preserves unrelated configuration', async (t) => {
  const home = await configuredHome(t);
  const repository = new FileDiagnosticSettingsRepository(home);
  const before = await repository.read();

  const after = await repository.setLevel({
    level: 'debug',
    expectedConfigurationRevision: before.configurationRevision,
  });

  assert.equal(after.level, 'debug');
  assert.notEqual(after.configurationRevision, before.configurationRevision);
  const central = JSON.parse(
    await readFile(
      path.join(home, 'configuration', 'active', 'plysmith.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;
  assert.deepEqual(central, configuration('debug'));
  assert.deepEqual(
    (
      await readFile(
        path.join(home, 'configuration', 'active', 'sqlite-main.json'),
        'utf8',
      )
    ).trim(),
    '{"untouched":true}',
  );
});

test('stale diagnostic configuration revisions are rejected without changing the file', async (t) => {
  const home = await configuredHome(t);
  const repository = new FileDiagnosticSettingsRepository(home);
  const before = await repository.read();
  await repository.setLevel({
    level: 'error',
    expectedConfigurationRevision: before.configurationRevision,
  });

  await assert.rejects(
    repository.setLevel({
      level: 'info',
      expectedConfigurationRevision: before.configurationRevision,
    }),
    (error: unknown) =>
      error instanceof ApplicationProblem &&
      error.problemCode === 'diagnostics.configuration_conflict',
  );
  assert.equal((await repository.read()).level, 'error');
});

async function configuredHome(t: test.TestContext): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'plysmith-settings-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const active = path.join(home, 'configuration', 'active');
  await mkdir(active, { recursive: true });
  await writeFile(
    path.join(active, 'plysmith.json'),
    `${JSON.stringify(configuration('off'), null, 2)}\n`,
  );
  await writeFile(
    path.join(active, 'sqlite-main.json'),
    '{"untouched":true}\n',
  );
  return home;
}

function configuration(level: 'off' | 'error' | 'info' | 'debug') {
  return {
    schemaVersion: 1,
    diagnostics: { logging: { level } },
    bindings: {
      persistence: 'sqlite-main',
      analysisEngines: [],
      playoutEngines: [],
      liveProviders: [],
    },
  };
}
