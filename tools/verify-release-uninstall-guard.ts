import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { _electron as electron } from '@playwright/test';

import {
  readHostDiscovery,
  startProductionHost,
} from '../app/infrastructure/adapters/platform/windows/index.ts';
import { sha256File } from '../app/infrastructure/adapters/platform/windows/product-manifest.ts';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const uuidSuffix =
  /(?:^|[-_])[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveOwnedInstallation(
  value: string | undefined,
): Promise<string> {
  const installed = requireAbsolutePath(
    value,
    'PLYSMITH_VERIFY_INSTALLED_ROOT',
  );
  assert.match(
    path.basename(path.dirname(installed)),
    uuidSuffix,
    'The installation must be a direct child of an owned UUID verification directory.',
  );
  assert.equal(
    isWithin(repositoryRoot, installed),
    false,
    'The installation must be outside the repository.',
  );
  await assertPhysicalPath(installed);
  assert.equal((await stat(installed)).isDirectory(), true);
  return installed;
}

async function verifyUninstallGuard(): Promise<void> {
  assert.equal(process.platform, 'win32', 'This check requires Windows.');
  // Parent must check existing product registration before installing this target.
  const installed = await resolveOwnedInstallation(
    process.env.PLYSMITH_VERIFY_INSTALLED_ROOT,
  );
  const installer =
    process.env.PLYSMITH_VERIFY_INSTALLER === undefined
      ? undefined
      : requireAbsolutePath(
          process.env.PLYSMITH_VERIFY_INSTALLER,
          'PLYSMITH_VERIFY_INSTALLER',
        );
  if (installer !== undefined) {
    assert.equal(path.extname(installer).toLowerCase(), '.exe');
    await assertPhysicalPath(installer);
    assert.equal((await lstat(installer)).isFile(), true);
    assert.equal(isWithin(installed, installer), false);
  }
  const executable = path.join(installed, 'Plysmith.exe');
  const uninstaller = path.join(installed, 'Uninstall Plysmith.exe');
  const installFiles = [
    'Plysmith.exe',
    'Uninstall Plysmith.exe',
    'resources/product-manifest.json',
    'resources/runtime/node.exe',
  ];
  const installSnapshot = await snapshotFiles(installed, installFiles);
  const localAppData = requireAbsolutePath(
    process.env.LOCALAPPDATA,
    'LOCALAPPDATA',
  );
  const cacheDirectory = path.join(localAppData, 'plysmith-updater');
  const cachedInstaller = path.join(cacheDirectory, 'installer.exe');
  await assert.rejects(stat(cacheDirectory), { code: 'ENOENT' });

  const applicationHome = path.join(
    path.dirname(installed),
    `uninstall-guard-${randomUUID()}`,
  );
  assert.equal(isWithin(installed, applicationHome), false);
  await mkdir(applicationHome);
  await assertPhysicalPath(applicationHome);
  console.log(`Uninstall verification home: ${applicationHome}`);
  // Match electron-builder's direct uninstaller invocation, without a detached outer launcher.
  const uninstallProbe = path.join(applicationHome, 'uninstall-probe.exe');
  await copyFile(uninstaller, uninstallProbe);
  assert.equal(
    await sha256File(uninstallProbe),
    installSnapshot['Uninstall Plysmith.exe'],
  );
  const uninstallArguments = ['/S', '/currentuser', `_?=${installed}`];
  const application = await electron.launch({
    executablePath: executable,
    args: ['--application-home', applicationHome],
    cwd: installed,
  });
  const desktop = application.process();
  let hostPid: number | undefined;
  try {
    const applicationWindow = await waitForApplicationWindow(application);
    await applicationWindow
      .getByText(/Verbunden|Connected/)
      .first()
      .waitFor({ timeout: 60_000 });
    hostPid = (await readHostDiscovery(applicationHome)).pid;
    const assertOwnedProcessesAlive = () => {
      assert.equal(desktop.exitCode, null);
      assert.equal(desktop.signalCode, null);
      assert.ok(desktop.pid !== undefined && hostPid !== undefined);
      process.kill(desktop.pid, 0);
      process.kill(hostPid, 0);
      assert.equal(applicationWindow.isClosed(), false);
    };
    console.log('Checking install/uninstall protection with Desktop and Host.');
    await verifyRunningInstallationRefusal({
      installed,
      installer,
      uninstallProbe,
      installSnapshot,
      assertOwnedProcessesAlive,
    });
  } finally {
    try {
      await application.close();
    } finally {
      if (hostPid !== undefined) await waitForHostExit(hostPid);
    }
  }

  assert.equal(desktop.exitCode, 0, 'The owned Desktop must have exited.');
  assert.equal(desktop.signalCode, null);
  const host = await startProductionHost({
    applicationHome,
    installRoot: path.join(installed, 'resources'),
  });
  try {
    const ownedHostPid = host.pid;
    assert.ok(ownedHostPid !== undefined);
    assert.equal((await readHostDiscovery(applicationHome)).pid, ownedHostPid);
    console.log(
      'Checking install/uninstall protection with Host only; Desktop exited.',
    );
    await verifyRunningInstallationRefusal({
      installed,
      installer,
      uninstallProbe,
      installSnapshot,
      assertOwnedProcessesAlive: () => {
        assert.equal(desktop.exitCode, 0);
        process.kill(ownedHostPid, 0);
      },
    });
  } finally {
    try {
      await host.close();
    } finally {
      if (host.pid !== undefined) await waitForHostExit(host.pid);
    }
  }

  const preserved = await snapshotPreservedFiles(applicationHome);
  assert.equal(await runNsis(uninstallProbe, uninstallArguments, 60_000), 0);
  await waitForRemoval(installed);
  await waitForRemoval(cachedInstaller);
  await waitForRemoval(cacheDirectory);
  assert.deepEqual(await snapshotPreservedFiles(applicationHome), preserved);
  console.log(
    'Uninstall after orderly quit: installation and cache removed; database and configuration bytes unchanged',
  );
}

export async function verifyRunningInstallationRefusal(options: {
  readonly installed: string;
  readonly installer: string | undefined;
  readonly uninstallProbe: string;
  readonly installSnapshot: Readonly<Record<string, string>>;
  readonly assertOwnedProcessesAlive: () => void;
}): Promise<void> {
  const { installed, installer, uninstallProbe, installSnapshot } = options;
  const installFiles = Object.keys(installSnapshot);
  options.assertOwnedProcessesAlive();
  if (installer !== undefined) {
    const exitCode = await runNsis(
      installer,
      ['/S', '/currentuser', `/D=${installed}`],
      30_000,
    );
    assert.equal(
      exitCode,
      1,
      'The installer must refuse the active owned installation.',
    );
    assert.deepEqual(
      await snapshotFiles(installed, installFiles),
      installSnapshot,
    );
    options.assertOwnedProcessesAlive();
    console.log(
      'Install refused: exit 1; install bytes unchanged; owned processes alive.',
    );
  } else {
    console.log(
      'Install refusal NOT VERIFIED: PLYSMITH_VERIFY_INSTALLER was not supplied.',
    );
  }
  const exitCode = await runNsis(
    uninstallProbe,
    ['/S', '/currentuser', `_?=${installed}`],
    30_000,
  );
  assert.ok(
    exitCode === 0 || exitCode === 1,
    `Unexpected uninstall refusal exit: ${exitCode}`,
  );
  assert.deepEqual(
    await snapshotFiles(installed, installFiles),
    installSnapshot,
  );
  options.assertOwnedProcessesAlive();
  console.log(
    `Uninstall refused (exit ${exitCode}); install bytes unchanged; owned processes alive.`,
  );
}

function requireAbsolutePath(value: string | undefined, name: string): string {
  assert.ok(
    value !== undefined && path.isAbsolute(value),
    `${name} must be an explicit absolute path.`,
  );
  assert.notEqual(
    path.parse(value).root,
    path.sep,
    `${name} must include its drive or share.`,
  );
  return path.resolve(value);
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function assertPhysicalPath(file: string): Promise<void> {
  assert.equal(
    (await realpath(file)).toLowerCase(),
    file.toLowerCase(),
    'Verification paths must not redirect through symlinks or junctions.',
  );
}

async function snapshotFiles(
  root: string,
  relatives: readonly string[],
): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const relative of relatives) {
    const absolute = path.join(root, relative);
    await assertPhysicalPath(absolute);
    const info = await lstat(absolute);
    assert.equal(info.isSymbolicLink(), false);
    if (info.isDirectory()) {
      snapshot[`${relative}/`] = '';
      Object.assign(
        snapshot,
        await snapshotFiles(
          root,
          (await readdir(absolute)).sort().map((name) => `${relative}/${name}`),
        ),
      );
    } else {
      assert.equal(info.isFile(), true);
      snapshot[relative] = await sha256File(absolute);
    }
  }
  return snapshot;
}

