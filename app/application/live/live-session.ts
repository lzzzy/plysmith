import type { ChessRulesPort } from '../chess_graph/index.ts';
import type { PositionAnalysisFocus } from '../analysis/position-analysis.ts';
import { ApplicationProblem } from '../problems/application-problem.ts';
import type { FairPlayGate } from './fair-play-gate.ts';
import {
  LiveProviderError,
  type LiveAccountEvent,
  type LiveGameEvent,
  type LiveGameSnapshot,
  type LiveOwnGame,
  type LiveProviderPort,
} from './live-ports.ts';
import type {
  LiveFairPlayGuard,
  LiveRecordedMove,
  LiveRecordWriter,
  LiveSaved,
  LiveSessionView,
  LiveState,
  SaveLiveRequest,
} from './live-models.ts';

interface Dependencies {
  readonly provider?: LiveProviderPort;
  readonly rules: ChessRulesPort;
  readonly writer: LiveRecordWriter;
  readonly fairPlay: FairPlayGate;
  readonly now: () => string;
  readonly onChange: () => void;
  readonly guard?: LiveFairPlayGuard;
}
type Session = Omit<
  LiveSessionView,
  'current' | 'legalMoves' | 'focus' | 'analysisRevision'
>;
type Action = Parameters<LiveProviderPort['act']>[1];

function problem(code: string): ApplicationProblem {
  return new ApplicationProblem(code, code);
}
function failure(error: unknown): ApplicationProblem {
  if (error instanceof ApplicationProblem) return error;
  return problem(
    error instanceof LiveProviderError
      ? error.code
      : 'live.provider_unavailable',
  );
}
function gameIdFromUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw problem('live.invalid_game');
  }
  const match = /^\/([a-zA-Z0-9]{8})(?:\/(?:white|black))?\/?$/.exec(
    url.pathname,
  );
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'lichess.org' ||
    url.port ||
    url.username ||
    url.password ||
    !match
  )
    throw problem('live.invalid_game');
  return match[1]!;
}
function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });
  });
}

export class LiveService {
  readonly #deps: Dependencies;
  readonly #lifetime = new AbortController();
  readonly #tasks = new Set<Promise<void>>();
  #accountController: AbortController | undefined;
  #gameController: AbortController | undefined;
  #writeController: AbortController | undefined;
  #started = false;
  #online = false;
  #busy = false;
  #revision = 0;
  #analysisRevision = 0;
  #analysisSignature: string | undefined;
  #accountId: string | undefined;
  #accountName: string | undefined;
  #connection: LiveState['connection'];
  #games = new Map<string, LiveOwnGame>();
  #session: Session | undefined;
  #problemCode: string | undefined;
  #initialization: Promise<void> | undefined;
  #guardTail: Promise<void> = Promise.resolve();
  #guardAccountId: string | undefined;
  #desiredBlocked = false;
  #guardFailed = false;

  constructor(dependencies: Dependencies) {
    this.#deps = dependencies;
    this.#connection = dependencies.provider ? 'disconnected' : 'unconfigured';
  }

