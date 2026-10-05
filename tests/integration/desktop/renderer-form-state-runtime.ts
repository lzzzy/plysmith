// Opt-in renderer regression: isolated browser, no Host or user data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
import { PlayoutActions } from './playout-view.tsx';
import { InventoryMetadataForm } from './inventory-metadata-form.tsx';
import { PlysmithApplicationStore } from './plysmith-application-store.ts';
import { messages } from './messages.ts';
const root = createRoot(document.getElementById('root'));
const store = new PlysmithApplicationStore({});
const calls = [];
store.completePlayout = (...args) => { calls.push(args); return Promise.resolve(true); };
const state = {
  scope: { kind: 'context', contextId: 'context-a' },
  preferences: { uiLocale: 'en-GB' }, inventory: { items: [] },
  inventoryOrganization: { folders: [{ folderId: 'folder-a', displayName: 'Games', itemCount: 0, contextItemCount: 0, contextLinkCount: 1 }], linkedFolderIds: ['folder-a'] },
};
const draft = { draftId: 'game-a', origin: { kind: 'initial_position' }, status: { kind: 'stopped' } };
let mode = 'away';
let metadata = { itemId: 'item-a', displayName: 'Original', summary: 'Original summary' };
function render() {
  root.render(<IntlProvider locale="en-GB" messages={messages['en-GB']}><main>
    {mode === 'playout' && <PlayoutActions key={draft.draftId} state={state} store={store} draft={draft} saved={false} isBusy={false} />}
    {mode === 'metadata' && <InventoryMetadataForm {...metadata} store={store} isBusy={false} saveBlocked={false} onCancel={() => {}} onPrepare={(...args) => calls.push(args)} />}
  </main></IntlProvider>);
}
window.audit = {
  show(next) { mode = next; render(); },
  metadata(patch) { metadata = { ...metadata, ...patch }; render(); },
  scope(contextId, draftId) { state.scope = { kind: 'context', contextId }; draft.draftId = draftId; render(); },
  calls,
};
render();`,
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    loader: { '.module.css': 'empty', '.woff2': 'dataurl' },
    plugins: [
      {
        name: 'private-playout-form',
        setup(builder) {
          builder.onLoad({ filter: /playout-view\.tsx$/ }, async (args) => ({
            contents:
              (await readFile(args.path, 'utf8')) +
              '\nexport { PlayoutActions };',
            loader: 'tsx',
          }));
        },
      },
    ],
    logLevel: 'silent',
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('https://renderer.plysmith.test');
  await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
});

after(async () => {
  await browser?.close();
  assert.deepEqual(errors, []);
});

test('playout form survives area and context switches and saves the retained values', async () => {
  await page.evaluate('window.audit.show("playout")');
  const title = page.locator('input:not([type=checkbox])');
  await title.fill('x'.repeat(161));
  await expect(title).toHaveValue('x'.repeat(160));
  await title.fill('My deliberate game');
  await page.locator('select').first().selectOption('folder-a');
  await page.locator('select').last().selectOption('white_win');
  await page.locator('input[type=checkbox]').uncheck();
  await page.evaluate('window.audit.show("away")');
  await expect(title).toHaveCount(0);
  await page.evaluate('window.audit.show("playout")');
  await expect(title).toHaveValue('My deliberate game');
  await expect(page.locator('select').first()).toHaveValue('folder-a');
  await expect(page.locator('select').last()).toHaveValue('white_win');
  await expect(page.locator('input[type=checkbox]')).not.toBeChecked();
  await page.evaluate('window.audit.scope("context-b", "game-b")');
  await expect(title).toHaveValue('');
  await title.fill('Other game');
  await page.evaluate('window.audit.scope("context-a", "game-a")');
  await expect(title).toHaveValue('My deliberate game');
  await page.getByRole('button').filter({ hasText: /save/i }).click();
  assert.deepEqual(await page.evaluate('window.audit.calls.at(-1)'), [
    'My deliberate game',
    false,
    'white_win',
    'folder-a',
  ]);
});

test('metadata preserves dirty fields, follows clean fields and resets for a new identity', async () => {
  await page.evaluate('window.audit.show("metadata")');
  const name = page.locator('input');
  const summary = page.locator('textarea');
  await name.fill('My unsaved title');
  await page.evaluate(
    'window.audit.metadata({ displayName: "Remote title", summary: "Remote summary" })',
  );
  await expect(name).toHaveValue('My unsaved title');
  await expect(summary).toHaveValue('Remote summary');
  await summary.fill('My unsaved summary');
  await name.fill('Remote title');
  await page.evaluate(
    'window.audit.metadata({ displayName: "Latest title", summary: "Latest summary" })',
  );
  await expect(name).toHaveValue('Latest title');
  await expect(summary).toHaveValue('My unsaved summary');
  await page.getByRole('button', { name: /save/i }).click();
  assert.deepEqual(await page.evaluate('window.audit.calls.at(-1)'), [
    'Latest title',
    'My unsaved summary',
  ]);
  await page.evaluate('window.audit.metadata({ itemId: "item-b" })');
  await expect(name).toHaveValue('Latest title');
  await expect(summary).toHaveValue('Latest summary');
});
