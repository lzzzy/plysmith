import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { LiveService } from '../../../app/application/live/live-session.ts';
import { FairPlayGate } from '../../../app/application/live/fair-play-gate.ts';
import {
  LiveProviderError,
  type LiveAccount,
  type LiveAccountEvent,
  type LiveGameEvent,
  type LiveGameSnapshot,
  type LiveProviderPort,
} from '../../../app/application/live/live-ports.ts';
import type {
  LiveFairPlayGuard,
  LiveFairPlayGuardState,
  LiveRecordWriter,
} from '../../../app/application/live/live-models.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { LichessLiveProvider } from '../../../app/infrastructure/adapters/live/lichess/index.ts';

const rules = new ChessJsRulesAdapter();
const id = 'AbCd1234';
const own = {
  gameId: id,
  displayName: 'Alice - Bob',
  playerSide: 'white' as const,
  boardCompatible: true,
  standard: true,
};
function game(moves = ['e4', 'e5'], ended = false): LiveGameSnapshot {
  return {
    gameId: id,
    standard: true,
    initialFen: 'startpos',
    white: { id: 'alice', name: 'Alice' },
    black: { id: 'bob', name: 'Bob' },
    moves: moves.map((value) => ({ kind: 'notation', value, locale: 'en-GB' })),
    status: ended ? 'ended' : 'ongoing',
    outcome: ended ? 'draw' : 'unfinished',
  };
}
class Feed<T> {
  readonly values: T[] = [];
  #wake: (() => void) | undefined;
  push(value: T): void {
    this.values.push(value);
    this.#wake?.();
  }
  async *stream(signal: AbortSignal): AsyncIterable<T> {
    while (!signal.aborted) {
      if (this.values.length) {
        yield this.values.shift()!;
        continue;
      }
      await new Promise<void>((resolve) => {
        const wake = () => {
          signal.removeEventListener('abort', wake);
          this.#wake = undefined;
          resolve();
        };
        this.#wake = wake;
        signal.addEventListener('abort', wake, { once: true });
        if (signal.aborted) wake();
      });
    }
  }
}
async function until(predicate: () => boolean): Promise<void> {
  for (let count = 0; count < 100; count++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail('Live state did not settle');
}
function fixture(t: TestContext, playing = false, guard?: LiveFairPlayGuard) {
  const accountEvents = new Feed<LiveAccountEvent>();
  const gameEvents = new Feed<LiveGameEvent>();
  let snapshot = game();
  let account: LiveAccount = {
    id: playing ? 'alice' : 'spectator',
    name: 'User',
    games: playing ? [own] : [],
  };
  let submit: LiveProviderPort['submitMove'] = async () => undefined;
  let now = '2026-10-05T12:00:00.000Z';
  const submitted: string[] = [];
  const providerCalls: string[] = [];
  const streamSignals: AbortSignal[] = [];
  const saved: Parameters<LiveRecordWriter['saveLiveGame']>[0][] = [];
  const provider: LiveProviderPort = {
    readAccount: async () => {
      providerCalls.push('readAccount');
      return account;
    },
    streamAccount: async function* (signal) {
      providerCalls.push('streamAccount');
      streamSignals.push(signal);
      yield { kind: 'connected' };
      yield* accountEvents.stream(signal);
    },
    readGame: async () => {
      providerCalls.push('readGame');
      return snapshot;
    },
    streamGame: (_id, _role, signal) => {
      providerCalls.push('streamGame');
      streamSignals.push(signal);
      return gameEvents.stream(signal);
    },
    submitMove: async (gameId, move, signal) => {
      providerCalls.push('submitMove');
      submitted.push(move);
      await submit(gameId, move, signal);
    },
    act: async () => {
      providerCalls.push('act');
    },
  };
  const fairPlay = new FairPlayGate();
  const service = new LiveService({
    provider,
    rules,
    fairPlay,
    ...(guard ? { guard } : {}),
    writer: {
      saveLiveGame: async (request) => {
        saved.push(request);
        return { itemId: 1, revisionId: 1, dataRevision: 1 };
      },
    },
    now: () => now,
    onChange: () => undefined,
  });
  t.after(() => service.close());
  service.start();
  return {
    service,
    fairPlay,
    provider,
    accountEvents,
    gameEvents,
    submitted,
    providerCalls,
    streamSignals,
    saved,
    set snapshot(value: LiveGameSnapshot) {
      snapshot = value;
    },
    set account(value: LiveAccount) {
      account = value;
    },
    set submit(value: LiveProviderPort['submitMove']) {
      submit = value;
    },
    set now(value: string) {
      now = value;
    },
    async ready() {
      await until(() => service.getState().connection === 'connected');
    },
    async connect() {
      await service.refresh(service.getState().revision);
      await until(() => service.getState().connection === 'connected');
    },
    get revision() {
      return service.getState().revision;
    },
  };
}

test('configured startup stays disconnected and analysable without any provider reads or streams until explicit refresh', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let guardReads = 0;
  const writes: LiveFairPlayGuardState[] = [];
  const f = fixture(t, false, {
    readLiveFairPlayGuard: async () => {
      guardReads++;
      return { blocked: false };
    },
    writeLiveFairPlayGuard: async (state) => {
      writes.push(state);
    },
  });
  await f.service.initialize();
  f.service.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(120_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(guardReads, 1);
  assert.deepEqual(f.providerCalls, []);
  assert.deepEqual(writes, []);
  assert.equal(f.service.getState().configured, true);
  assert.equal(f.service.getState().online, false);
  assert.equal(f.service.getState().connection, 'disconnected');
  assert.equal(f.service.getState().fairPlayBlocked, false);
  assert.doesNotThrow(() => f.fairPlay.assertAllowed());
  await assert.rejects(
    f.service.observe(`https://lichess.org/${id}`, f.revision),
    { problemCode: 'live.not_connected' },
  );
  await assert.rejects(f.service.play(id, f.revision), {
    problemCode: 'live.not_connected',
  });
  await assert.rejects(f.service.refresh(f.revision + 1), {
    problemCode: 'live.stale_state',
  });
  assert.deepEqual(f.providerCalls, []);
  await f.connect();
  assert.equal(f.service.getState().online, true);
  assert.deepEqual(f.providerCalls, ['streamAccount', 'readAccount']);
  assert.equal(f.fairPlay.blocked, false);
});

test('restart retains a stored blocked guard without provider contact until explicit refresh confirms the original account has no game', async (t) => {
  let stored: LiveFairPlayGuardState = { blocked: true, accountId: 'alice' };
  const writes: LiveFairPlayGuardState[] = [];
  const f = fixture(t, false, {
    readLiveFairPlayGuard: async () => stored,
    writeLiveFairPlayGuard: async (state) => {
      stored = state;
      writes.push(state);
    },
  });
  await f.service.initialize();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.service.getState().connection, 'disconnected');
  assert.equal(f.fairPlay.blocked, true);
  assert.throws(() => f.fairPlay.assertAllowed(), {
    problemCode: 'live.fair_play_blocked',
  });
  assert.deepEqual(f.providerCalls, []);
  assert.deepEqual(writes, []);
  let resolveAccount!: (account: LiveAccount) => void;
  f.provider.readAccount = async () => {
    f.providerCalls.push('readAccount');
    return new Promise((resolve) => {
      resolveAccount = resolve;
    });
  };
  await f.service.refresh(f.revision);
  await until(() => resolveAccount !== undefined);
  assert.equal(f.fairPlay.blocked, true);
  assert.deepEqual(stored, { blocked: true, accountId: 'alice' });
  resolveAccount({ id: 'alice', name: 'Alice', games: [] });
  await f.ready();
  await until(() => !stored.blocked);
  assert.deepEqual(f.providerCalls, ['streamAccount', 'readAccount']);
  assert.deepEqual(stored, { blocked: false });
  assert.doesNotThrow(() => f.fairPlay.assertAllowed());
});

