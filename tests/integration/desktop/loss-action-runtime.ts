// Opt-in isolated renderer check: node tests/integration/desktop/loss-action-runtime.ts
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AxeBuilder } from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';

const bundle = await build({
  stdin: {
    resolveDir: fileURLToPath(
      new URL(
        '../../../app/infrastructure/channels/ui/renderer',
        import.meta.url,
      ),
    ),
    loader: 'jsx',
    contents: `
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { DestructiveActionDialog } from './manage-view.tsx';
import { RevisionImpactResolutionPanel } from './revision-impact-view.tsx';
import { messages } from './messages.ts';
const root = createRoot(document.getElementById('root'));
const counts = { referenceCount: 2, activeNoteCount: 3, noteMoveCount: 17, scratchCount: 1, scratchMoveCount: 8, scratchNoteCount: 1, managementResumeAffected: true, analysisResumeAffected: false };
const contextPreview = { contextId: 'context', contextName: 'Preparation', contextVersion: 4, dataRevision: 7, referenceCount: 2, items: [{ itemId: 'item', displayName: 'Analysis' }], losses: { notes: [{ contributionId: 'note', body: 'A note', moveCount: 17 }], scratch: { scratchId: 'draft', scratchRevision: 2, stepCount: 8, noteBody: 'Draft note', intent: 'exploration' } }, retainedPlayout: { draftId: 'game', draftRevision: 1, moveCount: 12, status: 'paused' } };
const inventoryPreview = { itemId: 'item', currentRevisionId: 'revision', displayName: 'Analysis', itemType: 'analysis', contexts: [{ ...counts, contextId: 'context', contextName: 'Preparation' }], global: counts, retainedDerivedItemCount: 4, retainedPlayoutCount: 1, dataRevision: 7 };
const revision = { displayName: 'Analysis', revisionNumber: 1, root: { position: { sideToMove: 'white' }, playState: { fullmoveNumber: 1 } }, steps: [] };
let state, locale, mode, generation = 0, calls = [], settle;
function render() {
  root.render(<IntlProvider locale={locale} messages={messages[locale]}><main><h1>Loss preview test</h1>{mode === 'revision' ? <RevisionImpactResolutionPanel key={generation} details={state.revisionImpact} store={store} isBusy={false} /> : <DestructiveActionDialog key={generation} state={state} store={store} />}</main></IntlProvider>);
}
function prepare(kind) { calls.push(kind); state = { ...state, destructiveAction: { ...state.destructiveAction, status: 'loading' } }; render(); }
const store = {
  getSnapshot: () => state,
  cancelDestructiveAction: () => { calls.push('cancel'); state = { ...state, destructiveAction: undefined }; render(); },
  confirmDestructiveAction: async () => { calls.push('confirm'); state = { ...state, destructiveAction: { ...state.destructiveAction, status: 'submitting' } }; render(); return true; },
  prepareContextItemRemoval: () => prepare('context_item'),
  prepareContextDeletion: () => prepare('context'),
  prepareInventoryItemDeletion: () => prepare('inventory'),
  openRevisionImpact: async () => { calls.push('reload'); state = { ...state, revisionImpact: { ...state.revisionImpact } }; render(); },
  resolveRevisionImpact: (request) => { calls.push(request); return new Promise(resolve => { settle = resolve; }); },
};
window.lossTest = {
  show(kind = 'context_item', status = 'ready', language = 'en-GB', name = 'Analysis') {
    generation += 1; calls = []; locale = language; mode = kind;
    const preview = kind === 'inventory' ? inventoryPreview : contextPreview;
    state = { phase: 'ready', scope: { kind: 'context', contextId: 'context' }, selectedInventoryItemId: 'item', inventory: { items: [{ itemId: 'item', currentRevisionId: 'revision', displayName: name }] }, refreshing: false,
      destructiveAction: { kind, status, displayName: name, itemId: 'item', contextId: 'context', preview, errorMessageId: 'unknown.backend.code' },
      revisionImpact: { impact: { impactId: 'impact', impactVersion: 3, dataRevision: 7, useTargetLoss: counts, removeFromContextLoss: { ...counts, activeNoteCount: 13 } }, pinnedRevision: revision, targetRevision: { ...revision, revisionNumber: 2 } } };
    document.documentElement.lang = language;
    render();
  },
  patch(patch) { state = { ...state, ...patch }; render(); },
  changeRevision() { state = { ...state, revisionImpact: { ...state.revisionImpact, impact: { ...state.revisionImpact.impact, dataRevision: 8 } } }; render(); },
  calls: () => calls,
  settle: (success) => settle(success),
};`,
  },
  outfile: 'loss-runtime.js',
  write: false,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.woff2': 'dataurl' },
  metafile: true,
  logLevel: 'silent',
});
assert.ok(
  !Object.keys(bundle.metafile.inputs).some((input) =>
    /host_client|plysmith-application-store\.ts$|bootstrap/.test(input),
  ),
);
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'));
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'));
assert.ok(script && css);

