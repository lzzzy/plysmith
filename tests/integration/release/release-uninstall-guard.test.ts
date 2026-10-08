import assert from 'node:assert/strict';
import childProcess, {
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  lstat,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import {
  resolveOwnedInstallation,
  snapshotPreservedFiles,
  verifyRunningInstallationRefusal,
} from '../../../tools/verify-release-uninstall-guard.ts';

async function createOwnedRoot(context: TestContext): Promise<string> {
  const root = path.join(os.tmpdir(), `plysmith release-${randomUUID()}`);
  await mkdir(root);
  context.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.equal((await lstat(root)).isSymbolicLink(), false);
    await rm(root, { recursive: true, force: true });
  });
  return realpath(root);
}

async function createPreservedFiles(context: TestContext): Promise<string> {
  const home = await createOwnedRoot(context);
  await mkdir(path.join(home, 'data'));
  await mkdir(path.join(home, 'configuration', 'active'), { recursive: true });
  for (const relative of [
    'data/plysmith.db',
    'configuration/active/plysmith.json',
    'configuration/active/sqlite-main.json',
    '.env',
  ]) {
    await writeFile(path.join(home, relative), 'before');
  }
  return home;
}

test('uninstall verification rejects implicit, relative, unowned and repository targets', async () => {
  await assert.rejects(
    resolveOwnedInstallation(undefined),
    /explicit absolute/,
  );
  await assert.rejects(
    resolveOwnedInstallation('installed'),
    /explicit absolute/,
  );
  await assert.rejects(
    resolveOwnedInstallation(path.join(os.tmpdir(), 'Plysmith')),
    /owned UUID/,
  );
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  await assert.rejects(
    resolveOwnedInstallation(
      path.join(repositoryRoot, `release-${randomUUID()}`, 'installed'),
    ),
    /outside the repository/,
  );
});

test('uninstall verification accepts an exact owned installation with spaces in its path', async (context) => {
  const root = await createOwnedRoot(context);
  const installed = path.join(root, 'installed');
  await mkdir(installed);
  assert.equal(await resolveOwnedInstallation(installed), installed);
});

test('uninstall verification rejects an installation redirected by a junction', async (context) => {
  const root = await createOwnedRoot(context);
  const actual = path.join(root, 'actual');
  const installed = path.join(root, 'installed');
  await mkdir(actual);
  await symlink(actual, installed, 'junction');
  await assert.rejects(
    resolveOwnedInstallation(installed),
    /symlinks or junctions/,
  );
});

test('preservation snapshots include database sidecars, all configuration and optional env bytes', async (context) => {
  const home = await createPreservedFiles(context);
  const wal = Buffer.from([0, 1, 2, 255]);
  await writeFile(path.join(home, 'data', 'plysmith.db-wal'), wal);
  await writeFile(path.join(home, 'data', 'plysmith.db-shm'), 'shared memory');
  await writeFile(path.join(home, 'configuration', 'retained.json'), '{}');
  const snapshot = await snapshotPreservedFiles(home);
  assert.equal(
    snapshot['data/plysmith.db-wal'],
    createHash('sha256').update(wal).digest('hex'),
  );
  assert.equal(
    snapshot['configuration/active/plysmith.json'],
    createHash('sha256').update('before').digest('hex'),
  );
  assert.ok(snapshot['data/plysmith.db']);
  assert.equal(
    snapshot['data/plysmith.db-shm'],
    createHash('sha256').update('shared memory').digest('hex'),
  );
  assert.ok(snapshot['configuration/active/sqlite-main.json']);
  assert.equal(
    snapshot['configuration/retained.json'],
    createHash('sha256').update('{}').digest('hex'),
  );
  assert.ok(snapshot['.env']);
  assert.deepEqual(await snapshotPreservedFiles(home), snapshot);
});

test('preservation snapshots detect data changes even when the incompatible schema marker is unchanged', async (context) => {
  const home = await createPreservedFiles(context);
  const file = path.join(home, 'data', 'plysmith.db');
  await rm(file);
  const database = new Database(file);
  try {
    database.exec(
      'CREATE TABLE runtime_store_state (schema_version INTEGER);' +
        'INSERT INTO runtime_store_state VALUES (999);' +
        'CREATE TABLE retained_data (body TEXT);' +
        "INSERT INTO retained_data VALUES ('before');",
    );
  } finally {
    database.close();
  }
  const before = await snapshotPreservedFiles(home);
  assert.deepEqual(await snapshotPreservedFiles(home), before);
  const changed = new Database(file);
  try {
    changed.prepare('UPDATE retained_data SET body = ?').run('after!');
  } finally {
    changed.close();
  }
  assert.notDeepEqual(await snapshotPreservedFiles(home), before);
  const preserved = new Database(file, { readonly: true });
  try {
    assert.equal(
      preserved
        .prepare('SELECT schema_version FROM runtime_store_state')
        .pluck()
        .get(),
      999,
    );
  } finally {
    preserved.close();
  }
});