test('a failed first explicit connection fails closed after an analysable idle startup', async (t) => {
  const f = fixture(t);
  await f.service.initialize();
  assert.deepEqual(f.providerCalls, []);
  assert.equal(f.fairPlay.blocked, false);
  f.provider.readAccount = async () => {
    throw new LiveProviderError('live.provider_unavailable');
  };
  await f.service.refresh(f.revision);
  await until(
    () => f.service.getState().problemCode === 'live.provider_unavailable',
  );
  assert.equal(f.fairPlay.blocked, true);
  assert.throws(() => f.fairPlay.assertAllowed(), {
    problemCode: 'live.fair_play_blocked',
  });
});

test('offline aborts subscriptions without discarding an own recording or releasing its guard and reconnect restores the session', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let stored: LiveFairPlayGuardState = { blocked: false };
  const f = fixture(t, true, {
    readLiveFairPlayGuard: async () => stored,
    writeLiveFairPlayGuard: async (state) => {
      stored = state;
    },
  });
  await f.connect();
  await f.service.play(id, f.revision);
  f.gameEvents.push({ kind: 'snapshot', game: game() });
  await until(() => f.service.getState().session?.connected === true);
  await until(() => stored.blocked && stored.accountId === 'alice');
  const before = f.service.getState();
  const callsBefore = [...f.providerCalls];
  const signalsBefore = [...f.streamSignals];
  assert.equal(signalsBefore.length, 2);
  await assert.rejects(f.service.disconnect(f.revision - 1), {
    problemCode: 'live.stale_state',
  });
  assert.deepEqual(f.service.getState(), before);
  assert.ok(signalsBefore.every((signal) => !signal.aborted));
  const offline = await f.service.disconnect(f.revision);
  assert.equal(offline.online, false);
  assert.equal(offline.connection, 'disconnected');
  assert.equal(offline.session?.connected, false);
  assert.deepEqual(offline.session?.steps, before.session?.steps);
  assert.equal(offline.session?.gameId, id);
  assert.equal(offline.session?.status, 'ongoing');
  assert.ok(signalsBefore.every((signal) => signal.aborted));
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(120_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(f.providerCalls, callsBefore);
  assert.deepEqual(f.submitted, []);
  assert.deepEqual(f.saved, []);
  assert.deepEqual(stored, { blocked: true, accountId: 'alice' });
  assert.equal(f.fairPlay.blocked, true);
  await f.connect();
  f.gameEvents.push({ kind: 'snapshot', game: game() });
  await until(() => f.service.getState().session?.connected === true);
  assert.equal(f.service.getState().online, true);
  assert.deepEqual(f.service.getState().session?.steps, before.session?.steps);
  assert.equal(f.fairPlay.blocked, true);
  assert.deepEqual(f.submitted, []);
  assert.deepEqual(f.saved, []);
});

