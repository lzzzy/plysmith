import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { _electron as electron } from '@playwright/test';

import { readHostDiscovery } from '../app/infrastructure/adapters/platform/windows/index.ts';
import { connectHost } from '../app/infrastructure/channels/host_client/index.ts';

const releaseRoot = path.resolve('build/alpha-release');
const packaged = path.join(releaseRoot, 'packaged', 'Plysmith-win32-x64');
const home = path.resolve(
  'build/alpha-verification',
  `desktop-${randomUUID()}`,
);
const parallelHome = path.resolve(
  'build/alpha-verification',
  `desktop-parallel-${randomUUID()}`,
);
const executablePath =
  process.env.PLYSMITH_VERIFY_EXECUTABLE ?? path.join(packaged, 'Plysmith.exe');
const screenshots = path.join(releaseRoot, 'screenshots');
await mkdir(screenshots, { recursive: true });

for (const iteration of [1, 2]) {
  const application = await electron.launch({
    executablePath,
    args: ['--application-home', home],
    cwd: path.dirname(executablePath),
  });
  try {
    const firstWindow = await application.firstWindow();
    if (firstWindow.url().startsWith('data:')) {
      await firstWindow
        .getByRole('status')
        .getByRole('heading', { name: /Plysmith/ })
        .waitFor();
      await firstWindow.screenshot({
        path: path.join(screenshots, `startup-${iteration}.png`),
      });
      console.log(
        'Startup window: visible before the Application Host is ready',
      );
    }
    if (iteration === 1) {
      await verifySecondInstanceDoesNotOpen(application, executablePath, home);
    }
    const window = await waitForApplicationWindow(application);
    await window
      .getByRole('navigation', { name: 'Plysmith' })
      .waitFor({ timeout: 60_000 });
    await window
      .getByRole('navigation', { name: 'Plysmith' })
      .getByRole('button', { name: /Verwalten|Manage/ })
      .click();
    await window
      .getByText(/Verbunden|Connected/)
      .first()
      .waitFor();
    const discovery = await readHostDiscovery(home);
    const profilePaths = await application.evaluate(({ app }) => ({
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
    }));
    assert.deepEqual(profilePaths, {
      userData: path.join(home, 'desktop', 'profile'),
      sessionData: path.join(home, 'desktop', 'profile', 'session'),
    });
    const client = await connectHost(discovery, { origin: 'app://plysmith' });
    if (iteration === 1) {
      await client.createWorkingContext({ displayName: 'Alpha-Pruefung' });
    }
    const scopeSelector = window.getByRole('combobox', {
      name: /Arbeitskontext|Working context/,
    });
    const selected = await scopeSelector.selectOption(
      { label: 'Alpha-Pruefung' },
      { timeout: 60_000 },
    );
    assert.equal(selected.length, 1);
    const board = window.getByRole('grid', { name: /Schachbrett|Chess board/ });
    if (await board.isVisible().catch(() => false)) {
      assert.equal(await board.getByRole('gridcell').count(), 64);
    }
    await window.screenshot({
      path: path.join(screenshots, `installed-desktop-${iteration}.png`),
      fullPage: true,
    });
    assert.ok(discovery.pid > 0);
    console.log(
      `Desktop start ${iteration}: connected; Host PID ${discovery.pid}`,
    );
    if (iteration === 1) {
      const parallel = await electron.launch({
        executablePath,
        args: ['--application-home', parallelHome],
        cwd: path.dirname(executablePath),
      });
      try {
        const parallelWindow = await waitForApplicationWindow(parallel);
        await parallelWindow
          .getByText(/Verbunden|Connected/)
          .first()
          .waitFor({ timeout: 60_000 });
        const parallelDiscovery = await readHostDiscovery(parallelHome);
        const parallelPaths = await parallel.evaluate(({ app }) => ({
          userData: app.getPath('userData'),
          sessionData: app.getPath('sessionData'),
        }));
        assert.equal(
          parallelPaths.userData,
          path.join(parallelHome, 'desktop', 'profile'),
        );
        assert.equal(
          parallelPaths.sessionData,
          path.join(parallelHome, 'desktop', 'profile', 'session'),
        );
        assert.notEqual(parallelDiscovery.pid, discovery.pid);
        await parallel.evaluate(({ app }) => {
          setTimeout(() => app.quit(), 0);
        });
        await waitForHostExit(parallelHome, parallelDiscovery.pid);
        console.log('Parallel desktop: separate profile and Host');
      } finally {
        await parallel.close();
      }
    }
    await application.evaluate(({ app }) => {
      setTimeout(() => app.quit(), 0);
    });
    await waitForHostExit(home, discovery.pid);
  } finally {
    await application.close();
  }
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

async function verifySecondInstanceDoesNotOpen(
  application: Awaited<ReturnType<typeof electron.launch>>,
  executable: string,
  applicationHome: string,
): Promise<void> {
  const minimized = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.minimize();
    return window?.isMinimized() ?? false;
  });
  assert.equal(minimized, true, 'The startup window must be minimizable.');
  const duplicate = spawn(executable, ['--application-home', applicationHome], {
    cwd: path.dirname(executable),
    windowsHide: true,
    stdio: 'ignore',
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    duplicate.once('error', reject);
    duplicate.once('exit', resolve);
  });
  assert.equal(exitCode, 0, 'The second launch must exit cleanly.');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = await application.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      return {
        count: windows.length,
        focused: windows.some((window) => window.isFocused()),
        minimized: windows.some((window) => window.isMinimized()),
      };
    });
    assert.equal(state.count, 1, 'A second window must not appear.');
    if (state.focused && !state.minimized) {
      console.log('Second launch: first window restored and focused');
      return;
    }
    await delay(100);
  }
  throw new Error('The second launch did not focus the first window.');
}

async function waitForHostExit(
  applicationHome: string,
  hostPid: number,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      process.kill(hostPid, 0);
    } catch {
      await assert.rejects(readHostDiscovery(applicationHome));
      return;
    }
    await delay(500);
  }
  throw new Error('The Desktop-owned Host did not close.');
}
