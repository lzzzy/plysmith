// Opt-in renderer regression: isolated browser, no Host or user data.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { build } from 'esbuild';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, expect, type Browser, type Page } from '@playwright/test';

let browser: Browser;
let page: Page;
const errors: string[] = [];

before(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: path.resolve('app/infrastructure/channels/ui/renderer'),
      loader: 'jsx',
      contents: `
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { ImportDialog } from './import-dialog.tsx';
import { messages } from './messages.ts';
const root = createRoot(document.getElementById('root'));
let generation = 0;
let locale = 'en-GB';
let state;
const publications = [];
const checks = [];
const store = {
  checkImportNames: async (candidates) => {
    checks.push(candidates.length);
    return { candidates: candidates.map(c => ({ ...c, available: true, suggestedDisplayName: c.displayName })), dataRevision: 1 };
  },
  publishImport: async request => { publications.push(request); },
  closeImport: async () => { state.importSession.open = false; render(); },
};
function render() {
  root.render(<IntlProvider locale={locale} messages={messages[locale]}><ImportDialog key={generation} state={state} store={store} /></IntlProvider>);
}
window.audit = {
  show(count, moveCount, activity, language = 'en-GB') {
    ++generation;
    locale = language;
    state = {
      phase: 'ready', refreshing: false,
      status: { persistence: { dataRevision: 1 } },
      inventoryOrganization: { folders: [], linkedFolderIds: [] },
      ...(activity ? { busyCommand: 'import_command' } : {}),
      importSession: {
        open: true, activity,
        ...(activity === 'preparing' ? {} : { preview: {
          previewId: String(generation), sourceDisplayName: 'study.pgn', inputSize: 4096, encoding: 'utf-8', formatId: 'standard-chess-pgn-v1',
          candidates: Array.from({ length: count }, (_, sourceOrder) => ({ sourceOrder, suggestedName: 'Chapter ' + (sourceOrder + 1), status: 'ready', moveCount, variationCount: 0, findings: [] })),
        } }),
      },
    };
    publications.length = 0;
    checks.length = 0;
    render();
  },
  publications, checks,
};`,
    },
    bundle: true,
    write: false,
    outfile: 'import-runtime.js',
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    logLevel: 'silent',
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  page = await context.newPage();
  page.setDefaultTimeout(5_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><head><title>Import renderer test</title></head><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('https://renderer.plysmith.test');
  await page.addStyleTag({
    content:
      '* { box-sizing: border-box; } body { font: 16px sans-serif; } :root { --action-blue: #2e61ad; --action-blue-border: #285699; }',
  });
  await page.addStyleTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.css'))!
      .text,
  });
  await page.addScriptTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text,
  });
});

after(async () => {
  await browser?.close();
  assert.deepEqual(errors, []);
});

test('oversized selections remain complete across pages and cannot publish until both budgets fit', async () => {
  await page.evaluate('window.audit.show(101, 1)');
  const publish = page.getByRole('button', {
    name: 'Import selection',
    exact: true,
  });
  await expect(
    page.getByText('No chapters selected yet.', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Select all valid candidates' })
    .click();
  await expect(publish).toBeDisabled();
  await expect(
    page.getByText('The selection exceeds', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Name 1', exact: true })
    .fill('Edited chapter');
  await page.getByRole('button', { name: 'Next page' }).click();
  const last = page.getByRole('checkbox', {
    name: 'Select “study.pgn - Chapter 101”',
    exact: true,
  });
  await expect(last).toBeChecked();
  await last.uncheck();
  await expect(publish).toBeEnabled();
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(
    page.getByRole('checkbox', {
      name: 'Select “study.pgn - Edited chapter”',
      exact: true,
    }),
  ).toBeChecked();
  await expect(
    page.getByRole('textbox', { name: 'Name 1', exact: true }),
  ).toHaveValue('Edited chapter');
  await publish.click();
  assert.equal(
    await page.evaluate('window.audit.publications[0].candidates.length'),
    100,
  );
  assert.equal(
    await page.evaluate(
      'window.audit.publications[0].candidates[0].displayName',
    ),
    'study.pgn - Edited chapter',
  );
  assert.equal(
    await page.evaluate('window.audit.checks.every(count => count <= 100)'),
    true,
  );

  await page.evaluate('window.audit.show(9, 2048)');
  await page
    .getByRole('button', { name: 'Select all valid candidates' })
    .click();
  await expect(publish).toBeDisabled();
  await page
    .getByRole('checkbox', {
      name: 'Select “study.pgn - Chapter 9”',
      exact: true,
    })
    .uncheck();
  await expect(publish).toBeEnabled();
  await expect(page.locator('#import-selected-moves')).toBeVisible();
  await expect(page.locator('#import-selected-moves')).toHaveText(
    '16,384 half-moves including variations',
  );
  await publish.click();
  assert.equal(
    await page.evaluate('window.audit.publications[0].candidates.length'),
    8,
  );
});

test('preparation is keyboard-cancellable while publication stays locked', async () => {
  await page.evaluate('window.audit.show(0, 0, "preparing")');
  await expect(
    page.getByRole('button', { name: 'Cancel import', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Cancel import', exact: true })
    .focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(
      'document.activeElement.closest("[role=dialog]") !== null',
    ),
    true,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate('window.audit.show(1, 1, "publishing")');
  await expect(
    page.getByText('Saving selection', { exact: false }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Cancel import', exact: true }),
  ).toBeDisabled();
});

test('budget messages reflow in both languages on desktop and narrow viewports', async () => {
  await mkdir('build/verification/import-renderer', { recursive: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const locale of ['de-DE', 'en-GB']) {
      await page.evaluate(`window.audit.show(101, 1, undefined, '${locale}')`);
      await expect(page.getByRole('dialog')).toBeVisible();
      assert.equal(
        await page.evaluate(
          'document.documentElement.scrollWidth <= innerWidth',
        ),
        true,
      );
      assert.equal(
        await page.getByRole('dialog').evaluate((element) => {
          const box = element as unknown as {
            scrollWidth: number;
            clientWidth: number;
          };
          return box.scrollWidth <= box.clientWidth;
        }),
        true,
      );
      const selectedMoves = page.locator('#import-selected-moves');
      await selectedMoves.scrollIntoViewIfNeeded();
      await expect(selectedMoves).toBeVisible();
      await expect(selectedMoves).toHaveText(
        locale === 'de-DE'
          ? '0 Halbzüge einschließlich Varianten'
          : '0 half-moves including variations',
      );
      await page.screenshot({
        path: `build/verification/import-renderer/${locale}-${width}.png`,
      });
      const accessibility = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      assert.deepEqual(
        accessibility.violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map(({ target }) => target),
        })),
        [],
      );
    }
  }
});