test('offline respects the inflight command boundary and retains an unconfirmed move without retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, true);
  await f.connect();
  await f.service.play(id, f.revision);
  f.gameEvents.push({ kind: 'snapshot', game: game() });
  await until(() => f.service.getState().session?.connected === true);
  let writeSignal: AbortSignal | undefined;
  let acknowledge!: () => void;
  f.submit = async (_id, _move, signal) => {
    writeSignal = signal;
    return new Promise((resolve) => {
      acknowledge = resolve;
    });
  };
  const moving = f.service.move('g1f3', f.revision);
  await until(() => writeSignal !== undefined);
  await assert.rejects(f.service.disconnect(f.revision), {
    problemCode: 'live.busy',
  });
  assert.equal(f.service.getState().online, true);
  assert.equal(writeSignal?.aborted, false);
  acknowledge();
  await moving;
  const callsBefore = [...f.providerCalls];
  await f.service.disconnect(f.revision);
  assert.equal(f.service.getState().online, false);
  assert.equal(f.service.getState().session?.connected, false);
  assert.equal(f.service.getState().session?.steps.length, 2);
  assert.equal(f.service.getState().session?.pendingMove, true);
  assert.equal(f.fairPlay.blocked, true);
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(120_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(f.providerCalls, callsBefore);
  assert.deepEqual(f.submitted, ['g1f3']);
  assert.deepEqual(f.saved, []);
});

