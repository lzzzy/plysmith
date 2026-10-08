import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { LightMyRequestResponse } from 'fastify';
import { composeHost } from '../../../app/bootstrap/host/composition-root.ts';
import type { LiveState } from '../../../app/application/live/live-models.ts';
import type {
  LiveAccountEvent,
  LiveGameEvent,
  LiveGameSnapshot,
  LiveOwnGame,
  LiveProviderPort,
} from '../../../app/application/live/live-ports.ts';
import { initializeConfiguration } from '../../../app/infrastructure/adapters/configuration/filesystem/index.ts';
import { testResources } from '../../fixtures/test-resources.ts';

class Events<T> {
  readonly pending: T[] = [];
  active = 0;
  wake: (() => void) | undefined;
  push(event: T): void {
    this.pending.push(event);
    this.wake?.();
  }
  async *stream(signal: AbortSignal): AsyncIterable<T> {
    this.active++;
    try {
      while (!signal.aborted) {
        const event = this.pending.shift();
        if (event !== undefined) {
          yield event;
          continue;
        }
        await new Promise<void>((resolve) => {
          const done = () => {
            signal.removeEventListener('abort', done);
            this.wake = undefined;
            resolve();
          };
          this.wake = done;
          signal.addEventListener('abort', done, { once: true });
          if (signal.aborted) done();
        });
      }
    } finally {
      this.active--;
    }
  }
}

class Provider implements LiveProviderPort {
  readonly account = new Events<LiveAccountEvent>();
  readonly game = new Events<LiveGameEvent>();
  readonly writes: string[] = [];
  readonly calls: string[] = [];
  ownGames: LiveOwnGame[] = [];
  readFailure: Error | undefined;
  snapshot: LiveGameSnapshot = {
    gameId: 'Abcd1234',
    standard: true,
    initialFen: 'startpos',
    white: { id: 'white', name: 'White', rating: 1650 },
    black: { id: 'black', name: 'Black', rating: 1696 },
    moves: [
      { kind: 'coordinates', value: 'e2e4' },
      { kind: 'coordinates', value: 'e7e5' },
    ],
    status: 'ongoing',
    outcome: 'unfinished',
    whiteClockMs: 299000,
    blackClockMs: 298000,
  };
  async readAccount() {
    this.calls.push('readAccount');
    return { id: 'tester', name: 'Tester', games: this.ownGames };
  }
  async *streamAccount(signal: AbortSignal): AsyncIterable<LiveAccountEvent> {
    this.calls.push('streamAccount');
    yield { kind: 'connected' };
    yield* this.account.stream(signal);
  }
  async readGame() {
    this.calls.push('readGame');
    if (this.readFailure) throw this.readFailure;
    return this.snapshot;
  }
  async *streamGame(
    _id: string,
    _role: 'observe' | 'play',
    signal: AbortSignal,
  ): AsyncIterable<LiveGameEvent> {
    this.calls.push('streamGame');
    yield { kind: 'snapshot', game: this.snapshot };
    yield* this.game.stream(signal);
  }
  async submitMove(gameId: string, move: string) {
    this.calls.push('submitMove');
    this.writes.push(`${gameId}:${move}`);
  }
  async act(gameId: string, action: Parameters<LiveProviderPort['act']>[1]) {
    this.calls.push('act');
    this.writes.push(`${gameId}:${action}`);
  }
}

