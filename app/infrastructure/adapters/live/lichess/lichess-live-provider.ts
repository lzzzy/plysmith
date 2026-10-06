import {
  LiveProviderError,
  type LiveAccount,
  type LiveAccountEvent,
  type LiveGameEvent,
  type LiveGameSnapshot,
  type LiveProviderPort,
} from '../../../../application/live/live-ports.ts';
import { LichessHttp } from './lichess-http.ts';
import {
  boardSnapshot,
  clocks,
  ended,
  exportSnapshot,
  gameId,
  moveUci,
  object,
  ownGame,
  standard,
  text,
} from './lichess-protocol.ts';

export class LichessLiveProvider implements LiveProviderPort {
  readonly #http: LichessHttp;

  constructor(options: {
    readonly token: string;
    readonly fetch?: typeof fetch;
  }) {
    if (
      typeof options.token !== 'string' ||
      !/^[A-Za-z0-9_]+$/.test(options.token)
    )
      throw new LiveProviderError('live.authentication_failed');
    this.#http = new LichessHttp(
      options.token,
      options.fetch ?? globalThis.fetch,
    );
  }

  async readAccount(signal: AbortSignal): Promise<LiveAccount> {
    const account = object(await this.#http.json('/api/account', signal, true));
    const playing = object(
      await this.#http.json('/api/account/playing?nb=50', signal, true),
    );
    // The endpoint caps results; a full page cannot prove that no games were omitted.
    if (!Array.isArray(playing.nowPlaying) || playing.nowPlaying.length >= 50)
      throw new LiveProviderError('live.protocol_error');
    return {
      id: text(account.id).toLowerCase(),
      name: text(account.username),
      games: playing.nowPlaying.map(ownGame),
    };
  }

  async *streamAccount(signal: AbortSignal): AsyncIterable<LiveAccountEvent> {
    for await (const event of this.#http.stream(
      '/api/stream/event',
      signal,
      true,
    )) {
      if (event === 'connected') yield { kind: 'connected' };
      else if (event.type === 'gameStart')
        yield { kind: 'game_started', game: ownGame(event.game) };
      else if (event.type === 'gameFinish')
        yield {
          kind: 'game_finished',
          gameId: gameId(object(event.game).gameId),
        };
    }
    throw new LiveProviderError('live.provider_unavailable');
  }

  async readGame(id: string, signal: AbortSignal): Promise<LiveGameSnapshot> {
    gameId(id);
    return exportSnapshot(
      await this.#http.json(
        `/game/export/${id}?moves=true&clocks=true&evals=false&literate=false`,
        signal,
        false,
      ),
      id,
    );
  }

  async *streamGame(
    id: string,
    role: 'observe' | 'play',
    signal: AbortSignal,
  ): AsyncIterable<LiveGameEvent> {
    gameId(id);
    if (role === 'play') {
      let full: Record<string, unknown> | undefined;
      for await (const event of this.#http.stream(
        `/api/board/game/stream/${id}`,
        signal,
        true,
      )) {
        if (event === 'connected') continue;
        if (event.type === 'gameFull') full = event;
        else if (event.type !== 'gameState') continue;
        if (full === undefined)
          throw new LiveProviderError('live.protocol_error');
        const game = boardSnapshot(
          full,
          event.type === 'gameFull' ? object(event.state) : event,
          id,
        );
        yield { kind: 'snapshot', game };
        if (game.status === 'ended') {
          yield { kind: 'finished' };
          return;
        }
      }
    } else {
      for await (const event of this.#http.stream(
        `/api/stream/game/${id}`,
        signal,
        false,
      )) {
        if (event === 'connected') continue;
        if (event.id !== undefined) {
          if (gameId(event.id) !== id)
            throw new LiveProviderError('live.protocol_error');
          if (!standard(event.variant))
            throw new LiveProviderError('live.invalid_game');
          if (event.status !== undefined && ended(event.status)) {
            yield { kind: 'finished' };
            return;
          }
        } else if (event.fen !== undefined) {
          yield {
            kind: 'position',
            fen: text(event.fen, 128),
            ...(event.lm === undefined ? {} : { lastMove: moveUci(event.lm) }),
            // Public move stream clocks are rounded seconds, not export centiseconds.
            ...clocks(event.wc, event.bc, 1_000),
          };
        }
      }
    }
  }

  async submitMove(
    id: string,
    move: string,
    signal: AbortSignal,
  ): Promise<void> {
    gameId(id);
    try {
      moveUci(move);
    } catch {
      throw new LiveProviderError('live.move_rejected');
    }
    await this.#write(`/api/board/game/${id}/move/${move}`, signal);
  }

  async act(
    id: string,
    action: 'resign' | 'abort' | 'offer_draw' | 'accept_draw' | 'decline_draw',
    signal: AbortSignal,
  ): Promise<void> {
    gameId(id);
    const paths = {
      resign: 'resign',
      abort: 'abort',
      offer_draw: 'draw/yes',
      accept_draw: 'draw/yes',
      decline_draw: 'draw/no',
    };
    if (!Object.hasOwn(paths, action))
      throw new LiveProviderError('live.move_rejected');
    const path = paths[action];
    if (path === undefined) throw new LiveProviderError('live.move_rejected');
    await this.#write(`/api/board/game/${id}/${path}`, signal);
  }

  async #write(path: string, signal: AbortSignal): Promise<void> {
    const value = await this.#http.json(path, signal, true, true);
    try {
      if (object(value).ok !== true)
        throw new LiveProviderError('live.move_uncertain');
    } catch {
      throw new LiveProviderError('live.move_uncertain');
    }
  }
}
