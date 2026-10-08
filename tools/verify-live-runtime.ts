// Opt-in after build: node tools/verify-live-runtime.ts. Uses only an owned home and fake provider.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  type Page,
  type Locator,
} from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import {
  composeHost,
  type ComposedHost,
} from '../app/bootstrap/host/composition-root.ts';
import { publishHostDiscovery } from '../app/infrastructure/adapters/platform/windows/index.ts';
import {
  connectHost,
  type PlysmithHostClient,
} from '../app/infrastructure/channels/host_client/index.ts';
import { ChessJsRulesAdapter } from '../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { messages } from '../app/infrastructure/channels/ui/renderer/messages.ts';
import { liveMessages } from '../app/infrastructure/channels/ui/renderer/live-messages.ts';
import {
  LiveProviderError,
  type LiveAccountEvent,
  type LiveGameEvent,
  type LiveGameSnapshot,
  type LiveOwnGame,
  type LiveProviderPort,
} from '../app/application/live/live-ports.ts';
import type { CanonicalMove } from '../app/domain/chess_graph/index.ts';

class EventQueue<T> {
  readonly #values: T[] = [];
  #wake: (() => void) | undefined;
  #closed = false;
  push(value: T): void {
    this.#values.push(value);
    this.#wake?.();
  }
  close(): void {
    this.#closed = true;
    this.#wake?.();
  }
  async *read(signal: AbortSignal): AsyncIterable<T> {
    const abort = () => this.#wake?.();
    signal.addEventListener('abort', abort);
    try {
      while (!signal.aborted && !this.#closed) {
        const value = this.#values.shift();
        if (value !== undefined) {
          yield value;
          continue;
        }
        await new Promise<void>((resolve) => {
          this.#wake = resolve;
        });
        this.#wake = undefined;
      }
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
}

const rules = new ChessJsRulesAdapter();
function position(game: LiveGameSnapshot) {
  const parsed =
    game.initialFen === 'startpos'
      ? { ok: true as const, value: rules.initialState() }
      : rules.parseFen(game.initialFen);
  assert.ok(parsed.ok);
  const root = parsed.value;
  const moves: CanonicalMove[] = [];
  let current = root;
  for (const input of game.moves) {
    const applied = rules.applyMove(root, moves, input);
    assert.ok(applied.ok, 'Legal fake history');
    moves.push(applied.value.move);
    current = applied.value.after;
  }
  return current;
}

class FakeLiveProvider implements LiveProviderPort {
  readonly games = new Map<string, LiveGameSnapshot>();
  readonly own = new Map<string, LiveOwnGame>();
  readonly calls: { operation: string; gameId?: string; value?: string }[] = [];
  readonly accountQueues = new Set<EventQueue<LiveAccountEvent>>();
  readonly gameQueues = new Map<string, Set<EventQueue<LiveGameEvent>>>();
  readonly offline = new Set<string>();
  add(
    gameId: string,
    own: boolean,
    moves: readonly string[] = [],
    initialFen = 'startpos',
  ) {
    const game: LiveGameSnapshot = {
      gameId,
      standard: true,
      initialFen,
      white: {
        id: own ? 'runtime-user' : 'observer-white',
        name: own ? 'Runtime User' : 'Observer White',
      },
      black: { id: 'opponent', name: 'Opponent' },
      moves: moves.map((value) => ({ kind: 'coordinates', value })),
      status: 'ongoing',
      outcome: 'unfinished',
      whiteClockMs: 600_000,
      blackClockMs: 600_000,
    };
    position(game);
    this.games.set(gameId, game);
    if (own) {
      const entry: LiveOwnGame = {
        gameId,
        displayName: 'Runtime User - Opponent',
        playerSide: 'white',
        standard: true,
        boardCompatible: true,
      };
      this.own.set(gameId, entry);
      for (const queue of this.accountQueues)
        queue.push({ kind: 'game_started', game: entry });
    }
  }
  async readAccount(signal: AbortSignal) {
    signal.throwIfAborted();
    assert.ok(
      this.accountQueues.size > 0,
      'Account snapshot follows subscription handshake',
    );
    this.calls.push({ operation: 'readAccount' });
    return {
      id: 'runtime-user',
      name: 'Runtime User',
      games: [...this.own.values()],
    };
  }
  async *streamAccount(signal: AbortSignal): AsyncIterable<LiveAccountEvent> {
    const queue = new EventQueue<LiveAccountEvent>();
    this.accountQueues.add(queue);
    try {
      signal.throwIfAborted();
      this.calls.push({ operation: 'accountSubscribed' });
      yield { kind: 'connected' };
      yield* queue.read(signal);
    } finally {
      this.accountQueues.delete(queue);
    }
  }
  async readGame(
    gameId: string,
    signal: AbortSignal,
  ): Promise<LiveGameSnapshot> {
    signal.throwIfAborted();
    this.calls.push({ operation: 'readGame', gameId });
    if (this.offline.has(gameId))
      throw new LiveProviderError('live.provider_unavailable');
    const game = this.games.get(gameId);
    if (!game) throw new LiveProviderError('live.invalid_game');
    return structuredClone(game);
  }
  async *streamGame(
    gameId: string,
    role: 'observe' | 'play',
    signal: AbortSignal,
  ): AsyncIterable<LiveGameEvent> {
    const game = await this.readGame(gameId, signal);
    const queue = new EventQueue<LiveGameEvent>();
    const queues =
      this.gameQueues.get(gameId) ?? new Set<EventQueue<LiveGameEvent>>();
    queues.add(queue);
    this.gameQueues.set(gameId, queues);
    try {
      yield role === 'play'
        ? { kind: 'snapshot', game }
        : { kind: 'position', fen: position(game).fen };
      yield* queue.read(signal);
      if (!signal.aborted && this.games.get(gameId)?.status !== 'ended')
        throw new LiveProviderError('live.provider_unavailable');
    } finally {
      queues.delete(queue);
    }
  }
  emit(gameId: string, event: LiveGameEvent): void {
    for (const queue of this.gameQueues.get(gameId) ?? []) queue.push(event);
  }
  advance(gameId: string, value: string, spectator = false): void {
    const old = this.games.get(gameId)!;
    const game: LiveGameSnapshot = {
      ...old,
      moves: [...old.moves, { kind: 'coordinates', value }],
    };
    const current = position(game);
    this.games.set(gameId, game);
    this.emit(
      gameId,
      spectator
        ? { kind: 'position', fen: current.fen, lastMove: value }
        : { kind: 'snapshot', game },
    );
  }
  async submitMove(
    gameId: string,
    move: string,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    this.calls.push({ operation: 'submitMove', gameId, value: move });
    this.advance(gameId, move);
  }
  async act(
    gameId: string,
    action: Parameters<LiveProviderPort['act']>[1],
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    this.calls.push({ operation: 'act', gameId, value: action });
    if (action === 'offer_draw' || action === 'decline_draw') {
      const game = {
        ...this.games.get(gameId)!,
        whiteDrawOffer: action === 'offer_draw',
        blackDrawOffer: false,
      };
      this.games.set(gameId, game);
      this.emit(gameId, { kind: 'snapshot', game });
    } else
      this.finish(
        gameId,
        action === 'resign'
          ? 'black_win'
          : action === 'accept_draw'
            ? 'draw'
            : 'unfinished',
      );
  }
  finish(
    gameId: string,
    outcome: LiveGameSnapshot['outcome'] = 'draw',
    notify = true,
  ): void {
    const game = {
      ...this.games.get(gameId)!,
      status: 'ended' as const,
      outcome,
    };
    this.games.set(gameId, game);
    this.own.delete(gameId);
    if (notify) this.emit(gameId, { kind: 'finished' });
    else for (const queue of this.gameQueues.get(gameId) ?? []) queue.close();
    for (const queue of this.accountQueues)
      queue.push({ kind: 'game_finished', gameId });
  }
  disconnect(gameId: string): void {
    this.offline.add(gameId);
    for (const queue of this.gameQueues.get(gameId) ?? []) queue.close();
  }
}

const repo = await realpath(process.cwd());
const artifacts = path.join(repo, 'build/verification/live', randomUUID());
const applicationHome = path.join(artifacts, 'home');
const canary = 'runtime_live_CANARY_NOT_A_REAL_TOKEN_20261005';
const fake = new FakeLiveProvider();
const steps: { name: string; status: 'passed' | 'failed'; detail?: string }[] =
  [];
const screenshots: string[] = [];
const findings: { screenshot: string; kind: string; detail: unknown }[] = [];
const errors: string[] = [];
const output: string[] = [];
const externalRequests: string[] = [];
const desktopProcessIds: number[] = [];
let runtime: ComposedHost | undefined;
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
let page: Page | undefined;
let client: PlysmithHostClient;
let locale: 'de-DE' | 'en-GB' = 'de-DE';
let folderId: string;
let contextId: string;
let failed = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input
        : input.url,
  );
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    externalRequests.push(url.origin);
    throw new Error('External network forbidden by live acceptance harness');
  }
  return originalFetch(input, init);
};
await mkdir(artifacts, { recursive: true });
console.log('Artifacts: ' + artifacts);
function label(key: string): string {
  const all: Record<string, string> = {
    ...messages[locale],
    ...liveMessages[locale],
  };
  assert.ok(all[key], 'Unknown label ' + key);
  return all[key];
}
function button(key: string) {
  return page!.getByRole('button', { name: label(key), exact: true });
}
async function nav(key: string) {
  await page!
    .getByRole('navigation', { name: 'Plysmith' })
    .getByRole('button', { name: label(key), exact: true })
    .click();
}
async function proof() {
  const report = {
    applicationHome,
    ownedHostProcessId: process.pid,
    desktopProcessIds,
    steps,
    screenshots,
    findings,
    errors,
    externalRequests,
    providerCalls: fake.calls,
    limits: [
      'Only deterministic fake Lichess responses; no real token, Internet connection, matchmaking or actual account moves.',
      'Electron viewport is resized to 390px; no physical mobile-device or native token-entry acceptance claimed.',
      'No engine is configured: empty-engine state and suppression are checked; engine strength and actual remote stream timing are outside this test.',
    ],
  };
  assert.ok(!JSON.stringify(report).includes(canary), 'No token in evidence');
  await writeFile(
    path.join(artifacts, 'proof.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  assert.ok(!output.join('').includes(canary), 'No token in desktop output');
  await writeFile(path.join(artifacts, 'desktop-output.txt'), output.join(''));
}
async function capture(name: string) {
  assert.ok(page);
  await page.evaluate('document.fonts.ready');
  await page.evaluate(
    `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
  );
  const file = path.join(artifacts, name + '.png');
  const violations = (await new AxeBuilder({ page }).setLegacyMode().analyze())
    .violations;
  await writeFile(
    path.join(artifacts, name + '-axe.json'),
    JSON.stringify(violations, null, 2),
  );
  if (violations.length)
    findings.push({
      screenshot: name,
      kind: 'accessibility',
      detail: violations,
    });
  const geometry = await page.evaluate<{
    width: number;
    scrollWidth: number;
    clipped: unknown[];
  }>(`(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clipped: [
      ...document.querySelectorAll(
        'button, input, select, h1, h2',
      ),
    ]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          element.scrollWidth > element.clientWidth + 3
        );
      })
      .map((element) => ({
        tag: element.tagName,
        text: (
          element.innerText ||
          element.getAttribute('aria-label') ||
          ''
        ).slice(0, 100),
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
  }))()`);
  if (geometry.scrollWidth > geometry.width + 1 || geometry.clipped.length)
    findings.push({ screenshot: name, kind: 'geometry', detail: geometry });
  const outside = await page.evaluate<
    unknown[]
  >(`(() => [...document.querySelectorAll('main header [role="status"], main h1, main h2')].flatMap(element => {
    if (!element.getClientRects().length) return [];
    const range = document.createRange(); range.selectNodeContents(element);
    const rects = [...range.getClientRects()];
    return rects.some(rect => rect.right > document.documentElement.clientWidth + 1 || rect.left < -1)
      ? [{ text: element.textContent, rects: rects.map(rect => ({ left: rect.left, right: rect.right })), width: document.documentElement.clientWidth }] : [];
  }))()`);
  if (outside.length)
    findings.push({
      screenshot: name,
      kind: 'text-outside-viewport',
      detail: outside,
    });
  const viewport = (await page.evaluate(`(() => {
    const width = document.documentElement.clientWidth;
    const elements = [...document.querySelectorAll('main > header, main > header [role="status"], main [role="grid"], main [role="gridcell"]')]
      .filter(element => element.getClientRects().length)
      .map(element => {
        const rect = element.getBoundingClientRect();
        return { role: element.getAttribute('role') ?? element.tagName, label: element.getAttribute('aria-label'), left: rect.left, right: rect.right, width: rect.width };
      });
    return { innerWidth, clientWidth: width, visualWidth: visualViewport?.width, elements,
      outside: elements.filter(element => element.left < -1 || element.right > width + 1) };
  })()`)) as { outside: unknown[] };
  await writeFile(
    path.join(artifacts, name + '-geometry.json'),
    JSON.stringify(
      {
        requestedViewport: page.viewportSize(),
        geometry,
        textOutside: outside,
        viewport,
      },
      null,
      2,
    ),
  );
  if (viewport.outside.length)
    findings.push({
      screenshot: name,
      kind: 'element-outside-viewport',
      detail: viewport,
    });
  const viewportFile = path.join(artifacts, name + '-viewport.png');
  await page.screenshot({ path: viewportFile });
  screenshots.push(viewportFile);
  await page.screenshot({ path: file, fullPage: true });
  screenshots.push(file);
  assert.deepEqual(errors, [], 'No renderer errors');
  assert.deepEqual(externalRequests, [], 'No external network');
}
async function verifyObserverSaveLayout() {
  assert.ok(page);
  const save = button('live.save');
  for (const width of [1280, 900, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const divider = page.getByRole('separator', {
      name: label('analysis.resizePanels'),
      exact: true,
    });
    const positions = (await divider.isVisible())
      ? (['Home', 'End'] as const)
      : (['stacked'] as const);
    for (const position of positions) {
      if (position !== 'stacked') {
        await divider.press(position);
        await expect(divider).toHaveAttribute(
          'aria-valuenow',
          (await divider.getAttribute(
            position === 'Home' ? 'aria-valuemin' : 'aria-valuemax',
          ))!,
        );
      }
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeEnabled();
      const inspect = () =>
        page!.evaluate(`(() => {
        const top = document.querySelector('[data-analysis-layout] > [id$="-moves"]');
        const engine = document.querySelector('[data-analysis-layout] > [id$="-engine"]');
        const button = top?.querySelector('form button[type="submit"]');
        if (!top || !engine || !button) throw new Error('Missing live save layout');
        const t = top.getBoundingClientRect(), e = engine.getBoundingClientRect(), b = button.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        const rect = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
        return { top: rect(t), engine: rect(e), button: rect(b),
          nonintersecting: t.bottom <= e.top + 1 || e.bottom <= t.top + 1 || t.right <= e.left + 1 || e.right <= t.left + 1,
          contained: b.top >= t.top - 1 && b.bottom <= t.bottom + 1,
          hitTarget: hit === button || button.contains(hit),
          hit: hit?.tagName, viewport: { width: innerWidth, height: innerHeight } };
      })()`);
      await expect.poll(inspect).toMatchObject({
        nonintersecting: true,
        contained: true,
        hitTarget: true,
      });
      await writeFile(
        path.join(artifacts, `live-save-${width}-${position}-hit.json`),
        JSON.stringify(await inspect(), null, 2),
      );
      await capture(`live-save-${width}-${position}`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  await save.scrollIntoViewIfNeeded();
}
async function step(name: string, action: () => Promise<void>) {
  console.log('RUN ' + name);
  try {
    await action();
    steps.push({ name, status: 'passed' });
    console.log('PASS ' + name);
  } catch (error) {
    failed = true;
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    steps.push({ name, status: 'failed', detail });
    if (page && !page.isClosed()) {
      await page.screenshot({
        path: path.join(artifacts, 'failure.png'),
        fullPage: true,
      });
      const body = await page.locator('body').innerText();
      assert.ok(!body.includes(canary));
      await writeFile(path.join(artifacts, 'failure.txt'), body);
    }
    throw error;
  } finally {
    await proof();
  }
}
async function startHost(withProvider: boolean) {
  runtime = await composeHost({
    applicationHome,
    defaultsDirectory: path.join(repo, 'configuration/defaults'),
    ...(withProvider ? { liveProvider: fake } : {}),
  });
  const endpoint = await runtime.host.listen({ host: '127.0.0.1', port: 0 });
  runtime.markReady();
  const discovery = {
    ownerId: runtime.ownerId,
    pid: process.pid,
    endpoint: new URL(endpoint).toString(),
    productRelease: runtime.productRelease,
    contractFingerprint: runtime.contractFingerprint,
    token: runtime.hostToken,
  };
  await publishHostDiscovery(applicationHome, discovery);
  client = await connectHost(discovery);
}
async function launch() {
  app = await electron.launch({
    executablePath: path.join(repo, 'node_modules/electron/dist/electron.exe'),
    args: [
      path.join(repo, 'build/desktop/main.mjs'),
      '--application-home',
      applicationHome,
      '--install-root',
      repo,
    ],
    cwd: repo,
    timeout: 60_000,
  });
  const pid = app.process().pid;
  if (pid !== undefined) desktopProcessIds.push(pid);
  for (const stream of [app.process().stdout, app.process().stderr])
    stream?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  page = await app.firstWindow({ timeout: 60_000 });
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.context().route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (
      ['file:', 'data:'].includes(url.protocol) ||
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    )
      return route.continue();
    externalRequests.push(url.origin);
    return route.abort();
  });
  await page
    .getByRole('navigation', { name: 'Plysmith' })
    .waitFor({ timeout: 60_000 });
  await page
    .getByText(/^(Verbunden|Connected)$/)
    .first()
    .waitFor();
  await page.setViewportSize({ width: 1280, height: 1000 });
  const profile = await app.evaluate(({ app: desktop }) =>
    desktop.getPath('userData'),
  );
  assert.equal(profile, path.join(applicationHome, 'desktop/profile'));
}
async function closeDesktop() {
  const owned = app;
  app = undefined;
  page = undefined;
  if (!owned) return;
  const child = owned.process();
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    await owned.close();
    await expect
      .poll(() => child.exitCode !== null || child.signalCode !== null, {
        timeout: 15_000,
      })
      .toBe(true);
  } catch (error) {
    child.kill();
    throw error;
  }
}
async function closeHost() {
  const owned = runtime;
  runtime = undefined;
  await owned?.close();
}
async function setLocale(value: typeof locale) {
  const result = await client.setUiLanguage({
    uiLocale: value,
    expectedRevision: (await client.getUserPreferences()).preferenceRevision,
  });
  assert.equal(result.preferences.uiLocale, value);
  await expect(
    page!.getByRole('button', {
      name: messages[value]['activity.settings'],
      exact: true,
    }),
  ).toBeVisible();
  locale = value;
}
async function observe(gameId: string) {
  await nav('activity.live');
  await page!
    .getByLabel(label('live.url'), { exact: true })
    .fill('https://lichess.org/' + gameId);
  await button('live.observe').click();
  await expect
    .poll(async () => (await client.getLiveState()).session?.connected)
    .toBe(true);
  await expect(page!.getByRole('grid')).toHaveAttribute(
    'aria-readonly',
    'true',
  );
}
async function discard() {
  await button('live.discard').click();
  const dialog = page!.getByRole('dialog', {
    name: label('live.leave.title'),
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: label('live.discard'), exact: true })
    .click();
  await expect
    .poll(async () => (await client.getLiveState()).session)
    .toBeUndefined();
  await finishDiscardDialog(dialog);
}
async function finishDiscardDialog(dialog: Locator) {
  try {
    await expect(dialog).toBeHidden();
  } catch {
    findings.push({
      screenshot: 'discard-dialog-stuck',
      kind: 'product-behavior',
      detail:
        'Confirmed discard removes Host session but leaves its modal open. Cancel is used only to continue independent acceptance scenarios.',
    });
    await capture('discard-dialog-stuck');
    await dialog
      .getByRole('button', { name: label('action.cancel'), exact: true })
      .click();
    await expect(dialog).toBeHidden();
  }
}
async function assertBoard() {
  await expect(page!.getByRole('gridcell')).toHaveCount(64);
  const pieces = page!.locator('[data-chess-board-occupied]');
  assert.ok((await pieces.count()) > 0);
  const rendered = await pieces.first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      hasGlyph:
        element.querySelector('[class*="plysmithPieceGlyph"]')?.textContent
          ?.length === 1,
    };
  });
  assert.ok(
    rendered.width > 20 && rendered.height > 20 && rendered.hasGlyph,
    'Visible chess piece assets',
  );
  assert.equal(
    await page!.evaluate('document.fonts.check(\'32px "Plysmith Chess"\')'),
    true,
  );
}

try {
  await step(
    'Fresh isolated desktop and write-only settings, restart boundary',
    async () => {
      await startHost(false);
      await launch();
      await nav('activity.live');
      await expect(button('live.configure')).toBeVisible();
      await capture('live-unconfigured-de');
      await button('live.configure').click();
      const token = page!.getByLabel(label('live.token'), { exact: true });
      await expect(token).toHaveAttribute('type', 'password');
      await token.fill(canary);
      await button('live.saveToken').click();
      await expect(token).toHaveValue('');
      await expect(
        page!.getByText(label('live.restartRequired'), { exact: true }).first(),
      ).toBeVisible();
      assert.ok(
        (await readFile(path.join(applicationHome, '.env'), 'utf8')).includes(
          canary,
        ),
      );
      const config = await client.getLiveProviderConfiguration();
      assert.equal(config.tokenConfigured, true);
      assert.equal(config.restartRequired, true);
      assert.ok(!JSON.stringify(config).includes(canary));
      assert.ok(!(await page!.content()).includes(canary));
      assert.ok(
        !(await page!.evaluate(() => JSON.stringify(localStorage))).includes(
          canary,
        ),
      );
      await capture('live-settings-de');
      await page!.setViewportSize({ width: 390, height: 844 });
      await setLocale('en-GB');
      await capture('live-settings-mobile-en');
      await closeDesktop();
      await closeHost();
      await startHost(true);
      contextId = (
        await client.createWorkingContext({ displayName: 'Live practice' })
      ).context.contextId;
      await client.changeInventoryOrganization({
        expectedDataRevision: (await client.getInventoryOrganization({}))
          .dataRevision,
        change: { kind: 'create_folder', displayName: 'Live recordings' },
      });
      folderId = (await client.getInventoryOrganization({})).folders[0]!
        .folderId;
      await client.changeInventoryOrganization({
        expectedDataRevision: (await client.getInventoryOrganization({}))
          .dataRevision,
        change: {
          kind: 'include_folder',
          folderId,
          contextId,
          includeItems: false,
        },
      });
      await launch();
      assert.equal((await client.getLiveState()).connection, 'disconnected');
      assert.equal((await client.getLiveState()).fairPlayBlocked, false);
      await nav('activity.live');
      const connection = page!.getByRole('switch', {
        name: label('live.connectionMode'),
      });
      await expect(connection).not.toBeChecked();
      await expect(button('live.observe')).toHaveCount(0);
      await capture('live-disconnected-en');
      assert.equal(
        fake.calls.length,
        0,
        'No provider calls before explicit connection',
      );
      await page!.locator('label').filter({ has: connection }).click();
      await expect(connection).toBeChecked();
      await expect
        .poll(async () => (await client.getLiveState()).connection)
        .toBe('connected');
      assert.equal(
        (await client.getLiveProviderConfiguration()).restartRequired,
        false,
      );
      await setLocale('de-DE');
    },
  );
  await step(
    'Empty URL, illegal URL, observer history, rewind stability and assets',
    async () => {
      fake.add('watch001', false, ['e2e4', 'e7e5']);
      await nav('activity.live');
      await expect(button('live.observe')).toBeDisabled();
      await page!
        .getByLabel(label('live.url'), { exact: true })
        .fill('https://example.invalid/watch001');
      await button('live.observe').click();
      await expect(page!.getByRole('alert').first()).toBeVisible();
      assert.equal((await client.getLiveState()).session, undefined);
      await observe('watch001');
      await assertBoard();
      await expect(
        page!.getByText('Übertragung um drei Züge verzögert', { exact: true }),
      ).toHaveCount(0);
      await button('analysis.previousMove').click();
      await expect
        .poll(async () => (await client.getLiveState()).session?.selectedPly)
        .toBe(1);
      const before = (await client.getLiveState()).session!;
      fake.emit('watch001', {
        kind: 'position',
        fen: position(fake.games.get('watch001')!).fen,
        whiteClockMs: 599_000,
      });
      await expect
        .poll(async () => (await client.getLiveState()).session?.whiteClockMs)
        .toBe(599_000);
      assert.equal(
        (await client.getLiveState()).session!.analysisRevision,
        before.analysisRevision,
      );
      fake.advance('watch001', 'g1f3', true);
      await expect
        .poll(async () => (await client.getLiveState()).session?.steps.length)
        .toBe(3);
      const after = (await client.getLiveState()).session!;
      assert.equal(after.current.fen, before.current.fen);
      assert.equal(after.analysisRevision, before.analysisRevision);
      assert.equal(after.focus?.focusKey, before.focus?.focusKey);
      fake.disconnect('watch001');
      await expect(
        page!.getByText(label('live.error.unavailable'), { exact: true }),
      ).toBeVisible();
      fake.offline.delete('watch001');
      await expect
        .poll(async () => (await client.getLiveState()).session?.connected, {
          timeout: 10_000,
        })
        .toBe(true);
      assert.equal(
        (await client.getLiveState()).session?.problemCode,
        undefined,
      );
      assert.equal(
        (await client.getLiveState()).session?.analysisRevision,
        before.analysisRevision,
      );
      await expect(
        page!.getByText(label('live.error.unavailable'), { exact: true }),
      ).toHaveCount(0);
      await expect(
        page!.getByText(label('live.disconnected'), { exact: true }),
      ).toHaveCount(0);
      await capture('live-observe-reconnected-de');
      await capture('live-observe-rewound-de');
      await page!.setViewportSize({ width: 390, height: 844 });
      await capture('live-observe-mobile-de');
      await setLocale('en-GB');
      await capture('live-observe-mobile-en');
      await page!.setViewportSize({ width: 1280, height: 1000 });
      await capture('live-observe-en');
      await nav('activity.manage');
      const dialog = page!.getByRole('dialog', {
        name: label('live.leave.title'),
        exact: true,
      });
      await dialog
        .getByRole('button', { name: label('action.cancel'), exact: true })
        .click();
      assert.equal((await client.getLiveState()).session?.gameId, 'watch001');
      await nav('activity.manage');
      await dialog
        .getByRole('button', { name: label('live.discard'), exact: true })
        .click();
      await expect
        .poll(async () => (await client.getLiveState()).session)
        .toBeUndefined();
      await finishDiscardDialog(dialog);
      await nav('activity.manage');
      await expect(
        page!.getByLabel(label('live.url'), { exact: true }),
      ).toBeHidden();
      assert.equal((await client.searchInventory({})).items.length, 0);
    },
  );
  await step(
    'Browser game start globally blocks assistance, board confirms one move',
    async () => {
      await page!
        .getByLabel(label('scope.label'), { exact: true })
        .selectOption('context:' + contextId);
      fake.add('own00001', true);
      await expect
        .poll(async () => (await client.getLiveState()).fairPlayBlocked)
        .toBe(true);
      await expect(
        page!.getByText(label('live.fairPlay'), { exact: true }).first(),
      ).toBeVisible();
      await capture('live-global-fairplay-en');
      await nav('activity.live');
      await button('live.play').click();
      await expect(page!.getByRole('grid')).toHaveAttribute(
        'aria-readonly',
        'false',
      );
      await expect(button('analysis.previousMove')).toHaveCount(0);
      await expect(button('analysis.nextMove')).toHaveCount(0);
      await expect(button('live.abort')).toBeEnabled();
      await page!.getByRole('gridcell', { name: /^e2,/ }).click();
      await page!.getByRole('gridcell', { name: /^e4,/ }).click();
      await expect
        .poll(async () => (await client.getLiveState()).session?.steps.length)
        .toBe(1);
      assert.deepEqual(
        fake.calls.filter((call) => call.operation === 'submitMove'),
        [{ operation: 'submitMove', gameId: 'own00001', value: 'e2e4' }],
      );
      await expect(page!.getByRole('grid')).toHaveAttribute(
        'aria-readonly',
        'true',
      );
      fake.advance('own00001', 'e7e5');
      await expect(page!.getByRole('grid')).toHaveAttribute(
        'aria-readonly',
        'false',
      );
      const clocks = page!.locator(
        'dl[aria-labelledby="live-clock-caption"] dd',
      );
      await expect
        .poll(async () => clocks.first().textContent())
        .not.toBe('10:00');
      await expect(clocks.nth(1)).toHaveText('10:00');
      const clockRevision = (await client.getLiveState()).revision;
      await expect
        .poll(async () => clocks.first().textContent())
        .not.toBe(await clocks.first().textContent());
      assert.equal(
        (await client.getLiveState()).revision,
        clockRevision,
        'Local ticking makes no host mutation',
      );
      const connection = page!.getByRole('switch', {
        name: label('live.connectionMode'),
      });
      await page!.locator('label').filter({ has: connection }).click();
      await expect(connection).not.toBeChecked();
      await expect.poll(() => fake.accountQueues.size).toBe(0);
      await expect.poll(() => fake.gameQueues.get('own00001')?.size).toBe(0);
      const offline = await client.getLiveState();
      assert.equal(offline.fairPlayBlocked, true);
      assert.equal(offline.session!.steps.length, 2);
      assert.equal(offline.session!.connected, false);
      assert.deepEqual(offline.session!.legalMoves, []);
      await expect(
        page!.getByText(label('live.disconnected'), { exact: true }),
      ).toHaveCount(0);
      await expect(button('live.refresh')).toHaveCount(0);
      const offlineCalls = fake.calls.length;
      await capture('live-own-offline-de');
      assert.equal(
        fake.calls.length,
        offlineCalls,
        'Offline does not retry provider requests',
      );
      await page!.locator('label').filter({ has: connection }).click();
      await expect(connection).toBeChecked();
      await expect
        .poll(async () => (await client.getLiveState()).session?.connected)
        .toBe(true);
      const offered = { ...fake.games.get('own00001')!, blackDrawOffer: true };
      fake.games.set('own00001', offered);
      fake.emit('own00001', { kind: 'snapshot', game: offered });
      await expect(button('live.accept_draw')).toBeEnabled();
      await button('live.decline_draw').click();
      await button('live.offer_draw').click();
      await expect(button('live.drawOffered')).toBeDisabled();
      await capture('live-own-play-en');
      await page!.setViewportSize({ width: 390, height: 844 });
      await setLocale('de-DE');
      await capture('live-own-play-mobile-de');
      await page!.setViewportSize({ width: 1280, height: 1000 });
      fake.disconnect('own00001');
      await expect
        .poll(async () => (await client.getLiveState()).session?.connected)
        .toBe(false);
      await expect(page!.getByRole('grid')).toHaveAttribute(
        'aria-readonly',
        'true',
      );
      await expect(button('live.resign')).toBeDisabled();
      assert.equal((await client.getLiveState()).fairPlayBlocked, true);
      await capture('live-disconnected-de');
      fake.offline.delete('own00001');
      await button('live.refresh').click();
      await expect
        .poll(async () => (await client.getLiveState()).session?.connected)
        .toBe(true);
      await button('live.resign').click();
      await page!
        .getByRole('dialog')
        .getByRole('button', { name: label('live.resign'), exact: true })
        .click();
      await expect
        .poll(async () => (await client.getLiveState()).session?.status)
        .toBe('ended');
      await expect
        .poll(async () => (await client.getLiveState()).fairPlayBlocked)
        .toBe(false);
      await capture('live-own-completed-de');
      await page!
        .getByLabel(label('live.name'), { exact: true })
        .fill('Runtime saved live game');
      await page!
        .getByLabel(label('folders.saveDestination'))
        .selectOption(folderId);
      await button('live.save').click();
      await expect
        .poll(async () => (await client.searchInventory({})).items.length)
        .toBe(1);
      const item = (await client.searchInventory({})).items[0]!;
      assert.equal(item.itemType, 'game');
      assert.equal(item.displayName, 'Runtime saved live game');
      assert.equal(item.folderId, folderId);
      assert.ok(item.contextIds.includes(contextId));
      const record = await client.getInventoryRevision(
        item.itemId,
        item.currentRevisionId,
        { scopeKind: 'free' },
      );
      await writeFile(
        path.join(artifacts, 'saved-game.json'),
        JSON.stringify(record, null, 2),
      );
      assert.ok(JSON.stringify(record).includes('e4'));
      assert.ok(JSON.stringify(record).includes('e5'));
      assert.ok(JSON.stringify(record).includes('lichess.org/own00001'));
    },
  );
  await step(
    'Clock flag completes with result; failed final read recovers and saves normally',
    async () => {
      fake.add('flag0001', true, ['e2e4', 'e7e5', 'g1f3']);
      const running = {
        ...fake.games.get('flag0001')!,
        whiteClockMs: 209000,
        blackClockMs: 4000,
      };
      fake.games.set('flag0001', running);
      await nav('activity.live');
      await button('live.play').click();
      await expect
        .poll(async () => (await client.getLiveState()).session?.connected)
        .toBe(true);
      const clocks = page!.locator(
        'dl[aria-labelledby="live-clock-caption"] dd',
      );
      await expect(clocks.first()).toHaveText('3:29');
      await expect
        .poll(async () => clocks.nth(1).textContent())
        .not.toBe('0:04');
      const completed = {
        ...running,
        status: 'ended' as const,
        outcome: 'white_win' as const,
        blackClockMs: 0,
      };
      fake.games.set('flag0001', completed);
      fake.offline.add('flag0001');
      fake.emit('flag0001', { kind: 'snapshot', game: completed });
      fake.finish('flag0001', 'white_win');
      await expect
        .poll(async () => (await client.getLiveState()).session?.problemCode)
        .toBe('live.provider_unavailable');
      assert.equal((await client.getLiveState()).fairPlayBlocked, true);
      await expect(button('live.save')).toHaveCount(0);
      await capture('live-flag-awaiting-export-de');
      fake.offline.delete('flag0001');
      await button('live.refresh').click();
      await expect
        .poll(async () => (await client.getLiveState()).session?.status)
        .toBe('ended');
      await expect
        .poll(async () => (await client.getLiveState()).fairPlayBlocked)
        .toBe(false);
      await expect(
        page!.getByText(label('live.white_win'), { exact: true }),
      ).toBeVisible();
      await expect(clocks.nth(1)).toHaveText('0:00');
      await expect(
        page!.getByText(label('live.error.unavailable'), { exact: true }),
      ).toHaveCount(0);
      await page!
        .getByLabel(label('live.name'), { exact: true })
        .fill('Runtime saved timeout game');
      await capture('live-flag-completed-de');
      await button('live.save').click();
      await expect
        .poll(async () => (await client.searchInventory({})).items.length)
        .toBe(2);
      const item = (await client.searchInventory({})).items.find(
        (entry) => entry.displayName === 'Runtime saved timeout game',
      )!;
      const record = await client.getInventoryRevision(
        item.itemId,
        item.currentRevisionId,
        { scopeKind: 'free' },
      );
      await writeFile(
        path.join(artifacts, 'saved-timeout-game.json'),
        JSON.stringify(record, null, 2),
      );
      assert.ok(
        JSON.stringify(record).includes(
          JSON.stringify(
            'Runtime User - Opponent\n1-0\nhttps://lichess.org/flag0001',
          ),
        ),
      );
    },
  );
  await step(
    'Promotion uses legal UI selection; completed discard adds no inventory record',
    async () => {
      fake.add('prom0001', true, [], '7k/P7/8/8/8/8/8/7K w - - 0 1');
      await nav('activity.live');
      await button('live.play').click();
      await expect(page!.getByRole('grid')).toHaveAttribute(
        'aria-readonly',
        'false',
      );
      await page!.getByRole('gridcell', { name: /^a7,/ }).click();
      await page!.getByRole('gridcell', { name: /^a8,/ }).click();
      const dialog = page!.getByRole('dialog', {
        name: label('analysis.choosePromotion'),
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await capture('live-promotion-de');
      await dialog
        .getByRole('button', { name: label('piece.queen'), exact: true })
        .click();
      await expect
        .poll(async () => (await client.getLiveState()).session?.steps.length)
        .toBe(1);
      assert.equal(
        fake.calls.filter((call) => call.operation === 'submitMove').at(-1)
          ?.value,
        'a7a8q',
      );
      fake.finish('prom0001');
      await expect
        .poll(async () => (await client.getLiveState()).session?.status)
        .toBe('ended');
      await discard();
      assert.equal((await client.searchInventory({})).items.length, 2);
    },
  );
  await step(
    'Observer clean stream EOF confirms result and unseen final moves before ordinary save',
    async () => {
      fake.add('final001', false, ['e2e4', 'e7e5']);
      await observe('final001');
      const game = fake.games.get('final001')!;
      const completed: LiveGameSnapshot = {
        ...game,
        moves: [
          ...game.moves,
          { kind: 'coordinates', value: 'g1f3' },
          { kind: 'coordinates', value: 'b8c6' },
          { kind: 'coordinates', value: 'f1b5' },
        ],
      };
      position(completed);
      fake.games.set('final001', completed);
      fake.finish('final001', 'white_win', false);
      await expect
        .poll(async () => (await client.getLiveState()).session?.status)
        .toBe('ended');
      assert.equal((await client.getLiveState()).session!.steps.length, 5);
      assert.equal((await client.getLiveState()).session!.connected, false);
      assert.equal(
        (await client.getLiveState()).session!.problemCode,
        undefined,
      );
      await expect(
        page!.getByText(label('live.white_win'), { exact: true }),
      ).toBeVisible();
      await page!
        .getByLabel(label('live.name'), { exact: true })
        .fill('Runtime saved observed game');
      await page!
        .getByLabel(label('folders.saveDestination'))
        .selectOption(folderId);
      await capture('live-observed-completed-de');
      await verifyObserverSaveLayout();
      await button('live.save').click();
      await expect
        .poll(async () => (await client.searchInventory({})).items.length)
        .toBe(3);
      const item = (await client.searchInventory({})).items.find(
        (entry) => entry.displayName === 'Runtime saved observed game',
      )!;
      assert.equal(item.itemType, 'game');
      assert.equal(item.folderId, folderId);
      assert.ok(item.contextIds.includes(contextId));
      const record = await client.getInventoryRevision(
        item.itemId,
        item.currentRevisionId,
        { scopeKind: 'free' },
      );
      await writeFile(
        path.join(artifacts, 'saved-observed-game.json'),
        JSON.stringify(record, null, 2),
      );
      assert.ok(JSON.stringify(record).includes('Bb5'));
      assert.ok(JSON.stringify(record).includes('lichess.org/final001'));
    },
  );
  await step(
    'Early own game abort cancels its dialog without a write, then confirms and discards',
    async () => {
      const gameId = 'abort001';
      const inventoryCount = (await client.searchInventory({})).items.length;
      await expect
        .poll(async () => (await client.getLiveState()).session)
        .toBeUndefined();
      fake.add(gameId, true);
      await nav('activity.live');
      await button('live.play').click();
      await expect
        .poll(() => client.getLiveState())
        .toMatchObject({
          fairPlayBlocked: true,
          session: { gameId, status: 'ongoing', connected: true, steps: [] },
        });
      await expect.poll(() => fake.gameQueues.get(gameId)?.size).toBe(1);
      await button('live.abort').click();
      const dialog = page!.getByRole('dialog', {
        name: label('live.confirmAbort'),
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await capture('live-abort-confirmation-de');
      await dialog
        .getByRole('button', { name: label('action.cancel'), exact: true })
        .click();
      await expect(dialog).toBeHidden();
      assert.deepEqual(
        fake.calls.filter(
          (call) => call.gameId === gameId && call.operation === 'act',
        ),
        [],
      );
      const cancelled = await client.getLiveState();
      assert.equal(cancelled.session?.status, 'ongoing');
      assert.equal(cancelled.session?.connected, true);
      assert.equal(cancelled.fairPlayBlocked, true);
      assert.equal(fake.own.has(gameId), true);
      assert.equal(fake.gameQueues.get(gameId)?.size, 1);
      await button('live.abort').click();
      await dialog
        .getByRole('button', { name: label('live.abort'), exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await expect
        .poll(() => client.getLiveState())
        .toMatchObject({
          fairPlayBlocked: false,
          session: {
            gameId,
            status: 'ended',
            outcome: 'unfinished',
            connected: false,
            steps: [],
          },
        });
      assert.deepEqual(
        fake.calls.filter(
          (call) => call.gameId === gameId && call.operation === 'act',
        ),
        [{ operation: 'act', gameId, value: 'abort' }],
      );
      await expect.poll(() => fake.gameQueues.get(gameId)?.size).toBe(0);
      assert.equal(fake.own.has(gameId), false);
      assert.equal(fake.accountQueues.size, 1);
      await expect(
        page!.getByText(label('live.unfinished'), { exact: true }),
      ).toBeVisible();
      await expect(page!.getByRole('grid')).toHaveAttribute(
        'aria-readonly',
        'true',
      );
      await expect(
        page!.getByText(label('live.fairPlay'), { exact: true }),
      ).toHaveCount(0);
      await capture('live-aborted-de');
      await discard();
      assert.equal(
        (await client.searchInventory({})).items.length,
        inventoryCount,
      );
      assert.equal((await client.getLiveState()).fairPlayBlocked, false);
    },
  );
  await step(
    'Opponent draw is accepted through the UI; verified final export unlocks and saves one half result',
    async () => {
      const gameId = 'draw0001';
      const inventoryCount = (await client.searchInventory({})).items.length;
      fake.add(gameId, true, ['e2e4', 'e7e5']);
      await nav('activity.live');
      await button('live.play').click();
      await expect
        .poll(() => client.getLiveState())
        .toMatchObject({
          fairPlayBlocked: true,
          session: { gameId, status: 'ongoing', connected: true },
        });
      await expect.poll(() => fake.gameQueues.get(gameId)?.size).toBe(1);
      const offered = { ...fake.games.get(gameId)!, blackDrawOffer: true };
      fake.games.set(gameId, offered);
      fake.emit(gameId, { kind: 'snapshot', game: offered });
      await expect(button('live.accept_draw')).toBeEnabled();
      const readsBeforeAccept = fake.calls.filter(
        (call) => call.gameId === gameId && call.operation === 'readGame',
      ).length;
      fake.offline.add(gameId);
      await button('live.accept_draw').click();
      await expect
        .poll(() => client.getLiveState())
        .toMatchObject({
          fairPlayBlocked: true,
          games: [],
          session: {
            gameId,
            status: 'finalizing',
            problemCode: 'live.provider_unavailable',
          },
        });
      assert.deepEqual(
        fake.calls.filter(
          (call) => call.gameId === gameId && call.operation === 'act',
        ),
        [{ operation: 'act', gameId, value: 'accept_draw' }],
      );
      assert.equal(fake.own.has(gameId), false);
      await expect(button('live.save')).toHaveCount(0);
      await expect(
        page!.getByText(label('live.fairPlay'), { exact: true }).first(),
      ).toBeVisible();
      await capture('live-accepted-draw-awaiting-export-de');
      // Exhaust the bounded retries before restoring the fake for the UI refresh.
      await expect
        .poll(
          () =>
            fake.calls.filter(
              (call) => call.gameId === gameId && call.operation === 'readGame',
            ).length,
          { timeout: 15_000 },
        )
        .toBe(readsBeforeAccept + 4);
      assert.equal((await client.getLiveState()).fairPlayBlocked, true);
      fake.offline.delete(gameId);
      await button('live.refresh').click();
      await expect
        .poll(() => client.getLiveState())
        .toMatchObject({
          fairPlayBlocked: false,
          session: {
            gameId,
            status: 'ended',
            outcome: 'draw',
            connected: false,
          },
        });
      await expect.poll(() => fake.gameQueues.get(gameId)?.size).toBe(0);
      assert.equal(fake.accountQueues.size, 1);
      await expect(
        page!.getByText(label('live.draw'), { exact: true }),
      ).toBeVisible();
      await expect(
        page!.getByText(label('live.fairPlay'), { exact: true }),
      ).toHaveCount(0);
      await expect(page!.getByRole('grid')).toHaveAttribute(
        'aria-readonly',
        'true',
      );
      await page!
        .getByLabel(label('live.name'), { exact: true })
        .fill('Runtime saved drawn game');
      await capture('live-accepted-draw-completed-de');
      await button('live.save').click();
      await expect
        .poll(async () => (await client.searchInventory({})).items.length)
        .toBe(inventoryCount + 1);
      await expect
        .poll(async () => (await client.getLiveState()).session)
        .toBeUndefined();
      const item = (await client.searchInventory({})).items.find(
        (entry) => entry.displayName === 'Runtime saved drawn game',
      );
      assert.ok(item);
      assert.equal(item.itemType, 'game');
      const record = await client.getInventoryRevision(
        item.itemId,
        item.currentRevisionId,
        { scopeKind: 'free' },
      );
      await writeFile(
        path.join(artifacts, 'saved-draw-game.json'),
        JSON.stringify(record, null, 2),
      );
      assert.ok(
        JSON.stringify(record).includes(
          JSON.stringify(
            'Runtime User - Opponent\n1/2-1/2\nhttps://lichess.org/draw0001',
          ),
        ),
      );
    },
  );
  await step(
    'Saved ordinary game survives restart; all owned resources terminate',
    async () => {
      await closeDesktop();
      await closeHost();
      await startHost(true);
      assert.equal((await client.getLiveState()).connection, 'disconnected');
      await launch();
      const inventory = await client.searchInventory({});
      assert.equal(inventory.items.length, 4);
      assert.ok(
        inventory.items.some(
          (item) => item.displayName === 'Runtime saved live game',
        ),
      );
      const drawnGame = inventory.items.find(
        (item) => item.displayName === 'Runtime saved drawn game',
      );
      assert.ok(drawnGame);
      await nav('activity.live');
      await expect
        .poll(async () => (await client.getLiveState()).connection)
        .toBe('connected');
      await expect
        .poll(async () => (await client.getLiveState()).fairPlayBlocked)
        .toBe(false);
      const drawnRecord = await client.getInventoryRevision(
        drawnGame.itemId,
        drawnGame.currentRevisionId,
        { scopeKind: 'free' },
      );
      assert.ok(JSON.stringify(drawnRecord).includes('1/2-1/2'));
      const connection = page!.getByRole('switch', {
        name: label('live.connectionMode'),
      });
      await expect(connection).toBeChecked();
      await page!.locator('label').filter({ has: connection }).click();
      await expect(connection).not.toBeChecked();
      assert.equal((await client.getLiveState()).connection, 'disconnected');
      await closeDesktop();
      await closeHost();
      await startHost(true);
      const providerCalls = fake.calls.length;
      await launch();
      await nav('activity.live');
      await expect(
        page!.getByRole('switch', { name: label('live.connectionMode') }),
      ).not.toBeChecked();
      assert.equal((await client.getLiveState()).connection, 'disconnected');
      assert.equal(
        fake.calls.length,
        providerCalls,
        'Remembered Offline makes no provider calls',
      );
      await capture('live-final-empty-de');
      assert.equal((await client.getLiveState()).session, undefined);
      assert.deepEqual(externalRequests, []);
      assert.deepEqual(errors, []);
    },
  );
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  for (const close of [closeDesktop, closeHost]) {
    try {
      await close();
    } catch (error) {
      failed = true;
      errors.push(String(error));
    }
  }
  globalThis.fetch = originalFetch;
  await proof();
}
if (failed || findings.length) process.exitCode = 1;
