// Separate opt-in check: pnpm exec node tools/verify-analysis-setup-runtime.ts
// Saved playout visual/Axe review: add --saved-playout (screenshots stay in temp).
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { _electron as electron, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { build } from 'esbuild';

interface FixtureApi {
  showSavedPlayout(locale: 'de-DE' | 'en-GB', savedName: string): void;
  showPlayoutReview(locale: 'de-DE' | 'en-GB'): void;
  showPendingCompletion(locale: 'de-DE' | 'en-GB'): void;
  open(start: 'initial' | 'setup', hasScratch: boolean): void;
  settle(operation: 'discard' | 'start' | 'complete', success: boolean): void;
  releaseApplicationBusy(): void;
  snapshot(): {
    open: boolean;
    applicationBusy: boolean;
    scratch?: unknown;
    calls: string[];
    alerts: string[];
    closeRequests: boolean[];
    pending: string[];
  };
}
type FixtureGlobal = typeof globalThis & { analysisSetupRuntime: FixtureApi };
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), 'plysmith-analysis-setup-runtime-'),
);
const savedPlayoutMode = process.argv.includes('--saved-playout');
const artifactDirectory = savedPlayoutMode
  ? await mkdtemp(path.join(os.tmpdir(), 'plysmith-saved-playout-artifacts-'))
  : undefined;
let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
const processOutput: string[] = [];
const errors: string[] = [];
const failures: string[] = [];
let passed = 0;
let executed = 0;