test('discarding an offline own recording preserves the known guard without remote reads or actions', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let stored: LiveFairPlayGuardState = { blocked: false };
  const f = fixture(t, true, {
    readLiveFairPlayGuard: async () => stored,
    writeLiveFairPlayGuard: async (state) => {
      stored = state;
    },
  });
  await f.connect();
  await f.service.play(id, f.revision);
  f.gameEvents.push({ kind: 'snapshot', game: game() });
  await until(() => f.service.getState().session?.connected === true);
  await until(() => stored.blocked && stored.accountId === 'alice');
  await f.service.disconnect(f.revision);
  const callsBefore = [...f.providerCalls];
  const discarded = await f.service.discard(f.revision);
  assert.equal(discarded.online, false);
  assert.equal(discarded.connection, 'disconnected');
  assert.equal(discarded.session, undefined);
  assert.equal(discarded.fairPlayBlocked, true);
  assert.throws(() => f.fairPlay.assertAllowed(), {
    problemCode: 'live.fair_play_blocked',
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(120_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(stored, { blocked: true, accountId: 'alice' });
  assert.deepEqual(f.providerCalls, callsBefore);
  assert.deepEqual(f.submitted, []);
  assert.deepEqual(f.saved, []);
});

test('observer records history, ignores replay, preserves selection and saves final authoritative game', async (t) => {
  const f = fixture(t);
  await f.connect();
  const opened = await f.service.observe(
    `https://lichess.org/${id}`,
    f.revision,
  );
  assert.equal(opened.revision, f.revision);
  assert.equal(opened.session?.steps.length, 2);
  assert.equal(f.fairPlay.blocked, false);
  const focus = opened.session!.focus!;
  f.service.requireAnalysisFocus(
    { kind: 'live', revision: opened.session!.analysisRevision, ply: 2 },
    focus,
  );
  f.service.select(1, f.revision);
  const prior = opened.session!.steps[0]!.after.fen;
  f.gameEvents.push({ kind: 'position', fen: prior, lastMove: 'e2e4' });
  const applied = rules.applyMove(
    opened.session!.root,
    opened.session!.steps.map((step) => step.move),
    { kind: 'coordinates', value: 'g1f3' },
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  f.gameEvents.push({
    kind: 'position',
    fen: applied.value.after.fen,
    lastMove: 'g1f3',
  });
  await until(() => f.service.getState().session?.steps.length === 3);
  assert.equal(f.service.getState().session?.selectedPly, 1);
  assert.throws(
    () =>
      f.service.requireAnalysisFocus(
        { kind: 'live', revision: opened.session!.analysisRevision, ply: 2 },
        focus,
      ),
    { problemCode: 'live.stale_state' },
  );
  f.snapshot = game(['e4', 'e5', 'Nf3', 'Nc6'], true);
  f.gameEvents.push({ kind: 'finished' });
  await until(() => f.service.getState().session?.status === 'ended');
  await f.service.save({
    expectedRevision: f.revision,
    displayName: 'Observed game',
    languageTag: 'en-GB',
  });
  assert.equal(f.saved[0]?.steps.length, 4);
  assert.equal(f.saved[0]?.outcome, 'draw');
  assert.equal(f.service.getState().session, undefined);
});

test('own games block engines across discard and unsupported events; play waits for authoritative board', async (t) => {
  const f = fixture(t, true);
  assert.equal(f.fairPlay.blocked, false);
  await f.connect();
  assert.equal(f.fairPlay.blocked, true);
  await assert.rejects(
    f.service.observe(`https://lichess.org/${id}`, f.revision),
    { problemCode: 'live.own_game' },
  );
  await f.service.play(id, f.revision);
  await assert.rejects(f.service.move('g1f3', f.revision), {
    problemCode: 'live.not_playable',
  });
  f.gameEvents.push({ kind: 'snapshot', game: game() });
  await until(() => f.service.getState().session?.connected === true);
  assert.ok(f.service.getState().session!.legalMoves.length > 0);
  assert.equal(f.service.getState().session!.focus, undefined);
  assert.throws(() => f.service.select(1, f.revision), {
    problemCode: 'live.invalid_selection',
  });
  await f.service.move('g1f3', f.revision);
  assert.deepEqual(f.submitted, ['g1f3']);
  assert.equal(f.service.getState().session!.steps.length, 2);
  assert.equal(f.service.getState().session!.pendingMove, true);
  await f.service.discard(f.revision);
  assert.equal(f.fairPlay.blocked, true);
  f.accountEvents.push({ kind: 'game_finished', gameId: id });
  await until(() => !f.fairPlay.blocked);
  f.accountEvents.push({
    kind: 'game_started',
    game: { ...own, standard: false, boardCompatible: false },
  });
  await until(() => f.fairPlay.blocked);
  await assert.rejects(f.service.play(id, f.revision), {
    problemCode: 'live.not_playable',
  });
});

test('uncertain writes resync without retry; invalid snapshots and premature save retain recording', async (t) => {
  const f = fixture(t, true);
  await f.connect();
  await f.service.play(id, f.revision);
  f.gameEvents.push({ kind: 'snapshot', game: game() });
  await until(() => f.service.getState().session?.connected === true);
  f.submit = async () => {
    throw new LiveProviderError('live.move_uncertain');
  };
  await assert.rejects(f.service.move('g1f3', f.revision), {
    problemCode: 'live.move_uncertain',
  });
  assert.deepEqual(f.submitted, ['g1f3']);
  assert.equal(f.service.getState().session!.connected, false);
  await assert.rejects(
    f.service.save({
      expectedRevision: f.revision,
      displayName: 'Too soon',
      languageTag: 'de-DE',
    }),
    { problemCode: 'live.not_finished' },
  );
  f.gameEvents.push({ kind: 'snapshot', game: game(['e5']) });
  await until(
    () => f.service.getState().session?.problemCode === 'live.invalid_game',
  );
  assert.equal(f.service.getState().session!.steps.length, 2);
  assert.equal(f.fairPlay.blocked, true);
});

test('URL, own-identity, replacement, stale revision and finalization guards', async (t) => {
  const f = fixture(t);
  await f.connect();
  for (const url of [
    `https://evil.example/${id}`,
    `https://lichess.org@evil.example/${id}`,
    `http://lichess.org/${id}`,
    `https://lichess.org/study/${id}`,
  ])
    assert.throws(() => f.service.observe(url, f.revision), {
      problemCode: 'live.invalid_game',
    });
  f.snapshot = { ...game(), white: { id: 'spectator', name: 'User' } };
  await assert.rejects(
    f.service.observe(`https://lichess.org/${id}`, f.revision),
    { problemCode: 'live.own_game' },
  );
  f.snapshot = game();
  f.accountEvents.push({ kind: 'game_finished', gameId: id });
  await until(() => !f.fairPlay.blocked);
  await f.service.observe(`https://lichess.org/${id}/black`, f.revision);
  await assert.rejects(
    f.service.observe(`https://lichess.org/${id}`, f.revision),
    { problemCode: 'live.session_exists' },
  );
  await assert.rejects(f.service.discard(f.revision - 1), {
    problemCode: 'live.stale_state',
  });
  f.gameEvents.push({ kind: 'finished' });
  await until(() => f.service.getState().session?.status === 'finalizing');
  await assert.rejects(
    f.service.save({
      expectedRevision: f.revision,
      displayName: 'Delayed',
      languageTag: 'en-GB',
    }),
    { problemCode: 'live.not_finished' },
  );
});

test('account events buffered during initial read win the snapshot race and close aborts streams', async (t) => {
  const f = fixture(t);
  await f.connect();
  let resolveAccount!: (account: LiveAccount) => void;
  f.provider.readAccount = async () =>
    new Promise((resolve) => {
      resolveAccount = resolve;
    });
  const refreshed = await f.service.refresh(f.revision);
  assert.equal(refreshed.fairPlayBlocked, true);
  f.accountEvents.push({ kind: 'game_started', game: own });
  await new Promise<void>((resolve) => setImmediate(resolve));
  resolveAccount({ id: 'spectator', name: 'User', games: [] });
  await until(() => f.service.getState().connection === 'connected');
  assert.equal(f.fairPlay.blocked, true);
  assert.equal(f.service.getState().games.length, 1);
  await f.service.close();
  await assert.rejects(f.service.discard(f.revision), {
    problemCode: 'live.closed',
  });
});

test('durable guard survives missing token, binds the original account and clears only with proof', async (t) => {
  let stored: LiveFairPlayGuardState = { blocked: true, accountId: 'alice' };
  const writes: LiveFairPlayGuardState[] = [];
  const guard: LiveFairPlayGuard = {
    readLiveFairPlayGuard: async () => stored,
    writeLiveFairPlayGuard: async (state) => {
      stored = state;
      writes.push(state);
    },
  };
  const gate = new FairPlayGate();
  const offline = new LiveService({
    rules,
    fairPlay: gate,
    guard,
    writer: {
      saveLiveGame: async () => {
        throw new Error('unused');
      },
    },
    now: () => '',
    onChange: () => undefined,
  });
  t.after(() => offline.close());
  await offline.initialize();
  assert.equal(offline.getState().configured, false);
  assert.equal(gate.blocked, true);
  const other = fixture(t, false, guard);
  await other.service.initialize();
  assert.equal(other.fairPlay.blocked, true);
  assert.deepEqual(other.providerCalls, []);
  await other.service.refresh(other.revision);
  await until(
    () => other.service.getState().problemCode === 'live.account_mismatch',
  );
  assert.equal(other.fairPlay.blocked, true);
  await other.service.close();
  assert.equal(stored.accountId, 'alice');
  const correct = fixture(t, true, guard);
  await correct.connect();
  correct.accountEvents.push({ kind: 'game_finished', gameId: id });
  await until(() => !correct.fairPlay.blocked);
  assert.deepEqual(stored, { blocked: false });
  correct.accountEvents.push({ kind: 'game_started', game: own });
  await until(() => stored.blocked && stored.accountId === 'alice');
  assert.equal(correct.fairPlay.blocked, true);
  assert.ok(writes.some((state) => !state.blocked));
});

test('failed account stream keeps assistance blocked, and failed durable writes fail closed', async (t) => {
  const f = fixture(t);
  await f.connect();
  f.provider.streamAccount = async function* () {
    yield { kind: 'game_started', game: own };
    throw new Error('private upstream payload');
  };
  await f.service.refresh(f.revision);
  await until(
    () => f.service.getState().problemCode === 'live.provider_unavailable',
  );
  assert.equal(f.fairPlay.blocked, true);
  assert.ok(!JSON.stringify(f.service.getState()).includes('private upstream'));
  const broken = fixture(t, false, {
    readLiveFairPlayGuard: async () => ({ blocked: false }),
    writeLiveFairPlayGuard: async () => {
      throw new Error('private disk path');
    },
  });
  await broken.service.refresh(broken.revision);
  await until(() => broken.service.getState().connection === 'failed');
  assert.equal(broken.fairPlay.blocked, true);
  assert.equal(broken.service.getState().problemCode, 'live.guard_unavailable');
});

test('a queued durable unblock is skipped when a newer game start already blocks assistance', async (t) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.after(() => release());
  const writes: LiveFairPlayGuardState[] = [];
  const f = fixture(t, false, {
    readLiveFairPlayGuard: async () => ({ blocked: false }),
    writeLiveFairPlayGuard: async (state) => {
      await pending;
      writes.push(state);
    },
  });
  await f.connect();
  f.accountEvents.push({ kind: 'game_started', game: own });
  await until(() => f.service.getState().games.length === 1);
  release();
  await until(() => writes.some((state) => state.accountId === 'spectator'));
  assert.equal(
    writes.some((state) => !state.blocked),
    false,
  );
  assert.equal(f.fairPlay.blocked, true);
});

test('rejected move releases pending input and unsupported or oversized games never replace a session', async (t) => {
  const f = fixture(t, true);
  await f.connect();
  await f.service.play(id, f.revision);
  f.gameEvents.push({ kind: 'snapshot', game: game() });
  await until(() => f.service.getState().session?.connected === true);
  f.submit = async () => {
    throw new LiveProviderError('live.move_rejected');
  };
  await assert.rejects(f.service.move('g1f3', f.revision), {
    problemCode: 'live.move_rejected',
  });
  assert.equal(f.service.getState().session?.pendingMove, false);
  assert.ok(f.service.getState().session!.legalMoves.length > 0);
  await f.service.discard(f.revision);
  f.snapshot = { ...game(), standard: false };
  await assert.rejects(f.service.play(id, f.revision), {
    problemCode: 'live.unsupported_variant',
  });
  f.snapshot = game(Array<string>(1001).fill('e4'));
  await assert.rejects(f.service.play(id, f.revision), {
    problemCode: 'live.game_too_long',
  });
  assert.equal(f.service.getState().session, undefined);
});

test('observer refresh restarts subscription and delayed exports never shorten recorded history', async (t) => {
  const f = fixture(t);
  await f.connect();
  let streams = 0;
  f.provider.streamGame = (_id, _role, signal) => {
    streams++;
    return f.gameEvents.stream(signal);
  };
  await f.service.observe(`https://lichess.org/${id}`, f.revision);
  f.gameEvents.push({ kind: 'snapshot', game: game(['e4', 'e5', 'Nf3']) });
  await until(() => f.service.getState().session?.steps.length === 3);
  f.snapshot = game(['e4', 'e5']);
  await f.service.refresh(f.revision);
  assert.equal(streams, 2);
  assert.equal(f.service.getState().session?.steps.length, 3);
});

test('same-line clock or draw snapshots do not acknowledge a submitted move', async (t) => {
  const f = fixture(t, true);
  await f.connect();
  await f.service.play(id, f.revision);
  f.gameEvents.push({ kind: 'snapshot', game: game() });
  await until(() => f.service.getState().session?.connected === true);
  await f.service.move('g1f3', f.revision);
  const before = f.revision;
  f.gameEvents.push({
    kind: 'snapshot',
    game: { ...game(), blackDrawOffer: true },
  });
  await until(() => f.revision > before);
  assert.equal(f.service.getState().session?.pendingMove, true);
  assert.equal(f.service.getState().session?.legalMoves.length, 0);
  f.gameEvents.push({ kind: 'snapshot', game: game(['e4', 'e5', 'Nf3']) });
  await until(() => f.service.getState().session?.pendingMove === false);
});

test('healthy observer positions clear a previous stream error without changing historical analysis focus', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  await f.connect();
  let attempts = 0;
  f.provider.streamGame = async function* (_id, _role, signal) {
    attempts++;
    if (attempts === 1)
      throw new LiveProviderError('live.provider_unavailable');
    yield* f.gameEvents.stream(signal);
  };
  await f.service.observe(`https://lichess.org/${id}`, f.revision);
  await until(
    () =>
      f.service.getState().session?.problemCode === 'live.provider_unavailable',
  );
  f.service.select(1, f.revision);
  const before = f.service.getState().session!;
  t.mock.timers.tick(1000);
  await until(() => attempts === 2);
  f.gameEvents.push({
    kind: 'position',
    fen: before.steps.at(-1)!.after.fen,
    whiteClockMs: 599000,
    blackClockMs: 598000,
  });
  await until(() => f.service.getState().session?.connected === true);
  const after = f.service.getState().session!;
  assert.equal(after.problemCode, undefined);
  assert.equal(after.selectedPly, 1);
  assert.equal(after.steps.length, 2);
  assert.equal(after.analysisRevision, before.analysisRevision);
  assert.equal(after.clockUpdatedAt, '2026-10-05T12:00:00.000Z');
});

test('clean stream EOF confirms an ended export and makes the recording saveable without a finish event', async (t) => {
  const f = fixture(t);
  await f.connect();
  const ended = {
    ...game(['e4', 'e5', 'Nf3'], true),
    outcome: 'black_win' as const,
  };
  f.provider.streamGame = async function* () {
    yield { kind: 'snapshot', game: game(['e4', 'e5', 'Nf3']) };
    f.snapshot = ended;
  };
  await f.service.observe(`https://lichess.org/${id}`, f.revision);
  await until(() => f.service.getState().session?.status === 'ended');
  const completed = f.service.getState().session!;
  assert.equal(completed.connected, false);
  assert.equal(completed.problemCode, undefined);
  assert.equal(completed.outcome, 'black_win');
  await f.service.save({
    expectedRevision: f.revision,
    displayName: 'Observed resignation',
    languageTag: 'en-GB',
  });
  assert.equal(f.saved[0]?.outcome, 'black_win');
  assert.equal(f.saved[0]?.steps.length, 3);
});

test('clean stream EOF with an ongoing export never freezes the game in finalizing and reconnects', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  await f.connect();
  let attempts = 0;
  f.provider.streamGame = async function* (_id, _role, signal) {
    attempts++;
    if (attempts === 1) return;
    yield* f.gameEvents.stream(signal);
  };
  await f.service.observe(`https://lichess.org/${id}`, f.revision);
  await until(
    () =>
      f.service.getState().session?.problemCode === 'live.provider_unavailable',
  );
  assert.equal(f.service.getState().session?.status, 'ongoing');
  assert.equal(f.service.getState().session?.outcome, 'unfinished');
  t.mock.timers.tick(1000);
  await until(() => attempts === 2);
  f.gameEvents.push({ kind: 'snapshot', game: game(['e4', 'e5', 'Nf3']) });
  await until(() => f.service.getState().session?.steps.length === 3);
  assert.equal(f.service.getState().session?.status, 'ongoing');
  assert.equal(f.service.getState().session?.problemCode, undefined);
});

