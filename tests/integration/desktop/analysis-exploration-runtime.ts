// Opt-in isolated renderer check: node tests/integration/desktop/analysis-exploration-runtime.ts
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

const rules = new ChessJsRulesAdapter();
const rootState = rules.initialState();
const prefixMoves = [];
const prefix = [];
for (const value of ['e4', 'c5']) {
  const result = rules.applyMove(rootState, prefixMoves, {
    kind: 'notation',
    value,
    locale: 'en-GB',
  });
  assert.ok(result.ok);
  prefix.push({ ...result.value, anchorId: String(prefix.length + 14) });
  prefixMoves.push(result.value.move);
}
const endState = prefix.at(-1)!.after;
const moves = [];
const steps = [];
for (const value of ['Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'g6']) {
  const result = rules.applyMove(endState, moves, {
    kind: 'notation',
    value,
    locale: 'en-GB',
  });
  assert.ok(result.ok);
  steps.push(result.value);
  moves.push(result.value.move);
}
const fixture = { rootState, endState, prefix, steps };
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
import { AnalysisView } from './analysis-view.tsx';
import { messages } from './messages.ts';
import './tokens.css';
const data = ${JSON.stringify(fixture)};
const root = createRoot(document.getElementById('root'));
let state, locale, generation = 0, calls = [];
function render() {
  root.render(<IntlProvider locale={locale} messages={messages[locale]}><AnalysisView key={generation} state={state} store={store} /></IntlProvider>);
}
function revise(intent) {
  const scratch = { ...state.analysis.scratch, scratchRevision: state.analysis.scratch.scratchRevision + 1, intent };
  state = { ...state, analysis: { ...state.analysis, scratch, allowedActions: intent.kind === 'exploration' ? ['apply_move', 'discard_scratch'] : ['continue_exploration', 'discard_scratch'] }, inventoryRevisionPreview: intent.kind === 'exploration' ? undefined : { itemId: '11', baseRevisionId: '12', mode: 'extend', displayName: 'Sizilianisch', preservedMoveCount: 2, addedSteps: scratch.steps, removedSteps: [], followingContexts: [], affectedContexts: [], noOp: false } };
  render();
}
const store = {
  canWorkWithInventoryItem: () => true,
  promoteAnalysisToInventoryRevision: async () => { calls.push('promote'); revise({ kind: 'inventory_revision', mode: 'extend', itemId: '11', baseRevisionId: '12', cutAnchorId: '15', returnAnchorId: '15', displayName: 'Sizilianisch' }); },
  continueAnalysisExploration: async () => { calls.push('continue'); revise({ kind: 'exploration' }); },
  createAnalysisRecord: async (...args) => { calls.push({ kind: 'save_record', args }); return true; },
  prepareAnalysisNote: async () => { calls.push('note'); },
  discardAnalysisScratch: async () => { calls.push('discard'); },
  saveInventoryRevision: async () => { calls.push('save_revision'); return true; },
};
window.analysisTest = {
  show(mode = 'end', scopeKind = 'context', language = 'en-GB') {
    generation += 1; calls = []; locale = language;
    const scope = scopeKind === 'context' ? { kind: 'context', contextId: '7' } : { kind: 'free' };
    const independent = mode === 'root' || mode === 'fresh_path';
    const pathSteps = mode === 'root' ? [] : mode === 'fresh_path' ? [...data.prefix.map(({ anchorId, ...step }) => step), ...data.steps] : data.steps;
    const record = independent ? undefined : { itemType: 'analysis', itemId: '11', revisionId: '12', currentRevisionId: '12', revisionNumber: 1, displayName: 'Sizilianisch', rootAnchorId: '13', currentAnchorId: '15', root: data.rootState, steps: data.prefix, cursor: 2, origin: { kind: 'initial_position' }, historical: false, contributions: [], contextMember: scopeKind === 'context' };
    const scratch = { scratchId: 'dragon-path', scratchRevision: 7, intent: mode === 'revision' ? { kind: 'inventory_revision', mode: 'extend', itemId: '11', baseRevisionId: '12', cutAnchorId: '15', returnAnchorId: '15', displayName: 'Sizilianisch' } : { kind: 'exploration' }, origin: independent ? { kind: 'initial_position' } : { kind: 'inventory_anchor', itemId: '11', revisionId: '12', anchorId: mode === 'middle' ? '14' : '15' }, root: independent ? data.rootState : data.endState, steps: pathSteps, cursor: pathSteps.length };
    state = { phase: 'ready', scope, activity: 'analyze', preferences: { uiLocale: locale }, refreshing: false, analysisProviders: { providers: [], dataRevision: 0 }, analysis: { scope, contextName: 'Opening library', record, scratch, dataRevision: 0, currentState: pathSteps.at(-1)?.after ?? scratch.root, legalMoves: [], allowedActions: mode === 'revision' ? ['continue_exploration', 'discard_scratch'] : ['apply_move', 'discard_scratch'] } };
    document.documentElement.lang = locale; render();
  },
  calls: () => calls,
  snapshot: () => state.analysis.scratch,
  clearPath() {
    const scratch = { ...state.analysis.scratch, scratchRevision: state.analysis.scratch.scratchRevision + 1, steps: [], cursor: 0 };
    state = { ...state, analysis: { ...state.analysis, scratch, currentState: scratch.root } };
    render();
  },
};`,
  },
  outfile: 'analysis-exploration-runtime.js',
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
  show(mode: string, scopeKind: string, locale: string): void;
  calls(): unknown[];
  snapshot(): object;
  clearPath(): void;
}
type FixtureGlobal = typeof globalThis & { analysisTest: FixtureApi };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const artifacts = await mkdtemp(
  path.join(os.tmpdir(), 'plysmith-analysis-exploration-'),
);
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/*', (route) => route.abort());
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>Analysis exploration test</title></head><body><div id="root"></div></body></html>',
  );
  await page.addStyleTag({ content: css.text });
  await page.addScriptTag({ content: script.text });
  const calls = () =>
    page.evaluate(() => (globalThis as FixtureGlobal).analysisTest.calls());
  const show = async (mode: string, scopeKind: string, locale: string) => {
    await page.evaluate(
      ({ mode, scopeKind, locale }) =>
        (globalThis as FixtureGlobal).analysisTest.show(
          mode,
          scopeKind,
          locale,
        ),
      { mode, scopeKind, locale },
    );
    await expect(page.getByRole('main')).toBeVisible();
  };
  for (const locale of ['de-DE', 'en-GB']) {
    const de = locale === 'de-DE';
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const scope of ['free', 'context']) {
        await show('end', scope, locale);
        await page
          .locator('[aria-controls="analysis-actions-details"]')
          .click();
        const promote = page.getByRole('button', {
          name: de ? 'Hauptvariante verlängern' : 'Extend main line',
          exact: true,
        });
        const saveRecord = page.getByRole('button', {
          name: de
            ? 'Als eigene Analyse speichern'
            : 'Save as separate analysis',
          exact: true,
        });
        await expect(promote).toBeVisible();
        await expect(saveRecord).toBeVisible();
        assert.deepEqual(await calls(), []);
        await promote.click();
        await page.locator('[aria-controls="revision-details"]').click();
        await expect(
          page.getByRole('button', {
            name: de ? 'Speichern' : 'Save',
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole('button', {
            name: de
              ? 'Als Analysepfad weiterführen'
              : 'Continue as analysis path',
            exact: true,
          })
          .click();
        await expect(saveRecord).toBeVisible();
        const scratch = await page.evaluate(() =>
          (globalThis as FixtureGlobal).analysisTest.snapshot(),
        );
        assert.equal(
          (scratch as { scratchId: string }).scratchId,
          'dragon-path',
        );
        assert.equal((scratch as { steps: unknown[] }).steps.length, 6);
        await saveRecord.click();
        await page.locator('#analysis-title').fill('Dragon');
        await page
          .getByRole('button', {
            name: de ? 'Analyse speichern' : 'Save analysis',
            exact: true,
          })
          .click();
        assert.deepEqual(await calls(), [
          'promote',
          'continue',
          {
            kind: 'save_record',
            args: [
              'Dragon',
              scope === 'context' ? 'context' : 'inventory',
              scope === 'context' ? 'context' : 'global',
              '',
            ],
          },
        ]);
        await show('root', scope, locale);
        await page
          .locator('[aria-controls="analysis-actions-details"]')
          .click();
        await saveRecord.click();
        await page.locator('#analysis-title').fill('Opening library');
        await expect(page.locator('#analysis-record-note')).toHaveCount(0);
        await page
          .getByRole('button', {
            name: de ? 'Analyse speichern' : 'Save analysis',
            exact: true,
          })
          .click();
        assert.deepEqual(await calls(), [
          {
            kind: 'save_record',
            args: [
              'Opening library',
              scope === 'context' ? 'context' : 'inventory',
              scope === 'context' ? 'context' : 'global',
              '',
            ],
          },
        ]);
        assert.equal(
          (
            (await page.evaluate(() =>
              (globalThis as FixtureGlobal).analysisTest.snapshot(),
            )) as { steps: unknown[] }
          ).steps.length,
          0,
        );
        await show('fresh_path', scope, locale);
        await page
          .locator('[aria-controls="analysis-actions-details"]')
          .click();
        await saveRecord.click();
        await page.locator('#analysis-title').fill('Path root');
        await page.locator('#analysis-record-note').fill('Unsaved path note');
        await page.evaluate(() =>
          (globalThis as FixtureGlobal).analysisTest.clearPath(),
        );
        await expect(page.locator('#analysis-record-note')).toHaveCount(0);
        await page
          .getByRole('button', {
            name: de ? 'Analyse speichern' : 'Save analysis',
            exact: true,
          })
          .click();
        assert.deepEqual(await calls(), [
          {
            kind: 'save_record',
            args: [
              'Path root',
              scope === 'context' ? 'context' : 'inventory',
              scope === 'context' ? 'context' : 'global',
              '',
            ],
          },
        ]);
      }
      await show('revision', 'context', locale);
      await page.locator('[aria-controls="revision-details"]').click();
      await expect(
        page.getByRole('button', {
          name: de
            ? 'Als Analysepfad weiterführen'
            : 'Continue as analysis path',
          exact: true,
        }),
      ).toBeVisible();
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      if (axe.violations.length > 0)
        console.error(JSON.stringify(axe.violations, null, 2));
      assert.deepEqual(
        axe.violations.map(
          (violation) => `${violation.id}: ${violation.description}`,
        ),
        [],
      );
      assert.ok(
        await page.evaluate(
          'document.documentElement.scrollWidth <= innerWidth',
        ),
      );
      await page.screenshot({
        path: path.join(artifacts, `${locale}-${width}-revision.png`),
        fullPage: true,
      });
      await show('end', 'context', locale);
      await page.locator('[aria-controls="analysis-actions-details"]').click();
      await expect(
        page.getByRole('button', {
          name:
            locale === 'de-DE'
              ? 'Pfad in Notiz übernehmen'
              : 'Turn path into note',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', {
          name:
            locale === 'de-DE'
              ? 'Analysepfad verwerfen'
              : 'Discard analysis path',
          exact: true,
        }),
      ).toBeVisible();
      const explorationAxe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      assert.deepEqual(
        explorationAxe.violations.map((violation) => violation.id),
        [],
      );
      await page.screenshot({
        path: path.join(artifacts, `${locale}-${width}-exploration.png`),
        fullPage: true,
      });
      await show('middle', 'free', locale);
      await page.locator('[aria-controls="analysis-actions-details"]').click();
      await expect(
        page.getByRole('button', {
          name: de
            ? 'Hauptvariante ab hier ersetzen'
            : 'Replace main line from here',
          exact: true,
        }),
      ).toBeVisible();
      console.log(
        `PASS ${locale} ${width}px: neutral choices, explicit promotion/back, six-move save, empty library root, middle label, Axe`,
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Screenshots: ${artifacts}`);
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser.close();
}
