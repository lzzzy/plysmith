import { Chess, DEFAULT_POSITION, type Square } from 'chess.js';
import type { MoveInput } from '../../../../application/chess_graph/index.ts';
import {
  LiveProviderError,
  type LiveGameSnapshot,
  type LiveOutcome,
  type LiveOwnGame,
  type LivePlayer,
} from '../../../../application/live/live-ports.ts';

const maximumMoves = 4_096;
const uciPattern = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const statusNames = new Set([
  'created',
  'started',
  'aborted',
  'mate',
  'resign',
  'stalemate',
  'timeout',
  'draw',
  'outoftime',
  'cheat',
  'noStart',
  'unknownFinish',
  'insufficientMaterialClaim',
  'variantEnd',
]);

export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail();
  return value as Record<string, unknown>;
}

export function text(value: unknown, maximum = 256): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    /[\u0000-\u001f]/.test(value)
  )
    fail();
  return value as string;
}

export function gameId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]{8}$/.test(value))
    throw new LiveProviderError('live.invalid_game');
  return value;
}

export function moveUci(value: unknown): string {
  if (typeof value !== 'string' || !uciPattern.test(value)) fail();
  return value as string;
}

export function clock(value: unknown, factor = 1): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(value * factor)
  )
    fail();
  return (value as number) * factor;
}

export function clocks(white: unknown, black: unknown, factor = 1) {
  const whiteClockMs = clock(white, factor);
  const blackClockMs = clock(black, factor);
  return {
    ...(whiteClockMs === undefined ? {} : { whiteClockMs }),
    ...(blackClockMs === undefined ? {} : { blackClockMs }),
  };
}

function variantKey(value: unknown): string {
  return typeof value === 'string' ? value : text(object(value).key);
}

export function standard(value: unknown): boolean {
  return ['standard', 'fromPosition'].includes(variantKey(value));
}

function initialFen(value: unknown, variant: unknown): string {
  if (value === undefined || value === 'startpos') {
    if (variantKey(variant) === 'fromPosition') fail();
    return DEFAULT_POSITION;
  }
  const fen = text(value, 128);
  if (standard(variant)) {
    if (!/^[KQkq-]+$/.test(fen.split(' ')[2] ?? '')) fail();
    try {
      new Chess(fen);
    } catch {
      fail();
    }
  }
  return fen;
}

export function player(value: unknown): LivePlayer {
  const raw = object(value);
  const user = raw.user === undefined ? raw : object(raw.user);
  const id =
    user.id === undefined || user.id === null
      ? undefined
      : text(user.id).toLowerCase();
  const name =
    user.name ??
    user.username ??
    (raw.aiLevel === undefined ? 'Anonymous' : 'AI');
  const rating = raw.rating;
  if (
    rating !== undefined &&
    (typeof rating !== 'number' || !Number.isSafeInteger(rating) || rating < 0)
  )
    fail();
  return {
    ...(id === undefined ? {} : { id }),
    name: text(name),
    ...(rating === undefined ? {} : { rating }),
  };
}

export function ownGame(value: unknown): LiveOwnGame {
  const raw = object(value);
  if (raw.color !== 'white' && raw.color !== 'black') fail();
  const supported = standard(raw.variant);
  const compatible =
    raw.compat === undefined ? undefined : object(raw.compat).board;
  if (compatible !== undefined && typeof compatible !== 'boolean') fail();
  // /account/playing omits compat; the account event's explicit flag takes precedence.
  const allowedSpeed =
    ['rapid', 'classical', 'correspondence'].includes(String(raw.speed)) ||
    (raw.speed === 'blitz' &&
      ['friend', 'ai', 'api', 'position'].includes(String(raw.source)));
  const opponent = player(raw.opponent);
  return {
    gameId: gameId(raw.gameId),
    displayName: opponent.name,
    ...(opponent.rating === undefined
      ? {}
      : { opponentRating: opponent.rating }),
    playerSide: raw.color as 'white' | 'black',
    boardCompatible:
      supported &&
      (compatible === undefined ? allowedSpeed : compatible === true),
    standard: supported,
  };
}

export function gameStatus(value: unknown): string {
  const status = typeof value === 'string' ? value : text(object(value).name);
  if (!statusNames.has(status)) fail();
  return status;
}