  initialize(): Promise<void> {
    this.#initialization ??= (async () => {
      const stored = await this.#deps.guard?.readLiveFairPlayGuard();
      this.#guardAccountId = stored?.blocked ? stored.accountId : undefined;
      this.#desiredBlocked = stored?.blocked === true;
      this.#deps.fairPlay.setBlocked(this.#desiredBlocked);
    })();
    return this.#initialization;
  }

  start(): void {
    if (this.#started || this.#lifetime.signal.aborted) return;
    this.#started = true;
    this.#track(
      this.initialize().catch(() => {
        this.#guardFailed = true;
        this.#deps.fairPlay.setBlocked(true);
        this.#connection = 'failed';
        this.#problemCode = 'live.guard_unavailable';
        this.#changed();
      }),
    );
  }

  async close(): Promise<void> {
    this.#lifetime.abort();
    this.#accountController?.abort();
    this.#gameController?.abort();
    this.#writeController?.abort();
    await Promise.allSettled([...this.#tasks]);
    await this.#guardTail;
  }

  getState(): LiveState {
    const session = this.#session;
    let view: LiveSessionView | undefined;
    if (session) {
      const moves = session.steps
        .slice(0, session.selectedPly)
        .map((step) => step.move);
      const current =
        session.steps[session.selectedPly - 1]?.after ?? session.root;
      const canMove =
        session.role === 'play' &&
        session.status === 'ongoing' &&
        session.connected &&
        this.#connection === 'connected' &&
        !session.pendingMove &&
        !this.#busy &&
        current.position.sideToMove === session.playerSide;
      const legal = canMove
        ? this.#deps.rules.legalMoves(session.root, moves)
        : undefined;
      view = {
        ...session,
        analysisRevision: this.#analysisRevision,
        current,
        legalMoves: legal?.ok ? legal.value : [],
        ...(session.role === 'observe' && !this.#deps.fairPlay.blocked
          ? {
              focus: {
                focusKey: `live:${session.gameId}:${this.#analysisRevision}:${session.selectedPly}`,
                root: session.root,
                moves,
                current,
              },
            }
          : {}),
      };
    }
    return structuredClone({
      revision: this.#revision,
      configured: this.#deps.provider !== undefined,
      online: this.#online,
      connection: this.#connection,
      fairPlayBlocked: this.#deps.fairPlay.blocked,
      games: [...this.#games.values()],
      ...(this.#accountName ? { accountName: this.#accountName } : {}),
      ...(view ? { session: view } : {}),
      ...(this.#problemCode ? { problemCode: this.#problemCode } : {}),
    });
  }

  observe(url: string, expectedRevision: number): Promise<LiveState> {
    return this.#open(gameIdFromUrl(url), 'observe', expectedRevision);
  }

  play(gameId: string, expectedRevision: number): Promise<LiveState> {
    if (!/^[a-zA-Z0-9]{8}$/.test(gameId))
      return Promise.reject(problem('live.invalid_game'));
    return this.#open(gameId, 'play', expectedRevision);
  }

  select(ply: number, expectedRevision: number): LiveState {
    this.#check(expectedRevision);
    const session = this.#requireSession();
    if (
      !Number.isSafeInteger(ply) ||
      ply < 0 ||
      ply > session.steps.length ||
      (session.role === 'play' &&
        session.status !== 'ended' &&
        ply !== session.steps.length)
    )
      throw problem('live.invalid_selection');
    this.#session = { ...session, selectedPly: ply };
    this.#changed();
    return this.getState();
  }

  move(value: string, expectedRevision: number): Promise<LiveState> {
    return this.#command(expectedRevision, async () => {
      const session = this.#requirePlayable();
      if (
        session.steps.at(-1)?.after.position.sideToMove !==
          session.playerSide &&
        (session.steps.length !== 0 ||
          session.root.position.sideToMove !== session.playerSide)
      )
        throw problem('live.not_your_turn');
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(value))
        throw problem('live.illegal_move');
      const applied = this.#deps.rules.applyMove(
        session.root,
        session.steps.map((step) => step.move),
        { kind: 'coordinates', value },
      );
      if (!applied.ok) throw problem('live.illegal_move');
      this.#session = { ...session, pendingMove: true };
      this.#changed();
      const controller = new AbortController();
      this.#writeController = controller;
      try {
        await this.#provider().submitMove(
          session.gameId,
          value,
          AbortSignal.any([this.#lifetime.signal, controller.signal]),
        );
      } catch (error) {
        if (
          error instanceof LiveProviderError &&
          error.code === 'live.move_rejected'
        ) {
          if (this.#session)
            this.#session = { ...this.#session, pendingMove: false };
        } else {
          if (this.#session)
            this.#session = {
              ...this.#session,
              pendingMove: false,
              connected: false,
            };
          this.#restartGame();
        }
        throw failure(error);
      } finally {
        if (this.#writeController === controller)
          this.#writeController = undefined;
      }
      // Acknowledgement is not a board position; only the authoritative stream clears the pending move.
      return this.getState();
    });
  }

  act(action: Action, expectedRevision: number): Promise<LiveState> {
    return this.#command(expectedRevision, async () => {
      const session = this.#requirePlayable();
      if (
        ![
          'resign',
          'abort',
          'offer_draw',
          'accept_draw',
          'decline_draw',
        ].includes(action)
      )
        throw problem('live.invalid_action');
      const controller = new AbortController();
      this.#writeController = controller;
      try {
        await this.#provider().act(
          session.gameId,
          action,
          AbortSignal.any([this.#lifetime.signal, controller.signal]),
        );
      } catch (error) {
        this.#restartGame();
        throw failure(error);
      } finally {
        if (this.#writeController === controller)
          this.#writeController = undefined;
      }
      return this.getState();
    });
  }

  refresh(expectedRevision: number): Promise<LiveState> {
    return this.#command(expectedRevision, async () => {
      this.#provider();
      this.#online = true;
      this.#startAccount();
      if (this.#session) {
        if (this.#session.role === 'play' && this.#session.status === 'ongoing')
          this.#restartGame();
        else {
          await this.#resync(
            this.#gameController?.signal ?? this.#lifetime.signal,
            this.#session.status === 'finalizing',
          );
          this.#restartGame();
        }
      }
      return this.getState();
    });
  }

  disconnect(expectedRevision: number): Promise<LiveState> {
    return this.#command(expectedRevision, async () => {
      this.#online = false;
      this.#accountController?.abort();
      this.#gameController?.abort();
      this.#writeController?.abort();
      this.#accountController = undefined;
      this.#gameController = undefined;
      this.#writeController = undefined;
      this.#connection = this.#deps.provider ? 'disconnected' : 'unconfigured';
      if (!this.#guardFailed) this.#problemCode = undefined;
      if (this.#session) this.#session = { ...this.#session, connected: false };
      this.#changed();
      return this.getState();
    });
  }

  discard(expectedRevision: number): Promise<LiveState> {
    return this.#command(expectedRevision, async () => {
      this.#requireSession();
      this.#gameController?.abort();
      this.#gameController = undefined;
      this.#session = undefined;
      this.#updateGate();
      this.#changed();
      return this.getState();
    });
  }

  save(request: SaveLiveRequest): Promise<LiveSaved> {
    return this.#command(request.expectedRevision, async () => {
      const session = this.#requireSession();
      if (session.status !== 'ended') throw problem('live.not_finished');
      if (
        request.displayName.trim() !== request.displayName ||
        !request.displayName ||
        request.displayName.length > 160 ||
        !['de-DE', 'en-GB'].includes(request.languageTag) ||
        [request.folderId, request.workingContextId].some(
          (id) => id !== undefined && (!Number.isSafeInteger(id) || id < 1),
        )
      )
        throw problem('live.invalid_save');
      const result = await this.#deps.writer.saveLiveGame({
        ...request,
        gameId: session.gameId,
        role: session.role,
        white: session.white,
        black: session.black,
        root: session.root,
        steps: session.steps,
        outcome: session.outcome,
        occurredAt: this.#deps.now(),
      });
      this.#gameController?.abort();
      this.#session = undefined;
      this.#changed();
      return result;
    });
  }

  requireAnalysisFocus(
    work: { kind: 'live'; revision: number; ply: number },
    focus: PositionAnalysisFocus,
  ): void {
    this.#deps.fairPlay.assertAllowed();
    const view = this.getState().session;
    if (
      work.kind !== 'live' ||
      work.revision !== this.#analysisRevision ||
      work.ply !== view?.selectedPly ||
      !view?.focus ||
      focus.focusKey !== view.focus.focusKey ||
      JSON.stringify(focus.root) !== JSON.stringify(view.focus.root) ||
      JSON.stringify(focus.current) !== JSON.stringify(view.focus.current) ||
      JSON.stringify(focus.moves) !== JSON.stringify(view.focus.moves)
    )
      throw problem('live.stale_state');
  }

  async #open(
    gameId: string,
    role: 'observe' | 'play',
    revision: number,
  ): Promise<LiveState> {
    return this.#command(revision, async () => {
      if (this.#connection !== 'connected') throw problem('live.not_connected');
      if (this.#session) throw problem('live.session_exists');
      const own = this.#games.get(gameId);
      if (role === 'play' && (!own?.boardCompatible || !own.standard))
        throw problem('live.not_playable');
      if (role === 'observe' && own) throw problem('live.own_game');
      const snapshot = await this.#provider().readGame(
        gameId,
        this.#lifetime.signal,
      );
      if (this.#lifetime.signal.aborted || this.#connection !== 'connected')
        throw problem('live.not_connected');
      if (snapshot.gameId !== gameId) throw problem('live.protocol_error');
      if (
        role === 'observe' &&
        snapshot.status === 'ongoing' &&
        (this.#isOwn(snapshot) || this.#games.has(gameId))
      ) {
        this.#games.set(gameId, {
          gameId,
          displayName: `${snapshot.white.name} - ${snapshot.black.name}`,
          playerSide:
            snapshot.white.id?.toLowerCase() === this.#accountId
              ? 'white'
              : 'black',
          boardCompatible: false,
          standard: snapshot.standard,
        });
        this.#setBlocked(true);
        this.#changed();
        throw problem('live.own_game');
      }
      this.#session = this.#validated(snapshot, {
        role,
        ...(own ? { playerSide: own.playerSide } : {}),
      });
      this.#updateGate();
      this.#changed();
      if (snapshot.status === 'ongoing') this.#restartGame();
      return this.getState();
    });
  }

  #validated(
    snapshot: LiveGameSnapshot,
    previous: Pick<Session, 'role' | 'playerSide'> & Partial<Session>,
  ): Session {
    if (!snapshot.standard) throw problem('live.unsupported_variant');
    if (snapshot.moves.length > 1000) throw problem('live.game_too_long');
    const parsed =
      snapshot.initialFen === 'startpos' ||
      snapshot.initialFen === this.#deps.rules.initialState().fen
        ? { ok: true as const, value: this.#deps.rules.initialState() }
        : this.#deps.rules.parseFen(snapshot.initialFen);
    if (!parsed.ok) throw problem('live.invalid_game');
    const root = parsed.value;
    const steps: LiveRecordedMove[] = [];
    for (const input of snapshot.moves) {
      const applied = this.#deps.rules.applyMove(
        root,
        steps.map((step) => step.move),
        input,
      );
      if (!applied.ok) throw problem('live.invalid_game');
      steps.push({ move: applied.value.move, after: applied.value.after });
    }
    if (
      previous.root &&
      (previous.root.fen !== root.fen || previous.gameId !== snapshot.gameId)
    )
      throw problem('live.protocol_error');
    if (
      previous.role === 'observe' &&
      snapshot.status === 'ongoing' &&
      previous.steps &&
      steps.length < previous.steps.length
    ) {
      if (
        steps.some(
          (step, index) => step.after.fen !== previous.steps![index]?.after.fen,
        )
      )
        throw problem('live.protocol_error');
      // Public exports can lag behind the stream; retain already validated moves until the final export.
      steps.push(...previous.steps.slice(steps.length));
    }
    const follow =
      previous.role === 'play' ||
      previous.selectedPly === undefined ||
      previous.selectedPly === previous.steps?.length;
    return {
      gameId: snapshot.gameId,
      role: previous.role,
      white: snapshot.white,
      black: snapshot.black,
      ...(previous.playerSide ? { playerSide: previous.playerSide } : {}),
      root,
      steps,
      selectedPly: follow
        ? steps.length
        : Math.min(previous.selectedPly!, steps.length),
      status: snapshot.status,
      outcome: snapshot.outcome,
      connected: previous.connected ?? false,
      pendingMove:
        previous.pendingMove === true &&
        snapshot.status === 'ongoing' &&
        previous.steps?.length === steps.length &&
        steps.every(
          (step, index) => step.after.fen === previous.steps![index]?.after.fen,
        ),
      ...(snapshot.whiteClockMs === undefined
        ? {}
        : { whiteClockMs: snapshot.whiteClockMs }),
      ...(snapshot.blackClockMs === undefined
        ? {}
        : { blackClockMs: snapshot.blackClockMs }),
      ...(snapshot.whiteDrawOffer === undefined
        ? {}
        : { whiteDrawOffer: snapshot.whiteDrawOffer }),
      ...(snapshot.blackDrawOffer === undefined
        ? {}
        : { blackDrawOffer: snapshot.blackDrawOffer }),
    };
  }

  #startAccount(): void {
    if (
      !this.#deps.provider ||
      this.#lifetime.signal.aborted ||
      this.#guardFailed
    )
      return;
    this.#accountController?.abort();
    const controller = new AbortController();
    this.#accountController = controller;
    this.#connection = this.#accountId ? 'reconnecting' : 'connecting';
    this.#setBlocked(true);
    this.#changed();
    this.#track(this.#monitorAccount(controller.signal));
  }

  async #monitorAccount(signal: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < 4 && !signal.aborted; attempt++) {
      let retryDelay = 1000 * 2 ** attempt;
      const stream = new AbortController();
      const combined = AbortSignal.any([signal, stream.signal]);
      const buffered: LiveAccountEvent[] = [];
      let ready = false;
      let streamFailure: unknown;
      let connected!: () => void;
      let connectionFailed!: (error: unknown) => void;
      const handshake = new Promise<void>((resolve, reject) => {
        connected = resolve;
        connectionFailed = reject;
      });
      const abortHandshake = () =>
        connectionFailed(problem('live.provider_unavailable'));
      combined.addEventListener('abort', abortHandshake, { once: true });
      if (combined.aborted) abortHandshake();
      const consume = (async () => {
        try {
          for await (const event of this.#provider().streamAccount(combined)) {
            if (combined.aborted) return;
            if (event.kind === 'connected') {
              connected();
              continue;
            }
            if (ready) this.#accountEvent(event);
            else {
              if (buffered.length >= 1000) throw problem('live.protocol_error');
              buffered.push(event);
            }
          }
          if (!combined.aborted) throw problem('live.provider_unavailable');
        } catch (error) {
          streamFailure = error;
          connectionFailed(error);
        }
      })();
      try {
        await handshake;
        const account = await this.#provider().readAccount(combined);
        if (signal.aborted) return;
        if (streamFailure) throw streamFailure;
        if (
          this.#guardAccountId &&
          this.#guardAccountId !== account.id.toLowerCase()
        )
          throw problem('live.account_mismatch');
        this.#accountId = account.id.toLowerCase();
        this.#guardAccountId = this.#accountId;
        this.#accountName = account.name;
        this.#games = new Map(account.games.map((game) => [game.gameId, game]));
        this.#connection = 'connected';
        this.#problemCode = undefined;
        ready = true;
        for (const event of buffered) this.#accountEvent(event);
        this.#updateGate();
        this.#changed();
        await consume;
        if (signal.aborted) return;
        throw streamFailure ?? problem('live.provider_unavailable');
      } catch (error) {
        if (signal.aborted) return;
        this.#writeController?.abort();
        this.#connection = attempt === 3 ? 'failed' : 'reconnecting';
        this.#problemCode = failure(error).problemCode;
        if (this.#problemCode === 'live.rate_limited') retryDelay = 60_000;
        this.#setBlocked(true);
        this.#changed();
      } finally {
        combined.removeEventListener('abort', abortHandshake);
        stream.abort();
        await consume;
      }
      if (attempt < 3) await pause(retryDelay, signal);
    }
  }

  #accountEvent(event: LiveAccountEvent): void {
    if (event.kind === 'connected') return;
    if (event.kind === 'game_started')
      this.#games.set(event.game.gameId, event.game);
    else this.#games.delete(event.gameId);
    this.#updateGate();
    this.#changed();
  }

  #updateGate(): void {
    this.#setBlocked(
      (this.#online && this.#connection !== 'connected') ||
        (!this.#online && this.#desiredBlocked) ||
        this.#games.size > 0 ||
        (this.#session?.role === 'play' && this.#session.status !== 'ended'),
    );
  }

  #setBlocked(blocked: boolean): void {
    this.#desiredBlocked = blocked;
    if (blocked) this.#deps.fairPlay.setBlocked(true);
    if (!this.#deps.guard) {
      this.#deps.fairPlay.setBlocked(blocked);
      return;
    }
    const accountId = this.#guardAccountId ?? this.#accountId;
    if (blocked) this.#guardAccountId = accountId;
    this.#guardTail = this.#guardTail
      .then(async () => {
        if (this.#guardFailed) return;
        if (!blocked && this.#desiredBlocked) return;
        await this.#deps.guard!.writeLiveFairPlayGuard({
          blocked,
          ...(blocked && accountId ? { accountId } : {}),
        });
        if (!blocked && !this.#desiredBlocked) {
          this.#guardAccountId = undefined;
          this.#deps.fairPlay.setBlocked(false);
          this.#changed();
        }
      })
      .catch(() => {
        this.#guardFailed = true;
        this.#accountController?.abort();
        this.#gameController?.abort();
        this.#writeController?.abort();
        this.#deps.fairPlay.setBlocked(true);
        this.#connection = 'failed';
        this.#problemCode = 'live.guard_unavailable';
        this.#changed();
      });
  }

  #restartGame(): void {
    const session = this.#session;
    if (
      !session ||
      session.status === 'ended' ||
      this.#lifetime.signal.aborted ||
      this.#guardFailed
    )
      return;
    this.#gameController?.abort();
    const controller = new AbortController();
    this.#gameController = controller;
    this.#session = { ...session, connected: false };
    this.#changed();
    this.#track(this.#monitorGame(controller.signal));
  }

  async #monitorGame(signal: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < 4 && !signal.aborted; attempt++) {
      let retryDelay = 1000 * 2 ** attempt;
      const session = this.#session;
      if (!session || session.status === 'ended') return;
      try {
        for await (const event of this.#provider().streamGame(
          session.gameId,
          session.role,
          signal,
        )) {
          if (signal.aborted) return;
          await this.#gameEvent(event, signal);
          if (this.#session?.status === 'ended') return;
        }
        if (!signal.aborted) {
          this.#session = { ...this.#requireSession(), connected: false };
          this.#changed();
          await this.#resync(signal, this.#session?.status === 'finalizing');
        }
        if (signal.aborted || this.#session?.status === 'ended') return;
        throw problem('live.provider_unavailable');
      } catch (error) {
        if (signal.aborted) return;
        this.#writeController?.abort();
        if (failure(error).problemCode === 'live.rate_limited')
          retryDelay = 60_000;
        if (this.#session)
          this.#session = {
            ...this.#session,
            connected: false,
            problemCode: failure(error).problemCode,
          };
        this.#changed();
      }
      if (attempt < 3) await pause(retryDelay, signal);
    }
  }

  async #gameEvent(event: LiveGameEvent, signal: AbortSignal): Promise<void> {
    const session = this.#requireSession();
    if (session.status === 'ended') return;
    if (event.kind === 'snapshot' && event.game.status === 'ended') {
      this.#session = {
        ...this.#validated(event.game, session),
        status: 'finalizing',
        connected: false,
      };
      this.#changed();
      await this.#resync(signal, true);
      return;
    }
    if (session.status === 'finalizing') {
      await this.#resync(signal, true);
      return;
    }
    if (event.kind === 'finished') {
      await this.#resync(signal, true);
      return;
    }
    if (event.kind === 'snapshot') {
      this.#session = {
        ...this.#validated(event.game, session),
        connected: true,
        ...(event.game.whiteClockMs === undefined &&
        event.game.blackClockMs === undefined
          ? {}
          : { clockUpdatedAt: this.#deps.now() }),
      };
    } else {
      const latest = session.steps.at(-1)?.after ?? session.root;
      if (event.fen !== latest.fen) {
        if (
          [session.root, ...session.steps.map((step) => step.after)].some(
            (state) => state.fen === event.fen,
          )
        )
          return;
        const next = event.lastMove
          ? this.#deps.rules.applyMove(
              session.root,
              session.steps.map((step) => step.move),
              { kind: 'coordinates', value: event.lastMove },
            )
          : undefined;
        if (!next?.ok || next.value.after.fen !== event.fen) {
          await this.#resync(signal, false);
          return;
        }
        if (session.steps.length >= 1000) throw problem('live.game_too_long');
        const steps = [
          ...session.steps,
          { move: next.value.move, after: next.value.after },
        ];
        this.#session = {
          ...session,
          steps,
          selectedPly:
            session.selectedPly === session.steps.length
              ? steps.length
              : session.selectedPly,
        };
      }
      const recovered = { ...this.#requireSession() };
      delete recovered.problemCode;
      this.#session = {
        ...recovered,
        connected: true,
        ...(event.whiteClockMs === undefined
          ? {}
          : { whiteClockMs: event.whiteClockMs }),
        ...(event.blackClockMs === undefined
          ? {}
          : { blackClockMs: event.blackClockMs }),
        ...(event.whiteClockMs === undefined && event.blackClockMs === undefined
          ? {}
          : { clockUpdatedAt: this.#deps.now() }),
      };
    }
    this.#changed();
  }

  async #resync(signal: AbortSignal, final: boolean): Promise<void> {
    const session = this.#requireSession();
    if (final) {
      this.#session = { ...session, status: 'finalizing', connected: false };
      this.#changed();
    }
    const snapshot = await this.#provider().readGame(session.gameId, signal);
    if (signal.aborted || this.#session?.gameId !== session.gameId) return;
    if (this.#session.status === 'ended' && snapshot.status !== 'ended') return;
    const validated = this.#validated(snapshot, this.#session);
    if (
      snapshot.status === 'ended' &&
      (validated.steps.length < this.#session.steps.length ||
        this.#session.steps.some(
          (step, index) => step.after.fen !== validated.steps[index]?.after.fen,
        ))
    )
      throw problem('live.protocol_error');
    this.#session = {
      ...validated,
      status:
        final && snapshot.status !== 'ended' ? 'finalizing' : snapshot.status,
      connected: snapshot.status === 'ongoing' && !final && session.connected,
    };
    if (snapshot.status === 'ended') {
      this.#games.delete(session.gameId);
      this.#updateGate();
    }
    this.#changed();
  }

  #isOwn(snapshot: LiveGameSnapshot): boolean {
    return (
      this.#accountId !== undefined &&
      [snapshot.white.id, snapshot.black.id].some(
        (id) => id?.toLowerCase() === this.#accountId,
      )
    );
  }
  #provider(): LiveProviderPort {
    if (!this.#deps.provider) throw problem('live.not_configured');
    return this.#deps.provider;
  }
  #requireSession(): Session {
    if (!this.#session) throw problem('live.no_session');
    return this.#session;
  }
  #requirePlayable(): Session {
    const session = this.#requireSession();
    if (
      session.role !== 'play' ||
      session.status !== 'ongoing' ||
      !session.connected ||
      this.#connection !== 'connected' ||
      session.pendingMove
    )
      throw problem('live.not_playable');
    return session;
  }
  #check(revision: number): void {
    if (this.#lifetime.signal.aborted) throw problem('live.closed');
    if (this.#busy) throw problem('live.busy');
    if (revision !== this.#revision) throw problem('live.stale_state');
  }
  async #command<T>(revision: number, operation: () => Promise<T>): Promise<T> {
    this.#check(revision);
    this.#busy = true;
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      throw failure(error);
    } finally {
      this.#busy = false;
      this.#changed();
    }
    return result !== null &&
      typeof result === 'object' &&
      'configured' in result
      ? (this.getState() as T)
      : result;
  }
  #track(task: Promise<void>): void {
    this.#tasks.add(task);
    void task.finally(() => this.#tasks.delete(task));
  }
  #changed(): void {
    const session = this.#session;
    const signature =
      session?.role === 'observe'
        ? JSON.stringify([
            session.gameId,
            session.root,
            session.selectedPly,
            session.steps
              .slice(0, session.selectedPly)
              .map((step) => step.move),
          ])
        : undefined;
    if (signature !== this.#analysisSignature) {
      this.#analysisSignature = signature;
      this.#analysisRevision++;
    }
    this.#revision++;
    if (!this.#lifetime.signal.aborted) this.#deps.onChange();
  }
}