interface FixtureApi {
  show(kind?: string, status?: string, locale?: string, name?: string): void;
  patch(patch: object): void;
  changeRevision(): void;
  calls(): unknown[];
  settle(success: boolean): void;
}
type FixtureGlobal = typeof globalThis & { lossTest: FixtureApi };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const artifacts = await mkdtemp(path.join(os.tmpdir(), 'plysmith-loss-ui-'));
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/*', (route) => route.abort());
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>Loss preview test</title></head><body><div id="root"></div></body></html>',
  );
  await page.addStyleTag({
    content:
      'body { margin: 0; font-family: Arial, sans-serif; color: #252c34; --action-blue: #245cad; --action-blue-border: #17447f; } * { box-sizing: border-box; }' +
      css.text,
  });
  await page.addScriptTag({ content: script.text });
  page.setDefaultTimeout(5000);
  const show = async (
    kind = 'context_item',
    status = 'ready',
    locale = 'en-GB',
    name = 'Analysis',
  ) => {
    await page.evaluate(
      ({ kind, status, locale, name }) =>
        (globalThis as FixtureGlobal).lossTest.show(kind, status, locale, name),
      { kind, status, locale, name },
    );
    await expect(
      page.getByRole(kind === 'revision' ? 'main' : 'dialog'),
    ).toBeVisible();
  };
  const calls = () =>
    page.evaluate(() => (globalThis as FixtureGlobal).lossTest.calls());

  await show('context_item', 'loading');
  await expect(
    page.getByRole('button', { name: 'Confirm removal' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.deepEqual(await calls(), ['cancel']);
  console.log('PASS loading is read-only and Escape cancels');

  await show('context');
  assert.deepEqual(await calls(), []);
  await page
    .getByRole('button', { name: 'Delete working context', exact: true })
    .click();
  await expect.poll(calls).toEqual(['confirm']);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  console.log(
    'PASS context mutation needs confirmation and submitting locks dismissal',
  );

  for (const status of ['stale', 'error']) {
    await show('context_item', status);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Confirm removal' }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Reload preview' }).click();
    assert.deepEqual(await calls(), ['context_item']);
    await expect(
      page.getByRole('button', { name: 'Confirm removal' }),
    ).toBeDisabled();
  }
  await show('inventory');
  await page.evaluate(() =>
    (globalThis as FixtureGlobal).lossTest.patch({
      selectedInventoryItemId: 'other',
    }),
  );
  await expect(
    page.getByRole('button', { name: 'Delete inventory item', exact: true }),
  ).toBeDisabled();
  assert.deepEqual(await calls(), []);
  console.log('PASS stale/error reload and selection mismatch cannot mutate');

  for (const locale of ['de-DE', 'en-GB']) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await show(
        'inventory',
        'ready',
        locale,
        'VeryLongInventoryName'.repeat(10),
      );
      await expect(page.getByRole('dialog').locator('dl')).toHaveCount(2);
      assert.equal(
        await page.evaluate(() => {
          const viewport = globalThis as unknown as {
            document: { documentElement: { scrollWidth: number } };
            innerWidth: number;
          };
          return (
            viewport.document.documentElement.scrollWidth > viewport.innerWidth
          );
        }),
        false,
      );
      const overflow = await page.getByRole('dialog').evaluate((element) => {
        const bounds = element as unknown as {
          scrollWidth: number;
          clientWidth: number;
        };
        return bounds.scrollWidth > bounds.clientWidth;
      });
      assert.equal(overflow, false);
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations.map(
          (violation) => violation.id,
        ),
        [],
      );
      await page.screenshot({
        path: path.join(artifacts, `${locale}-${width}.png`),
        fullPage: true,
      });
    }
  }
  console.log('PASS inventory preview DE/EN, wide/narrow, long names and Axe');

  await page.setViewportSize({ width: 1280, height: 900 });
  await show('revision');
  await page
    .getByRole('button', { name: 'Use new version', exact: true })
    .click();
  assert.deepEqual(await calls(), []);
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert.deepEqual(await calls(), []);
  await page
    .getByRole('button', { name: 'Use new version', exact: true })
    .click();
  await page.evaluate(() =>
    (globalThis as FixtureGlobal).lossTest.changeRevision(),
  );
  await expect(
    page.getByRole('button', { name: 'Confirm decision' }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Use new version', exact: true })
    .click();
  await page.getByRole('button', { name: 'Confirm decision' }).click();
  assert.deepEqual(await calls(), [
    {
      expectedImpactVersion: 3,
      expectedDataRevision: 8,
      resolution: { kind: 'use_target' },
    },
  ]);
  await expect(
    page.getByRole('button', { name: 'Confirm decision' }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (globalThis as FixtureGlobal).lossTest.settle(false),
  );
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Use new version', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Reload preview', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Use new version', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  console.log(
    'PASS revision cancellation, changed counts, bound confirmation and local failure',
  );
  await show('revision');
  await page
    .getByRole('button', { name: 'Remove from context', exact: true })
    .click();
  assert.deepEqual(await calls(), []);
  await page.getByRole('button', { name: 'Confirm decision' }).click();
  assert.deepEqual(await calls(), [
    {
      expectedImpactVersion: 3,
      expectedDataRevision: 7,
      resolution: { kind: 'remove_from_context' },
    },
  ]);
  await page.evaluate(() =>
    (globalThis as FixtureGlobal).lossTest.settle(true),
  );
  await show('revision');
  await page
    .getByRole('button', { name: 'Keep analysis', exact: true })
    .click();
  assert.deepEqual(await calls(), [
    {
      expectedImpactVersion: 3,
      expectedDataRevision: 7,
      resolution: { kind: 'keep_copy', displayName: 'Analysis (Copy)' },
    },
  ]);
  await page.evaluate(() =>
    (globalThis as FixtureGlobal).lossTest.settle(true),
  );
  console.log('PASS all revision options send their confirmed data revision');
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${artifacts}`);
} finally {
  await browser.close();
}
