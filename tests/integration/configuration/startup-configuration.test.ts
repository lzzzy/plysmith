import assert from 'node:assert/strict';
import {
  link,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { initializeConfiguration } from '../../../app/infrastructure/adapters/configuration/filesystem/initialize-configuration.ts';

const defaultsDirectory = path.resolve('configuration/defaults');
const interruptedWriteFiles = [
  '.engine-settings.lock',
  '.diagnostic-settings.lock',
  '.stockfish-main.json-123-5ee173e3-625a-45d9-bafd-b321903cab17.tmp',
  '.plysmith.json-123-5ee173e3-625a-45d9-bafd-b321903cab17.tmp',
  '.plysmith-123-5ee173e3-625a-45d9-bafd-b321903cab17.tmp',
];

async function fixture(context: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plysmith-startup-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const applicationHome = path.join(root, 'home');
  const options = { applicationHome, defaultsDirectory };
  const { activeDirectory } = await initializeConfiguration(options);
  const central = JSON.parse(
    await readFile(path.join(activeDirectory, 'plysmith.json'), 'utf8'),
  );
  const put = (name: string, value: unknown) =>
    writeFile(path.join(activeDirectory, name), JSON.stringify(value));
  return { root, options, activeDirectory, central, put };
}

for (const invalid of [false, true]) {
  test(`recovers interrupted configuration writes with ${invalid ? 'an invalid' : 'a valid'} active set`, async (context) => {
    const f = await fixture(context);
    f.central.diagnostics.logging.level = 'debug';
    await f.put('plysmith.json', f.central);
    const centralPath = path.join(f.activeDirectory, 'plysmith.json');
    const centralBefore = await readFile(centralPath, 'utf8');
    const sqlitePath = path.join(f.activeDirectory, 'sqlite-main.json');
    const sqliteBefore = await readFile(sqlitePath, 'utf8');
    const envPath = path.join(f.options.applicationHome, '.env');
    await writeFile(envPath, '# retained when valid\n');
    const databasePath = path.join(
      f.options.applicationHome,
      'data',
      'plysmith.db',
    );
    await mkdir(path.dirname(databasePath));
    await writeFile(databasePath, 'preserved user data');
    for (const name of interruptedWriteFiles)
      await writeFile(path.join(f.activeDirectory, name), 'unfinished');
    if (invalid) await writeFile(centralPath, '{');

    assert.equal(
      (await initializeConfiguration(f.options)).status,
      invalid ? 'initialized' : 'already-initialized',
    );
    assert.deepEqual((await readdir(f.activeDirectory)).sort(), [
      'plysmith.json',
      'sqlite-main.json',
    ]);
    assert.equal(
      await readFile(centralPath, 'utf8'),
      invalid
        ? await readFile(path.join(defaultsDirectory, 'plysmith.json'), 'utf8')
        : centralBefore,
    );
    assert.equal(await readFile(sqlitePath, 'utf8'), sqliteBefore);
    assert.equal(await readFile(databasePath, 'utf8'), 'preserved user data');
    if (invalid) await assert.rejects(readFile(envPath), { code: 'ENOENT' });
    else
      assert.equal(await readFile(envPath, 'utf8'), '# retained when valid\n');
    assert.equal(
      (await initializeConfiguration(f.options)).status,
      'already-initialized',
    );
  });
}

for (const unsafe of ['unknown', 'junction', 'hardlink', 'database'] as const) {
  test(`preserves all files when interrupted write cleanup encounters ${unsafe}`, async (context) => {
    const f = await fixture(context);
    const retainedLock = path.join(
      f.activeDirectory,
      '.diagnostic-settings.lock',
    );
    await writeFile(retainedLock, 'retain until every file is checked');
    const outside = path.join(f.root, 'outside');
    await mkdir(outside);
    const outsideFile = path.join(outside, 'keep.json');
    await writeFile(outsideFile, 'untouched');
    const artifact = path.join(f.activeDirectory, interruptedWriteFiles[2]!);
    if (unsafe === 'unknown')
      await writeFile(
        path.join(f.activeDirectory, '.stockfish-main.json-123-not-a-uuid.tmp'),
        'untouched',
      );
    else if (unsafe === 'junction')
      await symlink(outside, artifact, 'junction');
    else if (unsafe === 'hardlink') await link(outsideFile, artifact);
    else {
      await f.put('sqlite-main.json', {
        schemaVersion: 99,
        sqlite: {
          databasePath: 'configuration/active/.diagnostic-settings.lock',
        },
      });
    }
    const before = await readdir(f.activeDirectory);
    await assert.rejects(initializeConfiguration(f.options));
    assert.deepEqual(await readdir(f.activeDirectory), before);
    assert.equal(
      await readFile(retainedLock, 'utf8'),
      'retain until every file is checked',
    );
    assert.equal(await readFile(outsideFile, 'utf8'), 'untouched');
  });
}

for (const damage of [
  'stale-unbound',
  'unknown-unbound',
  'bad-central-sqlite-missing-bound',
  'missing-bound',
  'invalid-bound',
  'invalid-sqlite',
  'live',
  'env',
  'missing-stockfish',
  'missing-maia',
  'bad-sqlite-path',
]) {
  test(`reseeds the entire active set for ${damage} and preserves user data`, async (context) => {
    const f = await fixture(context);
    const preserved = [
      'data/plysmith.db',
      'data/old.db',
      'notes.txt',
      'work-state.json',
      'configuration/schemas/keep.json',
      'configuration/defaults/keep.json',
    ];
    for (const name of preserved) {
      const target = path.join(f.options.applicationHome, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, `preserve:${name}`);
    }
    f.central.diagnostics.logging.level = 'debug';
    if (damage === 'stale-unbound')
      await f.put('stale.json', {
        schemaVersion: 1,
        provider: 'stockfish-uci',
      });
    if (damage === 'unknown-unbound')
      await f.put('old.json', { schemaVersion: 1, provider: 'obsolete' });
    if (damage.includes('missing-bound'))
      f.central.bindings.analysisEngines = ['missing'];
    if (damage === 'invalid-bound') {
      f.central.bindings.playoutEngines = ['broken'];
      await f.put('broken.json', { schemaVersion: 99, provider: 'maia-chess' });
    }
    if (damage === 'invalid-sqlite')
      await f.put('sqlite-main.json', { schemaVersion: 99 });
    if (damage === 'live') f.central.bindings.liveProviders = ['live'];
    if (damage === 'bad-sqlite-path')
      await f.put('sqlite-main.json', {
        schemaVersion: 1,
        provider: 'sqlite',
        enabled: true,
        sqlite: { databasePath: '../outside.db' },
      });
    if (damage === 'missing-stockfish')
      await f.put('engine.json', {
        schemaVersion: 2,
        provider: 'stockfish-uci',
        displayName: 'Engine',
        stockfish: {
          executablePath: path.join(f.root, 'missing.exe'),
          arguments: [],
          threads: 1,
          hashMb: 16,
          detailLevels: { fast: 10, thorough: 20, very_deep: 30 },
          playoutBudget: 'fast',
          startupTimeoutMs: 1000,
          moveTimeoutMs: 1000,
          stopTimeoutMs: 1000,
          maxOutputBytes: 1024,
        },
      });
    if (damage === 'missing-maia')
      await f.put('engine.json', {
        schemaVersion: 1,
        provider: 'maia-chess',
        displayName: 'Maia',
        maia: {
          executablePath: process.execPath,
          weightsPath: path.join(f.root, 'missing.pb'),
          startupTimeoutMs: 1000,
          moveTimeoutMs: 1000,
          stopTimeoutMs: 1000,
          maxOutputBytes: 1024,
        },
      });
    await f.put('plysmith.json', f.central);
    if (damage === 'bad-central-sqlite-missing-bound') {
      await writeFile(path.join(f.activeDirectory, 'plysmith.json'), '{');
      await f.put('sqlite-main.json', { schemaVersion: 99 });
    }
    await writeFile(
      path.join(f.options.applicationHome, '.env'),
      damage === 'env' ? 'SECRET=private-value\n' : '# local secret comment\n',
    );
    assert.equal(
      (await initializeConfiguration(f.options)).status,
      'initialized',
    );
    assert.deepEqual((await readdir(f.activeDirectory)).sort(), [
      'plysmith.json',
      'sqlite-main.json',
    ]);
    for (const name of ['plysmith.json', 'sqlite-main.json']) {
      assert.equal(
        await readFile(path.join(f.activeDirectory, name), 'utf8'),
        await readFile(path.join(defaultsDirectory, name), 'utf8'),
      );
    }
    await assert.rejects(
      readFile(path.join(f.options.applicationHome, '.env')),
      { code: 'ENOENT' },
    );
    for (const name of preserved)
      assert.equal(
        await readFile(path.join(f.options.applicationHome, name), 'utf8'),
        `preserve:${name}`,
      );
  });
}

for (const name of [
  'BadName.json',
  '-provider.json',
  'bad_name.json',
  'stale.unbound.json',
]) {
  test(`reseeds schema-valid unbound ${name} without deleting either database`, async (context) => {
    const f = await fixture(context);
    const provider = {
      schemaVersion: 1,
      provider: 'sqlite',
      enabled: true,
      sqlite: { databasePath: 'data/custom.db' },
    };
    f.central.bindings.persistence = 'custom';
    await f.put('plysmith.json', f.central);
    await f.put('custom.json', provider);
    await f.put(name, provider);
    await mkdir(path.join(f.options.applicationHome, 'data'));
    for (const database of ['plysmith.db', 'custom.db']) {
      await writeFile(
        path.join(f.options.applicationHome, 'data', database),
        `keep:${database}`,
      );
    }

    assert.equal(
      (await initializeConfiguration(f.options)).status,
      'initialized',
    );
    assert.deepEqual((await readdir(f.activeDirectory)).sort(), [
      'plysmith.json',
      'sqlite-main.json',
    ]);
    const central = JSON.parse(
      await readFile(path.join(f.activeDirectory, 'plysmith.json'), 'utf8'),
    );
    const sqlite = JSON.parse(
      await readFile(path.join(f.activeDirectory, 'sqlite-main.json'), 'utf8'),
    );
    assert.equal(central.bindings.persistence, 'sqlite-main');
    assert.equal(sqlite.sqlite.databasePath, 'data/plysmith.db');
    for (const database of ['plysmith.db', 'custom.db']) {
      assert.equal(
        await readFile(
          path.join(f.options.applicationHome, 'data', database),
          'utf8',
        ),
        `keep:${database}`,
      );
    }
  });
}

test('preserves valid customized and unbound configuration byte for byte', async (context) => {
  const f = await fixture(context);
  f.central.diagnostics.logging.level = 'debug';
  f.central.bindings.persistence = '1custom';
  f.central.bindings.analysisEngines = ['stockfish'];
  f.central.bindings.playoutEngines = ['unbound'];
  await f.put('plysmith.json', f.central);
  await f.put('1custom.json', {
    schemaVersion: 1,
    provider: 'sqlite',
    enabled: true,
    sqlite: { databasePath: 'data/custom.db' },
  });
  await f.put('unbound.json', {
    schemaVersion: 1,
    provider: 'maia-chess',
    displayName: 'Valid',
    maia: {
      executablePath: process.execPath,
      weightsPath: process.execPath,
      startupTimeoutMs: 1000,
      moveTimeoutMs: 1000,
      stopTimeoutMs: 1000,
      maxOutputBytes: 1024,
    },
  });
  await f.put('stockfish.json', {
    schemaVersion: 2,
    provider: 'stockfish-uci',
    displayName: 'Valid',
    stockfish: {
      executablePath: process.execPath,
      arguments: [],
      threads: 1,
      hashMb: 16,
      detailLevels: { fast: 10, thorough: 20, very_deep: 30 },
      playoutBudget: 'fast',
      startupTimeoutMs: 1000,
      moveTimeoutMs: 1000,
      stopTimeoutMs: 1000,
      maxOutputBytes: 1024,
    },
  });
  await writeFile(path.join(f.options.applicationHome, '.env'), '# comment\n');
  const before = await Promise.all(
    (await readdir(f.activeDirectory)).map(
      async (name) =>
        [
          name,
          await readFile(path.join(f.activeDirectory, name), 'utf8'),
        ] as const,
    ),
  );
  assert.equal(
    (await initializeConfiguration(f.options)).status,
    'already-initialized',
  );
  for (const [name, source] of before)
    assert.equal(
      await readFile(path.join(f.activeDirectory, name), 'utf8'),
      source,
    );
  assert.equal(
    await readFile(path.join(f.options.applicationHome, '.env'), 'utf8'),
    '# comment\n',
  );
});

test('invalid defaults cannot remove active configuration or secrets', async (context) => {
  const f = await fixture(context);
  const badDefaults = path.join(f.root, 'defaults');
  await mkdir(badDefaults);
  await writeFile(path.join(badDefaults, 'plysmith.json'), '{}');
  await writeFile(path.join(badDefaults, 'sqlite-main.json'), '{}');
  await writeFile(path.join(f.activeDirectory, 'plysmith.json'), '{');
  await writeFile(path.join(f.options.applicationHome, '.env'), 'SECRET=keep');
  const interruptedLock = path.join(f.activeDirectory, '.engine-settings.lock');
  await writeFile(interruptedLock, 'preserved with invalid defaults');
  await assert.rejects(
    initializeConfiguration({ ...f.options, defaultsDirectory: badDefaults }),
  );
  assert.equal(
    await readFile(path.join(f.activeDirectory, 'plysmith.json'), 'utf8'),
    '{',
  );
  assert.equal(
    await readFile(path.join(f.options.applicationHome, '.env'), 'utf8'),
    'SECRET=keep',
  );
  assert.equal(
    await readFile(interruptedLock, 'utf8'),
    'preserved with invalid defaults',
  );
});

for (const link of ['configuration', 'active', 'nested']) {
  test(`refuses ${link} junction without touching its target`, async (context) => {
    const f = await fixture(context);
    const outside = path.join(f.root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'keep.json'), 'untouched');
    const target =
      link === 'configuration'
        ? path.dirname(f.activeDirectory)
        : link === 'active'
          ? f.activeDirectory
          : path.join(f.activeDirectory, 'linked');
    await rm(target, { recursive: true, force: true });
    await symlink(outside, target, 'junction');
    await assert.rejects(initializeConfiguration(f.options));
    assert.equal(
      await readFile(path.join(outside, 'keep.json'), 'utf8'),
      'untouched',
    );
  });
}

