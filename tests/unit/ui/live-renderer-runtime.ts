// Isolated browser regression; no host, credentials, or external game requests.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test('live renderer keeps credentials ephemeral and own-game navigation locked', async () => {
  const bundle = await build({
    stdin: {
      resolveDir: path.resolve('app/infrastructure/channels/ui/renderer'),
      loader: 'jsx',
      contents: `
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { LiveSettings } from './live-settings.tsx';
import { LiveView } from './live-view.tsx';
import { PlysmithApplication } from './application-shell.tsx';
import { messages } from './messages.ts';
import './tokens.css';
const root = createRoot(document.getElementById('root'));
const chess = { fen: '8/8/8/8/8/8/4K3/7k w - - 0 1', position: { boardKey: '.......k....K...................................................', sideToMove: 'white' }, playState: { fullmoveNumber: 1 } };
const session = { gameId: 'abcdefgh', role: 'play', playerSide: 'white', white: { name: 'White' }, black: { name: 'Black' }, root: chess, current: chess, steps: [{ move: { san: 'Ke3', from: 'e2', to: 'e3' }, after: chess }], selectedPly: 1, legalMoves: [], status: 'ongoing', connected: true, pendingMove: false, outcome: 'unfinished' };
let state = { phase: 'ready', scope: { kind: 'free' }, status: { persistence: { dataRevision: 0 } }, preferences: { uiLocale: 'en-GB' }, fairPlayBlocked: true, liveProviderConfiguration: { configured: false, tokenConfigured: false, configurationRevision: null, restartRequired: false }, live: { revision: 1, configured: true, online: true, connection: 'connected', fairPlayBlocked: true, games: [{ gameId: 'game1234', displayName: 'Opponent', opponentRating: 1650, playerSide: 'white', standard: true, boardCompatible: true }], session }, inventoryOrganization: { folders: [], linkedFolderIds: [] }, inventory: { items: [] }, analysisProviders: { providers: [] } };
let mode = 'settings';
const calls = [];
Object.assign(session, { whiteClockMs: 60000, blackClockMs: 90000 });
Object.assign(state.live, { accountName: 'Runtime_User_12345678' });
let engineCalls = 0;
let finishSave;
const store = { start: async () => {}, close() {}, saveLiveProviderConfiguration: token => { calls.push({ length: token.length }); return new Promise(resolve => { finishSave = resolve; }); }, getSnapshot: () => state, subscribe: () => () => {}, selectLivePosition: ply => { calls.push({ ply }); return Promise.resolve(); } };
Object.assign(store, { checkInventoryName: async displayName => ({ displayName, available: true, suggestedDisplayName: displayName, dataRevision: 0 }) });
Object.assign(store, { getPositionAnalysisObjectiveProvider: () => 'stockfish', getPositionAnalysisBudget: () => 'fast', getPositionAnalysisHumanSelection: () => [], getPositionAnalysisSort: () => 'stockfish', analyzePosition: async () => { engineCalls++; return { kind: 'failed' }; } });
function render() { root.render(<IntlProvider locale={state.preferences.uiLocale} messages={messages[state.preferences.uiLocale]}>{mode === 'settings' ? <LiveSettings state={state} store={store} /> : mode === 'live' ? <LiveView state={state} store={store} /> : mode === 'shell' ? <PlysmithApplication store={store} /> : null}</IntlProvider>); }
window.audit = { show(value) { mode = value; render(); }, locked(activity) { state = { ...state, activity, contexts: { contexts: [] }, fairPlayBlocked: true, live: { ...state.live, fairPlayBlocked: true } }; mode = 'shell'; render(); }, observe() { state = { ...state, fairPlayBlocked: false, live: { ...state.live, fairPlayBlocked: false, session: { ...session, role: 'observe' } } }; render(); }, finish(value) { finishSave(value); }, calls };
Object.assign(window.audit, { connection(online) { state = { ...state, live: { ...state.live, online, connection: online ? 'failed' : 'disconnected', session: { ...state.live.session, connected: false } } }; render(); } });
Object.assign(window.audit, { ratings(white, black) { state = { ...state, live: { ...state.live, session: { ...state.live.session, white: { name: 'White', ...(white === undefined ? {} : { rating: white }) }, black: { name: 'Black', ...(black === undefined ? {} : { rating: black }) } } } }; render(); } });
Object.assign(window.audit, { verifying(blocked) { state = { ...state, fairPlayBlocked: blocked }; render(); } });
Object.assign(window.audit, { completed(locale, empty) { mode = 'live'; state = { ...state, preferences: { uiLocale: locale }, fairPlayBlocked: false, live: { ...state.live, fairPlayBlocked: false, session: { ...session, status: 'ended', connected: false, outcome: empty ? 'unfinished' : 'draw', steps: empty ? [] : session.steps, selectedPly: empty ? 0 : 1 } } }; render(); } });
Object.assign(window.audit, { engine() { state = { ...state, analysisProviders: { providers: [{ instanceId: 'stockfish', displayName: 'Stockfish', capability: 'objective_position_analysis', status: 'available' }] }, live: { ...state.live, session: { ...state.live.session, analysisRevision: 1, focus: { focusKey: 'position-1', root: chess, current: chess, moves: [] } } } }; render(); }, clock() { state = { ...state, live: { ...state.live, revision: state.live.revision + 1, session: { ...state.live.session, whiteClockMs: 20000 } } }; render(); }, gate(blocked) { state = { ...state, fairPlayBlocked: blocked, live: { ...state.live, fairPlayBlocked: blocked } }; render(); }, engineCalls: () => engineCalls });
render();
`,
    },
    outfile: 'live-renderer-runtime.js',
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
    await page.goto('https://live-ui.plysmith.test');
    const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'));
    const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'));
    assert.ok(script && css);
    await page.addStyleTag({ content: css.text });
    await page.addScriptTag({ content: script.text });
    const token = page.getByLabel('Personal API token');
    await expect(token).toHaveAttribute('type', 'password');
    await token.fill('fake-runtime-canary');
    await page.getByRole('button', { name: 'Save access' }).click();
    await expect(token).toHaveValue('');
    await page.evaluate('window.audit.finish(false)');
    await expect(token).toHaveValue('');
    await token.fill('fake-unmount-canary');
    await page.evaluate('window.audit.show("away")');
    await expect(token).toHaveCount(0);
    await page.evaluate('window.audit.show("settings")');
    await expect(token).toHaveValue('');
    await page.evaluate('window.audit.show("live")');
    await expect(page.getByText('Game in progress')).toBeVisible();
    await expect(
      page.getByText('Opponent (1650)', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'White – Black', exact: true }),
    ).toBeVisible();
    await page.evaluate('window.audit.ratings(1650, 1696)');
    await expect(
      page.getByRole('heading', {
        name: 'White (1650) – Black (1696)',
        exact: true,
      }),
    ).toBeVisible();
    await page.evaluate('window.audit.ratings(undefined, 1696)');
    await expect(
      page.getByRole('heading', { name: 'White – Black (1696)', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Last reported time remaining')).toBeVisible();
    await expect(page.getByText('1:00', { exact: true })).toBeVisible();
    await expect(page.getByText('1:30', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Ke3', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Resign', exact: true }),
    ).toBeVisible();
    await page.evaluate('window.audit.connection(false)');
    await expect(
      page.getByRole('switch', { name: 'Lichess connection' }),
    ).not.toBeChecked();
    await expect(
      page.getByText('Connection interrupted', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Refresh connection', exact: true }),
    ).toHaveCount(0);
    await page.evaluate('window.audit.connection(true)');
    await expect(
      page.getByText('Connection interrupted', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Refresh connection', exact: true }),
    ).toBeVisible();
    await page.evaluate('window.audit.observe()');
    await expect(
      page.getByRole('button', { name: 'Ke3', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Resign', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Broadcast delayed by three moves'),
    ).toHaveCount(0);
    await expect(page.getByText('live.delay', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Ke3', exact: true }).click();
    await page.evaluate('window.audit.ratings(1650, 1696)');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const players = page.getByRole('heading', {
        name: 'White (1650) – Black (1696)',
        exact: true,
      });
      await expect(players).toBeVisible();
      assert.equal(
        await page.evaluate(`(() => {
          const element = Array.from(document.querySelectorAll('h2')).find(
            element => element.textContent === 'White (1650) – Black (1696)',
          );
          if (element === undefined) return false;
          const heading = element.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(element);
          return Array.from(range.getClientRects()).every(
            (rect) =>
              rect.left >= heading.left - 0.5 &&
              rect.right <= heading.right + 0.5,
          );
        })()`),
        true,
      );
      assert.equal(
        await page.evaluate(
          'document.documentElement.scrollWidth <= window.innerWidth',
        ),
        true,
      );
      assert.equal(
        await page.evaluate(`(() => {
        const status = document.querySelector('main > header > [role="status"]');
        const range = document.createRange();
        range.selectNodeContents(status);
        const header = status.parentElement.getBoundingClientRect();
        return Array.from(range.getClientRects()).every(rect =>
          rect.left >= header.left - 0.5 && rect.right <= header.right + 0.5);
      })()`),
        true,
      );
    }
    assert.deepEqual(await page.evaluate('window.audit.calls'), [
      { length: 19 },
      { ply: 1 },
    ]);
    await page.evaluate('window.audit.engine()');
    await expect
      .poll(() => page.evaluate('window.audit.engineCalls()'))
      .toBe(1);
    const analysis = page.locator(
      'section[aria-labelledby="engine-analysis-title"]',
    );
    await expect(analysis).toBeVisible();
    await page.evaluate('window.audit.clock()');
    await expect(analysis).toBeVisible();
    await expect(page.getByText('0:20', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate('window.audit.engineCalls()'), 1);
    await page.evaluate('window.audit.verifying(true)');
    await expect(analysis).toBeHidden();
    assert.equal(await page.evaluate('window.audit.engineCalls()'), 1);
    await page.evaluate('window.audit.verifying(false)');
    await expect(analysis).toBeVisible();
    await expect
      .poll(() => page.evaluate('window.audit.engineCalls()'))
      .toBe(2);
    await page.evaluate('window.audit.gate(true)');
    await expect(analysis).toBeHidden();
    await page.evaluate('window.audit.gate(false)');
    await expect(analysis).toBeVisible();
    await expect
      .poll(() => page.evaluate('window.audit.engineCalls()'))
      .toBe(3);
    for (const activity of ['analyze', 'playout']) {
      await page.evaluate(`window.audit.locked('${activity}')`);
      await expect(
        page.getByText(
          'Analysis assistance is disabled during your online game.',
        ),
      ).toBeVisible();
      await expect(page.getByRole('grid')).toHaveCount(0);
      await expect(page.getByRole('main')).toHaveCount(0);
    }
    const accessibilityFailures = [];
    for (const locale of ['de-DE', 'en-GB']) {
      for (const empty of [true, false]) {
        await page.evaluate(`window.audit.completed('${locale}', ${empty})`);
        const list = page.getByLabel(
          locale === 'de-DE' ? 'Zugfolge' : 'Moves',
          {
            exact: true,
          },
        );
        await expect(list).toHaveCount(1);
        await expect(list).toHaveAttribute('tabindex', '0');
        await list.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(list).toBeFocused();
        await expect(list.getByRole('button')).toHaveCount(empty ? 0 : 1);
        if (!empty)
          await expect(list.getByRole('button')).toHaveAttribute(
            'aria-current',
            'step',
          );
        const { violations } = await new AxeBuilder({ page })
          .setLegacyMode()
          .include('main')
          .analyze();
        assert.equal(await list.getAttribute('role'), 'region');
        for (const violation of violations)
          accessibilityFailures.push({
            locale,
            empty,
            rule: violation.id,
            nodes: violation.nodes.map((node) => node.html),
          });
      }
    }
    assert.deepEqual(accessibilityFailures, []);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