try {
  const bundle = await build({
    entryPoints: [
      path.join(repositoryRoot, 'tools/fixtures/analysis-setup-runtime.tsx'),
    ],
    outfile: path.join(temporaryRoot, 'renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    target: 'es2024',
    loader: { '.woff2': 'file' },
    metafile: true,
    logLevel: 'silent',
  });
  // No application store, host client implementation or bootstrap may enter the bundle.
  assert.ok(
    !Object.keys(bundle.metafile.inputs).some((input) =>
      /app\/(?:bootstrap\/|infrastructure\/channels\/host_client\/|.*\/plysmith-application-store\.ts$)/.test(
        input.replaceAll('\\', '/'),
      ),
    ),
  );
  const profile = path.join(temporaryRoot, 'profile');
  await mkdir(profile);
  await writeFile(
    path.join(temporaryRoot, 'index.html'),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self'">
<title>Isolated analysis setup verification</title>
<link rel="stylesheet" href="renderer.css"></head>
<body><div id="root"></div><script src="renderer.js"></script></body></html>`,
  );
  await writeFile(
    path.join(temporaryRoot, 'main.cjs'),
    `
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(__dirname, 'profile'));
app.setPath('sessionData', path.join(__dirname, 'profile'));
app.setPath('logs', path.join(__dirname, 'logs'));
app.setPath('crashDumps', path.join(__dirname, 'crashes'));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('devtools:') });
  });
  const window = new BrowserWindow({
    width: 1280, height: 1000, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await window.loadFile(path.join(__dirname, 'index.html'));
  if (${savedPlayoutMode}) window.showInactive();
});
app.on('window-all-closed', () => app.quit());
`,
  );
  const electronRoot = path.dirname(
    fileURLToPath(import.meta.resolve('electron')),
  );
  const executablePath = path.join(
    electronRoot,
    'dist',
    process.platform === 'win32'
      ? 'electron.exe'
      : process.platform === 'darwin'
        ? 'Electron.app/Contents/MacOS/Electron'
        : 'electron',
  );
  application = await electron.launch({
    executablePath,
    args: [path.join(temporaryRoot, 'main.cjs'), `--user-data-dir=${profile}`],
    cwd: temporaryRoot,
    timeout: 30_000,
  });
  application
    .process()
    .stdout?.on('data', (chunk: Buffer) =>
      processOutput.push(chunk.toString()),
    );
  application
    .process()
    .stderr?.on('data', (chunk: Buffer) =>
      processOutput.push(chunk.toString()),
    );
  const page = await application.firstWindow();
  page.setDefaultTimeout(5_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.waitForFunction(() => 'analysisSetupRuntime' in globalThis);

  async function run(name: string, check: () => Promise<void>) {
    executed += 1;
    const errorCount = errors.length;
    try {
      await check();
      assert.deepEqual(
        errors.slice(errorCount),
        [],
        'Unexpected renderer errors',
      );
      passed += 1;
      console.log(`PASS ${executed}: ${name}`);
    } catch (error) {
      failures.push(`${name}: ${String(error)}`);
      console.error(`FAIL ${executed}: ${name}\n${String(error)}`);
    } finally {
      // A fresh renderer prevents a failed case's pending promises from leaking.
      await page.reload();
      await page.waitForFunction(() => 'analysisSetupRuntime' in globalThis);
    }
  }

  if (!savedPlayoutMode) {
    await run(
      'discard succeeds; delayed start has no alert and blocks all dismissal',
      async () => {
        await open(page, 'initial', true);
        await page
          .getByRole('button', { name: 'Discard draft and start again' })
          .click();
        await expect
          .poll(async () => (await snapshot(page)).pending)
          .toEqual(['discard']);
        await assertLocked(page);
        await settle(page, 'discard', true);
        await expect
          .poll(async () => (await snapshot(page)).pending)
          .toEqual(['start']);
        assert.equal((await snapshot(page)).scratch, undefined);
        // Simulate the store publishing idle between command completion and UI continuation.
        await page.evaluate(() =>
          (
            globalThis as FixtureGlobal
          ).analysisSetupRuntime.releaseApplicationBusy(),
        );
        await assertLocked(page);
        assert.deepEqual((await snapshot(page)).calls, ['discard', 'start']);
        await settle(page, 'start', true);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        assert.deepEqual((await snapshot(page)).closeRequests, [false]);
        assert.deepEqual((await snapshot(page)).alerts, []);
      },
    );

    await run(
      'start false reports a local alert; retry succeeds and closes exactly once',
      async () => {
        await open(page, 'initial', true);
        await page
          .getByRole('button', { name: 'Discard draft and start again' })
          .click();
        await settle(page, 'discard', true);
        await expect
          .poll(async () => (await snapshot(page)).pending)
          .toEqual(['start']);
        await settle(page, 'start', false);
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('alert')).toBeVisible();
        await expect(dialog.getByRole('alert')).toContainText('analysis');
        assert.equal(await page.getByRole('alert').count(), 1);
        assert.deepEqual((await snapshot(page)).closeRequests, []);
        await dialog.getByRole('button', { name: 'Try again' }).click();
        await expect(dialog.getByRole('alert')).toHaveCount(0);
        await assertLocked(page, false);
        await settle(page, 'start', true);
        await expect(dialog).toHaveCount(0);
        assert.deepEqual((await snapshot(page)).calls, [
          'discard',
          'start',
          'start',
        ]);
        assert.deepEqual((await snapshot(page)).closeRequests, [false]);
      },
    );

    await run(
      'discard false preserves the scratch and decision content with a local error',
      async () => {
        await open(page, 'setup', true);
        const before = (await snapshot(page)).scratch;
        const dialog = page.getByRole('dialog');
        const content = await dialog.innerText();
        await dialog
          .getByRole('button', { name: 'Discard draft and start again' })
          .click();
        await settle(page, 'discard', false);
        await expect(dialog.getByRole('alert')).toHaveText(
          'The action could not be completed.',
        );
        assert.equal(await page.getByRole('alert').count(), 1);
        const after = (await dialog.innerText())
          .replace('The action could not be completed.', '')
          .replace(/\s+/g, ' ')
          .trim();
        assert.equal(after, content.replace(/\s+/g, ' ').trim());
        assert.deepEqual((await snapshot(page)).scratch, before);
        assert.deepEqual((await snapshot(page)).calls, ['discard']);
        assert.deepEqual((await snapshot(page)).closeRequests, []);
        await expect(dialog.getByRole('grid')).toHaveCount(0);
        await expect(
          dialog.getByRole('button', { name: 'Discard draft and start again' }),
        ).toBeEnabled();
      },
    );

    await run(
      'continue existing scratch closes once without discard or start',
      async () => {
        await open(page, 'initial', true);
        const before = (await snapshot(page)).scratch;
        await page
          .getByRole('button', { name: 'Continue existing analysis' })
          .click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        assert.deepEqual((await snapshot(page)).scratch, before);
        assert.deepEqual((await snapshot(page)).calls, ['activity:analyze']);
        assert.deepEqual((await snapshot(page)).closeRequests, [false]);
      },
    );

    await run(
      'direct setup renders an editable board; Escape cancels without domain calls',
      async () => {
        await open(page, 'setup', false);
        const dialog = page.getByRole('dialog');
        await expect(
          dialog.getByRole('heading', { name: 'Set up a position' }),
        ).toBeVisible();
        const board = dialog.getByRole('grid');
        await expect(board).toBeVisible();
        await expect(board.getByRole('gridcell')).toHaveCount(64);
        await expect(
          dialog.getByRole('button', { name: 'Discard draft and start again' }),
        ).toHaveCount(0);
        const original = await board.getByRole('gridcell').allTextContents();
        await dialog.getByRole('button', { name: 'Clear board' }).click();
        assert.notDeepEqual(
          await board.getByRole('gridcell').allTextContents(),
          original,
        );
        await dialog
          .getByRole('button', { name: 'Initial position', exact: true })
          .click();
        assert.deepEqual(
          await board.getByRole('gridcell').allTextContents(),
          original,
        );
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        assert.deepEqual((await snapshot(page)).calls, []);
        assert.deepEqual((await snapshot(page)).closeRequests, [false]);
        assert.equal((await snapshot(page)).scratch, undefined);
      },
    );
  } else {
    console.log(`Saved playout screenshots: ${artifactDirectory}`);
    for (const locale of ['de-DE', 'en-GB'] as const) {
      for (const width of [1280, 390]) {
        await run(
          `saved playout ${locale} at ${width}px: metadata, single status, Axe and action`,
          async () => {
            await page.setViewportSize({ width, height: 1000 });
            const savedName =
              locale === 'de-DE'
                ? 'Training mit Schwarz'
                : 'Practice with Black';
            await page.evaluate(
              ({ locale, savedName }) =>
                (
                  globalThis as FixtureGlobal
                ).analysisSetupRuntime.showSavedPlayout(locale, savedName),
              { locale, savedName },
            );
            const heading = page.getByRole('heading', {
              name: savedName,
              exact: true,
            });
            await expect(heading).toBeVisible();
            const panel = page.getByRole('region', {
              name: savedName,
              exact: true,
            });
            await expect(panel.getByRole('status')).toHaveText(
              locale === 'de-DE' ? 'Partie gespeichert' : 'Game saved',
            );
            await expect(page.getByRole('status')).toHaveCount(1);
            await expect(panel.locator('dd')).toHaveText(
              locale === 'de-DE'
                ? ['Schwarz', 'Unvollständig beendet', 'Manuell festgelegt']
                : ['Black', 'Stopped unfinished', 'Set manually'],
            );
            await expect(panel).toContainText('Stockfish');
            await expect(page.getByRole('grid')).toHaveAttribute(
              'aria-readonly',
              'true',
            );
            await expect(page.getByRole('gridcell')).toHaveCount(64);
            await page.evaluate(async () => {
              const browser = globalThis as unknown as {
                document: { fonts: { ready: Promise<unknown> } };
              };
              await browser.document.fonts.ready;
            });
            await page.screenshot({
              path: path.join(artifactDirectory!, `${locale}-${width}.png`),
              fullPage: true,
            });
            const accessibility = await new AxeBuilder({ page })
              .setLegacyMode()
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
              .analyze();
            assert.deepEqual(
              accessibility.violations.map(({ id, nodes }) => ({
                id,
                targets: nodes.map(({ target }) => target),
              })),
              [],
            );
            await assertSavedHeadingFits(page);
            assert.deepEqual((await snapshot(page)).calls, []);
            await panel
              .getByRole('button', {
                name: locale === 'de-DE' ? 'Analysieren' : 'Analyse',
                exact: true,
              })
              .click();
            assert.deepEqual((await snapshot(page)).calls, [
              'openCompletedPlayout',
            ]);
          },
        );
      }
    }
    for (const locale of ['de-DE', 'en-GB'] as const) {
      await run(
        `saved playout ${locale} at 390px: long allowed name stays readable`,
        async () => {
          await page.setViewportSize({ width: 390, height: 1000 });
          const savedName =
            'Training_2026_09_27_Stockfish_Schwarz_SizilianischeVerteidigung';
          await page.evaluate(
            ({ locale, savedName }) =>
              (
                globalThis as FixtureGlobal
              ).analysisSetupRuntime.showSavedPlayout(locale, savedName),
            { locale, savedName },
          );
          await expect(
            page.getByRole('heading', { name: savedName, exact: true }),
          ).toBeVisible();
          await page.screenshot({
            path: path.join(artifactDirectory!, `${locale}-390-long-name.png`),
            fullPage: true,
          });
          await assertSavedHeadingFits(page);
        },
      );
    }
  }
  if (savedPlayoutMode) {
    for (const locale of ['de-DE', 'en-GB'] as const) {
      for (const width of [1280, 390]) {
        for (const result of [
          'white_win',
          'black_win',
          'draw',
          'unfinished',
        ] as const) {
          await run(
            `manual completion ${locale} ${width}px ${result}`,
            async () => {
              await page.setViewportSize({ width, height: 1000 });
              await page.evaluate(
                (locale) =>
                  (
                    globalThis as FixtureGlobal
                  ).analysisSetupRuntime.showPlayoutReview(locale),
                locale,
              );
              const title = page.getByRole('textbox');
              const choice = page.getByRole('combobox');
              await title.fill('Result confirmation');
              await choice.selectOption(result);
              await page
                .getByRole('button', {
                  name: locale === 'de-DE' ? 'Partie speichern' : 'Save game',
                  exact: true,
                })
                .click();
              await expect(choice).toBeDisabled();
              await expect(title).toBeDisabled();
              await expect
                .poll(async () => (await snapshot(page)).pending)
                .toEqual(['complete']);
              const accessibility = await new AxeBuilder({ page })
                .setLegacyMode()
                .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
                .analyze();
              assert.deepEqual(
                accessibility.violations.map(({ id }) => id),
                [],
              );
              await settle(page, 'complete', true);
              const panel = page.getByRole('region', {
                name: 'Result confirmation',
                exact: true,
              });
              await expect(panel.getByRole('status')).toHaveText(
                locale === 'de-DE' ? 'Partie gespeichert' : 'Game saved',
              );
              const expected =
                locale === 'de-DE'
                  ? {
                      white_win: 'Weiß gewinnt',
                      black_win: 'Schwarz gewinnt',
                      draw: 'Remis',
                      unfinished: 'Unvollständig beendet',
                    }
                  : {
                      white_win: 'White wins',
                      black_win: 'Black wins',
                      draw: 'Draw',
                      unfinished: 'Stopped unfinished',
                    };
              await expect(panel.locator('dd')).toHaveText([
                locale === 'de-DE' ? 'Schwarz' : 'Black',
                expected[result],
                locale === 'de-DE' ? 'Manuell festgelegt' : 'Set manually',
              ]);
              assert.deepEqual((await snapshot(page)).calls, [
                `result:${result}`,
                'complete',
              ]);
              await assertSavedHeadingFits(page);
            },
          );
        }
      }
    }
  }
  if (savedPlayoutMode) {
    for (const locale of ['de-DE', 'en-GB'] as const) {
      await run(
        `pending completion remount ${locale}: frozen fields and enabled retry`,
        async () => {
          await page.setViewportSize({ width: 390, height: 1000 });
          await page.evaluate(
            (locale) =>
              (
                globalThis as FixtureGlobal
              ).analysisSetupRuntime.showPendingCompletion(locale),
            locale,
          );
          await expect(page.getByRole('textbox')).toHaveValue(
            'Frozen completion',
          );
          await expect(page.getByRole('textbox')).toBeDisabled();
          await expect(page.getByRole('combobox')).toHaveValue('draw');
          await expect(page.getByRole('combobox')).toBeDisabled();
          const retry = page.getByRole('button', {
            name:
              locale === 'de-DE'
                ? 'Speichern erneut bestätigen'
                : 'Confirm save again',
            exact: true,
          });
          await expect(retry).toBeEnabled();
          await retry.click();
          await settle(page, 'complete', true);
          await expect(
            page.getByRole('heading', {
              name: 'Frozen completion',
              exact: true,
            }),
          ).toBeVisible();
          assert.deepEqual((await snapshot(page)).calls, [
            'result:draw',
            'complete',
          ]);
        },
      );
    }
  }
  console.log(
    `${savedPlayoutMode ? 'Saved playout' : 'Analysis setup'} runtime: ${passed}/${executed} cases passed; ${failures.length} failed.`,
  );
  assert.deepEqual(errors, [], 'Renderer errors');
  assert.deepEqual(failures, [], 'Runtime interaction regressions');
} catch (error) {
  if (processOutput.length > 0) console.error(processOutput.join(''));
  throw error;
} finally {
  try {
    await application?.close();
  } finally {
    const resolved = path.resolve(temporaryRoot);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(
      path.basename(resolved).startsWith('plysmith-analysis-setup-runtime-'),
    );
    await rm(resolved, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
}

async function assertSavedHeadingFits(page: Page) {
  const pageWidth = await page.evaluate(() => {
    const document = (
      globalThis as unknown as {
        document: {
          documentElement: { clientWidth: number; scrollWidth: number };
        };
      }
    ).document;
    return {
      available: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    };
  });
  assert.ok(
    pageWidth.content <= pageWidth.available,
    'Saved game overflows the viewport',
  );
  const boardBox = await page.getByRole('grid').boundingBox();
  assert.ok(
    boardBox && boardBox.x + boardBox.width <= pageWidth.available,
    'Saved game board is clipped outside the viewport',
  );
  const heading = page.locator('#playout-line-title');
  const panel = page.getByRole('region', {
    name: await heading.innerText(),
    exact: true,
  });
  const titleBox = await heading.boundingBox();
  const panelBox = await panel.boundingBox();
  const statusBox = await panel.getByRole('status').boundingBox();
  assert.ok(titleBox && panelBox && statusBox);
  assert.ok(
    titleBox.x >= panelBox.x &&
      titleBox.x + titleBox.width <= panelBox.x + panelBox.width,
    'Saved name is clipped outside its panel',
  );
  assert.ok(
    statusBox.x + statusBox.width <= panelBox.x + panelBox.width,
    'Save status is clipped outside its panel',
  );
  assert.ok(
    titleBox.x + titleBox.width <= statusBox.x ||
      titleBox.y >= statusBox.y + statusBox.height ||
      titleBox.y + titleBox.height <= statusBox.y,
    'Saved name overlaps the save status',
  );
}

async function snapshot(page: Page) {
  return page.evaluate(() =>
    (globalThis as FixtureGlobal).analysisSetupRuntime.snapshot(),
  );
}

async function open(
  page: Page,
  start: 'initial' | 'setup',
  hasScratch: boolean,
) {
  await page.evaluate(
    ({ start, hasScratch }) =>
      (globalThis as FixtureGlobal).analysisSetupRuntime.open(
        start,
        hasScratch,
      ),
    { start, hasScratch },
  );
  await expect(page.getByRole('dialog')).toBeVisible();
  assert.deepEqual((await snapshot(page)).calls, []);
  assert.deepEqual((await snapshot(page)).alerts, []);
}

async function settle(
  page: Page,
  operation: 'discard' | 'start' | 'complete',
  success: boolean,
) {
  await expect
    .poll(async () => (await snapshot(page)).pending)
    .toContain(operation);
  await page.evaluate(
    ({ operation, success }) =>
      (globalThis as FixtureGlobal).analysisSetupRuntime.settle(
        operation,
        success,
      ),
    { operation, success },
  );
}

async function assertLocked(page: Page, checkAlertHistory = true) {
  const dialog = page.getByRole('dialog');
  const before = await snapshot(page);
  const buttons = dialog.getByRole('button');
  assert.ok((await buttons.count()) > 0);
  for (const button of await buttons.all()) {
    await expect(button).toBeDisabled();
    // Real pointer events on disabled buttons must not trigger a second command.
    const box = await button.boundingBox();
    assert.ok(box);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  await page.keyboard.press('Escape');
  const box = await dialog.boundingBox();
  assert.ok(
    box && box.x > 2 && box.y > 2,
    'Outside click must miss the dialog',
  );
  await page.mouse.click(2, 2);
  // Allow several browser frames while the promise remains explicitly unresolved.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const browser = globalThis as unknown as {
          requestAnimationFrame(callback: () => void): void;
        };
        browser.requestAnimationFrame(() =>
          browser.requestAnimationFrame(resolve),
        );
      }),
  );
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  const after = await snapshot(page);
  assert.deepEqual(after.calls, before.calls);
  assert.deepEqual(after.closeRequests, []);
  if (checkAlertHistory) assert.deepEqual(after.alerts, []);
}
