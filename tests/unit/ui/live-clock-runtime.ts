// Isolated browser regression with a virtual clock; no host or external requests.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

test('live clocks follow stream receipt time without changing host state', async (t) => {
  const bundle = await build({
    stdin: {
      resolveDir: path.resolve('app/infrastructure/channels/ui/renderer'),
      loader: 'jsx',
      contents: `
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { LiveView } from './live-view.tsx';
import { messages } from './messages.ts';
import './tokens.css';
const root = createRoot(document.getElementById('root'));
const white = { fen: '8/8/8/8/8/8/4K3/7k w - - 0 1', position: { boardKey: '.......k....K...................................................', sideToMove: 'white' }, playState: { fullmoveNumber: 1 } };
const black = { ...white, position: { ...white.position, sideToMove: 'black' } };
const steps = [{ move: { san: 'Ke3', from: 'e2', to: 'e3' }, after: black }, { move: { san: 'Kg1', from: 'h1', to: 'g1' }, after: white }];
let session;
let locale = 'en-GB';
let shown = true;
const calls = [];
const store = new Proxy({}, { get: (_, name) => (...args) => { calls.push({ name, args }); return Promise.resolve(); } });
function render() {
  const state = { phase: 'ready', scope: { kind: 'free' }, status: { persistence: { dataRevision: 0 } }, preferences: { uiLocale: locale }, fairPlayBlocked: true, live: { revision: 7, configured: true, online: true, connection: 'connected', fairPlayBlocked: true, games: [], session }, inventoryOrganization: { folders: [], linkedFolderIds: [] }, inventory: { items: [] }, analysisProviders: { providers: [] } };
  root.render(<IntlProvider locale={locale} messages={messages[locale]}>{shown && <LiveView state={state} store={store} />}</IntlProvider>);
}
window.audit = {
  reset() { locale = 'en-GB'; shown = true; calls.length = 0; session = { analysisRevision: 3, gameId: 'abcdefgh', role: 'observe', white: { name: 'White' }, black: { name: 'Black' }, root: white, current: white, steps, selectedPly: 2, legalMoves: [], status: 'ongoing', connected: true, pendingMove: false, outcome: 'unfinished', whiteClockMs: 60000, blackClockMs: 90000, clockUpdatedAt: new Date().toISOString() }; render(); },
  patch(patch) { session = { ...session, ...patch }; render(); },
  review() { session = { ...session, selectedPly: 1, current: black }; render(); },
  next() { session = { ...session, steps: [...steps, { move: { san: 'Ke4', from: 'e3', to: 'e4' }, after: black }], whiteClockMs: 65000, blackClockMs: 80000, clockUpdatedAt: new Date().toISOString() }; render(); },
  firstMoves(count) { session = { ...session, steps: steps.slice(0, count), selectedPly: count }; render(); },
  locale(value) { locale = value; render(); },
  show(value) { shown = value; render(); },
  snapshot() { return { calls, session }; }
};
window.audit.reset();
`,
    },
    outfile: 'live-clock-runtime.js',
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    loader: { '.woff2': 'dataurl' },
    logLevel: 'silent',
  });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.route('**/*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="en"><body><div id="root"></div></body></html>',
      }),
    );
    await page.goto('https://live-clock.plysmith.test');
    await page.clock.install({ time: new Date('2026-10-06T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-06T12:00:01Z'));
    const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'));
    const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'));
    assert.ok(script && css);
    await page.addStyleTag({ content: css.text });
    await page.addScriptTag({ content: script.text });
    const clocks = page.locator('dl[aria-labelledby="live-clock-caption"] dd');

    await t.test(
      'ticks latest side, reconciles increments, survives review, locale and remount',
      async () => {
        await expect(clocks).toHaveText(['1:00', '1:30']);
        await page.clock.runFor(2250);
        await expect(clocks).toHaveText(['0:58', '1:30']);
        await expect(page.getByText('Estimated time remaining')).toBeVisible();
        await page.evaluate('window.audit.review()');
        await page.clock.runFor(1000);
        await expect(clocks).toHaveText(['0:57', '1:30']);
        await page.evaluate('window.audit.locale("de-DE")');
        await page.clock.runFor(1000);
        await expect(clocks).toHaveText(['0:56', '1:30']);
        await expect(page.getByText('Geschätzte Restzeit')).toBeVisible();
        await page.evaluate('window.audit.show(false)');
        await expect(clocks).toHaveCount(0);
        await page.clock.runFor(2000);
        await page.evaluate('window.audit.show(true)');
        await expect(clocks).toHaveText(['0:54', '1:30']);
        await page.evaluate('window.audit.next()');
        await expect(clocks).toHaveText(['1:05', '1:20']);
        await page.clock.runFor(2000);
        await expect(clocks).toHaveText(['1:05', '1:18']);
        assert.equal(
          await page.evaluate('window.audit.snapshot().session.selectedPly'),
          1,
        );
        assert.equal(
          await page.evaluate(
            'window.audit.snapshot().session.analysisRevision',
          ),
          3,
        );
        assert.deepEqual(
          await page.evaluate('window.audit.snapshot().calls'),
          [],
        );
      },
    );

    await t.test(
      'uses reported values while disconnected or terminal and never ends at local zero',
      async () => {
        await page.evaluate('window.audit.reset()');
        await expect(clocks).toHaveText(['1:00', '1:30']);
        await page.clock.runFor(3000);
        await expect(clocks).toHaveText(['0:57', '1:30']);
        await page.evaluate('window.audit.patch({connected: false})');
        await page.clock.runFor(5000);
        await expect(clocks).toHaveText(['1:00', '1:30']);
        await expect(
          page.getByText('Last reported time remaining'),
        ).toBeVisible();
        await page.evaluate(
          'window.audit.patch({connected: true, whiteClockMs: 1500, clockUpdatedAt: new Date().toISOString()})',
        );
        await page.clock.runFor(2500);
        await expect(clocks).toHaveText(['0:00', '1:30']);
        await expect(page.getByText('Game in progress')).toBeVisible();
        assert.deepEqual(
          await page.evaluate('window.audit.snapshot().calls'),
          [],
        );
        await page.evaluate(
          'window.audit.patch({status: "finalizing", whiteClockMs: 0})',
        );
        await page.clock.runFor(5000);
        await expect(clocks).toHaveText(['0:00', '1:30']);
        await page.evaluate(
          'window.audit.patch({status: "ended", outcome: "black_win"})',
        );
        await page.clock.runFor(5000);
        await expect(clocks).toHaveText(['0:00', '1:30']);
        await expect(
          page.getByRole('button', { name: 'Save game', exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText('Last reported time remaining'),
        ).toBeVisible();
      },
    );

    await t.test(
      'holds initial moves and unknown or export-only clocks conservatively',
      async () => {
        await page.evaluate('window.audit.reset()');
        for (const count of [0, 1]) {
          await page.evaluate(`window.audit.firstMoves(${count})`);
          await page.clock.runFor(5000);
          await expect(clocks).toHaveText(['1:00', '1:30']);
        }
        await page.evaluate(
          'window.audit.firstMoves(2); window.audit.patch({clockUpdatedAt: undefined})',
        );
        await page.clock.runFor(5000);
        await expect(clocks).toHaveText(['1:00', '1:30']);
        await page.evaluate(
          'window.audit.patch({clockUpdatedAt: "invalid", whiteClockMs: undefined})',
        );
        await page.clock.runFor(5000);
        await expect(clocks).toHaveText(['–', '1:30']);
        await page.evaluate(
          'window.audit.patch({clockUpdatedAt: new Date(Date.now() + 60000).toISOString(), whiteClockMs: 60000})',
        );
        await page.clock.runFor(5000);
        await expect(clocks).toHaveText(['1:00', '1:30']);
        assert.deepEqual(
          await page.evaluate('window.audit.snapshot().calls'),
          [],
        );
      },
    );
    await t.test(
      'distinguishes malformed game data from connection failure in both locales',
      async () => {
        await page.evaluate(
          'window.audit.reset(); window.audit.patch({problemCode: "live.protocol_error"})',
        );
        await expect(page.getByRole('alert')).toHaveText(
          'Could not process the game data received from Lichess.',
        );
        await page.evaluate('window.audit.locale("de-DE")');
        await expect(page.getByRole('alert')).toHaveText(
          'Die von Lichess übermittelten Partiedaten konnten nicht verarbeitet werden.',
        );
      },
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
