import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  link,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import filesystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
  GetLiveProviderConfiguration,
  SaveLiveProviderConfiguration,
} from '../../../app/application/live/live-provider-configuration.ts';
import {
  FileLiveProviderConfigurationRepository,
  initializeConfiguration,
  loadConfiguration,
  loadLichessToken,
} from '../../../app/infrastructure/adapters/configuration/filesystem/index.ts';
import { LICHESS_TOKEN_ENVIRONMENT_VARIABLE } from '../../../contracts/host/live-provider-configuration.ts';

const token = 'lip_isolated-canary-token';
const replacement = 'lip_replacement-canary-token';
const defaultsDirectory = path.resolve('configuration/defaults');

async function fixture(context: TestContext) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'plysmith-live-config-'));
  context.after(() => rm(home, { recursive: true, force: true }));
  const options = { applicationHome: home, defaultsDirectory };
  const { activeDirectory } = await initializeConfiguration(options);
  const repository = new FileLiveProviderConfigurationRepository(home);
  return {
    home,
    options,
    activeDirectory,
    repository,
    envPath: path.join(home, '.env'),
    providerPath: path.join(activeDirectory, 'lichess-main.json'),
  };
}

test('first setup and token replacement expose only restart-bound metadata', async (context) => {
  const f = await fixture(context);
  const initial = await loadConfiguration(f.home);
  assert.deepEqual(initial.liveProviders, []);
  assert.deepEqual(await f.repository.get(), {
    configured: false,
    tokenConfigured: false,
    configurationRevision: null,
  });
  const read = new GetLiveProviderConfiguration({
    repository: f.repository,
    activeConfigurationRevision: null,
  });
  const save = new SaveLiveProviderConfiguration(f.repository);
  const result = await save.execute({
    token,
    expectedConfigurationRevision: null,
  });
  assert.deepEqual(Object.keys(result).sort(), [
    'configurationRevision',
    'configured',
    'restartRequired',
    'tokenConfigured',
  ]);
  assert.equal(result.restartRequired, true);
  assert.equal((await read.execute()).restartRequired, true);
  assert.deepEqual(initial.liveProviders, []);
  assert.equal(await loadLichessToken(f.home), token);
  assert.equal(
    (await initializeConfiguration(f.options)).status,
    'already-initialized',
  );
  const runtime = await loadConfiguration(f.home);
  assert.equal(runtime.liveProviders[0]?.status, 'available');
  assert.ok(Object.isFrozen(runtime.liveProviders));
  const provider = runtime.liveProviders[0];
  assert.ok(provider?.provider === 'lichess');
  assert.ok(Object.isFrozen(provider.configuration.lichess));
  const restarted = new GetLiveProviderConfiguration({
    repository: f.repository,
    activeConfigurationRevision: provider.configuration.configurationRevision,
  });
  assert.equal((await restarted.execute()).restartRequired, false);
  const next = await save.execute({
    token: replacement,
    expectedConfigurationRevision: result.configurationRevision,
  });
  assert.notEqual(next.configurationRevision, result.configurationRevision);
  assert.equal(await loadLichessToken(f.home), replacement);
  assert.equal((await restarted.execute()).restartRequired, true);
  const publicContent =
    JSON.stringify([result, next, runtime, await f.repository.get()]) +
    (await readFile(f.providerPath, 'utf8'));
  assert.ok(!publicContent.includes(token));
  assert.ok(!publicContent.includes(replacement));
  assert.deepEqual((await readdir(f.activeDirectory)).sort(), [
    'lichess-main.json',
    'plysmith.json',
    'sqlite-main.json',
  ]);
});

test('missing and empty token keep valid settings but make the live provider unavailable', async (context) => {
  const f = await fixture(context);
  await f.repository.save({ token, expectedConfigurationRevision: null });
  for (const source of [
    undefined,
    '# token not configured\n',
    `${LICHESS_TOKEN_ENVIRONMENT_VARIABLE}=\n`,
  ]) {
    await rm(f.envPath, { force: true });
    if (source !== undefined) await writeFile(f.envPath, source);
    assert.equal(
      (await initializeConfiguration(f.options)).status,
      'already-initialized',
    );
    const runtime = await loadConfiguration(f.home);
    assert.equal(runtime.liveProviders[0]?.status, 'unavailable');
    assert.equal(
      runtime.liveProviders[0]?.problemCode,
      'configuration.live_token_missing',
    );
    assert.equal((await f.repository.get()).tokenConfigured, false);
    assert.equal(await loadLichessToken(f.home), undefined);
  }
});

