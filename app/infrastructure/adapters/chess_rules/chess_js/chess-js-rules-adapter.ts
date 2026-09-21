import { Chess, DEFAULT_POSITION } from 'chess.js';

import type {
  ChessRulesFailure,
  ChessGameStatus,
  ChessRulesPort,
  ChessRulesResult,
  MoveInput,
} from '../../../../application/chess_graph/index.ts';
import {
  normalizeAnalysisSetup,
  createChessState,
  createPosition,
  type AnalysisSetup,
  type AnalysisSetupIssue,
  type AnalysisSetupPiece,
  type AnalysisSetupValidation,
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

  validateSetup(setup: AnalysisSetup): AnalysisSetupValidation {
    const issues = validateAnalysisSetup(setup);
    if (issues.length > 0) {
      return Object.freeze({ valid: false, issues: Object.freeze(issues) });
    }
    const normalized = normalizeAnalysisSetup(setup);
    try {
      const state = stateFromChess(
        new Chess(fenFromSetup(normalized)),
        'unknown',
      );
      return Object.freeze({ valid: true, setup: normalized, state });
    } catch {
      return Object.freeze({
        valid: false,
        issues: Object.freeze([
          Object.freeze({ code: 'invalid_position', field: 'pieces' }),
        ]),
      });
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

  gameStatus(
    root: ChessState,
    moves: readonly CanonicalMove[],
  ): ChessRulesResult<ChessGameStatus> {
    const replay = replayLine(root, moves);
    if (!replay.ok) return replay;
    const chess = replay.value;
    if (chess.isCheckmate()) {
      return success(
        Object.freeze({
          kind: 'terminal',
          reason: 'checkmate',
          winner: chess.turn() === 'w' ? 'black' : 'white',
        }),
      );
    }
    if (chess.isStalemate()) {
      return success(Object.freeze({ kind: 'terminal', reason: 'stalemate' }));
    }
    if (chess.isInsufficientMaterial()) {
      return success(
        Object.freeze({ kind: 'terminal', reason: 'insufficient_material' }),
      );
    }
    const repeated = hasThreefoldRepetition(root, moves);
    if (!repeated.ok) return repeated;
    if (repeated.value) {
      return success(
        Object.freeze({ kind: 'terminal', reason: 'threefold_repetition' }),
      );
    }
    const halfmoveClock = Number(chess.fen().split(' ')[4]);
    if (Number.isSafeInteger(halfmoveClock) && halfmoveClock >= 150) {
      return success(
        Object.freeze({ kind: 'terminal', reason: 'seventy_five_move' }),
      );
    }
    return success(Object.freeze({ kind: 'ongoing' }));
  }
}

function validateAnalysisSetup(
  setup: AnalysisSetup,
): readonly AnalysisSetupIssue[] {
  const issues: AnalysisSetupIssue[] = [];
  const bySquare = new Map<string, AnalysisSetupPiece>();
  for (const piece of setup.pieces) {
    if (!/^[a-h][1-8]$/.test(piece.square)) {
      issues.push(
        Object.freeze({
          code: 'invalid_square',
          field: 'pieces',
          square: piece.square,
        }),
      );
      continue;
    }
    if (bySquare.has(piece.square)) {
      issues.push(
        Object.freeze({
          code: 'duplicate_square',
          field: 'pieces',
          square: piece.square,
        }),
      );
      continue;
    }
    bySquare.set(piece.square, piece);
    if (piece.role === 'pawn' && /[18]$/.test(piece.square)) {
      issues.push(
        Object.freeze({
          code: 'pawn_on_back_rank',
          field: 'pieces',
          square: piece.square,
        }),
      );
    }
  }

  const whiteKings = setup.pieces.filter(
    (piece) => piece.color === 'white' && piece.role === 'king',
  );
  const blackKings = setup.pieces.filter(
    (piece) => piece.color === 'black' && piece.role === 'king',
  );
  requireKingCount(whiteKings, 'white', issues);
  requireKingCount(blackKings, 'black', issues);
  if (
    whiteKings.length === 1 &&
    blackKings.length === 1 &&
    kingsAreAdjacent(whiteKings[0]!.square, blackKings[0]!.square)
  ) {
    issues.push(Object.freeze({ code: 'adjacent_kings', field: 'pieces' }));
  }

  if (!castlingRightsAreConsistent(setup, bySquare)) {
    issues.push(
      Object.freeze({
        code: 'invalid_castling_rights',
        field: 'castlingRights',
      }),
    );
  }
  if (!enPassantIsConsistent(setup, bySquare)) {
    issues.push(
      Object.freeze({
        code: 'invalid_en_passant_square',
        field: 'enPassantSquare',
        ...(setup.enPassantSquare === undefined
          ? {}
          : { square: setup.enPassantSquare }),
      }),
    );
  }
  if (!Number.isSafeInteger(setup.halfmoveClock) || setup.halfmoveClock < 0) {
    issues.push(
      Object.freeze({
        code: 'invalid_halfmove_clock',
        field: 'halfmoveClock',
      }),
    );
  }
  if (!Number.isSafeInteger(setup.fullmoveNumber) || setup.fullmoveNumber < 1) {
    issues.push(
      Object.freeze({
        code: 'invalid_fullmove_number',
        field: 'fullmoveNumber',
      }),
    );
  }
  return issues;
}

function requireKingCount(
  kings: readonly AnalysisSetupPiece[],
  color: 'white' | 'black',
  issues: AnalysisSetupIssue[],
): void {
  if (kings.length === 0) {
    issues.push(
      Object.freeze({ code: `${color}_king_required`, field: 'pieces' }),
    );
  } else if (kings.length > 1) {
    issues.push(
      Object.freeze({ code: `multiple_${color}_kings`, field: 'pieces' }),
    );
  }
}

function kingsAreAdjacent(whiteSquare: string, blackSquare: string): boolean {
  return (
    Math.abs(files.indexOf(whiteSquare[0]!) - files.indexOf(blackSquare[0]!)) <=
      1 && Math.abs(Number(whiteSquare[1]) - Number(blackSquare[1])) <= 1
  );
}

function castlingRightsAreConsistent(
  setup: AnalysisSetup,
  bySquare: ReadonlyMap<string, AnalysisSetupPiece>,
): boolean {
  const rights = setup.castlingRights;
  return (
    (!rights.whiteKingSide ||
      (hasPiece(bySquare, 'e1', 'white', 'king') &&
        hasPiece(bySquare, 'h1', 'white', 'rook'))) &&
    (!rights.whiteQueenSide ||
      (hasPiece(bySquare, 'e1', 'white', 'king') &&
        hasPiece(bySquare, 'a1', 'white', 'rook'))) &&
    (!rights.blackKingSide ||
      (hasPiece(bySquare, 'e8', 'black', 'king') &&
        hasPiece(bySquare, 'h8', 'black', 'rook'))) &&
    (!rights.blackQueenSide ||
      (hasPiece(bySquare, 'e8', 'black', 'king') &&
        hasPiece(bySquare, 'a8', 'black', 'rook')))
  );
}

function enPassantIsConsistent(
  setup: AnalysisSetup,
  bySquare: ReadonlyMap<string, AnalysisSetupPiece>,
): boolean {
  const target = setup.enPassantSquare;
  if (target === undefined) return true;
  if (!/^[a-h][1-8]$/.test(target)) return false;
  const fileIndex = files.indexOf(target[0]!);
  const targetRank = Number(target[1]);
  const movingColor = setup.sideToMove;
  const expectedRank = movingColor === 'white' ? 6 : 3;
  if (targetRank !== expectedRank) return false;
  const pawnRank = movingColor === 'white' ? 5 : 4;
  const movedPawnColor = movingColor === 'white' ? 'black' : 'white';
  if (!hasPiece(bySquare, `${target[0]}${pawnRank}`, movedPawnColor, 'pawn')) {
    return false;
  }
  return [-1, 1].some((offset) => {
    const file = files[fileIndex + offset];
    return (
      file !== undefined &&
      hasPiece(bySquare, `${file}${pawnRank}`, movingColor, 'pawn')
    );
  });
}

function hasPiece(
  bySquare: ReadonlyMap<string, AnalysisSetupPiece>,
  square: string,
  color: AnalysisSetupPiece['color'],
  role: AnalysisSetupPiece['role'],
): boolean {
  const piece = bySquare.get(square);
  return piece?.color === color && piece.role === role;
}

function fenFromSetup(setup: AnalysisSetup): string {
  const pieces = new Map(setup.pieces.map((piece) => [piece.square, piece]));
  const ranks: string[] = [];
  for (let rank = 8; rank >= 1; rank -= 1) {
    let empty = 0;
    let row = '';
    for (const file of files) {
      const piece = pieces.get(`${file}${rank}`);
      if (piece === undefined) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        row += String(empty);
        empty = 0;
      }
      row += fenSymbol(piece);
    }
    if (empty > 0) row += String(empty);
    ranks.push(row);
  }
  const castling = [
    setup.castlingRights.whiteKingSide ? 'K' : '',
    setup.castlingRights.whiteQueenSide ? 'Q' : '',
    setup.castlingRights.blackKingSide ? 'k' : '',
    setup.castlingRights.blackQueenSide ? 'q' : '',
  ].join('');
  return [
    ranks.join('/'),
    setup.sideToMove === 'white' ? 'w' : 'b',
    castling.length === 0 ? '-' : castling,
    setup.enPassantSquare ?? '-',
    setup.halfmoveClock,
    setup.fullmoveNumber,
  ].join(' ');
}

function fenSymbol(piece: AnalysisSetupPiece): string {
  const symbol = {
    king: 'k',
    queen: 'q',
    rook: 'r',
    bishop: 'b',
    knight: 'n',
    pawn: 'p',
  }[piece.role];
  return piece.color === 'white' ? symbol.toUpperCase() : symbol;
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

function hasThreefoldRepetition(
  root: ChessState,
  moves: readonly CanonicalMove[],
): ChessRulesResult<boolean> {
  let chess: Chess;
  try {
    chess = new Chess(root.fen);
  } catch {
    return failure('invalid_line');
  }
  const historyKnowledge: HistoryKnowledge =
    root.playState.historyKnowledge === 'complete' ? 'complete' : 'partial';
  const occurrences = new Map<string, number>();
  const recordPosition = (): boolean => {
    const key = stateFromChess(chess, historyKnowledge).position.positionKey;
    const count = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, count);
    return count >= 3;
  };
  if (recordPosition()) return success(true);
  try {
    for (const move of moves) {
      chess.move({
        from: move.from,
        to: move.to,
        ...(move.promotion === undefined
          ? {}
          : { promotion: promotionSymbol[move.promotion] }),
      });
      if (recordPosition()) return success(true);
    }
  } catch {
    return failure('invalid_line');
  }
  return success(false);
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
