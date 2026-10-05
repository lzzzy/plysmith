// Opt-in renderer regression: real board and controls, isolated from Host/user data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { pausedPlayoutDto } from '../../contract/playout-fixtures.ts';
import type { CanonicalMove } from '../../../app/domain/chess_graph/index.ts';

const rules = new ChessJsRulesAdapter();
const moves: CanonicalMove[] = [];
const allSteps = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'].map(
  (value) => {
    const applied = rules.applyMove(rules.initialState(), moves, {
      kind: 'coordinates',
      value,
    });
    assert.ok(applied.ok);
    moves.push(applied.value.move);
    return applied.value;
  },
);
const rootState = allSteps[1]!.after;
const steps = allSteps.slice(2);
const legal = rules.legalMoves(
  rootState,
  steps.map((step) => step.move),
);
assert.ok(legal.ok);
const fixture = {
  ...pausedPlayoutDto,
  legalMoves: legal.value,
  draft: {
    ...pausedPlayoutDto.draft,
    playerSide: 'white',
    root: rootState,
    sourcePath: {
      displayName: 'Opening',
      root: rules.initialState(),
      steps: allSteps.slice(0, 2),
    },
    steps,
  },
};
const bundle = await build({
  stdin: {
    resolveDir: path.resolve('app/infrastructure/channels/ui/renderer'),
    loader: 'jsx',
    contents: `
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { PlayoutView } from './playout-view.tsx';
import { messages } from './messages.ts';
import './tokens.css';
const fixture = ${JSON.stringify(fixture)};
const root = createRoot(document.getElementById('root'));
let locale = 'en-GB', generation = 0, calls = [];
let state;
const store = {
  getPlayoutCompletionForm: () => undefined,
  rememberPlayoutCompletionForm: () => {},
  canWorkWithInventoryItem: () => true,
  pausePlayout: () => window.playoutTest.status('paused'),
  resumePlayout: () => window.playoutTest.status('active'),
  stopPlayout: () => window.playoutTest.status('stopped'),
  cancelPlayoutCompletion: () => window.playoutTest.status('paused'),
  submitPlayoutMove: (...args) => { calls.push(args); return Promise.resolve(true); },
};
function render() {
  root.render(<IntlProvider locale={locale} messages={messages[locale]}><PlayoutView key={generation} state={state} store={store} /></IntlProvider>);
}
function status(kind) {
  const draft = {...state.playout.draft, status: {kind, outcome: {kind: 'unfinished'}}};
  state = {...state, playout: {...state.playout, draft}};
  render();
}
window.playoutTest = {
  show(kind, language, zero = false, source = true) {
    locale = language; generation++; calls = [];
    const draft = {...fixture.draft, status: {kind, outcome: {kind: 'unfinished'}}};
    if (zero) draft.steps = [];
    if (!source) delete draft.sourcePath;
    state = {phase: 'ready', scope: {kind: 'free'}, preferences: {uiLocale: locale}, refreshing: false,
      inventory: {items: []}, inventoryOrganization: {folders: [], linkedFolderIds: []},
      playout: {...fixture, draft}, playoutProviders: {providers: [{instanceId: 'engine-main', displayName: 'Stockfish', status: 'available', capabilities: ['best_move']}]}};
    document.documentElement.lang = locale; render();
  },
  status,
  shorten() {
    state = {...state, playout: {...state.playout, draft: {...state.playout.draft, steps: fixture.draft.steps.slice(0, 2)}}}; render();
  },
  advance() {
    state = {...state, playout: {...state.playout, draft: {...state.playout.draft, steps: fixture.draft.steps}}}; render();
  },
  saved() {
    state = {...state, completedPlayout: {itemId: 'saved-game', displayName: 'Saved game', outcome: {kind: 'unfinished'}, outcomeSource: 'manual'}, completedPlayoutView: state.playout}; render();
  },
  prestart() {
    state = {...state, playoutStart: {sourcePath: fixture.draft.sourcePath, workspace: {scope: state.scope, currentState: fixture.draft.root, legalMoves: [], allowedActions: []}}, playout: null}; render();
  },
  calls: () => calls,
};`,
  },
  outfile: 'playout-navigation-runtime.js',
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.woff2': 'dataurl' },
  logLevel: 'silent',
});
const artifacts = path.resolve(
  'build/verification/playout-navigation',
  randomUUID(),
);
await mkdir(artifacts, { recursive: true });
console.log('Artifacts: ' + artifacts);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(5_000);
  await page.route('**/*', (route) => route.abort());
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>Playout navigation check</title></head><body><div id="root"></div></body></html>',
  );
  await page.addStyleTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.css'))!
      .text,
  });
  await page.addScriptTag({
    content: bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text,
  });
  const line = page.getByRole('region');
  const board = page.getByRole('grid');
  const square = (name: string) =>
    page.getByRole('gridcell', { name: new RegExp('^' + name + ',') });
  const current = line.locator('[data-current-move="true"]');
  for (const locale of ['de-DE', 'en-GB']) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const status of ['active', 'awaiting_policy', 'paused']) {
        await page.evaluate(
          `window.playoutTest.show('${status}', '${locale}')`,
        );
        await expect(current).toHaveText('a6');
        // Neither roots, source moves, game start nor played moves are actions.
        await expect(
          line.getByRole('button', {
            name: /^(e4|e5|Sf3|Nf3|Sc6|Nc6|Lb5|Bb5|a6|Ausgangsstellung|Starting position|Partiestart|Game start)$/,
          }),
        ).toHaveCount(0);
        await expect(
          page.getByRole('button', {
            name: /Zur aktuellen Stellung|Return to current position/,
          }),
        ).toHaveCount(0);
        const oldMove = line.getByText(locale === 'de-DE' ? 'Sf3' : 'Nf3', {
          exact: true,
        });
        await oldMove.click();
        await expect(current).toHaveText('a6');
        await expect(square('a6')).toHaveAttribute('aria-label', /pawn|Bauer/);
        assert.equal(
          await oldMove.evaluate(
            (element) => (element as unknown as { tabIndex: number }).tabIndex,
          ),
          -1,
        );
        await expect(board).toHaveAttribute(
          'aria-readonly',
          status === 'active' ? 'false' : 'true',
        );
        await page.screenshot({
          path: path.join(artifacts, `${locale}-${width}-${status}.png`),
          fullPage: true,
        });
      }
      // The visible current move tracks new replies, without an intermediate review selection.
      await page.evaluate('window.playoutTest.shorten()');
      await expect(current).toHaveText(locale === 'de-DE' ? 'Sc6' : 'Nc6');
      await page.evaluate('window.playoutTest.advance()');
      await expect(current).toHaveText('a6');
      for (const status of ['stopped', 'terminal']) {
        await page.evaluate(`window.playoutTest.status('${status}')`);
        await line
          .getByRole('button', {
            name: locale === 'de-DE' ? 'Sf3' : 'Nf3',
            exact: true,
          })
          .click();
        await expect(current).toHaveText(locale === 'de-DE' ? 'Sf3' : 'Nf3');
        await expect(square('b5')).not.toHaveAttribute(
          'aria-label',
          /bishop|Läufer/,
        );
        await expect(board).toHaveAttribute('aria-readonly', 'true');
        await line.getByRole('button', { name: 'e4', exact: true }).focus();
        await page.keyboard.press('Enter');
        await expect(current).toHaveText('e4');
        // Even an unchanged draft revision must stop reviewing on resumption.
        await page.evaluate("window.playoutTest.status('paused')");
        await expect(current).toHaveText('a6');
        await expect(
          line.getByRole('button', { name: 'e4', exact: true }),
        ).toHaveCount(0);
      }
      await page.evaluate(
        "window.playoutTest.status('stopped'); window.playoutTest.saved()",
      );
      await line.getByRole('button', { name: 'e5', exact: true }).click();
      await expect(current).toHaveText('e5');
      await page.screenshot({
        path: path.join(artifacts, `${locale}-${width}-saved-review.png`),
        fullPage: true,
      });
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations,
        [],
      );
      assert.ok(
        await page.evaluate(
          'document.documentElement.scrollWidth <= innerWidth',
        ),
      );
      console.log(
        `PASS ${locale} ${width}px: active/awaiting/paused, automatic latest, end/review/resume, saved review, Axe`,
      );
    }
    for (const source of [true, false]) {
      await page.evaluate(
        `window.playoutTest.show('paused', '${locale}', true, ${source})`,
      );
      await expect(current).toHaveText(
        source
          ? locale === 'de-DE'
            ? 'Partiestart'
            : 'Game start'
          : locale === 'de-DE'
            ? 'Ausgangsstellung'
            : 'Starting position',
      );
      await expect(
        line.getByRole('button', {
          name: /Ausgangsstellung|Starting position|Partiestart|Game start/,
        }),
      ).toHaveCount(0);
    }
    await page.evaluate(`window.playoutTest.show('active', '${locale}')`);
    await page
      .getByRole('button', {
        name: locale === 'de-DE' ? 'Pausieren' : 'Pause',
        exact: true,
      })
      .click();
    await expect(board).toHaveAttribute('aria-readonly', 'true');
    await page
      .getByRole('button', {
        name: locale === 'de-DE' ? 'Partie beenden' : 'Stop game',
        exact: true,
      })
      .click();
    await line.getByRole('button', { name: 'e4', exact: true }).click();
    await expect(current).toHaveText('e4');
    await page
      .getByRole('button', {
        name: locale === 'de-DE' ? 'Zur Partie zurück' : 'Return to game',
        exact: true,
      })
      .click();
    await expect(current).toHaveText('a6');
    await page
      .getByRole('button', {
        name: locale === 'de-DE' ? 'Weiterspielen' : 'Continue',
        exact: true,
      })
      .click();
    await expect(board).toHaveAttribute('aria-readonly', 'false');
    await expect(current).toHaveText('a6');
    await expect(
      line.getByRole('button', { name: 'e4', exact: true }),
    ).toHaveCount(0);
    await page.evaluate('window.playoutTest.prestart()');
    await line.getByRole('button', { name: 'e4', exact: true }).click();
    await expect(current).toHaveText('e4');
    console.log(
      `PASS ${locale}: zero moves, pause/stop/return/continue controls and prestart source navigation`,
    );
  }
  assert.deepEqual(await page.evaluate('window.playoutTest.calls()'), []);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