test('public adapter EOF and a resignation export with a final active clock complete and save the entire recording', async (t) => {
  const f = fixture(t);
  await f.connect();
  const after = rules.applyMove(rules.initialState(), [], {
    kind: 'notation',
    value: 'e4',
    locale: 'en-GB',
  });
  assert.ok(after.ok);
  let exports = 0;
  const provider = new LichessLiveProvider({
    token: 'unused_test_only',
    fetch: async (url) => {
      if (String(url).includes('/api/stream/'))
        return new Response(
          `${JSON.stringify({ id, variant: { key: 'standard' } })}\n${JSON.stringify({ fen: after.value.after.fen, lm: 'e2e4', wc: 598, bc: 600 })}\n`,
        );
      exports++;
      return Response.json({
        id,
        variant: 'standard',
        status: exports === 1 ? 'started' : 'resign',
        ...(exports === 1 ? {} : { winner: 'white' }),
        players: {
          white: { user: { id: 'alice', name: 'Alice' } },
          black: { user: { id: 'bob', name: 'Bob' } },
        },
        moves: exports === 1 ? '' : 'e4',
        clock: { initial: 600, increment: 0 },
        clocks: exports === 1 ? [] : [59800, 208],
      });
    },
  });
  f.provider.readGame = (gameId, signal) => provider.readGame(gameId, signal);
  f.provider.streamGame = (gameId, role, signal) =>
    provider.streamGame(gameId, role, signal);
  await f.service.observe(`https://lichess.org/${id}`, f.revision);
  await until(() => f.service.getState().session?.status === 'ended');
  const completed = f.service.getState().session!;
  assert.equal(exports, 2);
  assert.equal(completed.outcome, 'white_win');
  assert.equal(completed.blackClockMs, 2080);
  assert.equal(completed.connected, false);
  assert.equal(completed.problemCode, undefined);
  await f.service.save({
    expectedRevision: f.revision,
    displayName: 'Observed resignation',
    languageTag: 'en-GB',
  });
  assert.equal(f.saved[0]?.outcome, 'white_win');
  assert.equal(f.saved[0]?.steps.length, 1);
  assert.equal(f.saved[0]?.steps[0]?.move.san, 'e4');
});

