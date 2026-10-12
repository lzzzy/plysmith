// Isolated renderer contract: no Host, filesystem dialogs or user data.
import assert from 'node:assert/strict';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { build } from 'esbuild';
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
import { InventoryBackupSettings } from './inventory-backup-settings.tsx';
import { messages } from './messages.ts';
const root = createRoot(document.getElementById('root'));
let locale = 'en-GB';
let drafts = false;
let calls = [];
let transfer = { phase: 'idle', status: { canRestore: true, blockerCodes: [] } };
const store = {
  hasInventoryRestoreDrafts: () => drafts,
  refreshInventoryBackupStatus: async () => {},
  createInventoryBackup: async () => { calls.push('backup'); },
  prepareInventoryRestore: async () => {
    calls.push('prepare');
    transfer = { ...transfer, phase: 'prepared', preview: { restoreId: 'test-id', fingerprint: 'a'.repeat(64), counts: { analyses: 2, games: 3, folders: 1, provenanceRecords: 4, contributions: 5 }, expiresAt: '2099-01-01T12:10:00.000Z' } };
    render();
  },
  cancelInventoryRestore: async () => { calls.push('cancel'); transfer = { phase: 'idle', status: { canRestore: true, blockerCodes: [] } }; render(); },
  restoreInventory: async () => { calls.push('publish'); transfer = { ...transfer, phase: 'publishing' }; render(); },
};
function render() {
  document.documentElement.lang = locale.slice(0,2);
  root.render(<IntlProvider locale={locale} messages={messages[locale]}><main><InventoryBackupSettings state={{ phase: 'ready', inventoryTransfer: transfer }} store={store}/></main></IntlProvider>);
}
window.audit = {
  setup(nextLocale, localDrafts = false, blocked = false) { locale = nextLocale; drafts = localDrafts; calls = []; transfer = { phase: 'idle', status: { canRestore: !blocked, blockerCodes: blocked ? ['stored_content'] : [] } }; render(); },
  calls: () => calls,
};
render();`,
    },
    outfile: 'backup.js',
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><head><title>Backup test</title></head><body style="margin:16px;font-family:Arial"><div id="root"></div></body></html>',
    }),
  );
  await page.goto('https://renderer.plysmith.test');
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

for (const locale of ['de-DE', 'en-GB'])
  for (const width of [1280, 900, 390]) {
    test(`backup keyboard preview cancellation and guards ${locale} ${width}`, async () => {
      const choose =
        locale === 'de-DE' ? 'Sicherung auswählen' : 'Choose backup';
      const confirm =
        locale === 'de-DE' ? 'Bestand wiederherstellen' : 'Restore inventory';
      const cancel = locale === 'de-DE' ? 'Abbrechen' : 'Cancel';
      const backup =
        locale === 'de-DE' ? 'Bestand sichern' : 'Back up inventory';
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((value) => {
        (
          globalThis as unknown as {
            audit: { setup: (locale: string) => void };
          }
        ).audit.setup(value);
      }, locale);
      await page.getByRole('button', { name: choose, exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toBeVisible();
      const dialogBox = await page.getByRole('dialog').boundingBox();
      const heading = page.getByRole('dialog').getByRole('heading');
      const headingBox = await heading.boundingBox();
      assert(dialogBox && headingBox);
      assert(
        headingBox.x - dialogBox.x >= 16,
        'Dialog heading has inner spacing',
      );
      const headingSize = await page.evaluate<number>(
        'parseFloat(getComputedStyle(document.querySelector("[role=dialog] h2")).fontSize)',
      );
      assert(headingSize <= 20, `Compact dialog heading: ${headingSize}`);
      await expect(
        page.getByRole('button', { name: cancel, exact: true }),
      ).toBeFocused();
      assert.deepEqual(await page.evaluate('window.audit.calls()'), [
        'prepare',
      ]);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: backup, exact: true }),
      ).toBeFocused();
      assert.deepEqual(await page.evaluate('window.audit.calls()'), [
        'prepare',
        'cancel',
      ]);
      await page.getByRole('button', { name: choose, exact: true }).click();
      await page.getByRole('button', { name: confirm, exact: true }).click();
      await expect(
        page.getByRole('button', { name: cancel, exact: true }),
      ).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeVisible();
      assert.equal(
        await page.evaluate<boolean>(
          'document.documentElement.scrollWidth <= innerWidth',
        ),
        true,
      );
      await page.evaluate(`window.audit.setup('${locale}', true)`);
      await expect(
        page.getByRole('button', { name: choose, exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole('button', { name: backup, exact: true }),
      ).toBeEnabled();
      await page.evaluate(`window.audit.setup('${locale}', false, true)`);
      await expect(
        page.getByRole('button', { name: choose, exact: true }),
      ).toBeDisabled();
    });
  }
