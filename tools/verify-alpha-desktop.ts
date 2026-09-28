import assert from 'node:assert/strict';
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
    const window = await application.firstWindow();
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
        const parallelWindow = await parallel.firstWindow();
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
