import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

test('analysis choices survive area changes and a fresh desktop store after reload', async () => {
  const rootState = new ChessJsRulesAdapter().initialState();
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
import { PositionAnalysisPanel } from './position-analysis-panel.tsx';
import { PlysmithApplicationStore } from './plysmith-application-store.ts';
import { messages } from './messages.ts';
import './tokens.css';
const root = createRoot(document.getElementById('root'));
const providers = { providers: [
  { instanceId: 'stockfish', displayName: 'Stockfish', capability: 'objective_position_analysis', status: 'available' },
  { instanceId: 'stockfish-two', displayName: 'Stockfish two', capability: 'objective_position_analysis', status: 'available' },
  { instanceId: 'maia-1600', displayName: 'Maia 1600', capability: 'human_policy_analysis', status: 'available' },
] };
const store = new PlysmithApplicationStore({
  getBootstrap: async () => { throw new Error('No host in panel fixture'); },
});
const calls = [];
const objectiveCalls = [];
store.analyzePosition = (request) => {
  calls.push(request.mode.kind === 'objective' ? request.mode.budget : request.mode.kind);
  if (request.mode.kind === 'objective') objectiveCalls.push(request.providerInstanceId);
  return Promise.resolve({ kind: 'failed' });
};
let generation = 0;
let focus = { focusKey: 'initial', root: ${JSON.stringify(rootState)}, current: ${JSON.stringify(rootState)}, moves: [] };
function render() {
  root.render(<IntlProvider locale="en-GB" messages={messages['en-GB']}>
    <PositionAnalysisPanel key={generation} focus={focus} work={{ scope: { kind: 'free' }, subject: { kind: 'position' } }} locale="en-GB" providers={providers} store={store} />
  </IntlProvider>);
}
window.selectionTest = {
  leaveAndReturn() { generation++; render(); },
  move() { generation++; focus = { ...focus, focusKey: 'next' }; render(); },
  calls() { return calls; },
  dropProvider() {
    const offset = objectiveCalls.length;
    providers.providers = providers.providers.filter((provider) => provider.instanceId !== 'stockfish-two');
    generation++; render();
    return offset;
  },
  objectiveCalls() { return objectiveCalls; },
};
render();`,
    },
    outfile: 'position-analysis-selection.js',
    write: false,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    loader: { '.woff2': 'dataurl' },
    logLevel: 'silent',
  });
  const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'));
  const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'));
  assert.ok(script && css);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) =>
      route.request().url() === 'http://localhost/'
        ? route.fulfill({
            contentType: 'text/html',
            body:
              '<!doctype html><style>' +
              css.text +
              '</style><div id="root"></div><script>' +
              script.text +
              '</script>',
          })
        : route.abort(),
    );
    await page.goto('http://localhost/');
    const maia = page.getByRole('checkbox', { name: 'Maia 1600' });
    await expect(maia).toBeChecked();
    await maia.uncheck();
    await expect(maia).not.toBeChecked();
    const budget = page.getByRole('combobox', { name: 'Thinking time' });
    await budget.selectOption('very_deep');
    await expect(budget).toHaveValue('very_deep');
    await page.evaluate(() =>
      (
        globalThis as unknown as { selectionTest: { leaveAndReturn(): void } }
      ).selectionTest.leaveAndReturn(),
    );
    await expect(budget).toHaveValue('very_deep');
    await expect(maia).not.toBeChecked();
    const callsBeforeMove = await page.evaluate(
      () =>
        (
          globalThis as unknown as { selectionTest: { calls(): string[] } }
        ).selectionTest.calls().length,
    );
    await page.evaluate(() =>
      (
        globalThis as unknown as { selectionTest: { move(): void } }
      ).selectionTest.move(),
    );
    await expect(maia).not.toBeChecked();
    await expect(budget).toHaveValue('very_deep');
    const callsAfterMove = await page.evaluate(() =>
      (
        globalThis as unknown as { selectionTest: { calls(): string[] } }
      ).selectionTest.calls(),
    );
    assert.equal(callsAfterMove.length, callsBeforeMove + 1);
    assert.equal(callsAfterMove.at(-1), 'very_deep');
    await maia.check();
    const sort = page.getByRole('combobox', { name: 'Sort by' });
    await sort.selectOption('maia-1600');
    const objective = page.getByRole('combobox', {
      name: 'Stockfish',
      exact: true,
    });
    await objective.selectOption('stockfish-two');
    await page.reload();
    await expect(budget).toHaveValue('very_deep');
    await expect(maia).toBeChecked();
    await expect(sort).toHaveValue('maia-1600');
    await expect(objective).toHaveValue('stockfish-two');
    await maia.uncheck();
    await page.reload();
    await expect(maia).not.toBeChecked();
    await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveCount(
      0,
    );
    const offset = await page.evaluate(() =>
      (
        globalThis as unknown as { selectionTest: { dropProvider(): number } }
      ).selectionTest.dropProvider(),
    );
    await expect(objective).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          (offset) =>
            (
              globalThis as unknown as {
                selectionTest: { objectiveCalls(): string[] };
              }
            ).selectionTest
              .objectiveCalls()
              .slice(offset),
          offset,
        ),
      )
      .toEqual(['stockfish']);
  } finally {
    await browser.close();
  }
});