test('preservation snapshots detect changed, removed and newly created database sidecars', async (context) => {
  const home = await createPreservedFiles(context);
  const withoutSidecars = await snapshotPreservedFiles(home);
  for (const name of ['plysmith.db-wal', 'plysmith.db-shm']) {
    const file = path.join(home, 'data', name);
    await writeFile(file, 'before');
    const before = await snapshotPreservedFiles(home);
    assert.notDeepEqual(before, withoutSidecars);
    await writeFile(file, 'after!');
    assert.notDeepEqual(await snapshotPreservedFiles(home), before);
    await rm(file);
    assert.notDeepEqual(await snapshotPreservedFiles(home), before);
    assert.deepEqual(await snapshotPreservedFiles(home), withoutSidecars);
  }
});

test('preservation snapshots detect same-length changes and added or removed files', async (context) => {
  const home = await createPreservedFiles(context);
  const before = await snapshotPreservedFiles(home);
  for (const relative of [
    'data/plysmith.db',
    'configuration/active/plysmith.json',
    '.env',
  ]) {
    const file = path.join(home, relative);
    await writeFile(file, 'after!');
    assert.notDeepEqual(await snapshotPreservedFiles(home), before, relative);
    await writeFile(file, 'before');
    assert.deepEqual(await snapshotPreservedFiles(home), before);
  }
  const extra = path.join(home, 'configuration', 'active', 'extra.json');
  await writeFile(extra, '{}');
  assert.notDeepEqual(await snapshotPreservedFiles(home), before);
  await rm(extra);
  await rm(path.join(home, '.env'));
  assert.notDeepEqual(await snapshotPreservedFiles(home), before);
  await rm(path.join(home, 'data', 'plysmith.db'));
  await assert.rejects(snapshotPreservedFiles(home), { code: 'ENOENT' });
});

test('preservation snapshots reject redirected data instead of hashing another directory', async (context) => {
  const home = await createPreservedFiles(context);
  const data = path.join(home, 'data');
  await rm(data, { recursive: true });
  await symlink(path.join(home, 'configuration', 'active'), data, 'junction');
  await writeFile(
    path.join(home, 'configuration', 'active', 'plysmith.db'),
    'before',
  );
  await assert.rejects(snapshotPreservedFiles(home), /symlinks or junctions/);
});

async function createRefusalFixture(context: TestContext) {
  const root = await createOwnedRoot(context);
  const installed = path.join(root, 'installed');
  await mkdir(path.join(installed, 'resources', 'runtime'), {
    recursive: true,
  });
  const installSnapshot: Record<string, string> = {};
  for (const relative of [
    'Plysmith.exe',
    'Uninstall Plysmith.exe',
    'resources/product-manifest.json',
    'resources/runtime/node.exe',
  ]) {
    await writeFile(path.join(installed, relative), 'before');
    installSnapshot[relative] = createHash('sha256')
      .update('before')
      .digest('hex');
  }
  return {
    installed,
    installer: path.join(root, 'Setup.exe'),
    uninstallProbe: path.join(root, 'uninstall-probe.exe'),
    installSnapshot,
  };
}

function stubNsis(
  context: TestContext,
  complete: (index: number) => Promise<{
    code: number | null;
    signal?: NodeJS.Signals;
    killed?: boolean;
  }>,
) {
  const launches: {
    file: string;
    args: readonly string[];
    options: SpawnOptions;
  }[] = [];
  const spawn = context.mock.method(
    childProcess,
    'spawn',
    (file: string, args: readonly string[], options: SpawnOptions) => {
      const index = launches.length;
      launches.push({ file, args, options });
      const child = Object.assign(new EventEmitter(), { killed: false });
      void Promise.resolve()
        .then(async () => {
          const result = await complete(index);
          child.killed = result.killed ?? false;
          child.emit('close', result.code, result.signal ?? null);
        })
        .catch((error: unknown) => child.emit('error', error));
      return child as ChildProcess;
    },
  );
  syncBuiltinESMExports();
  context.after(() => {
    spawn.mock.restore();
    syncBuiltinESMExports();
  });
  return launches;
}