async function setup(t: TestContext, provider = new Provider()) {
  const resources = testResources(t);
  const applicationHome = await resources.acquire(
    () => mkdtemp(path.join(tmpdir(), 'plysmith-live-host-')),
    (directory) => rm(directory, { recursive: true, force: true }),
  );
  resources.defer(() => {
    assert.equal(provider.account.active, 0);
    assert.equal(provider.game.active, 0);
  });
  const defaultsDirectory = path.resolve('configuration', 'defaults');
  await resources.run(() =>
    initializeConfiguration({ applicationHome, defaultsDirectory }),
  );
  const options = {
    applicationHome,
    defaultsDirectory,
    hostToken: 'live-host-test',
    liveProvider: provider,
  };
  const startRuntime = () =>
    resources.acquire(
      () => composeHost(options),
      (runtime) => runtime.close(),
    );
  let runtime = await startRuntime();
  runtime.markReady();
  let host = runtime.host;
  const headers = { host: '127.0.0.1', authorization: 'Bearer live-host-test' };
  const getState = async () => {
    t.signal.throwIfAborted();
    const response = await host.inject({ url: '/live', headers });
    assert.equal(response.statusCode, 200, response.body);
    return response.json<LiveState>();
  };
  const waitFor = async (predicate: (state: LiveState) => boolean) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const state = await getState();
      if (predicate(state)) return state;
      await delay(5);
    }
    assert.fail('Live state did not reach the expected state');
  };
  const command = async (body: Record<string, unknown>) =>
    host.inject({
      method: 'POST',
      url: '/live/commands',
      headers,
      payload: { expectedRevision: (await getState()).revision, ...body },
    });
  const connect = async () => {
    const response = await command({ kind: 'refresh' });
    assert.equal(response.statusCode, 200, response.body);
    return waitFor(
      (state) =>
        state.connection === 'connected' &&
        state.fairPlayBlocked === provider.ownGames.length > 0,
    );
  };
  const restart = async () => {
    await resources.run(() => runtime.close());
    runtime = await startRuntime();
    runtime.markReady();
    host = runtime.host;
    return host;
  };
  return {
    host,
    headers,
    getState,
    waitFor,
    command,
    connect,
    restart,
    provider,
  };
}

test('configured host is idle and analysis remains available until a valid explicit refresh connects', async (t) => {
  const { host, headers, getState, command, connect, provider } =
    await setup(t);
  const idle = await getState();
  assert.equal(idle.configured, true);
  assert.equal(idle.online, false);
  assert.equal(idle.connection, 'disconnected');
  assert.equal(idle.fairPlayBlocked, false);
  const workspace = await host.inject({
    url: '/analysis/workspace?scopeKind=free',
    headers,
  });
  assert.equal(workspace.statusCode, 200, workspace.body);
  for (const url of ['/live', '/configuration/live', '/status']) {
    const response = await host.inject({ url, headers });
    assert.equal(response.statusCode, 200, response.body);
  }
  assert.deepEqual(provider.calls, []);
  const observe = await command({
    kind: 'observe',
    url: 'https://lichess.org/Abcd1234',
  });
  assert.equal(observe.json().code, 'live.not_connected');
  assert.deepEqual(provider.calls, []);
  const stale = await command({
    kind: 'refresh',
    expectedRevision: (await getState()).revision + 1,
  });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(stale.json().code, 'live.stale_state');
  assert.deepEqual(provider.calls, []);
  await connect();
  assert.deepEqual(provider.calls, ['streamAccount', 'readAccount']);
  assert.deepEqual(provider.writes, []);
});

test('a restarted host keeps the persisted guard blocked without connecting until explicit refresh confirms the game ended', async (t) => {
  const provider = new Provider();
  provider.ownGames = [
    {
      gameId: 'Abcd1234',
      displayName: 'Tester - Black',
      playerSide: 'white',
      boardCompatible: true,
      standard: true,
    },
  ];
  const { headers, getState, connect, restart } = await setup(t, provider);
  await connect();
  assert.equal((await getState()).fairPlayBlocked, true);
  const callsBeforeRestart = [...provider.calls];
  provider.ownGames = [];
  const host = await restart();
  const idle = await getState();
  assert.equal(idle.connection, 'disconnected');
  assert.equal(idle.fairPlayBlocked, true);
  const blocked = await host.inject({
    url: '/analysis/workspace?scopeKind=free',
    headers,
  });
  assert.equal(blocked.statusCode, 403, blocked.body);
  assert.equal(blocked.json().code, 'live.fair_play_blocked');
  assert.deepEqual(provider.calls, callsBeforeRestart);
  const connected = await connect();
  assert.equal(connected.fairPlayBlocked, false);
  const workspace = await host.inject({
    url: '/analysis/workspace?scopeKind=free',
    headers,
  });
  assert.equal(workspace.statusCode, 200, workspace.body);
  assert.deepEqual(provider.calls.slice(callsBeforeRestart.length), [
    'streamAccount',
    'readAccount',
  ]);
});