test('refuses data files inside active and relative application homes', async (context) => {
  const f = await fixture(context);
  await writeFile(path.join(f.activeDirectory, 'database.db'), 'untouched');
  await writeFile(path.join(f.activeDirectory, 'plysmith.json'), '{');
  await assert.rejects(initializeConfiguration(f.options));
  assert.equal(
    await readFile(path.join(f.activeDirectory, 'database.db'), 'utf8'),
    'untouched',
  );
  await assert.rejects(
    initializeConfiguration({ ...f.options, applicationHome: '.' }),
  );
});

test('guards database paths even in malformed provider documents', async (context) => {
  const f = await fixture(context);
  await f.put('sqlite-main.json', {
    schemaVersion: 99,
    sqlite: { databasePath: 'configuration/active/saved.json' },
  });
  await writeFile(path.join(f.activeDirectory, 'saved.json'), 'database bytes');
  await assert.rejects(initializeConfiguration(f.options), /database path/u);
  assert.equal(
    await readFile(path.join(f.activeDirectory, 'saved.json'), 'utf8'),
    'database bytes',
  );
});

test('refuses env junctions and overlapping defaults without removal', async (context) => {
  const f = await fixture(context);
  await writeFile(path.join(f.activeDirectory, 'plysmith.json'), '{');
  await assert.rejects(
    initializeConfiguration({
      ...f.options,
      defaultsDirectory: f.activeDirectory,
    }),
  );
  await symlink(
    f.activeDirectory,
    path.join(f.options.applicationHome, '.env'),
    'junction',
  );
  await assert.rejects(initializeConfiguration(f.options));
  assert.equal(
    await readFile(path.join(f.activeDirectory, 'plysmith.json'), 'utf8'),
    '{',
  );
});
