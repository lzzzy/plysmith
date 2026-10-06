import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { inspect } from 'node:util';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { DEFAULT_POSITION } from 'chess.js';
import { LiveProviderError } from '../../../app/application/live/live-ports.ts';
import { LichessLiveProvider } from '../../../app/infrastructure/adapters/live/lichess/index.ts';

const token = 'test_only_secret_marker';
const id = 'Abcd1234';
const signal = () => new AbortController().signal;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const accountGame = (extra: Record<string, unknown> = {}) => ({
  gameId: id,
  color: 'white',
  variant: { key: 'standard' },
  speed: 'rapid',
  source: 'pool',
  opponent: { id: 'opponent', username: 'Opponent' },
  ...extra,
});
const exportedGame = (extra: Record<string, unknown> = {}) => ({
  id,
  variant: 'standard',
  status: 'started',
  players: {
    white: { user: { id: 'white', name: 'White' } },
    black: { user: { id: 'black', name: 'Black' } },
  },
  moves: 'e4 e5 Nf3',
  clock: { initial: 600, increment: 0 },
  clocks: [59980, 59920, 59800],
  ...extra,
});
const fullGame = (extra: Record<string, unknown> = {}) => ({
  type: 'gameFull',
  id,
  variant: { key: 'standard' },
  initialFen: 'startpos',
  white: { id: 'white', name: 'White' },
  black: { id: 'black', name: 'Black' },
  state: {
    type: 'gameState',
    moves: 'e2e4 e7e5',
    status: 'started',
    wtime: 598765,
    btime: 597654,
  },
  ...extra,
});

function controlledBody() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel() {
      cancelled += 1;
    },
  });
  return {
    response: new Response(body),
    body,
    get cancelled() {
      return cancelled;
    },
    send(value: unknown) {
      controller.enqueue(Buffer.from(`${JSON.stringify(value)}\n`));
    },
    bytes(value: Uint8Array) {
      controller.enqueue(value);
    },
    close() {
      controller.close();
    },
    error() {
      controller.error(new Error(`transport contained ${token}`));
    },
  };
}

function fixture(
  responses: Array<Response | (() => Response | Promise<Response>)>,
) {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const provider = new LichessLiveProvider({
    token,
    fetch: async (url, options) => {
      calls.push({ url: String(url), options: options ?? {} });
      const next = responses.shift();
      assert.notEqual(next, undefined, 'unexpected fetch');
      return typeof next === 'function' ? next() : next!;
    },
  });
  return { provider, calls };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of events) values.push(value);
  return values;
}

function safeError(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof LiveProviderError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.equal('cause' in error, false);
    assert.equal(inspect(error).includes(token), false);
    assert.equal(JSON.stringify(error).includes(token), false);
    return true;
  };
}

test('account identity and current games preserve own IDs, variant and board eligibility', async () => {
  const { provider, calls } = fixture([
    json({ id: 'MyUser', username: 'MyUser' }),
    json({
      nowPlaying: [
        accountGame(),
        accountGame({ speed: 'bullet' }),
        accountGame({ speed: 'blitz', source: 'friend' }),
        accountGame({ variant: { key: 'chess960' }, compat: { board: true } }),
        accountGame({ compat: { board: false } }),
      ],
    }),
  ]);
  const abort = signal();
  const account = await provider.readAccount(abort);
  assert.equal(account.id, 'myuser');
  assert.equal(account.name, 'MyUser');
  assert.deepEqual(
    account.games.map((game) => game.boardCompatible),
    [true, false, true, false, false],
  );
  assert.equal(account.games[0]?.displayName, 'Opponent');
  assert.equal(account.games[0]?.playerSide, 'white');
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      'https://lichess.org/api/account',
      'https://lichess.org/api/account/playing?nb=50',
    ],
  );
  for (const call of calls) {
    assert.equal(
      new Headers(call.options.headers).get('Authorization'),
      `Bearer ${token}`,
    );
    assert.equal(call.options.redirect, 'manual');
    assert.equal(call.options.signal?.aborted, true);
  }
  assert.equal(getEventListeners(abort, 'abort').length, 0);
  assert.equal(inspect(provider, { showHidden: true }).includes(token), false);
});

