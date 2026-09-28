import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { _electron as electron } from '@playwright/test';

import { readHostDiscovery } from '../app/infrastructure/adapters/platform/windows/index.ts';

const execFileAsync = promisify(execFile);
const installed = path.resolve(
  process.env.PLYSMITH_VERIFY_INSTALLED_ROOT ??
    'build/alpha-verification/installed',
);
const executable = path.join(installed, 'Plysmith.exe');
const uninstaller = path.join(installed, 'Uninstall Plysmith.exe');
const applicationHome = path.resolve(
  'build/alpha-verification',
  `uninstall-guard-${randomUUID()}`,
);
await mkdir(applicationHome, { recursive: true });
await stat(executable);
await stat(uninstaller);

const application = await electron.launch({
  executablePath: executable,
  args: ['--application-home', applicationHome],
  cwd: installed,
});
let hostPid: number | undefined;
let quitRequested = false;
try {
  const window = await application.firstWindow();
  await window
    .getByText(/Verbunden|Connected/)
    .first()
    .waitFor({ timeout: 60_000 });
  hostPid = (await readHostDiscovery(applicationHome)).pid;
  await execFileAsync(uninstaller, ['/S', '/currentuser'], {
    windowsHide: true,
    timeout: 30_000,
  });
  await delay(2_000);
  await stat(executable);
  process.kill(hostPid, 0);
  assert.equal(window.isClosed(), false);
  console.log('Uninstall while Desktop and Host run: refused');
  await application.evaluate(({ app }) => {
    setTimeout(() => app.quit(), 0);
  });
  quitRequested = true;
  await waitForHostExit(hostPid);
} finally {
  if (!quitRequested && hostPid !== undefined) {
    try {
      await application.evaluate(({ app }) => {
        setTimeout(() => app.quit(), 0);
      });
      await waitForHostExit(hostPid);
    } catch {
      // The assertion failure still takes precedence if the application already exited.
    }
  }
  await application.close();
}

await execFileAsync(uninstaller, ['/S', '/currentuser'], {
  windowsHide: true,
  timeout: 60_000,
});
await waitForRemoval(executable);
await stat(path.join(applicationHome, 'data', 'plysmith.db'));
console.log('Uninstall after orderly quit: program removed; data preserved');

async function waitForHostExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await delay(500);
  }
  throw new Error('Desktop-owned Host did not exit.');
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
  throw new Error('The uninstaller did not remove the program.');
}
