import { Chess, DEFAULT_POSITION } from 'chess.js';

import type {
  ChessRulesFailure,
  ChessRulesPort,
  ChessRulesResult,
  MoveInput,
} from '../../../../application/chess_graph/index.ts';
import {
  createChessState,
  createPosition,
  type AppliedMove,
  type CanonicalMove,
  type ChessState,
  type HistoryKnowledge,
  type PromotionPiece,
} from '../../../../domain/chess_graph/index.ts';

const files = 'abcdefgh';
const germanPieces: Readonly<Record<string, string>> = Object.freeze({
  K: 'K',
  D: 'Q',
  T: 'R',
  L: 'B',
  S: 'N',
});
const promotionBySymbol: Readonly<Record<string, PromotionPiece>> =
  Object.freeze({ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' });
const promotionSymbol: Readonly<Record<PromotionPiece, string>> = Object.freeze(
  {
    queen: 'q',
    rook: 'r',
    bishop: 'b',
    knight: 'n',
  },
);

export class ChessJsRulesAdapter implements ChessRulesPort {
  initialState(): ChessState {
    return stateFromChess(new Chess(DEFAULT_POSITION), 'complete');
  }

  parseFen(fen: string): ChessRulesResult<ChessState> {
    if (typeof fen !== 'string' || fen.trim() !== fen || fen.length === 0) {
      return failure('invalid_fen');
    }
    try {
      return success(stateFromChess(new Chess(fen), 'unknown'));
    } catch {
      return failure('invalid_fen');
    }
  }

  applyMove(
    root: ChessState,
    moves: readonly CanonicalMove[],
    input: MoveInput,
  ): ChessRulesResult<AppliedMove> {
    const replay = replayLine(root, moves);
    if (!replay.ok) return replay;
    const before = stateFromChess(
      replay.value,
      root.playState.historyKnowledge === 'complete' ? 'complete' : 'partial',
    );
    const normalized = normalizeMoveInput(input);
    if (!normalized.ok) return normalized;
    try {
      const move = replay.value.move(normalized.value, { strict: true });
      return success(
        Object.freeze({
          before,
          move: canonicalMove(move),
          after: stateFromChess(
            replay.value,
            root.playState.historyKnowledge === 'complete'
              ? 'complete'
              : 'partial',
          ),
        }),
      );
    } catch {
      return failure('illegal_move');
    }
  }

  legalMoves(
    root: ChessState,
    moves: readonly CanonicalMove[],
  ): ChessRulesResult<readonly CanonicalMove[]> {
    const replay = replayLine(root, moves);
    if (!replay.ok) return replay;
    return success(
      Object.freeze(
        replay.value
          .moves({ verbose: true })
          .map((move) => canonicalMove(move)),
      ),
    );
  }
}

function replayLine(
  root: ChessState,
  moves: readonly CanonicalMove[],
): ChessRulesResult<Chess> {
  let chess: Chess;
  try {
    chess = new Chess(root.fen);
  } catch {
    return failure('invalid_line');
  }
  try {
    for (const move of moves) {
      chess.move({
        from: move.from,
        to: move.to,
        ...(move.promotion === undefined
          ? {}
          : { promotion: promotionSymbol[move.promotion] }),
      });
    }
    return success(chess);
  } catch {
    return failure('invalid_line');
  }
}

function normalizeMoveInput(
  input: MoveInput,
): ChessRulesResult<string | { from: string; to: string; promotion?: string }> {
  if (input.kind === 'coordinates') {
    const value = input.value.trim().toLowerCase();
    const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(value);
    if (match === null) return failure('invalid_move_input');
    const from = match[1];
    const to = match[2];
    if (from === undefined || to === undefined) {
      return failure('invalid_move_input');
    }
    return success({
      from,
      to,
      ...(match[3] === undefined ? {} : { promotion: match[3] }),
    });
  }
  if (input.value.trim() !== input.value || input.value.length === 0) {
    return failure('invalid_move_input');
  }
  if (input.locale === 'en-GB') return success(input.value);
  const first = input.value[0];
  const normalizedFirst = first === undefined ? undefined : germanPieces[first];
  let notation =
    normalizedFirst === undefined
      ? input.value
      : `${normalizedFirst}${input.value.slice(1)}`;
  notation = notation.replace(
    /=([DTLS])/g,
    (_, piece: string) => `=${germanPieces[piece] ?? piece}`,
  );
  return success(notation);
}

function canonicalMove(move: {
  readonly from: string;
  readonly to: string;
  readonly promotion?: string;
  readonly san: string;
}): CanonicalMove {
  const promotion =
    move.promotion === undefined
      ? undefined
      : promotionBySymbol[move.promotion];
  if (move.promotion !== undefined && promotion === undefined) {
    throw new Error('chess.js returned an unsupported promotion.');
  }
  return Object.freeze({
    from: move.from,
    to: move.to,
    ...(promotion === undefined ? {} : { promotion }),
    san: move.san,
  });
}

function stateFromChess(
  chess: Chess,
  historyKnowledge: HistoryKnowledge,
): ChessState {
  const fen = chess.fen();
  const [, side, castling, enPassant, halfmove, fullmove] = fen.split(' ');
  if (
    side === undefined ||
    castling === undefined ||
    enPassant === undefined ||
    halfmove === undefined ||
    fullmove === undefined
  ) {
    throw new Error('chess.js returned an incomplete FEN.');
  }
  const whiteCastling = chess.getCastlingRights('w');
  const blackCastling = chess.getCastlingRights('b');
  const position = createPosition({
    ruleSetId: 'standardChess',
    boardKey: boardKey(chess),
    sideToMove: side === 'w' ? 'white' : 'black',
    castlingRights: {
      whiteKingSide: whiteCastling.k,
      whiteQueenSide: whiteCastling.q,
      blackKingSide: blackCastling.k,
      blackQueenSide: blackCastling.q,
    },
    effectiveEnPassantSquare: squareIndex(enPassant),
  });
  return createChessState({
    position,
    halfmoveClock: Number(halfmove),
    fullmoveNumber: Number(fullmove),
    historyKnowledge,
    fen,
  });
}

function boardKey(chess: Chess): string {
  let result = '';
  for (let rank = 1; rank <= 8; rank += 1) {
    for (const file of files) {
      const piece = chess.get(`${file}${rank}` as Parameters<Chess['get']>[0]);
      if (piece === undefined) {
        result += '.';
      } else {
        result += piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
      }
    }
  }
  return result;
}

function squareIndex(square: string): number {
  if (square === '-') return -1;
  const file = files.indexOf(square[0] ?? '');
  const rank = Number(square[1]);
  if (file < 0 || !Number.isInteger(rank) || rank < 1 || rank > 8) {
    throw new Error('chess.js returned an invalid en-passant square.');
  }
  return (rank - 1) * 8 + file;
}

function success<T>(value: T): ChessRulesResult<T> {
  return Object.freeze({ ok: true, value });
}

function failure(reason: ChessRulesFailure): {
  readonly ok: false;
  readonly reason: ChessRulesFailure;
} {
  return Object.freeze({ ok: false, reason });
}