export function ended(value: unknown): boolean {
  return !['created', 'started'].includes(gameStatus(value));
}

function result(
  status: unknown,
  winner: unknown,
): Pick<LiveGameSnapshot, 'status' | 'outcome'> {
  const name = gameStatus(status);
  if (winner !== undefined && winner !== 'white' && winner !== 'black') fail();
  const complete = ended(name);
  let outcome: LiveOutcome = 'unfinished';
  if (complete && winner !== undefined)
    outcome = winner === 'white' ? 'white_win' : 'black_win';
  else if (
    ['draw', 'stalemate', 'outoftime', 'insufficientMaterialClaim'].includes(
      name,
    )
  )
    outcome = 'draw';
  return { status: complete ? 'ended' : 'ongoing', outcome };
}

function moveWords(value: unknown): string[] {
  if (typeof value !== 'string' || value.length > 65_536) fail();
  const trimmed = (value as string).trim();
  const words = trimmed === '' ? [] : trimmed.split(/\s+/);
  if (words.length > maximumMoves || words.some((word) => word.length > 16))
    fail();
  return words;
}

export function exportSnapshot(
  value: unknown,
  expectedId: string,
): LiveGameSnapshot {
  const raw = object(value);
  if (gameId(raw.id) !== expectedId) fail();
  const players = object(raw.players);
  const fen = initialFen(raw.initialFen, raw.variant);
  const moves: MoveInput[] = moveWords(raw.moves).map((value) => ({
    kind: 'notation',
    value,
    locale: 'en-GB',
  }));
  let white: number | undefined;
  let black: number | undefined;
  if (raw.clock !== undefined)
    white = black = clock(object(raw.clock).initial, 1_000);
  if (raw.clocks !== undefined) {
    const finalClock =
      Array.isArray(raw.clocks) &&
      ended(raw.status) &&
      raw.clocks.length === moves.length + 1;
    if (
      !Array.isArray(raw.clocks) ||
      (raw.clocks.length !== moves.length && !finalClock)
    )
      fail();
    let whiteMoved = fen.split(' ')[1] === 'w';
    // An asynchronous finish records the active clock without another chess move.
    for (const value of raw.clocks) {
      if (whiteMoved) white = clock(value, 10);
      else black = clock(value, 10);
      whiteMoved = !whiteMoved;
    }
  }
  return {
    gameId: expectedId,
    standard: standard(raw.variant),
    initialFen: fen,
    white: player(players.white),
    black: player(players.black),
    moves,
    ...result(raw.status, raw.winner),
    ...clocks(white, black),
  };
}

export function boardSnapshot(
  full: Record<string, unknown>,
  state: Record<string, unknown>,
  expectedId: string,
): LiveGameSnapshot {
  if (gameId(full.id) !== expectedId) fail();
  const supported = standard(full.variant);
  const fen = initialFen(full.initialFen, full.variant);
  const words = moveWords(state.moves);
  let moves: MoveInput[];
  try {
    const chess = supported ? new Chess(fen) : undefined;
    moves = words.map((word) => {
      let value = moveUci(word);
      if (chess !== undefined) {
        const from = value.slice(0, 2) as Square;
        let to = value.slice(2, 4);
        // Board API UCI uses king-to-rook castling, including standard chess.
        if (chess.get(from)?.type === 'k') {
          const castling: Record<string, string> = {
            e1h1: 'g1',
            e1a1: 'c1',
            e8h8: 'g8',
            e8a8: 'c8',
          };
          to = castling[value] ?? to;
        }
        value = `${from}${to}${value.slice(4)}`;
        chess.move({
          from,
          to,
          ...(value.length === 5 ? { promotion: value[4] } : {}),
        });
      }
      return { kind: 'coordinates', value };
    });
  } catch {
    fail();
  }
  return {
    gameId: expectedId,
    standard: supported,
    initialFen: fen,
    white: player(full.white),
    black: player(full.black),
    moves: moves!,
    ...result(state.status, state.winner),
    ...clocks(state.wtime, state.btime),
    whiteDrawOffer: boolean(state.wdraw),
    blackDrawOffer: boolean(state.bdraw),
  };
}

function boolean(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') fail();
  return value as boolean;
}

function fail(): never {
  throw new LiveProviderError('live.protocol_error');
}