test('a saturated current-games response is rejected instead of proving the account snapshot complete', async () => {
  for (const count of [49, 50]) {
    const { provider, calls } = fixture([
      json({ id: 'tester', username: 'Tester' }),
      json({
        nowPlaying: Array.from({ length: count }, (_, index) =>
          accountGame({ gameId: `Game${String(index).padStart(4, '0')}` }),
        ),
      }),
    ]);
    if (count === 50) {
      await assert.rejects(
        provider.readAccount(signal()),
        safeError('live.protocol_error'),
      );
    } else {
      assert.equal((await provider.readAccount(signal())).games.length, count);
    }
    assert.equal(calls.length, 2);
    assert.equal(
      calls[1]?.url,
      'https://lichess.org/api/account/playing?nb=50',
    );
  }
});

test(
  'transport cancellation that never resolves cannot hold abort or iterator shutdown open',
  { timeout: 2000 },
  async () => {
    for (const mode of ['read', 'write', 'stream'] as const) {
      let cancellations = 0;
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancellations++;
          return new Promise<void>(() => {});
        },
      });
      const { provider } = fixture([new Response(body)]);
      const controller = new AbortController();
      if (mode === 'stream') {
        const events = provider
          .streamAccount(controller.signal)
          [Symbol.asyncIterator]();
        assert.deepEqual((await events.next()).value, { kind: 'connected' });
        await events.return?.();
      } else {
        const pending =
          mode === 'read'
            ? provider.readGame(id, controller.signal)
            : provider.submitMove(id, 'e2e4', controller.signal);
        const rejected = assert.rejects(
          pending,
          safeError(
            mode === 'write'
              ? 'live.move_uncertain'
              : 'live.provider_unavailable',
          ),
        );
        await setImmediate();
        controller.abort();
        await rejected;
      }
      assert.equal(cancellations, 1);
      assert.equal(body.locked, false);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    }
  },
);

test('account stream handles split UTF-8, CRLF, blank keepalives and explicit finishes; return releases reader', async () => {
  const stream = controlledBody();
  const { provider, calls } = fixture([stream.response]);
  const abort = signal();
  const events = provider.streamAccount(abort)[Symbol.asyncIterator]();
  assert.deepEqual((await events.next()).value, { kind: 'connected' });
  const first = events.next();
  const bytes = Buffer.from(
    `\r\n${JSON.stringify({ type: 'challenge' })}\n${JSON.stringify({ type: 'gameStart', game: accountGame({ opponent: { username: 'K\u00f6nig' }, compat: { board: true } }) })}\r\n`,
  );
  const split = bytes.indexOf(Buffer.from('\u00f6')) + 1;
  stream.bytes(bytes.subarray(0, split));
  stream.bytes(bytes.subarray(split));
  assert.deepEqual((await first).value, {
    kind: 'game_started',
    game: {
      gameId: id,
      displayName: 'K\u00f6nig',
      playerSide: 'white',
      boardCompatible: true,
      standard: true,
    },
  });
  stream.send({ type: 'gameFinish', game: { gameId: id } });
  assert.deepEqual((await events.next()).value, {
    kind: 'game_finished',
    gameId: id,
  });
  await events.return?.();
  assert.equal(stream.cancelled, 1);
  assert.equal(stream.body.locked, false);
  assert.equal(calls[0]?.options.signal?.aborted, true);
  assert.equal(getEventListeners(abort, 'abort').length, 0);
});