test('own input is disabled immediately when the Board stream closes, before its export resolves', async (t) => {
  const f = fixture(t, true);
  await f.connect();
  let finish!: () => void;
  f.provider.streamGame = async function* () {
    yield { kind: 'snapshot', game: game() };
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  await f.service.play(id, f.revision);
  await until(() => f.service.getState().session?.connected === true);
  let exportStarted = false;
  let release!: (value: LiveGameSnapshot) => void;
  f.provider.readGame = () => {
    exportStarted = true;
    return new Promise<LiveGameSnapshot>((resolve) => {
      release = resolve;
    });
  };
  finish();
  await until(() => exportStarted);
  assert.equal(f.service.getState().session?.connected, false);
  assert.equal(f.service.getState().session?.legalMoves.length, 0);
  await assert.rejects(f.service.move('g1f3', f.revision), {
    problemCode: 'live.not_playable',
  });
  assert.equal(f.submitted.length, 0);
  assert.equal(f.fairPlay.blocked, true);
  release(game(['e4', 'e5'], true));
  await until(() => f.service.getState().session?.status === 'ended');
});

test('terminal Board moves survive an incomplete final export and cannot be saved early', async (t) => {
  const f = fixture(t, true);
  await f.connect();
  await f.service.play(id, f.revision);
  f.gameEvents.push({ kind: 'finished' });
  await until(() => f.service.getState().session?.status === 'finalizing');
  f.snapshot = game(['e4', 'e5'], true);
  f.gameEvents.push({
    kind: 'snapshot',
    game: game(['e4', 'e5', 'Nf3', 'Nc6'], true),
  });
  await until(() => f.service.getState().session?.steps.length === 4);
  assert.equal(f.service.getState().session?.steps.length, 4);
  assert.equal(f.service.getState().session?.status, 'finalizing');
  await assert.rejects(
    f.service.save({
      expectedRevision: f.revision,
      displayName: 'Final game',
      languageTag: 'en-GB',
    }),
    { problemCode: 'live.not_finished' },
  );
  f.snapshot = game(['e4', 'e5', 'Nf3', 'Nc6'], true);
  await f.service.refresh(f.revision);
  assert.equal(f.service.getState().session?.status, 'ended');
});

test('timeout export completes an own game and refresh recovers a failed final read without losing result or recording', async (t) => {
  const f = fixture(t, true);
  await f.connect();
  await f.service.play(id, f.revision);
  f.gameEvents.push({ kind: 'snapshot', game: game(['e4', 'e5', 'Nf3']) });
  await until(() => f.service.getState().session?.connected === true);
  let failFinalRead = true;
  const exportProvider = new LichessLiveProvider({
    token: 'unused_test_only',
    fetch: async () => {
      if (failFinalRead) return new Response('', { status: 503 });
      return Response.json({
        id,
        variant: 'standard',
        status: 'outoftime',
        winner: 'white',
        players: {
          white: { user: { id: 'alice', name: 'Alice' } },
          black: { user: { id: 'bob', name: 'Bob' } },
        },
        moves: 'e4 e5 Nf3',
        clock: { initial: 600, increment: 5 },
        clocks: [59980, 59920, 59800, 0],
      });
    },
  });
  f.provider.readGame = (gameId, signal) =>
    exportProvider.readGame(gameId, signal);
  f.gameEvents.push({
    kind: 'snapshot',
    game: {
      ...game(['e4', 'e5', 'Nf3'], true),
      outcome: 'white_win',
      whiteClockMs: 598000,
      blackClockMs: 0,
    },
  });
  f.accountEvents.push({ kind: 'game_finished', gameId: id });
  await until(
    () =>
      f.service.getState().session?.problemCode === 'live.provider_unavailable',
  );
  assert.equal(f.service.getState().session?.status, 'finalizing');
  assert.equal(f.fairPlay.blocked, true);
  assert.equal(f.service.getState().session?.steps.length, 3);
  await assert.rejects(
    f.service.save({
      expectedRevision: f.revision,
      displayName: 'Timeout',
      languageTag: 'en-GB',
    }),
    { problemCode: 'live.not_finished' },
  );
  failFinalRead = false;
  const refreshed = await f.service.refresh(f.revision);
  assert.equal(refreshed.session?.status, 'ended');
  assert.equal(refreshed.session?.outcome, 'white_win');
  assert.equal(refreshed.session?.blackClockMs, 0);
  assert.equal(refreshed.session?.problemCode, undefined);
  await until(() => !f.fairPlay.blocked);
  await f.service.save({
    expectedRevision: f.revision,
    displayName: 'Timeout',
    languageTag: 'en-GB',
  });
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0]?.outcome, 'white_win');
  assert.equal(f.saved[0]?.steps.length, 3);
  assert.equal(f.service.getState().session, undefined);
});

