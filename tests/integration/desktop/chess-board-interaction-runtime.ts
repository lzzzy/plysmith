// Opt-in: actual React board state transitions, isolated from user data and Host.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { build } from 'esbuild';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

const rules = new ChessJsRulesAdapter();
const promotion = rules.parseFen('7k/P7/8/8/8/8/8/7K w - - 0 1');
assert.ok(promotion.ok);
const states = [rules.initialState(), promotion.value].map((state) => {
  const legal = rules.legalMoves(state, []);
  assert.ok(legal.ok);
  return { state, legalMoves: legal.value };
});
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
import { ChessBoard } from './chess-board.tsx';
import { messages } from './messages.ts';
import './tokens.css';
const states = ${JSON.stringify(states)};
const root = createRoot(document.getElementById('root'));
let props, locale, generation = 0, calls = [];
function render() {
  root.render(<IntlProvider locale={locale} messages={messages[locale]}><main><h1>Board interaction check</h1><ChessBoard key={generation} {...props} locale={locale} onMove={(...move) => calls.push(move)} /></main></IntlProvider>);
}
window.boardTest = {
  show(index, language) {
    locale = language; generation++; calls = [];
    const {state, legalMoves} = states[index];
    props = { isBusy: false, canMove: true, workspace: {scope: {kind: 'free'}, currentState: state, legalMoves, allowedActions: ['apply_move'], scratch: {scratchId: 'board', cursor: 0}} };
    document.documentElement.lang = locale; render();
  },
  update(change) {
    props = {...props, ...change, workspace: {...props.workspace, ...change.workspace}};
    render();
  },
  calls: () => calls,
};`,
  },
  outfile: 'chess-board-interaction-runtime.js',
  write: false,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.woff2': 'dataurl' },
  logLevel: 'silent',
});
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))!;
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))!;
const artifacts = path.resolve(
  'build/verification/board-interaction',
  randomUUID(),
);
await mkdir(artifacts, { recursive: true });
console.log('Artifacts: ' + artifacts);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => route.abort());
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>Board interaction check</title></head><body><div id="root"></div></body></html>',
  );
  await page.addStyleTag({ content: css.text });
  await page.addScriptTag({ content: script.text });
  const show = async (index: number, locale: string) => {
    await page.evaluate(
      ({ index, locale }) =>
        (
          globalThis as unknown as {
            boardTest: { show(index: number, locale: string): void };
          }
        ).boardTest.show(index, locale),
      { index, locale },
    );
    await expect(page.getByRole('grid')).toHaveAttribute(
      'aria-readonly',
      'false',
    );
  };
  const update = async (change: object) => {
    await page.evaluate(
      (change) =>
        (
          globalThis as unknown as {
            boardTest: { update(change: object): void };
          }
        ).boardTest.update(change),
      change,
    );
  };
  const calls = () =>
    page.evaluate(() =>
      (
        globalThis as unknown as { boardTest: { calls(): string[][] } }
      ).boardTest.calls(),
    );
  const square = (name: string) =>
    page.getByRole('gridcell', { name: new RegExp('^' + name + ',') });
  const selected = page.locator(
    '[data-chess-board-square][aria-selected="true"]',
  );
  const promotionDialog = page.getByRole('dialog');
  for (const locale of ['de-DE', 'en-GB']) {
    await show(0, locale);
    await square('e2').click();
    await expect(square('e2')).toHaveAttribute('aria-selected', 'true');
    await expect(square('e4')).toHaveClass(/target/);
    await update({ isBusy: true });
    await expect(page.getByRole('grid')).toHaveAttribute(
      'aria-readonly',
      'true',
    );
    await expect(selected).toHaveCount(0);
    await expect(square('e4')).not.toHaveClass(/target/);
    await square('e2').click();
    await square('e4').click();
    assert.deepEqual(await calls(), []);
    await square('e2').focus();
    await square('e2').press('ArrowRight');
    await expect(square('f2')).toBeFocused();
    await page
      .getByRole('button', {
        name: locale === 'de-DE' ? 'Brett drehen' : 'Flip board',
      })
      .click();
    await expect(page.getByRole('gridcell').first()).toHaveAttribute(
      'aria-label',
      /^h1,/,
    );
    await update({ isBusy: false });
    await expect(selected).toHaveCount(0);
    await square('e4').click();
    assert.deepEqual(await calls(), []);
    await square('e2').click();
    await square('e4').click();
    assert.deepEqual(await calls(), [['e2', 'e4', undefined]]);
    console.log(
      'PASS ' +
        locale +
        ': busy clears selection and targets; reading and continuation remain',
    );

    await show(1, locale);
    await square('a7').click();
    await square('a8').click();
    await expect(promotionDialog).toBeVisible();
    await update({ canMove: false });
    await expect(promotionDialog).toHaveCount(0);
    await expect(selected).toHaveCount(0);
    await update({ canMove: true });
    await expect(promotionDialog).toHaveCount(0);
    await square('a8').click();
    assert.deepEqual(await calls(), []);
    await square('a7').click();
    await square('a8').click();
    await expect(promotionDialog).toBeVisible();
    await update({ isBusy: true });
    await expect(promotionDialog).toHaveCount(0);
    assert.deepEqual(await calls(), []);
    await update({ isBusy: false });
    await square('a7').click();
    await square('a8').click();
    await promotionDialog
      .getByRole('button', {
        name: locale === 'de-DE' ? 'Dame' : 'Queen',
        exact: true,
      })
      .click();
    assert.deepEqual(await calls(), [['a7', 'a8', 'queen']]);
    console.log(
      'PASS ' +
        locale +
        ': readonly and busy cancel promotion without a stale move',
    );

    await show(1, locale);
    await square('a7').click();
    await square('a8').click();
    await update({
      workspace: {
        scope: { kind: 'context', contextId: '7' },
        scratch: { scratchId: 'other', cursor: 0 },
      },
    });
    await expect(promotionDialog).toHaveCount(0);
    await expect(selected).toHaveCount(0);
    await expect(page.getByRole('grid')).toHaveAttribute(
      'aria-readonly',
      'false',
    );
    assert.deepEqual(await calls(), []);
    await square('a7').click();
    await update({ canMove: false });
    await expect(selected).toHaveCount(0);
    await page.setViewportSize({
      width: locale === 'de-DE' ? 390 : 1000,
      height: 900,
    });
    await page.screenshot({
      path: path.join(artifacts, locale + '-readonly.png'),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        'document.documentElement.scrollWidth <= innerWidth + 1',
      ),
    );
    assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
    console.log(
      'PASS ' +
        locale +
        ': scope identity clears gestures at the same FEN; readonly reflow and accessibility',
    );
  }
  assert.deepEqual(errors, []);
  console.log('PASS 6/6 board interaction groups');
} finally {
  await browser.close();
}
