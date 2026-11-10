// Opt-in renderer regression: isolated browser, no Host or user data.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
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
import { ChessTreeMoveList } from './chess-tree-view.tsx';
import { localizeSan } from './chess-display.ts';
import { messages } from './messages.ts';
const root = createRoot(document.getElementById('root'));
let generation = 0, locale, props, custom;
const selections = [], removals = [];
const state = (sideToMove, fullmoveNumber) => ({position: {sideToMove}, playState: {fullmoveNumber}});
const select = anchorId => { selections.push(anchorId); props.anchorId = anchorId; render(); };
function render() {
  root.render(<IntlProvider locale={locale} messages={messages[locale]}>
    <ChessTreeMoveList key={generation} {...props} onSelect={select}
      onRemoveVariation={anchorId => removals.push(anchorId)}
      renderSteps={custom ? steps => steps.map(step => <li key={step.anchorId} data-custom-step={step.anchorId}>
        <button disabled={props.disabled} onClick={() => select(step.anchorId)}>{localizeSan(step.move.san, locale)}</button>
      </li>) : undefined} />
  </IntlProvider>);
}
window.audit = {
  show(language = 'en-GB', side = 'white', customRows = false, initialAnchor = 'root') {
    generation++; locale = language; custom = customRows;
    selections.length = 0; removals.length = 0;
    const nextSide = side === 'white' ? 'black' : 'white';
    const nextNumber = side === 'white' ? 9 : 10;
    const node = (nodeIndex, parentNodeIndex, siblingOrder, anchorId, san, after) =>
      ({nodeIndex, parentNodeIndex, siblingOrder, anchorId, move: {san}, after});
    props = {anchorId: initialAnchor, disabled: false, record: {
      itemId: 'record', revisionId: 'revision', rootAnchorId: 'root', steps: [], root: state(side, 9),
      tree: {nodes: [
        node(0, null, 0, 'main', 'e4', state(nextSide, nextNumber)),
        node(1, null, 1, 'branch', 'Nxf6+', state(nextSide, nextNumber)),
        node(2, 1, 0, 'reply', 'Kf8', state(side, 10)),
        node(3, 1, 1, 'nested', 'Kd8', state(side, 10)),
        node(4, 3, 0, 'nested-reply', 'Ne4', state(nextSide, nextNumber + 1)),
        node(5, null, 2, 'sibling', 'Qh5', state(nextSide, nextNumber)),
      ]},
    }};
    document.documentElement.lang = locale;
    render();
  },
  update(change) { props = {...props, ...change}; render(); },
  draft(anchorId) {
    props = {...props, draft: anchorId ? {anchorId, content: <li data-test-draft>Draft</li>} : undefined};
    render();
  },
  selections, removals,
};`,
    },
    bundle: true,
    write: false,
    outfile: 'chess-tree-preview-runtime.js',
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    logLevel: 'silent',
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => route.abort());
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>Tree preview regression</title></head><body><main id="root"></main></body></html>',
  );
  await page.addStyleTag({
    content:
      '* { box-sizing: border-box; } body { font: 16px sans-serif; margin: 8px; } #root { width: 100%; max-width: 320px; }',
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

const heading = (anchorId: string) =>
  page.locator(`[data-tree-line="${anchorId}"] > div`).first();
const toggle = (anchorId: string) =>
  heading(anchorId).locator('button[aria-expanded]');
const preview = (anchorId: string) =>
  heading(anchorId).locator('[data-tree-preview]');
const move = (anchorId: string) =>
  page.locator(`[data-tree-anchor="${anchorId}"]`);

test('each locale and starting side previews one half-move, with no duplicates after repeated toggles', async () => {
  for (const locale of ['de-DE', 'en-GB']) {
    for (const side of ['white', 'black']) {
      await page.evaluate(`window.audit.show('${locale}', '${side}')`);
      const label = `9${side === 'white' ? '.' : '...'} ${locale === 'de-DE' ? 'S' : 'N'}xf6+`;
      await expect(preview('branch')).toHaveText(label);
      await expect(toggle('branch')).toHaveAccessibleName(
        `${locale === 'de-DE' ? 'Variante ausklappen' : 'Expand variation'}: ${label}`,
      );
      await expect(move('branch')).toHaveCount(0);
      await expect(move('reply')).toHaveCount(0);
      for (let iteration = 0; iteration < 2; iteration++) {
        await toggle('branch').focus();
        await toggle('branch').press('Enter');
        await expect(preview('branch')).toHaveCount(0);
        await expect(move('branch')).toHaveText(label);
        await expect(move('branch')).toHaveCount(1);
        await expect(move('reply')).toHaveCount(1);
        await expect(preview('nested')).toHaveText(
          `${side === 'white' ? '9...' : '10.'} Kd8`,
        );
        await expect(move('nested')).toHaveCount(0);
        await toggle('branch').press('Space');
        await expect(preview('branch')).toHaveText(label);
        await expect(move('branch')).toHaveCount(0);
        await expect(move('reply')).toHaveCount(0);
        await expect(preview('nested')).toHaveCount(0);
      }
      assert.deepEqual(await page.evaluate('window.audit.selections'), []);
      assert.deepEqual(await page.evaluate('window.audit.removals'), []);
    }
  }
});

test('nested draft expansion removes only ancestor previews and preserves the draft and unrelated branches', async () => {
  await page.evaluate('window.audit.show()');
  await page.evaluate('window.audit.draft("nested-reply")');
  for (const anchor of ['branch', 'nested']) {
    await expect(toggle(anchor)).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle(anchor)).toBeDisabled();
    await expect(preview(anchor)).toHaveCount(0);
    await expect(move(anchor)).toHaveCount(1);
  }
  await expect(move('reply')).toHaveCount(1);
  await expect(move('nested-reply')).toHaveCount(1);
  await expect(page.locator('[data-test-draft]')).toHaveCount(1);
  await expect(preview('sibling')).toHaveText('9. Qh5');
  assert.deepEqual(await page.evaluate('window.audit.selections'), []);
  await page.evaluate('window.audit.draft()');
  await expect(preview('branch')).toHaveText('9. Nxf6+');
  await expect(page.locator('[data-test-draft]')).toHaveCount(0);
  await expect(toggle('branch')).toBeEnabled();
});

test('navigation reveals a collapsed active branch and its ancestors without closing siblings or preventing manual collapse', async () => {
  await page.evaluate('window.audit.show()');
  await toggle('sibling').click();
  await page.evaluate('window.audit.update({anchorId: "nested-reply"})');
  for (const anchor of ['branch', 'nested', 'sibling'])
    await expect(toggle(anchor)).toHaveAttribute('aria-expanded', 'true');
  await expect(move('nested-reply')).toHaveAttribute('aria-current', 'step');
  await expect(move('sibling')).toBeVisible();
  await toggle('branch').click();
  await expect(move('nested-reply')).toHaveCount(0);
  await page.evaluate('window.audit.update({disabled: true})');
  await expect(toggle('branch')).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(
    'window.audit.update({anchorId: "nested", disabled: false})',
  );
  await expect(move('nested')).toHaveAttribute('aria-current', 'step');
  await toggle('branch').click();
  await page.evaluate('window.audit.update({anchorId: "nested-reply"})');
  await expect(move('nested-reply')).toHaveAttribute('aria-current', 'step');
  await expect(toggle('sibling')).toHaveAttribute('aria-expanded', 'true');
  assert.deepEqual(await page.evaluate('window.audit.selections'), []);
});

test('a restored active move initially opens nested variations', async () => {
  await page.evaluate(
    'window.audit.show("de-DE", "white", false, "nested-reply")',
  );
  await expect(move('nested-reply')).toHaveAttribute('aria-current', 'step');
  await expect(move('nested-reply')).toBeVisible();
  await expect(preview('sibling')).toHaveText('9. Dh5');
});

test('preview text is inert, move selection and exact branch deletion keep their existing disabled behavior', async () => {
  await page.evaluate('window.audit.show()');
  await preview('branch').click();
  await expect(toggle('branch')).toHaveAttribute('aria-expanded', 'false');
  assert.deepEqual(await page.evaluate('window.audit.selections'), []);
  await toggle('branch').click();
  await move('branch').click();
  await expect(move('branch')).toHaveAttribute('aria-current', 'step');
  await move('reply').click();
  await expect(move('reply')).toHaveAttribute('aria-current', 'step');
  await toggle('nested').click();
  await heading('nested')
    .getByRole('button', { name: 'Delete variation: 9... Kd8', exact: true })
    .click();
  assert.deepEqual(await page.evaluate('window.audit.removals'), ['nested']);
  await page.evaluate('window.audit.update({disabled: true})');
  await expect(move('branch')).toBeDisabled();
  await expect(move('reply')).toBeDisabled();
  await expect(
    heading('branch').getByRole('button', {
      name: 'Delete variation: 9. Nxf6+',
      exact: true,
    }),
  ).toBeDisabled();
  await expect(toggle('branch')).toBeEnabled();
  await toggle('branch').click();
  await expect(preview('branch')).toHaveText('9. Nxf6+');
  await toggle('branch').click();
  await expect(preview('nested')).toHaveCount(0);
  await expect(move('nested')).toHaveCount(1);
  assert.deepEqual(await page.evaluate('window.audit.selections'), [
    'branch',
    'reply',
  ]);
  assert.deepEqual(await page.evaluate('window.audit.removals'), ['nested']);
});

test('custom full rows render only below expanded headings and preserve callbacks', async () => {
  await page.evaluate('window.audit.show("de-DE", "white", true)');
  await expect(preview('branch')).toHaveText('9. Sxf6+');
  await expect(page.locator('[data-custom-step="branch"]')).toHaveCount(0);
  await toggle('branch').click();
  await expect(preview('branch')).toHaveCount(0);
  await expect(page.locator('[data-custom-step="branch"]')).toHaveCount(1);
  await expect(page.locator('[data-custom-step="reply"]')).toHaveCount(1);
  await page.locator('[data-custom-step="branch"] button').click();
  assert.deepEqual(await page.evaluate('window.audit.selections'), ['branch']);
  await toggle('branch').click();
  await expect(preview('branch')).toHaveText('9. Sxf6+');
  await expect(page.locator('[data-custom-step="branch"]')).toHaveCount(0);
});

test('headings and move rows fit desktop and narrow widths in both locales', async () => {
  await mkdir('build/verification/chess-tree-preview', { recursive: true });
  for (const width of [1280, 390, 240]) {
    await page.setViewportSize({ width, height: 700 });
    for (const locale of ['de-DE', 'en-GB']) {
      await page.evaluate(`window.audit.show('${locale}')`);
      for (const expanded of [false, true]) {
        if (expanded) await toggle('branch').click();
        await expect(toggle('branch')).toHaveAttribute(
          'aria-expanded',
          String(expanded),
        );
        assert.equal(
          await page.evaluate(
            'document.documentElement.scrollWidth <= innerWidth',
          ),
          true,
        );
        const boxes = await heading('branch')
          .locator(':scope > *')
          .evaluateAll((elements) =>
            elements.map((element) => {
              const box = (
                element as unknown as {
                  getBoundingClientRect(): {
                    left: number;
                    right: number;
                    top: number;
                    bottom: number;
                  };
                }
              ).getBoundingClientRect();
              return {
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
              };
            }),
          );
        for (let index = 0; index < boxes.length; index++) {
          const box = boxes[index]!;
          assert.ok(box.left >= 0 && box.right <= width);
          for (const other of boxes.slice(index + 1))
            assert.ok(
              box.right <= other.left ||
                other.right <= box.left ||
                box.bottom <= other.top ||
                other.bottom <= box.top,
            );
        }
        await page.screenshot({
          path: `build/verification/chess-tree-preview/${locale}-${width}-${expanded ? 'expanded' : 'collapsed'}.png`,
        });
      }
    }
  }
});