test('only streamed clocks receive a stable host timestamp without invalidating analysis focus', async (t) => {
  const f = fixture(t);
  f.snapshot = { ...game(), whiteClockMs: 600000, blackClockMs: 590000 };
  await f.connect();
  await f.service.observe(`https://lichess.org/${id}`, f.revision);
  assert.equal(f.service.getState().session?.clockUpdatedAt, undefined);
  f.service.select(1, f.revision);
  const before = f.service.getState().session!;
  const fen = before.steps.at(-1)!.after.fen;
  f.gameEvents.push({
    kind: 'position',
    fen,
    whiteClockMs: 599000,
    blackClockMs: 590000,
  });
  await until(() => f.service.getState().session?.whiteClockMs === 599000);
  assert.equal(
    f.service.getState().session?.clockUpdatedAt,
    '2026-10-05T12:00:00.000Z',
  );
  assert.equal(
    f.service.getState().session?.analysisRevision,
    before.analysisRevision,
  );
  f.now = '2026-10-05T12:00:10.000Z';
  f.service.select(2, f.revision);
  assert.equal(
    f.service.getState().session?.clockUpdatedAt,
    '2026-10-05T12:00:00.000Z',
  );
  f.gameEvents.push({
    kind: 'position',
    fen,
    whiteClockMs: 589000,
    blackClockMs: 590000,
  });
  await until(() => f.service.getState().session?.whiteClockMs === 589000);
  assert.equal(
    f.service.getState().session?.clockUpdatedAt,
    '2026-10-05T12:00:10.000Z',
  );
});

