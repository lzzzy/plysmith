import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { initializeConfiguration } from '../../../app/infrastructure/adapters/configuration/filesystem/index.ts';

const defaultsDirectory = path.resolve('configuration', 'defaults');

test('publishes the complete default set once', async (context) => {
  const applicationHome = await createApplicationHome(context);

  const first = await initializeConfiguration({
    applicationHome,
    defaultsDirectory,
  });
  const firstPlysmith = await readFile(
    path.join(first.activeDirectory, 'plysmith.json'),
    'utf8',
  );

  const second = await initializeConfiguration({
    applicationHome,
    defaultsDirectory,
  });
  const secondPlysmith = await readFile(
    path.join(second.activeDirectory, 'plysmith.json'),
    'utf8',
  );

  assert.equal(first.status, 'initialized');
  assert.equal(second.status, 'already-initialized');
  assert.equal(secondPlysmith, firstPlysmith);
  assert.equal(JSON.parse(firstPlysmith).bindings.persistence, 'sqlite-main');
  assert.equal(
    JSON.parse(
      await readFile(
        path.join(first.activeDirectory, 'sqlite-main.json'),
        'utf8',
      ),
    ).provider,
    'sqlite',
  );
});

test('never overwrites an existing active path', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const activeDirectory = path.join(applicationHome, 'configuration', 'active');
  await mkdir(activeDirectory, { recursive: true });
  await writeFile(
    path.join(activeDirectory, 'plysmith.json'),
    'invalid',
    'utf8',
  );

  const result = await initializeConfiguration({
    applicationHome,
    defaultsDirectory,
  });

  assert.equal(result.status, 'already-initialized');
  assert.equal(
    await readFile(path.join(activeDirectory, 'plysmith.json'), 'utf8'),
    'invalid',
  );
});

test('ignores an unpublished staging directory', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const abandoned = path.join(
    applicationHome,
    'configuration',
    '.staging-abandoned',
  );
  await mkdir(abandoned, { recursive: true });
  await writeFile(path.join(abandoned, 'plysmith.json'), '{', 'utf8');

  const result = await initializeConfiguration({
    applicationHome,
    defaultsDirectory,
  });

  assert.equal(result.status, 'initialized');
  assert.equal(
    await readFile(path.join(abandoned, 'plysmith.json'), 'utf8'),
    '{',
  );
});

test('concurrent initializers publish one complete active set', async (context) => {
  const applicationHome = await createApplicationHome(context);

  const results = await Promise.all([
    initializeConfiguration({ applicationHome, defaultsDirectory }),
    initializeConfiguration({ applicationHome, defaultsDirectory }),
  ]);

  assert.deepEqual(results.map(({ status }) => status).sort(), [
    'already-initialized',
    'initialized',
  ]);
  await Promise.all([
    readFile(
      path.join(applicationHome, 'configuration', 'active', 'plysmith.json'),
      'utf8',
    ),
    readFile(
      path.join(applicationHome, 'configuration', 'active', 'sqlite-main.json'),
      'utf8',
    ),
  ]);
});

async function createApplicationHome(context: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'plysmith-config-'));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