export async function snapshotPreservedFiles(
  applicationHome: string,
): Promise<Record<string, string>> {
  for (const required of [
    'data/plysmith.db',
    'configuration/active/plysmith.json',
    'configuration/active/sqlite-main.json',
  ]) {
    assert.equal(
      (await lstat(path.join(applicationHome, required))).isFile(),
      true,
    );
  }
  const relatives = ['data', 'configuration'];
  try {
    await lstat(path.join(applicationHome, '.env'));
    relatives.push('.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return snapshotFiles(applicationHome, relatives);
}

function runNsis(
  executable: string,
  args: readonly string[],
  timeout: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      argv0: `"${executable}"`,
      // NSIS /D= and _?= consume the unquoted remainder of the command line.
      windowsVerbatimArguments: true,
      windowsHide: true,
      stdio: 'ignore',
      timeout,
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (child.killed || signal !== null || code === null) {
        reject(
          new Error(
            `NSIS did not exit normally: ${executable}; code=${code}; signal=${signal}; killed=${child.killed}`,
          ),
        );
      } else resolve(code);
    });
  });
}

async function waitForApplicationWindow(
  application: Awaited<ReturnType<typeof electron.launch>>,
) {
  await application.firstWindow();
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const window = application
      .windows()
      .find((candidate) => candidate.url().startsWith('app://plysmith/'));
    if (window !== undefined) return window;
    await delay(100);
  }
  throw new Error('The Plysmith application window did not appear.');
}

async function waitForHostExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    await delay(500);
  }
  throw new Error('Owned Host did not exit.');
}

async function waitForRemoval(file: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await stat(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    await delay(500);
  }
  throw new Error(`The uninstaller did not remove ${file}.`);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await verifyUninstallGuard();
}
