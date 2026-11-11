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
import type {
  PlysmithApplicationState,
  PlysmithApplicationStore,
} from '../../../app/infrastructure/channels/ui/renderer/plysmith-application-store.ts';

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
const middleState = prefix[0]!.after;
const middleMoves = [];
const middleSteps = [];
for (const value of ['e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4']) {
  const result = rules.applyMove(middleState, middleMoves, {
    kind: 'notation',
    value,
    locale: 'en-GB',
  });
  assert.ok(result.ok);
  middleSteps.push(result.value);
  middleMoves.push(result.value.move);
}
const fixture = {
  rootState,
  endState,
  middleState,
  prefix,
  steps,
  middleSteps,
};
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
import { flushSync } from 'react-dom';
import { IntlProvider } from 'react-intl';
import { AnalysisView } from './analysis-view.tsx';
import { messages } from './messages.ts';
import './tokens.css';
const data = ${JSON.stringify(fixture)};
const root = createRoot(document.getElementById('root'));
let state, locale, generation = 0, calls = [], choice, recordForm, pathNoteForm;
function render() {
  flushSync(() => root.render(<IntlProvider locale={locale} messages={messages[locale]}><AnalysisView key={generation} state={state} store={store} /></IntlProvider>));
}
function revise(intent) {
  const scratch = { ...state.analysis.scratch, scratchRevision: state.analysis.scratch.scratchRevision + 1, intent };
  const record = state.analysis.record;
  const preservedMoveCount = record?.steps.findIndex(step => step.anchorId === scratch.origin.anchorId) + 1;
  state = { ...state, analysis: { ...state.analysis, scratch, allowedActions: intent.kind === 'exploration' ? ['apply_move', 'discard_scratch'] : ['apply_move', 'continue_exploration', 'discard_scratch'] }, inventoryRevisionPreview: intent.kind === 'exploration' ? undefined : { itemId: record.itemId, baseRevisionId: record.revisionId, mode: intent.mode, displayName: record.displayName, preservedMoveCount, addedSteps: scratch.steps, removedSteps: intent.mode === 'add_variation' ? [] : record.steps.slice(preservedMoveCount), historicalGlobalContributionCount: 0, followingContexts: [], affectedContexts: [], noOp: false } };
}
function revisionIntent(mode) {
  const { scratch, record } = state.analysis;
  return { kind: 'inventory_revision', mode, itemId: record.itemId, baseRevisionId: record.revisionId, cutAnchorId: scratch.origin.anchorId, returnAnchorId: scratch.origin.anchorId, displayName: record.displayName };
}
const store = {
  canWorkWithInventoryItem: () => true,
  getPositionAnalysisBudget: () => 'fast',
  getPositionAnalysisSort: () => 'stockfish',
  getPositionAnalysisHumanSelection: () => undefined,
  checkInventoryName: async () => undefined,
  getAnalysisAcceptanceChoice: () => choice,
  selectAnalysisAcceptance: async (target, mode = 'add_variation') => {
    calls.push({ kind: 'select', target, mode });
    if (state.analysis.scratch.intent.kind === 'inventory_revision') revise({ kind: 'exploration' });
    choice = { target, mode };
    if (target === 'inventory') {
      const atEnd = state.analysis.scratch.origin.anchorId === state.analysis.record.steps.at(-1)?.anchorId;
      revise(revisionIntent(mode === 'add_variation' ? mode : atEnd ? 'extend' : 'truncate_after'));
    }
    render();
  },
  getAnalysisRecordForm: () => recordForm,
  setAnalysisRecordForm: (_scope, _scratchId, draft) => { recordForm = draft; },
  getPathNoteFormDraft: () => pathNoteForm,
  setPathNoteFormDraft: (scratchId, body, noteScope, preparedBody) => {
    pathNoteForm = { scratchId, body, noteScope, preparedBody };
  },
  // Save spies prove renderer arguments only; native checks cover persistence.
  createAnalysisRecord: async (...args) => { calls.push({ kind: 'save_record', args }); return true; },
  createAnalysisNote: async (...args) => { calls.push({ kind: 'save_note', args }); return true; },
  discardAnalysisScratch: async () => { calls.push('discard'); },
  saveInventoryRevision: async (...args) => { calls.push({ kind: 'save_revision', args }); return true; },
};
window.analysisTest = {
  show(mode = 'end', scopeKind = 'context', language = 'en-GB') {
    generation += 1; calls = []; choice = recordForm = pathNoteForm = undefined; locale = language;
    const scope = scopeKind === 'context' ? { kind: 'context', contextId: '7' } : { kind: 'free' };
    const independent = mode === 'root' || mode === 'fresh_path';
    const middle = mode === 'middle';
    const pathSteps = mode === 'root' ? [] : mode === 'fresh_path' ? [...data.prefix.map(({ anchorId, ...step }) => step), ...data.steps] : middle ? data.middleSteps : data.steps;
    const record = independent ? undefined : { itemType: 'analysis', itemId: '11', revisionId: '12', currentRevisionId: '12', revisionNumber: 1, displayName: 'Sizilianisch', rootAnchorId: '13', currentAnchorId: middle ? '14' : '15', root: data.rootState, steps: data.prefix, cursor: middle ? 1 : 2, origin: { kind: 'initial_position' }, historical: false, contributions: [], contextMember: scopeKind === 'context' };
    const scratch = { scratchId: 'dragon-path', scratchRevision: 7, intent: { kind: 'exploration' }, origin: independent ? { kind: 'initial_position' } : { kind: 'inventory_anchor', itemId: '11', revisionId: '12', anchorId: middle ? '14' : '15' }, root: independent ? data.rootState : middle ? data.middleState : data.endState, steps: pathSteps, cursor: pathSteps.length };
    state = { phase: 'ready', useWorkingContexts: true, scope, activity: 'analyze', preferences: { uiLocale: locale }, refreshing: false, inventory: { items: [], dataRevision: 0 }, inventoryOrganization: { folders: [], linkedFolderIds: [], dataRevision: 0 }, analysisProviders: { providers: [], dataRevision: 0 }, analysis: { scope, contextName: 'Opening library', record, scratch, dataRevision: 0, currentState: pathSteps.at(-1)?.after ?? scratch.root, legalMoves: [], allowedActions: ['apply_move', 'discard_scratch'] } };
    if (mode === 'revision') revise(revisionIntent('extend'));
    document.documentElement.lang = locale; render();
  },
  calls: () => calls,
  snapshot: () => ({ analysis: state.analysis, preview: state.inventoryRevisionPreview, choice }),
  // Simulate a refreshed independent scratch; do not clear local form text.
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
  !Object.values(bundle.metafile.outputs).some((output) =>
    Object.entries(output.inputs).some(
      ([input, details]) =>
        details.bytesInOutput > 0 &&
        /host_client|plysmith-application-store\.ts$|bootstrap/.test(input),
    ),
  ),
);
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'));
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'));
assert.ok(script && css);
type ReadyState = Extract<PlysmithApplicationState, { phase: 'ready' }>;
interface FixtureApi {
  show(mode: string, scopeKind: string, locale: string): void;
  calls(): unknown[];
  snapshot(): {
    analysis: NonNullable<ReadyState['analysis']>;
    preview: ReadyState['inventoryRevisionPreview'];
    choice: ReturnType<PlysmithApplicationStore['getAnalysisAcceptanceChoice']>;
  };
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
  const snapshot = () =>
    page.evaluate(() => (globalThis as FixtureGlobal).analysisTest.snapshot());
  const assertPathPreserved = async (
    before: Awaited<ReturnType<typeof snapshot>>,
  ) => {
    const after = await snapshot();
    assert.ok(before.analysis.scratch && after.analysis.scratch);
    for (const key of [
      'scratchId',
      'origin',
      'root',
      'steps',
      'cursor',
    ] as const)
      assert.deepEqual(
        after.analysis.scratch[key],
        before.analysis.scratch[key],
      );
    assert.deepEqual(after.analysis.record, before.analysis.record);
    return after;
  };
  const selection = (target: string, mode = 'add_variation') => ({
    kind: 'select',
    target,
    mode,
  });
  const audit = async (name: string) => {
    await page.screenshot({
      path: path.join(artifacts, name + '.png'),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate<boolean>(
        'document.documentElement.scrollWidth <= innerWidth',
      ),
      name + ': horizontal overflow',
    );
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    if (axe.violations.length > 0)
      console.error(JSON.stringify(axe.violations, null, 2));
    assert.deepEqual(
      axe.violations.map(
        (violation) => violation.id + ': ' + violation.description,
      ),
      [],
      name,
    );
  };
  for (const locale of ['de-DE', 'en-GB']) {
    const de = locale === 'de-DE';
    const target = page.getByRole('combobox', {
      name: de ? 'Übernehmen als' : 'Accept as',
      exact: true,
    });
    const mode = page.getByRole('combobox', {
      name: de ? 'Übernahmeart' : 'How to accept',
      exact: true,
    });
    const saveRecord = page.getByRole('button', {
      name: de ? 'Analyse speichern' : 'Save analysis',
      exact: true,
    });
    const saveNote = page.getByRole('button', {
      name: de ? 'Notiz speichern' : 'Save note',
      exact: true,
    });
    const saveVariation = page.getByRole('button', {
      name: de ? 'Als Variante speichern' : 'Save as variation',
      exact: true,
    });
    const extend = page.getByRole('button', {
      name: de ? 'Zugfolge verlängern' : 'Extend line',
      exact: true,
    });
    const replace = page.getByRole('button', {
      name: de
        ? 'Hauptvariante ab hier ersetzen'
        : 'Replace main line from here',
      exact: true,
    });
    const discard = page.getByRole('button', {
      name: de ? 'Analysepfad verwerfen' : 'Discard analysis path',
      exact: true,
    });
    const acknowledgeLoss = page.getByRole('checkbox', {
      name: de
        ? /Nicht übernommene Texte in den Speicherformularen/
        : /Explicitly discard text in the save forms/,
    });
    const globalNote = page.getByRole('radio', {
      name: de ? 'Im gesamten Bestand' : 'Throughout the inventory',
      exact: true,
    });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const scope of ['free', 'context']) {
        const destination = scope === 'context' ? 'context' : 'inventory';
        const caseName = `${locale}-${width}-${scope}`;
        await show('end', scope, locale);
        const original = await snapshot();
        assert.deepEqual(original.analysis.scratch?.steps, steps);
        await expect(target).toBeVisible();
        await expect(target).toHaveValue('');
        await expect(target.locator('option')).toHaveText(
          de
            ? ['Ziel auswählen', 'Notiz', 'In dieser Analyse', 'Eigene Analyse']
            : [
                'Choose a destination',
                'Note',
                'In this analysis',
                'Separate analysis',
              ],
        );
        for (const value of ['note', 'inventory', 'record'])
          await expect(
            target.locator('option[value="' + value + '"]'),
          ).toBeEnabled();
        await expect(discard).toBeEnabled();
        assert.deepEqual(await calls(), []);

        // Destination changes preserve both independently edited forms.
        await target.selectOption('note');
        await expect(page.locator('#analysis-path-note')).not.toHaveValue('');
        if (scope === 'context') await expect(globalNote).toBeChecked();
        await page.locator('#analysis-path-note').fill('Remember the Dragon');
        await target.selectOption('record');
        await page.locator('#analysis-title').fill('Dragon');
        await page.locator('#analysis-record-note').fill('Dragon comment');
        if (scope === 'context') await expect(globalNote).toBeChecked();
        await assertPathPreserved(original);
        assert.deepEqual(await calls(), [
          selection('note'),
          selection('record'),
        ]);

        // Structural acceptance defaults to a variation, including at line end.
        await target.selectOption('inventory');
        await expect(mode).toHaveValue('add_variation');
        await expect(page.locator('#revision-details')).toBeVisible();
        await expect(saveVariation).toBeVisible();
        await expect(saveVariation).toBeDisabled();
        let current = await assertPathPreserved(original);
        assert.deepEqual(current.choice, {
          target: 'inventory',
          mode: 'add_variation',
        });
        assert.equal(current.preview?.mode, 'add_variation');
        assert.deepEqual(current.preview?.removedSteps, []);
        assert.deepEqual(current.preview?.addedSteps, steps);

        await mode.selectOption('continuation');
        await expect(extend).toBeVisible();
        await expect(extend).toBeDisabled();
        await expect(page.locator('#revision-details ins')).toHaveCount(6);
        await expect(page.locator('#revision-details del')).toHaveCount(0);
        current = await assertPathPreserved(original);
        assert.equal(current.preview?.mode, 'extend');
        assert.equal(current.preview?.preservedMoveCount, 2);
        assert.deepEqual(current.preview?.addedSteps, steps);
        await audit(caseName + '-revision');

        // The destination selector is also the lossless route out of preview.
        await target.selectOption('note');
        await expect(page.locator('#revision-details')).toHaveCount(0);
        await expect(page.locator('#analysis-path-note')).toHaveValue(
          'Remember the Dragon',
        );
        await expect(saveNote).toBeDisabled();
        if (scope === 'context') await expect(globalNote).toBeChecked();
        current = await assertPathPreserved(original);
        assert.equal(current.analysis.scratch?.intent.kind, 'exploration');
        assert.equal(current.preview, undefined);
        await target.selectOption('record');
        await expect(page.locator('#analysis-title')).toHaveValue('Dragon');
        await expect(page.locator('#analysis-record-note')).toHaveValue(
          'Dragon comment',
        );
        if (scope === 'context') await expect(globalNote).toBeChecked();
        await expect(saveRecord).toBeDisabled();
        const changes = [
          selection('note'),
          selection('record'),
          selection('inventory'),
          selection('inventory', 'continuation'),
          selection('note'),
          selection('record'),
        ];
        assert.deepEqual(await calls(), changes);
        await expect(acknowledgeLoss).not.toBeChecked();
        await acknowledgeLoss.check();
        await expect(saveRecord).toBeEnabled();
        await assertPathPreserved(original);
        await saveRecord.click();
        assert.deepEqual(await calls(), [
          ...changes,
          {
            kind: 'save_record',
            args: [
              'Dragon',
              destination,
              'global',
              'Dragon comment',
              undefined,
            ],
          },
        ]);

        // An independent root needs no move, and has no implicit comment.
        await show('root', scope, locale);
        await expect(target).toHaveValue('record');
        await expect(target.locator('option[value="note"]')).toBeDisabled();
        await expect(
          target.locator('option[value="inventory"]'),
        ).toBeDisabled();
        await page.locator('#analysis-title').fill('Opening library');
        await expect(page.locator('#analysis-record-note')).toHaveCount(0);
        assert.deepEqual((await snapshot()).analysis.scratch?.steps, []);
        assert.equal((await snapshot()).analysis.scratch?.cursor, 0);
        await expect(saveRecord).toBeEnabled();
        assert.deepEqual(await calls(), []);
        await saveRecord.click();
        assert.deepEqual(await calls(), [
          {
            kind: 'save_record',
            args: ['Opening library', destination, 'global', '', null],
          },
        ]);

        // A refreshed zero-move path must keep its now-inapplicable comment
        // visible and block saving until the user explicitly discards it.
        await show('fresh_path', scope, locale);
        await expect(target).toHaveValue('record');
        await page.locator('#analysis-title').fill('Path root');
        await page.locator('#analysis-record-note').fill('Unsaved path note');
        await page.evaluate(() =>
          (globalThis as FixtureGlobal).analysisTest.clearPath(),
        );
        await expect(page.locator('#analysis-record-note')).toHaveValue(
          'Unsaved path note',
        );
        await expect(
          page.getByText(
            de
              ? 'Ohne ausgewählte Halbzüge wird der Kommentar nicht übernommen. Entfernen Sie den Text oder bestätigen Sie sein Verwerfen vor dem Speichern.'
              : 'Without selected half-moves, this comment is not included. Clear the text or acknowledge discarding it before saving.',
            { exact: true },
          ),
        ).toBeVisible();
        await expect(saveRecord).toBeDisabled();
        await expect(discard).toBeDisabled();
        await expect(acknowledgeLoss).not.toBeChecked();
        assert.deepEqual(await calls(), []);
        await acknowledgeLoss.check();
        await expect(saveRecord).toBeEnabled();
        // Editing the text invalidates an earlier loss acknowledgement.
        await page
          .locator('#analysis-record-note')
          .fill('Revised unsaved path note');
        await expect(acknowledgeLoss).not.toBeChecked();
        await expect(saveRecord).toBeDisabled();
        assert.deepEqual(await calls(), []);
        await acknowledgeLoss.check();
        await saveRecord.click();
        assert.deepEqual(await calls(), [
          {
            kind: 'save_record',
            args: ['Path root', destination, 'global', '', null],
          },
        ]);

        // A restored revision exposes the same selector and exit route.
        await show('revision', scope, locale);
        const restored = await snapshot();
        await expect(target).toHaveValue('inventory');
        await expect(mode).toHaveValue('continuation');
        await expect(page.locator('#revision-details')).toBeVisible();
        await expect(extend).toBeEnabled();
        assert.deepEqual(await calls(), []);
        await target.selectOption('record');
        await expect(page.locator('#analysis-title')).toBeVisible();
        current = await assertPathPreserved(restored);
        assert.equal(current.analysis.scratch?.intent.kind, 'exploration');
        assert.equal(current.preview, undefined);
        await target.selectOption('note');
        await expect(saveNote).toBeEnabled();
        await expect(discard).toBeEnabled();
        if (scope === 'context') await expect(globalNote).toBeChecked();
        const noteBody = await page.locator('#analysis-path-note').inputValue();
        assert.match(noteBody, de ? /Sf3/ : /Nf3/);
        assert.match(noteBody, /g6/);
        await assertPathPreserved(restored);
        await audit(caseName + '-exploration');
        assert.deepEqual(await calls(), [
          selection('record'),
          selection('note'),
        ]);
        await saveNote.click();
        assert.deepEqual(await calls(), [
          selection('record'),
          selection('note'),
          { kind: 'save_note', args: ['global', noteBody] },
        ]);

        // At an interior anchor, only explicit continuation replaces the suffix.
        await show('middle', scope, locale);
        const middle = await snapshot();
        assert.equal(middle.analysis.scratch?.root.fen, middleState.fen);
        assert.deepEqual(middle.analysis.scratch?.steps, middleSteps);
        await target.selectOption('inventory');
        await expect(mode).toHaveValue('add_variation');
        await expect(saveVariation).toBeEnabled();
        current = await assertPathPreserved(middle);
        assert.deepEqual(current.preview?.removedSteps, []);
        await expect(mode.locator('option[value="continuation"]')).toHaveText(
          de ? 'Hauptvariante ab hier ersetzen' : 'Replace main line from here',
        );
        await mode.selectOption('continuation');
        await expect(replace).toBeEnabled();
        await expect(extend).toHaveCount(0);
        await expect(page.locator('#revision-details del')).toHaveText([
          '1... c5',
        ]);
        await expect(page.locator('#revision-details ins')).toHaveCount(6);
        current = await assertPathPreserved(middle);
        assert.equal(current.preview?.mode, 'truncate_after');
        assert.equal(current.preview?.preservedMoveCount, 1);
        assert.deepEqual(current.preview?.removedSteps, [prefix[1]]);
        assert.deepEqual(current.preview?.addedSteps, middleSteps);
        assert.deepEqual(await calls(), [
          selection('inventory'),
          selection('inventory', 'continuation'),
        ]);
        await replace.click();
        assert.deepEqual(await calls(), [
          selection('inventory'),
          selection('inventory', 'continuation'),
          { kind: 'save_revision', args: [undefined] },
        ]);
        console.log(
          `PASS ${caseName}: three destinations, preserved forms and six half-moves, variation/continuation preview and return, global note/record arguments, root-only, explicit comment loss, middle replacement, Axe/reflow`,
        );
      }
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
