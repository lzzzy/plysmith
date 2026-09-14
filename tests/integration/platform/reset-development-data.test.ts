import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';

import { acquireDevelopmentWatchLease } from '../../../app/infrastructure/adapters/platform/windows/index.ts';
import { resetDevelopmentData } from '../../../tools/reset-development-data.ts';

async function developmentHome(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'plysmith-reset-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'configuration', 'defaults'), {
    recursive: true,
  });
  await mkdir(path.join(root, 'configuration', 'active'), { recursive: true });
  await mkdir(path.join(root, 'data'), { recursive: true });
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'plysmith', private: true }),
  );
  await writeFile(
    path.join(root, 'configuration', 'defaults', 'plysmith.json'),
    '{}',
  );
  return root;
}

test('removes only development database files and keeps configuration', async (t) => {
  const root = await developmentHome(t);
  for (const fileName of [
    'plysmith.db',
    'plysmith.db-wal',
    'plysmith.db-shm',
    'future-asset.bin',
  ]) {
    await writeFile(path.join(root, 'data', fileName), fileName);
  }
  await writeFile(
    path.join(root, 'configuration', 'active', 'plysmith.json'),
    '{}',
  );
  await writeFile(path.join(root, '.env'), 'PLYSMITH_TEST=value\n');
  let hostReleased = false;
  let watchReleased = false;

  const removed = await resetDevelopmentData({
    applicationHome: root,
    acquireWatchLease: async () => ({
      release: async () => {
        watchReleased = true;
      },
    }),
    acquireHostLease: async () => ({
      release: async () => {
        hostReleased = true;
      },
    }),
  });

  assert.deepEqual(removed, [
    path.join('data', 'plysmith.db'),
    path.join('data', 'plysmith.db-wal'),
    path.join('data', 'plysmith.db-shm'),
  ]);
  assert.equal(hostReleased, true);
  assert.equal(watchReleased, true);
  assert.equal(
    await readFile(path.join(root, 'data', 'future-asset.bin'), 'utf8'),
    'future-asset.bin',
  );
  assert.equal(
    await readFile(
      path.join(root, 'configuration', 'active', 'plysmith.json'),
      'utf8',
    ),
    '{}',
  );
  assert.equal(
    await readFile(path.join(root, '.env'), 'utf8'),
    'PLYSMITH_TEST=value\n',
  );
});

test('keeps all database files when the watch lease is unavailable', async (t) => {
  const root = await developmentHome(t);
  const databasePath = path.join(root, 'data', 'plysmith.db');
  await writeFile(databasePath, 'still here');
  let hostLeaseRequested = false;

  await assert.rejects(
    resetDevelopmentData({
      applicationHome: root,
      acquireWatchLease: async () => {
        throw new Error('host.already_running');
      },
      acquireHostLease: async () => {
        hostLeaseRequested = true;
        return { release: async () => undefined };
      },
    }),
    /host\.already_running/,
  );
  assert.equal(hostLeaseRequested, false);
  assert.equal(await readFile(databasePath, 'utf8'), 'still here');
});

test('refuses reset while a real development watch lease is active', async (t) => {
  const root = await developmentHome(t);
  const databasePath = path.join(root, 'data', 'plysmith.db');
  await writeFile(databasePath, 'still here');
  const watchLease = await acquireDevelopmentWatchLease(root);
  t.after(() => watchLease.release());

  await assert.rejects(
    resetDevelopmentData({ applicationHome: root }),
    /host\.already_running/,
  );
  assert.equal(await readFile(databasePath, 'utf8'), 'still here');
});

test('releases the watch lease when the host lease is unavailable', async (t) => {
  const root = await developmentHome(t);
  const databasePath = path.join(root, 'data', 'plysmith.db');
  await writeFile(databasePath, 'still here');
  let watchReleased = false;

  await assert.rejects(
    resetDevelopmentData({
      applicationHome: root,
      acquireWatchLease: async () => ({
        release: async () => {
          watchReleased = true;
        },
      }),
      acquireHostLease: async () => {
        throw new Error('host.already_running');
      },
    }),
    /host\.already_running/,
  );
  assert.equal(watchReleased, true);
  assert.equal(await readFile(databasePath, 'utf8'), 'still here');
});

test('refuses a directory that is not the Plysmith development home', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'not-plysmith-reset-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    resetDevelopmentData({
      applicationHome: root,
      acquireWatchLease: async () => ({ release: async () => undefined }),
      acquireHostLease: async () => ({ release: async () => undefined }),
    }),
    /Plysmith repository root/,
  );
});
