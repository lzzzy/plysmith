import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

test('analysis choices survive leaving the area and a position change', async () => {
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
import { messages } from './messages.ts';
import './tokens.css';
const root = createRoot(document.getElementById('root'));
const providers = { providers: [
  { instanceId: 'stockfish', displayName: 'Stockfish', capability: 'objective_position_analysis', status: 'available' },
  { instanceId: 'maia-1600', displayName: 'Maia 1600', capability: 'human_policy_analysis', status: 'available' },
] };
const store = {
  selection: undefined,
  budget: 'fast',
  calls: [],
  getPositionAnalysisHumanSelection() { return this.selection; },
  setPositionAnalysisHumanSelection(ids) { this.selection = new Set(ids); },
  getPositionAnalysisBudget() { return this.budget; },
  setPositionAnalysisBudget(budget) { this.budget = budget; },
  analyzePosition(request) {
    this.calls.push(request.mode.kind === 'objective' ? request.mode.budget : request.mode.kind);
    return Promise.resolve({ kind: 'failed' });
  },
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
  calls() { return store.calls; },
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
    await page.route('**/*', (route) => route.abort());
    await page.setContent('<!doctype html><div id="root"></div>');
    await page.addStyleTag({ content: css.text });
    await page.addScriptTag({ content: script.text });
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
  } finally {
    await browser.close();
  }
});