test('offline host commands retain an own recording and guard, stop both streams and reject a stale revision', async (t) => {
  const provider = new Provider();
  provider.ownGames = [
    {
      gameId: 'Abcd1234',
      displayName: 'Tester - Black',
      opponentRating: 1696,
      playerSide: 'white',
      boardCompatible: true,
      standard: true,
    },
  ];
  provider.snapshot = {
    ...provider.snapshot,
    white: { id: 'tester', name: 'Tester' },
  };
  const { command, connect, getState, waitFor } = await setup(t, provider);
  await connect();
  assert.equal((await getState()).games[0]?.opponentRating, 1696);
  const opened = await command({ kind: 'play', gameId: 'Abcd1234' });
  assert.equal(opened.statusCode, 200, opened.body);
  const before = await waitFor((state) => state.session?.connected === true);
  assert.equal(provider.account.active, 1);
  assert.equal(provider.game.active, 1);
  const stale = await command({
    kind: 'disconnect',
    expectedRevision: before.revision - 1,
  });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(stale.json().code, 'live.stale_state');
  assert.deepEqual(await getState(), before);
  const callsBefore = [...provider.calls];
  const response = await command({ kind: 'disconnect' });
  assert.equal(response.statusCode, 200, response.body);
  const offline = response.json<LiveState>();
  assert.equal(offline.online, false);
  assert.equal(offline.connection, 'disconnected');
  assert.equal(offline.session?.connected, false);
  assert.equal(offline.session?.status, 'ongoing');
  assert.deepEqual(offline.session?.steps, before.session?.steps);
  assert.equal(offline.fairPlayBlocked, true);
  await waitFor(
    () => provider.account.active === 0 && provider.game.active === 0,
  );
  assert.deepEqual(provider.calls, callsBefore);
  assert.deepEqual(provider.writes, []);
  await connect();
  const reconnected = await waitFor(
    (state) => state.session?.connected === true,
  );
  assert.equal(reconnected.online, true);
  assert.equal(reconnected.fairPlayBlocked, true);
  assert.deepEqual(reconnected.session?.steps, before.session?.steps);
  assert.deepEqual(provider.writes, []);
  const secondOffline = await command({ kind: 'disconnect' });
  assert.equal(secondOffline.statusCode, 200, secondOffline.body);
  await waitFor(
    () => provider.account.active === 0 && provider.game.active === 0,
  );
  const callsBeforeDiscard = [...provider.calls];
  const discarded = await command({ kind: 'discard' });
  assert.equal(discarded.statusCode, 200, discarded.body);
  assert.equal(discarded.json<LiveState>().session, undefined);
  assert.equal(discarded.json<LiveState>().online, false);
  assert.equal(discarded.json<LiveState>().fairPlayBlocked, true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(provider.calls, callsBeforeDiscard);
  assert.deepEqual(provider.writes, []);
});

test('host records full observed history, enforces focus and revisions, and saves a finished game once', async (t) => {
  const { host, headers, command, getState, waitFor, connect, provider } =
    await setup(t);
  await connect();
  const opened = await command({
    kind: 'observe',
    url: 'https://lichess.org/Abcd1234',
  });
  assert.equal(opened.statusCode, 200, opened.body);
  const state = await waitFor((value) => value.session?.connected === true);
  assert.deepEqual(
    state.session?.steps.map((step) => step.move.san),
    ['e4', 'e5'],
  );
  assert.equal(state.session?.whiteClockMs, 299000);
  assert.equal(state.session?.white.rating, 1650);
  assert.equal(state.session?.black.rating, 1696);
  assert.ok(state.session?.focus);
  const stale = await command({
    kind: 'select',
    ply: 0,
    expectedRevision: state.revision - 1,
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, 'live.stale_state');
  const selected = await command({ kind: 'select', ply: 0 });
  assert.equal(selected.statusCode, 200, selected.body);
  assert.equal(
    selected.json<LiveState>().session?.current.fen,
    state.session.root.fen,
  );
  const staleAnalysis = await host.inject({
    method: 'POST',
    url: '/analysis/position',
    headers,
    payload: {
      work: { kind: 'live', revision: state.revision, ply: 2 },
      focus: state.session.focus,
      consumerId: 'live-host',
      laneId: 'objective',
      providerInstanceId: 'no-engine',
      candidateCount: 1,
      mode: { kind: 'objective', budget: 'fast' },
    },
  });
  assert.equal(staleAnalysis.statusCode, 409, staleAnalysis.body);
  assert.equal(staleAnalysis.json().code, 'live.stale_state');
  const premature = await host.inject({
    method: 'POST',
    url: '/live/games',
    headers,
    payload: {
      expectedRevision: (await getState()).revision,
      displayName: 'Observed game',
      languageTag: 'en-GB',
    },
  });
  assert.equal(premature.statusCode, 409);
  assert.equal(premature.json().code, 'live.not_finished');
  provider.snapshot = {
    ...provider.snapshot,
    status: 'ended',
    outcome: 'draw',
    moves: [...provider.snapshot.moves, { kind: 'coordinates', value: 'g1f3' }],
  };
  provider.game.push({ kind: 'finished' });
  const ended = await waitFor((value) => value.session?.status === 'ended');
  assert.equal(ended.session?.steps.length, 3);
  const request = {
    expectedRevision: ended.revision,
    displayName: 'Observed game',
    languageTag: 'en-GB',
  };
  const saved = await host.inject({
    method: 'POST',
    url: '/live/games',
    headers,
    payload: request,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const ids = saved.json<{
    itemId: number;
    revisionId: number;
    dataRevision: number;
  }>();
  for (const id of Object.values(ids))
    assert.ok(Number.isSafeInteger(id) && id > 0);
  const stored = await host.inject({
    url: `/inventory/items/${ids.itemId}/revisions/${ids.revisionId}?scopeKind=free`,
    headers,
  });
  assert.equal(stored.statusCode, 200, stored.body);
  assert.ok(stored.json().itemId);
  assert.ok(stored.body.includes('1/2-1/2'));
  assert.equal((await getState()).session, undefined);
  const duplicate = await host.inject({
    method: 'POST',
    url: '/live/games',
    headers,
    payload: request,
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(provider.writes.length, 0);
});

test('browser start gates objective, Maia and local playout, including unknown non-playable own variants', async (t) => {
  const { host, headers, command, getState, waitFor, connect, provider } =
    await setup(t);
  await connect();
  await command({ kind: 'observe', url: 'https://lichess.org/Abcd1234' });
  const before = await waitFor((state) => state.session?.connected === true);
  assert.ok(before.session?.focus);
  const own: LiveOwnGame = {
    gameId: 'OwnX1234',
    displayName: 'Unknown variant',
    playerSide: 'white',
    boardCompatible: false,
    standard: false,
  };
  provider.account.push({ kind: 'game_started', game: own });
  const blocked = await waitFor(
    (state) => state.fairPlayBlocked && state.games.length === 1,
  );
  assert.equal(blocked.session?.focus, undefined);
  const scratch = {
    scope: { kind: 'free' },
    expectedScratchId: 'blocked-scratch',
    expectedScratchRevision: 1,
  };
  const expectedPlayout = {
    scope: { kind: 'free' },
    draftId: '1',
    expectedDraftRevision: 1,
  };
  const knowledgeRequests = [
    {
      method: 'PUT',
      url: '/analysis/scratch',
      payload: { ...scratch, action: { kind: 'move_cursor', cursor: 0 } },
    },
    {
      method: 'POST',
      url: '/inventory/items/1/revision-edits',
      payload: {
        ...scratch,
        baseRevisionId: '1',
        anchorId: '1',
        mode: 'metadata',
      },
    },
    {
      method: 'POST',
      url: '/inventory/items/1/revision-edits/promote-analysis',
      payload: { ...scratch, baseRevisionId: '1', anchorId: '1' },
    },
    {
      method: 'POST',
      url: '/inventory/revision-edits/preview',
      payload: scratch,
    },
    { method: 'POST', url: '/playout/pause', payload: expectedPlayout },
    { method: 'POST', url: '/playout/stop', payload: expectedPlayout },
    {
      method: 'POST',
      url: '/playout/cancel-completion',
      payload: expectedPlayout,
    },
  ] as const;
  for (const request of knowledgeRequests) {
    const response: LightMyRequestResponse = await host.inject({
      ...request,
      headers,
    });
    assert.equal(response.statusCode, 403, `${request.url}: ${response.body}`);
    assert.equal(response.json().code, 'live.fair_play_blocked', request.url);
  }
  for (const url of [
    '/analysis/workspace?scopeKind=free',
    '/inventory/items/1/revisions/1?scopeKind=free',
    '/playout?scopeKind=free',
  ]) {
    const response = await host.inject({ url, headers });
    assert.equal(response.statusCode, 403, `${url}: ${response.body}`);
    assert.equal(response.json().code, 'live.fair_play_blocked', url);
  }
  for (const mode of [
    { kind: 'objective', budget: 'fast' },
    { kind: 'human_policy' },
  ]) {
    const response: LightMyRequestResponse = await host.inject({
      method: 'POST',
      url: '/analysis/position',
      headers,
      payload: {
        work: { kind: 'live', revision: blocked.revision, ply: 2 },
        focus: before.session.focus,
        consumerId: 'live-host',
        laneId: mode.kind,
        providerInstanceId: mode.kind === 'objective' ? 'stockfish' : 'maia',
        candidateCount: 1,
        mode,
      },
    });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().code, 'live.fair_play_blocked');
  }
  for (const capability of ['best_move', 'human_profile']) {
    const response = await host.inject({
      method: 'POST',
      url: '/playout',
      headers,
      payload: {
        scope: { kind: 'free' },
        start: { kind: 'initial_position' },
        providerInstanceId: 'engine',
        capability,
        opening: {
          kind: 'user_move',
          move: { kind: 'notation', value: 'e4', locale: 'en-GB' },
        },
      },
    });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().code, 'live.fair_play_blocked');
  }
  assert.equal((await command({ kind: 'discard' })).statusCode, 200);
  assert.equal((await getState()).fairPlayBlocked, true);
  const play = await command({ kind: 'play', gameId: own.gameId });
  assert.equal(play.statusCode, 409);
  assert.equal(play.json().code, 'live.not_playable');
  const observeOwn = await command({
    kind: 'observe',
    url: `https://lichess.org/${own.gameId}`,
  });
  assert.equal(observeOwn.statusCode, 403);
  assert.equal(observeOwn.json().code, 'live.own_game');
  provider.account.push({ kind: 'game_finished', gameId: own.gameId });
  await waitFor((state) => !state.fairPlayBlocked && state.games.length === 0);
  assert.deepEqual(provider.writes, []);
});

test('own play waits for authoritative confirmation, disallows historic selection and aborts streams on close', async (t) => {
  const provider = new Provider();
  provider.ownGames = [
    {
      gameId: 'Abcd1234',
      displayName: 'Tester - Black',
      playerSide: 'white',
      boardCompatible: true,
      standard: true,
    },
  ];
  provider.snapshot = {
    ...provider.snapshot,
    white: { id: 'tester', name: 'Tester' },
    moves: [],
  };
  const { command, waitFor, getState, connect } = await setup(t, provider);
  await connect();
  assert.equal(
    (await command({ kind: 'play', gameId: 'Abcd1234' })).statusCode,
    200,
  );
  await waitFor((state) => state.session?.connected === true);
  const move = await command({ kind: 'move', move: 'e2e4' });
  assert.equal(move.statusCode, 200, move.body);
  assert.equal(move.json<LiveState>().session?.pendingMove, true);
  assert.equal(move.json<LiveState>().session?.steps.length, 0);
  assert.deepEqual(provider.writes, ['Abcd1234:e2e4']);
  assert.equal((await command({ kind: 'move', move: 'e2e4' })).statusCode, 409);
  provider.snapshot = {
    ...provider.snapshot,
    moves: [{ kind: 'coordinates', value: 'e2e4' }],
  };
  provider.game.push({ kind: 'snapshot', game: provider.snapshot });
  const confirmed = await waitFor(
    (state) =>
      state.session?.steps.length === 1 && state.session.pendingMove === false,
  );
  assert.deepEqual(confirmed.session?.legalMoves, []);
  assert.equal(confirmed.session?.focus, undefined);
  const selection = await command({ kind: 'select', ply: 0 });
  assert.equal(selection.statusCode, 400);
  assert.equal(selection.json().code, 'live.invalid_selection');
  assert.equal(
    (await command({ kind: 'act', action: 'offer_draw' })).statusCode,
    200,
  );
  assert.deepEqual(provider.writes, ['Abcd1234:e2e4', 'Abcd1234:offer_draw']);
  assert.equal((await getState()).fairPlayBlocked, true);
});

test('host sanitizes raw provider failures and exposes no credentials in live configuration', async (t) => {
  const { host, headers, command, connect, provider } = await setup(t);
  await connect();
  provider.readFailure = new Error('secret-marker raw provider response', {
    cause: 'secret-marker',
  });
  const response = await command({
    kind: 'observe',
    url: 'https://lichess.org/Abcd1234',
  });
  assert.equal(response.json().code, 'live.provider_unavailable');
  assert.equal(response.body.includes('secret-marker'), false);
  assert.equal(response.body.includes('cause'), false);
  const status = await host.inject({ url: '/configuration/live', headers });
  assert.equal(status.statusCode, 200, status.body);
  assert.deepEqual(Object.keys(status.json()).sort(), [
    'configurationRevision',
    'configured',
    'restartRequired',
    'tokenConfigured',
  ]);
  assert.equal('token' in status.json(), false);
});