test('account connection is proven only by successful headers, never snapshot timing or remote JSON', async () => {
  const headers = Promise.withResolvers<Response>();
  const body = controlledBody();
  const { provider } = fixture([() => headers.promise]);
  const abort = signal();
  const events = provider.streamAccount(abort)[Symbol.asyncIterator]();
  let settled = false;
  const pending = events.next().then((value) => {
    settled = true;
    return value;
  });
  await setImmediate();
  assert.equal(settled, false);
  headers.resolve(body.response);
  assert.deepEqual((await pending).value, { kind: 'connected' });
  body.send({ type: 'connected', kind: 'connected' });
  body.send({ type: 'gameFinish', game: { gameId: id } });
  assert.deepEqual((await events.next()).value, {
    kind: 'game_finished',
    gameId: id,
  });
  await events.return?.();
  assert.equal(body.cancelled, 1);
  assert.equal(getEventListeners(abort, 'abort').length, 0);
  for (const [status, code] of [
    [401, 'live.authentication_failed'],
    [429, 'live.rate_limited'],
    [503, 'live.provider_unavailable'],
  ] as const) {
    const failed = fixture([new Response('', { status })]);
    await assert.rejects(
      failed.provider.streamAccount(signal())[Symbol.asyncIterator]().next(),
      safeError(code),
    );
  }
  const forged = fixture([new Response('"connected"\n')]);
  await assert.rejects(
    collect(forged.provider.streamAccount(signal())),
    safeError('live.protocol_error'),
  );
  const idleBody = controlledBody();
  const idle = fixture([idleBody.response]);
  const idleEvents = idle.provider
    .streamAccount(signal())
    [Symbol.asyncIterator]();
  assert.deepEqual((await idleEvents.next()).value, { kind: 'connected' });
  await idleEvents.return?.();
  assert.equal(idleBody.cancelled, 1);
  assert.equal(idleBody.body.locked, false);

  const lateHeaders = Promise.withResolvers<Response>();
  const lateBody = controlledBody();
  const cancelled = fixture([() => lateHeaders.promise]);
  const controller = new AbortController();
  const rejected = assert.rejects(
    cancelled.provider
      .streamAccount(controller.signal)
      [Symbol.asyncIterator]()
      .next(),
    safeError('live.provider_unavailable'),
  );
  controller.abort();
  await rejected;
  lateHeaders.resolve(lateBody.response);
  await setImmediate();
  assert.equal(lateBody.cancelled, 1);
  assert.equal(lateBody.body.locked, false);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('export maps SAN, all available moves, result, and centisecond clocks without imported evaluations', async () => {
  const { provider, calls } = fixture([
    json(exportedGame({ status: 'resign', winner: 'black' })),
  ]);
  const game = await provider.readGame(id, signal());
  assert.deepEqual(game.moves, [
    { kind: 'notation', value: 'e4', locale: 'en-GB' },
    { kind: 'notation', value: 'e5', locale: 'en-GB' },
    { kind: 'notation', value: 'Nf3', locale: 'en-GB' },
  ]);
  assert.equal(game.initialFen, DEFAULT_POSITION);
  assert.equal(game.whiteClockMs, 598000);
  assert.equal(game.blackClockMs, 599200);
  assert.equal(game.status, 'ended');
  assert.equal(game.outcome, 'black_win');
  assert.equal(
    new Headers(calls[0]?.options.headers).get('Authorization'),
    null,
  );
  assert.equal(
    calls[0]?.url,
    `https://lichess.org/game/export/${id}?moves=true&clocks=true&evals=false&literate=false`,
  );
});

test('ratings accompany names in exports, Board snapshots and own opponents without interpreting provisional or ratingDiff', async () => {
  const stream = controlledBody();
  stream.send(
    fullGame({
      white: { id: 'white', name: 'White', rating: 1650, provisional: true },
      black: { id: 'black', name: 'Black', rating: 1696, provisional: false },
      state: { moves: 'e2e4 e7e5', status: 'draw' },
    }),
  );
  const { provider } = fixture([
    json(
      exportedGame({
        players: {
          white: {
            user: { id: 'white', name: 'White' },
            rating: 1650,
            provisional: true,
            ratingDiff: -31,
          },
          black: {
            user: { id: 'black', name: 'Black' },
            rating: 1696,
            ratingDiff: 131,
          },
        },
      }),
    ),
    stream.response,
    json({ id: 'tester', username: 'Tester' }),
    json({
      nowPlaying: [
        accountGame({
          opponent: {
            id: 'opponent',
            username: 'Opponent',
            rating: 1650,
            provisional: true,
          },
        }),
      ],
    }),
  ]);
  const exported = await provider.readGame(id, signal());
  assert.deepEqual(exported.white, {
    id: 'white',
    name: 'White',
    rating: 1650,
  });
  assert.deepEqual(exported.black, {
    id: 'black',
    name: 'Black',
    rating: 1696,
  });
  const events = await collect(provider.streamGame(id, 'play', signal()));
  assert.ok(events[0]?.kind === 'snapshot');
  assert.deepEqual(events[0].game.white, exported.white);
  assert.deepEqual(events[0].game.black, exported.black);
  const account = await provider.readAccount(signal());
  assert.equal(account.games[0]?.opponentRating, 1650);
  assert.equal(account.games[0]?.displayName, 'Opponent');
});

test('invalid player ratings are protocol errors while missing ratings remain absent', async () => {
  for (const rating of [
    -1,
    1650.5,
    '1650',
    null,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const { provider } = fixture([
      json(
        exportedGame({
          players: {
            white: { user: { id: 'white', name: 'White' }, rating },
            black: { user: { id: 'black', name: 'Black' } },
          },
        }),
      ),
    ]);
    await assert.rejects(
      provider.readGame(id, signal()),
      safeError('live.protocol_error'),
    );
  }
  const { provider } = fixture([json(exportedGame())]);
  const game = await provider.readGame(id, signal());
  assert.equal('rating' in game.white, false);
  assert.equal('rating' in game.black, false);
});

test('timeout exports preserve a final flagged clock without adding a move', async () => {
  for (const scenario of [
    { moves: 'e4 e5 Nf3', clocks: [59980, 59920, 59800, 0], winner: 'white' },
    { moves: 'e4 e5', clocks: [59980, 59920, 0], winner: 'black' },
    { moves: 'e4 e5', clocks: [59980, 59920, 0], winner: undefined },
  ]) {
    const { provider } = fixture([
      json(exportedGame({ ...scenario, status: 'outoftime' })),
    ]);
    const game = await provider.readGame(id, signal());
    assert.equal(game.moves.length, scenario.moves.split(' ').length);
    assert.equal(game.status, 'ended');
    assert.equal(
      game.outcome,
      scenario.winner === 'white'
        ? 'white_win'
        : scenario.winner === 'black'
          ? 'black_win'
          : 'draw',
    );
    assert.equal(
      scenario.moves.split(' ').length % 2
        ? game.blackClockMs
        : game.whiteClockMs,
      0,
    );
  }
  const { provider } = fixture([
    json(
      exportedGame({
        variant: 'fromPosition',
        initialFen: '4k3/8/8/8/8/8/8/4K3 b - - 0 1',
        moves: 'Kd7',
        clocks: [59901, 0],
        status: 'outoftime',
      }),
    ),
  ]);
  const game = await provider.readGame(id, signal());
  assert.equal(game.whiteClockMs, 0);
  assert.equal(game.blackClockMs, 599010);
});

test('asynchronous finishes preserve one final active clock without inventing a move', async () => {
  for (const scenario of [
    {
      status: 'resign',
      winner: 'black',
      moves: 'e4 e5',
      clocks: [59980, 59920, 208],
      side: 'white',
      expected: 2080,
      outcome: 'black_win',
    },
    {
      status: 'resign',
      winner: 'white',
      moves: 'e4 e5 Nf3',
      clocks: [59980, 59920, 59800, 31451],
      side: 'black',
      expected: 314510,
      outcome: 'white_win',
    },
    {
      status: 'draw',
      moves: 'e4 e5',
      clocks: [59980, 59920, 125],
      side: 'white',
      expected: 1250,
      outcome: 'draw',
    },
    {
      status: 'outoftime',
      winner: 'black',
      moves: 'e4 e5',
      clocks: [59980, 59920, 1],
      side: 'white',
      expected: 10,
      outcome: 'black_win',
    },
    {
      status: 'aborted',
      moves: '',
      clocks: [60000],
      side: 'white',
      expected: 600000,
      outcome: 'unfinished',
    },
    {
      status: 'resign',
      winner: 'black',
      variant: 'fromPosition',
      initialFen: '4k3/8/8/8/8/8/8/4K3 b - - 0 1',
      moves: 'Kd7',
      clocks: [59901, 208],
      side: 'white',
      expected: 2080,
      outcome: 'black_win',
    },
  ]) {
    const { provider } = fixture([json(exportedGame(scenario))]);
    const game = await provider.readGame(id, signal());
    assert.equal(game.status, 'ended');
    assert.equal(game.outcome, scenario.outcome);
    assert.equal(
      game.moves.length,
      scenario.moves ? scenario.moves.split(' ').length : 0,
    );
    assert.equal(
      scenario.side === 'white' ? game.whiteClockMs : game.blackClockMs,
      scenario.expected,
    );
  }
});

test('export clock histories reject missing, invalid or multiple extra clocks and any ongoing extra clock', async () => {
  for (const extra of [
    { clocks: [59980, 59920, 59800, 0] },
    { clocks: [59980, 59920, 59800, 208] },
    { clocks: [59980, 59920, 59800, 0, 0], status: 'outoftime' },
    { clocks: [59980, 59920], status: 'resign', winner: 'white' },
    { clocks: [59980, 59920, 59800, -1], status: 'resign', winner: 'white' },
    { clocks: [59980, 59920, 59800, 1.5], status: 'resign', winner: 'white' },
    { clocks: [59980, 59920, 59800, null], status: 'resign', winner: 'white' },
  ]) {
    const { provider } = fixture([json(exportedGame(extra))]);
    await assert.rejects(
      provider.readGame(id, signal()),
      safeError('live.protocol_error'),
    );
  }
});

test('fromPosition clock history starts with the FEN turn; anonymous players and clockless games remain representable', async () => {
  const fen = '4k3/8/8/8/8/8/8/4K3 b - - 0 1';
  const { provider } = fixture([
    json(
      exportedGame({
        variant: 'fromPosition',
        initialFen: fen,
        moves: 'Kd7',
        clocks: [59901],
        players: { white: {}, black: { aiLevel: 4 } },
      }),
    ),
    json(exportedGame({ moves: '', clocks: undefined, clock: undefined })),
  ]);
  const game = await provider.readGame(id, signal());
  assert.equal(game.standard, true);
  assert.equal(game.initialFen, fen);
  assert.equal(game.blackClockMs, 599010);
  assert.equal(game.whiteClockMs, 600000);
  assert.equal(game.white.name, 'Anonymous');
  assert.equal(game.black.name, 'AI');
  const clockless = await provider.readGame(id, signal());
  assert.equal('whiteClockMs' in clockless, false);
  assert.equal('blackClockMs' in clockless, false);
});

test('Board snapshots use millisecond clocks and full UCI history, clear omitted draw offers, and finish explicitly', async () => {
  const stream = controlledBody();
  const { provider, calls } = fixture([stream.response]);
  stream.send(fullGame());
  stream.send({ type: 'chatLine', text: 'ignored' });
  stream.send({
    type: 'gameState',
    moves: 'e2e4 e7e5 g1f3',
    status: 'started',
    wdraw: true,
    wtime: 590123,
    btime: 591234,
  });
  stream.send({
    type: 'gameState',
    moves: 'e2e4 e7e5 g1f3',
    status: 'draw',
    wtime: 590123,
    btime: 591234,
  });
  const events = await collect(provider.streamGame(id, 'play', signal()));
  assert.equal(events.length, 4);
  const first = events[0];
  const next = events[1];
  const last = events[2];
  assert.ok(
    first?.kind === 'snapshot' &&
      next?.kind === 'snapshot' &&
      last?.kind === 'snapshot',
  );
  assert.equal(first.game.initialFen, DEFAULT_POSITION);
  assert.equal(first.game.whiteClockMs, 598765);
  assert.deepEqual(next.game.moves.at(-1), {
    kind: 'coordinates',
    value: 'g1f3',
  });
  assert.equal(next.game.whiteDrawOffer, true);
  assert.equal(last.game.whiteDrawOffer, false);
  assert.equal(last.game.blackDrawOffer, false);
  assert.equal(last.game.outcome, 'draw');
  assert.deepEqual(events[3], { kind: 'finished' });
  assert.equal(stream.cancelled, 1);
  assert.equal(stream.body.locked, false);
  assert.equal(
    calls[0]?.url,
    `https://lichess.org/api/board/game/stream/${id}`,
  );
});

test('standard castling king-to-rook UCI is normalized while ordinary rook moves and promotions are preserved', async () => {
  const cases = [
    {
      fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
      moves: 'e1h1 e8a8',
      expected: ['e1g1', 'e8c8'],
    },
    {
      fen: '4k3/8/8/8/8/8/8/K3R3 w - - 0 1',
      moves: 'e1h1',
      expected: ['e1h1'],
    },
    {
      fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1',
      moves: 'a7a8q',
      expected: ['a7a8q'],
    },
  ];
  for (const value of cases) {
    const stream = controlledBody();
    const { provider } = fixture([stream.response]);
    stream.send(
      fullGame({
        variant: { key: 'fromPosition' },
        initialFen: value.fen,
        state: { moves: value.moves, status: 'draw' },
      }),
    );
    const events = await collect(provider.streamGame(id, 'play', signal()));
    const event = events[0];
    assert.ok(event?.kind === 'snapshot');
    assert.deepEqual(
      event.game.moves.map((move) => move.value),
      value.expected,
    );
  }
});

test('public positions use second clocks and never infer a completed game from an EOF', async () => {
  const stream = controlledBody();
  const { provider, calls } = fixture([stream.response]);
  stream.send({ id, variant: { key: 'standard' } });
  stream.send({ fen: DEFAULT_POSITION, wc: 300, bc: 300 });
  stream.send({
    fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    lm: 'e2e4',
    wc: 299,
    bc: 300,
  });
  stream.send({
    id,
    variant: { key: 'standard' },
    status: { id: 31, name: 'resign' },
  });
  const events = await collect(provider.streamGame(id, 'observe', signal()));
  assert.deepEqual(events[0], {
    kind: 'position',
    fen: DEFAULT_POSITION,
    whiteClockMs: 300000,
    blackClockMs: 300000,
  });
  assert.ok(events[1]?.kind === 'position');
  assert.equal(events[1].lastMove, 'e2e4');
  assert.equal(events[1].whiteClockMs, 299000);
  assert.deepEqual(events[2], { kind: 'finished' });
  assert.equal(
    new Headers(calls[0]?.options.headers).get('Authorization'),
    null,
  );
  assert.equal(stream.cancelled, 1);
  for (const role of ['observe', 'play'] as const) {
    const { provider: disconnected } = fixture([new Response('')]);
    assert.deepEqual(
      await collect(disconnected.streamGame(id, role, signal())),
      [],
    );
  }
  const { provider: disconnected } = fixture([new Response('')]);
  await assert.rejects(
    collect(disconnected.streamAccount(signal())),
    safeError('live.provider_unavailable'),
  );
});

test('invalid IDs, moves and unsupported observed variants do not become a URL proxy', async () => {
  const { provider, calls } = fixture([]);
  for (const invalid of [
    'https://example.org',
    '../account',
    'abcdefgh?token=x',
    'abcdefghTOKEN',
    '',
  ]) {
    await assert.rejects(
      provider.readGame(invalid, signal()),
      safeError('live.invalid_game'),
    );
    await assert.rejects(
      provider.submitMove(invalid, 'e2e4', signal()),
      safeError('live.invalid_game'),
    );
  }
  await assert.rejects(
    provider.submitMove(id, 'e2e4?foo=bar', signal()),
    safeError('live.move_rejected'),
  );
  assert.equal(calls.length, 0);
  const { provider: other } = fixture([
    new Response(`${JSON.stringify({ id, variant: { key: 'chess960' } })}\n`),
  ]);
  await assert.rejects(
    collect(other.streamGame(id, 'observe', signal())),
    safeError('live.invalid_game'),
  );
});

test('every write uses the Board endpoint exactly once with no token in its URL', async () => {
  const { provider, calls } = fixture(
    Array.from({ length: 6 }, () => json({ ok: true })),
  );
  await provider.submitMove(id, 'e2e4', signal());
  for (const action of [
    'resign',
    'abort',
    'offer_draw',
    'accept_draw',
    'decline_draw',
  ] as const)
    await provider.act(id, action, signal());
  assert.deepEqual(
    calls.map((call) => call.url),
    ['move/e2e4', 'resign', 'abort', 'draw/yes', 'draw/yes', 'draw/no'].map(
      (path) => `https://lichess.org/api/board/game/${id}/${path}`,
    ),
  );
  for (const call of calls) {
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.redirect, 'manual');
    assert.equal(
      new Headers(call.options.headers).get('Authorization'),
      `Bearer ${token}`,
    );
    assert.equal(call.url.includes(token), false);
  }
});

test('HTTP rejection, authentication, rate limit and uncertain writes remain distinct and sanitized', async () => {
  for (const [status, code] of [
    [400, 'live.move_rejected'],
    [409, 'live.move_rejected'],
    [401, 'live.authentication_failed'],
    [403, 'live.authentication_failed'],
    [404, 'live.invalid_game'],
    [429, 'live.rate_limited'],
    [503, 'live.move_uncertain'],
    [302, 'live.move_uncertain'],
  ] as const) {
    const body = controlledBody();
    const response = new Response(body.body, {
      status,
      headers: { Location: `https://example.org/${token}` },
    });
    const { provider, calls } = fixture([response]);
    body.bytes(Buffer.from(token));
    await assert.rejects(
      provider.submitMove(id, 'e2e4', signal()),
      safeError(code),
    );
    assert.equal(body.cancelled, 1);
    assert.equal(calls.length, 1);
  }
  for (const response of [
    new Response(`bad ${token}`),
    json(null),
    json({ ok: false }),
    json({ error: token }),
  ]) {
    const { provider, calls } = fixture([response]);
    await assert.rejects(
      provider.act(id, 'resign', signal()),
      safeError('live.move_uncertain'),
    );
    assert.equal(calls.length, 1);
  }
  const { provider, calls } = fixture([
    () => {
      throw new Error(token);
    },
  ]);
  await assert.rejects(
    provider.submitMove(id, 'e2e4', signal()),
    safeError('live.move_uncertain'),
  );
  assert.equal(calls.length, 1);
});

test('pending body reads abort promptly and leave no active reader or parent listener', async () => {
  for (const mode of ['account', 'read', 'write'] as const) {
    const stream = controlledBody();
    const { provider, calls } = fixture([stream.response]);
    const abort = new AbortController();
    const result =
      mode === 'account'
        ? collect(provider.streamAccount(abort.signal))
        : mode === 'read'
          ? provider.readGame(id, abort.signal)
          : provider.submitMove(id, 'e2e4', abort.signal);
    const assertion = assert.rejects(
      result,
      safeError(
        mode === 'write' ? 'live.move_uncertain' : 'live.provider_unavailable',
      ),
    );
    await setImmediate();
    abort.abort(new Error(token));
    await assertion;
    assert.equal(stream.cancelled, 1);
    assert.equal(stream.body.locked, false);
    assert.equal(calls[0]?.options.signal?.aborted, true);
    assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
  }
});

test('read failures and failed stream bodies never expose transport details or retry', async () => {
  for (const [status, code] of [
    [401, 'live.authentication_failed'],
    [403, 'live.authentication_failed'],
    [404, 'live.invalid_game'],
    [429, 'live.rate_limited'],
    [503, 'live.provider_unavailable'],
    [302, 'live.provider_unavailable'],
  ] as const) {
    const { provider, calls } = fixture([
      new Response(token, {
        status,
        headers: { Location: `https://example.org/${token}` },
      }),
    ]);
    await assert.rejects(provider.readGame(id, signal()), safeError(code));
    assert.equal(calls.length, 1);
  }
  for (const mode of ['read', 'write', 'stream'] as const) {
    const body = controlledBody();
    const { provider, calls } = fixture([body.response]);
    const reading =
      mode === 'read'
        ? provider.readGame(id, signal())
        : mode === 'write'
          ? provider.submitMove(id, 'e2e4', signal())
          : collect(provider.streamAccount(signal()));
    const assertion = assert.rejects(
      reading,
      safeError(
        mode === 'write' ? 'live.move_uncertain' : 'live.provider_unavailable',
      ),
    );
    await setImmediate();
    body.error();
    await assertion;
    assert.equal(body.body.locked, false);
    assert.equal(calls.length, 1);
  }
});

test('cancelled startup sends nothing; late responses after a cancelled fetch have their body released', async () => {
  const abort = new AbortController();
  abort.abort(new Error(token));
  const { provider, calls } = fixture([]);
  await assert.rejects(
    provider.readAccount(abort.signal),
    safeError('live.provider_unavailable'),
  );
  await assert.rejects(
    provider.submitMove(id, 'e2e4', abort.signal),
    safeError('live.provider_unavailable'),
  );
  await assert.rejects(
    collect(provider.streamAccount(abort.signal)),
    safeError('live.provider_unavailable'),
  );
  assert.equal(calls.length, 0);
  const body = controlledBody();
  const deferred = Promise.withResolvers<Response>();
  const late = fixture([() => deferred.promise]);
  const controller = new AbortController();
  const reading = late.provider.readGame(id, controller.signal);
  const assertion = assert.rejects(
    reading,
    safeError('live.provider_unavailable'),
  );
  controller.abort();
  await assertion;
  deferred.resolve(body.response);
  await setImmediate();
  assert.equal(body.cancelled, 1);
  assert.equal(body.body.locked, false);
});

test('JSON export and NDJSON framing enforce byte, line and encoding budgets without echoing raw data', async () => {
  const bodies = [
    new Response(`{"${'x'.repeat(131072)}":"${token}"}`),
    new Response('\n'.repeat(8193)),
    new Response(
      '[\n' +
        ' '.repeat(120000) +
        '\n' +
        (' '.repeat(120000) + '\n').repeat(9) +
        ']',
    ),
    new Response(Uint8Array.from([0xff, 0xfe])),
    new Response(`{"secret":"${token}"`),
    json(exportedGame({ moves: 'e4 '.repeat(4097), clocks: undefined })),
  ];
  for (const response of bodies) {
    const { provider } = fixture([response]);
    await assert.rejects(
      provider.readGame(id, signal()),
      safeError('live.protocol_error'),
    );
  }
  for (const bytes of [
    Buffer.from('x'.repeat(131073)),
    Buffer.from(`{"bad":"${token}"\n`),
    Buffer.from('[]\n'),
    Uint8Array.from([0xff, 10]),
  ]) {
    const body = controlledBody();
    const { provider } = fixture([body.response]);
    body.bytes(bytes);
    await assert.rejects(
      collect(provider.streamAccount(signal())),
      safeError('live.protocol_error'),
    );
    assert.equal(body.cancelled, 1);
    assert.equal(body.body.locked, false);
  }
});

test('malformed snapshots cannot become fabricated moves, outcomes or normal chess', async () => {
  const cases = [
    exportedGame({ id: 'Different' }),
    exportedGame({ status: 'unexpected' }),
    exportedGame({ moves: undefined }),
    exportedGame({ variant: 'fromPosition', initialFen: undefined }),
    exportedGame({ clocks: [100] }),
    exportedGame({ clocks: [-1, 3, 4] }),
    exportedGame({ winner: 'purple' }),
  ];
  for (const value of cases) {
    const { provider } = fixture([json(value)]);
    await assert.rejects(
      provider.readGame(id, signal()),
      (error) => error instanceof LiveProviderError,
    );
  }
  for (const value of [
    { type: 'gameState', moves: '', status: 'started' },
    fullGame({ state: { moves: 'e2e5', status: 'started' } }),
  ]) {
    const { provider } = fixture([new Response(`${JSON.stringify(value)}\n`)]);
    await assert.rejects(
      collect(provider.streamGame(id, 'play', signal())),
      safeError('live.protocol_error'),
    );
  }
});

test('request deadlines cover headers and slow JSON bodies; stream idle deadline resets on keepalive', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const deferred = Promise.withResolvers<Response>();
  const { provider, calls } = fixture([() => deferred.promise]);
  const first = assert.rejects(
    provider.readGame(id, signal()),
    safeError('live.provider_unavailable'),
  );
  t.mock.timers.tick(15000);
  await first;
  assert.equal(calls[0]?.options.signal?.aborted, true);
  const jsonBody = controlledBody();
  const slow = fixture([jsonBody.response]);
  const second = assert.rejects(
    slow.provider.readGame(id, signal()),
    safeError('live.provider_unavailable'),
  );
  await setImmediate();
  jsonBody.bytes(Buffer.from('{'));
  await setImmediate();
  t.mock.timers.tick(15000);
  await second;
  assert.equal(jsonBody.cancelled, 1);
  const body = controlledBody();
  const live = fixture([body.response]);
  const third = assert.rejects(
    collect(live.provider.streamAccount(signal())),
    safeError('live.provider_unavailable'),
  );
  await setImmediate();
  t.mock.timers.tick(44000);
  body.bytes(Buffer.from('\n'));
  await setImmediate();
  t.mock.timers.tick(44000);
  assert.equal(body.cancelled, 0);
  t.mock.timers.tick(1000);
  await third;
  assert.equal(body.cancelled, 1);
});
