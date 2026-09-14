export const standardInitialFen =
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export type SideToMove = 'white' | 'black';
export type HistoryKnowledge = 'complete' | 'partial' | 'unknown';
export type PromotionPiece = 'queen' | 'rook' | 'bishop' | 'knight';

export interface CastlingRights {
  readonly whiteKingSide: boolean;
  readonly whiteQueenSide: boolean;
  readonly blackKingSide: boolean;
  readonly blackQueenSide: boolean;
}

export interface Position {
  readonly ruleSetId: 'standardChess';
  /** Exactly 64 PNBRQKpnbrqk. characters in a1-to-h8 order. */
  readonly boardKey: string;
  readonly sideToMove: SideToMove;
  readonly castlingRights: CastlingRights;
  /** a1 = 0 through h8 = 63; -1 means no effective right. */
  readonly effectiveEnPassantSquare: number;
  readonly positionKey: string;
}

export interface PlayState {
  readonly halfmoveClock: number;
  readonly fullmoveNumber: number;
  readonly historyKnowledge: HistoryKnowledge;
}

export interface ChessState {
  readonly position: Position;
  readonly playState: PlayState;
  /** Canonical exchange representation; identity remains Position + PlayState. */
  readonly fen: string;
}

export interface CanonicalMove {
  readonly from: string;
  readonly to: string;
  readonly promotion?: PromotionPiece;
  readonly san: string;
}

export interface AppliedMove {
  readonly before: ChessState;
  readonly move: CanonicalMove;
  readonly after: ChessState;
}

export function createPosition(input: Omit<Position, 'positionKey'>): Position {
  if (!/^[PNBRQKpnbrqk.]{64}$/.test(input.boardKey)) {
    throw new Error('A position boardKey must contain exactly 64 pieces.');
  }
  if (
    input.effectiveEnPassantSquare !== -1 &&
    (!Number.isInteger(input.effectiveEnPassantSquare) ||
      input.effectiveEnPassantSquare < 0 ||
      input.effectiveEnPassantSquare > 63)
  ) {
    throw new Error('An effective en-passant square must be -1 or 0..63.');
  }
  const castlingRights = Object.freeze({ ...input.castlingRights });
  const positionKey = [
    input.ruleSetId,
    input.boardKey,
    input.sideToMove,
    Number(castlingRights.whiteKingSide),
    Number(castlingRights.whiteQueenSide),
    Number(castlingRights.blackKingSide),
    Number(castlingRights.blackQueenSide),
    input.effectiveEnPassantSquare,
  ].join('|');
  return Object.freeze({ ...input, castlingRights, positionKey });
}

export function createChessState(input: {
  readonly position: Position;
  readonly halfmoveClock: number;
  readonly fullmoveNumber: number;
  readonly historyKnowledge: HistoryKnowledge;
  readonly fen: string;
}): ChessState {
  if (!Number.isInteger(input.halfmoveClock) || input.halfmoveClock < 0) {
    throw new Error('A halfmove clock must be a non-negative integer.');
  }
  if (!Number.isInteger(input.fullmoveNumber) || input.fullmoveNumber < 1) {
    throw new Error('A fullmove number must be a positive integer.');
  }
  return Object.freeze({
    position: input.position,
    playState: Object.freeze({
      halfmoveClock: input.halfmoveClock,
      fullmoveNumber: input.fullmoveNumber,
      historyKnowledge: input.historyKnowledge,
    }),
    fen: input.fen,
  });
}

export function samePosition(left: Position, right: Position): boolean {
  return left.positionKey === right.positionKey;
}