test('rate-limited account and game reconnects respect a minute cooldown', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  await f.connect();
  let gameAttempts = 0;
  f.provider.streamGame = async function* () {
    gameAttempts++;
    yield { kind: 'snapshot', game: game() };
    throw new LiveProviderError('live.rate_limited');
  };
  await f.service.observe(`https://lichess.org/${id}`, f.revision);
  await until(
    () => f.service.getState().session?.problemCode === 'live.rate_limited',
  );
  let accountAttempts = 0;
  f.provider.streamAccount = async function* () {
    accountAttempts++;
    throw new LiveProviderError('live.rate_limited');
    yield { kind: 'connected' };
  };
  await f.service.refresh(f.revision);
  await until(() => f.service.getState().problemCode === 'live.rate_limited');
  await new Promise<void>((resolve) => setImmediate(resolve));
  const initialGameAttempts = gameAttempts;
  t.mock.timers.tick(59_999);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(accountAttempts, 1);
  assert.equal(gameAttempts, initialGameAttempts);
  t.mock.timers.tick(1);
  await until(
    () => accountAttempts === 2 && gameAttempts === initialGameAttempts + 1,
  );
});

test('account read waits for the live HTTP handshake and closing interrupts the wait', async (t) => {
  const f = fixture(t);
  await f.connect();
  let reads = 0;
  f.provider.readAccount = async () => {
    reads++;
    return { id: 'spectator', name: 'User', games: [] };
  };
  f.provider.streamAccount = (signal) => f.accountEvents.stream(signal);
  await f.service.refresh(f.revision);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reads, 0);
  assert.equal(f.fairPlay.blocked, true);
  f.accountEvents.push({ kind: 'connected' });
  await f.ready();
  assert.equal(reads, 1);
  await f.service.refresh(f.revision);
  let closed = false;
  void f.service.close().then(() => {
    closed = true;
  });
  await until(() => closed);
  assert.equal(f.fairPlay.blocked, true);
});

test('rewound analysis focus ignores unrelated updates and rejects forged full chess states', async (t) => {
  const f = fixture(t);
  await f.connect();
  await f.service.observe(`https://lichess.org/${id}`, f.revision);
  const selected = f.service.select(1, f.revision).session!;
  const work = {
    kind: 'live' as const,
    revision: selected.analysisRevision,
    ply: 1,
  };
  const focus = selected.focus!;
  f.gameEvents.push({
    kind: 'snapshot',
    game: { ...game(['e4', 'e5', 'Nf3']), whiteClockMs: 123_000 },
  });
  await until(() => f.service.getState().session?.steps.length === 3);
  assert.equal(
    f.service.getState().session?.analysisRevision,
    selected.analysisRevision,
  );
  assert.equal(f.service.getState().session?.focus?.focusKey, focus.focusKey);
  f.service.requireAnalysisFocus(work, focus);
  assert.throws(
    () =>
      f.service.requireAnalysisFocus(work, {
        ...focus,
        root: {
          ...focus.root,
          playState: { ...focus.root.playState, historyKnowledge: 'unknown' },
        },
      }),
    { problemCode: 'live.stale_state' },
  );
  assert.throws(
    () =>
      f.service.requireAnalysisFocus(work, {
        ...focus,
        current: {
          ...focus.current,
          position: { ...focus.current.position, boardKey: '.'.repeat(64) },
        },
      }),
    { problemCode: 'live.stale_state' },
  );
  f.service.select(2, f.revision);
  assert.throws(() => f.service.requireAnalysisFocus(work, focus), {
    problemCode: 'live.stale_state',
  });
});

test('account disconnect aborts an inflight move without retry and graceful close retains the guard', async (t) => {
  let stored: LiveFairPlayGuardState = { blocked: false };
  const f = fixture(t, true, {
    readLiveFairPlayGuard: async () => stored,
    writeLiveFairPlayGuard: async (value) => {
      stored = value;
    },
  });
  let disconnect!: () => void;
  f.provider.streamAccount = async function* (signal) {
    yield { kind: 'connected' };
    await new Promise<void>((resolve) => {
      disconnect = resolve;
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
    throw new LiveProviderError('live.provider_unavailable');
  };
  await f.connect();
  await f.service.play(id, f.revision);
  f.gameEvents.push({ kind: 'snapshot', game: game() });
  await until(() => f.service.getState().session?.connected === true);
  let aborted = false;
  f.submit = async (_id, _move, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          reject(new LiveProviderError('live.move_uncertain'));
        },
        { once: true },
      );
    });
  const move = f.service.move('g1f3', f.revision);
  const rejected = assert.rejects(move, { problemCode: 'live.move_uncertain' });
  disconnect();
  await rejected;
  assert.equal(aborted, true);
  assert.deepEqual(f.submitted, ['g1f3']);
  assert.equal(f.fairPlay.blocked, true);
  await f.service.close();
  assert.deepEqual(stored, { blocked: true, accountId: 'alice' });
});