for (const uninstallExit of [0, 1]) {
  test(`running-installation checks accept uninstall refusal exit ${uninstallExit} only with preserved bytes and live owners`, async (context) => {
    const fixture = await createRefusalFixture(context);
    const launches = stubNsis(context, async (index) => ({
      code: index === 0 ? 1 : uninstallExit,
    }));
    let aliveChecks = 0;
    await verifyRunningInstallationRefusal({
      ...fixture,
      assertOwnedProcessesAlive: () => {
        aliveChecks++;
      },
    });
    assert.equal(aliveChecks, 3);
    assert.deepEqual(
      launches.map(({ file, args }) => ({ file, args })),
      [
        {
          file: fixture.installer,
          args: ['/S', '/currentuser', `/D=${fixture.installed}`],
        },
        {
          file: fixture.uninstallProbe,
          args: ['/S', '/currentuser', `_?=${fixture.installed}`],
        },
      ],
    );
    for (const launch of launches) {
      assert.equal(launch.options.windowsHide, true);
      assert.equal(launch.options.windowsVerbatimArguments, true);
      assert.equal(launch.options.argv0, `"${launch.file}"`);
      assert.equal(launch.options.timeout, 30_000);
    }
  });
}

test('running-installation checks reject a successful installer before attempting uninstall', async (context) => {
  const fixture = await createRefusalFixture(context);
  const launches = stubNsis(context, async () => ({ code: 0 }));
  await assert.rejects(
    verifyRunningInstallationRefusal({
      ...fixture,
      assertOwnedProcessesAlive: () => undefined,
    }),
    /installer must refuse/,
  );
  assert.equal(launches.length, 1);
});

for (const modifiedDuring of [0, 1]) {
  test(`running-installation checks reject changed installation bytes after command ${modifiedDuring + 1}`, async (context) => {
    const fixture = await createRefusalFixture(context);
    const launches = stubNsis(context, async (index) => {
      if (index === modifiedDuring)
        await writeFile(
          path.join(fixture.installed, 'resources', 'runtime', 'node.exe'),
          'after!',
        );
      return { code: index === 0 ? 1 : 0 };
    });
    await assert.rejects(
      verifyRunningInstallationRefusal({
        ...fixture,
        assertOwnedProcessesAlive: () => undefined,
      }),
      { code: 'ERR_ASSERTION' },
    );
    assert.equal(launches.length, modifiedDuring + 1);
  });
}

test('running-installation checks fail when an owner exits during refusal', async (context) => {
  const fixture = await createRefusalFixture(context);
  const launches = stubNsis(context, async () => ({ code: 1 }));
  const stopped = new Error('Owned Host exited');
  let aliveChecks = 0;
  await assert.rejects(
    verifyRunningInstallationRefusal({
      ...fixture,
      assertOwnedProcessesAlive: () => {
        if (++aliveChecks === 2) throw stopped;
      },
    }),
    (error: unknown) => error === stopped,
  );
  assert.equal(launches.length, 1);
});

test('running-installation checks do not launch an unspecified installer', async (context) => {
  const fixture = await createRefusalFixture(context);
  const launches = stubNsis(context, async () => ({ code: 0 }));
  let aliveChecks = 0;
  await verifyRunningInstallationRefusal({
    ...fixture,
    installer: undefined,
    assertOwnedProcessesAlive: () => {
      aliveChecks++;
    },
  });
  assert.equal(aliveChecks, 2);
  assert.deepEqual(
    launches.map(({ file }) => file),
    [fixture.uninstallProbe],
  );
});

for (const outcome of [
  { code: null },
  { code: 1, signal: 'SIGTERM' as const },
  { code: 1, killed: true },
]) {
  test(`running-installation checks reject abnormal NSIS exit ${JSON.stringify(outcome)}`, async (context) => {
    const fixture = await createRefusalFixture(context);
    const launches = stubNsis(context, async () => outcome);
    await assert.rejects(
      verifyRunningInstallationRefusal({
        ...fixture,
        assertOwnedProcessesAlive: () => undefined,
      }),
      /NSIS did not exit normally/,
    );
    assert.equal(launches.length, 1);
  });
}