test('stale revisions and overlapping configuration writers cannot overwrite secrets', async (context) => {
  const f = await fixture(context);
  const current = await f.repository.save({
    token,
    expectedConfigurationRevision: null,
  });
  await assert.rejects(
    f.repository.save({
      token: replacement,
      expectedConfigurationRevision: null,
    }),
    { problemCode: 'configuration.live_conflict' },
  );
  for (const lock of ['.engine-settings.lock', '.diagnostic-settings.lock']) {
    const lockPath = path.join(f.activeDirectory, lock);
    await writeFile(lockPath, 'existing writer');
    await assert.rejects(
      f.repository.save({
        token: replacement,
        expectedConfigurationRevision: current.configurationRevision,
      }),
      { problemCode: 'configuration.live_conflict' },
    );
    assert.equal(await readFile(lockPath, 'utf8'), 'existing writer');
    await rm(lockPath);
  }
  assert.equal(await loadLichessToken(f.home), token);
  const outcomes = await Promise.allSettled([
    f.repository.save({
      token: replacement,
      expectedConfigurationRevision: current.configurationRevision,
    }),
    f.repository.save({
      token: replacement,
      expectedConfigurationRevision: current.configurationRevision,
    }),
  ]);
  assert.equal(
    outcomes.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(await loadLichessToken(f.home), replacement);
});

test('invalid secret input is rejected without reflection or filesystem changes', async (context) => {
  const f = await fixture(context);
  const before = await readFile(
    path.join(f.activeDirectory, 'plysmith.json'),
    'utf8',
  );
  for (const candidate of [
    '',
    `${token}\nOTHER_SECRET=injection`,
    `${token}\r`,
    `${token} `,
    'x'.repeat(513),
  ]) {
    await assert.rejects(
      f.repository.save({
        token: candidate,
        expectedConfigurationRevision: null,
      }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.ok(!(error.stack + JSON.stringify(error)).includes(token));
        return true;
      },
    );
  }
  assert.equal(
    await readFile(path.join(f.activeDirectory, 'plysmith.json'), 'utf8'),
    before,
  );
  await assert.rejects(readFile(f.envPath), { code: 'ENOENT' });
});

test('strict reset removes invalid live settings and interrupted saves while retaining user data', async (context) => {
  const f = await fixture(context);
  const database = path.join(f.home, 'data', 'plysmith.db');
  await mkdir(path.dirname(database));
  await writeFile(database, 'user data');
  for (const damage of ['provider', 'environment', 'interrupted']) {
    await f.repository.save({ token, expectedConfigurationRevision: null });
    if (damage === 'provider') await writeFile(f.providerPath, '{}');
    if (damage === 'environment')
      await writeFile(
        f.envPath,
        `${LICHESS_TOKEN_ENVIRONMENT_VARIABLE}=${token}\nUNKNOWN=value\n`,
      );
    if (damage === 'interrupted')
      await writeFile(
        path.join(f.activeDirectory, '.live-settings.lock'),
        'interrupted',
      );
    assert.equal(
      (await initializeConfiguration(f.options)).status,
      'initialized',
    );
    assert.equal(await readFile(database, 'utf8'), 'user data');
    assert.deepEqual((await loadConfiguration(f.home)).liveProviders, []);
    await assert.rejects(readFile(f.envPath), { code: 'ENOENT' });
  }
});

test('secret hardlinks cannot overwrite other files', async (context) => {
  const f = await fixture(context);
  const unrelated = path.join(f.home, 'keep');
  await writeFile(unrelated, 'untouched');
  await link(unrelated, f.envPath);
  await assert.rejects(
    f.repository.save({ token, expectedConfigurationRevision: null }),
  );
  assert.equal(await readFile(unrelated, 'utf8'), 'untouched');
  assert.equal(await loadLichessToken(f.home), undefined);
});

test('failed publication rolls back both secret and provider without exposing the failed write', async (context) => {
  const f = await fixture(context);
  const current = await f.repository.save({
    token,
    expectedConfigurationRevision: null,
  });
  const before = await readFile(f.providerPath, 'utf8');
  const rename = filesystem.rename;
  let failed = false;
  const mocked = context.mock.method(
    filesystem,
    'rename',
    async (
      source: Parameters<typeof filesystem.rename>[0],
      destination: Parameters<typeof filesystem.rename>[1],
    ) => {
      if (
        !failed &&
        destination === path.join(f.activeDirectory, 'plysmith.json')
      ) {
        failed = true;
        throw new Error(`Injected failure ${replacement}`);
      }
      return rename(source, destination);
    },
  );
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      f.repository.save({
        token: replacement,
        expectedConfigurationRevision: current.configurationRevision,
      }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.ok(
          !`${error.stack}${JSON.stringify(error)}`.includes(replacement),
        );
        return true;
      },
    );
  } finally {
    mocked.mock.restore();
    syncBuiltinESMExports();
  }
  assert.ok(failed);
  assert.equal(await loadLichessToken(f.home), token);
  assert.equal(await readFile(f.providerPath, 'utf8'), before);
  assert.equal(
    (await initializeConfiguration(f.options)).status,
    'already-initialized',
  );
});

test('host token resolution never injects the token into child process environments', async (context) => {
  const f = await fixture(context);
  await f.repository.save({ token, expectedConfigurationRevision: null });
  const loaderUrl = pathToFileURL(
    path.resolve(
      'app/infrastructure/adapters/configuration/filesystem/lichess-secret.ts',
    ),
  ).href;
  const script = `import { loadLichessToken } from ${JSON.stringify(loaderUrl)};
    import { execFileSync } from 'node:child_process';
    const token = await loadLichessToken(process.argv[1]);
    if (!token) throw new Error('Missing fixture token');
    const child = execFileSync(process.execPath, ['-e', 'process.stdout.write(String(Object.hasOwn(process.env, "PLYSMITH_LICHESS_TOKEN")))']);
    process.stdout.write(child);`;
  const result = await promisify(execFile)(
    process.execPath,
    ['--input-type=module', '-e', script, f.home],
    { env: {} },
  );
  assert.equal(result.stdout, 'false');
});
