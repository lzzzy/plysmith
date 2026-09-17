import type { CastlingRights, ChessState, SideToMove } from './chess-state.ts';

export type AnalysisSetupPieceColor = 'white' | 'black';
export type AnalysisSetupPieceRole =
  'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';

export interface AnalysisSetupPiece {
  readonly square: string;
  readonly color: AnalysisSetupPieceColor;
  readonly role: AnalysisSetupPieceRole;
}

export interface AnalysisSetup {
  readonly pieces: readonly AnalysisSetupPiece[];
  readonly sideToMove: SideToMove;
  readonly castlingRights: CastlingRights;
  readonly enPassantSquare?: string;
  readonly halfmoveClock: number;
  readonly fullmoveNumber: number;
}

export type AnalysisSetupIssueCode =
  | 'invalid_square'
  | 'duplicate_square'
  | 'white_king_required'
  | 'black_king_required'
  | 'multiple_white_kings'
  | 'multiple_black_kings'
  | 'adjacent_kings'
  | 'pawn_on_back_rank'
  | 'invalid_castling_rights'
  | 'invalid_en_passant_square'
  | 'invalid_halfmove_clock'
  | 'invalid_fullmove_number'
  | 'invalid_position'
  | 'invalid_fen';

export interface AnalysisSetupIssue {
  readonly code: AnalysisSetupIssueCode;
  readonly field?:
    | 'pieces'
    | 'castlingRights'
    | 'enPassantSquare'
    | 'halfmoveClock'
    | 'fullmoveNumber'
    | 'fen';
  readonly square?: string;
}

export type AnalysisSetupValidation =
  | {
      readonly valid: true;
      readonly setup: AnalysisSetup;
      readonly state: ChessState;
    }
  | {
      readonly valid: false;
      readonly issues: readonly AnalysisSetupIssue[];
    };

const files = 'abcdefgh';

export function normalizeAnalysisSetup(setup: AnalysisSetup): AnalysisSetup {
  return Object.freeze({
    pieces: Object.freeze(
      [...setup.pieces]
        .sort(
          (left, right) => squareIndex(left.square) - squareIndex(right.square),
        )
        .map((piece) => Object.freeze({ ...piece })),
    ),
    sideToMove: setup.sideToMove,
    castlingRights: Object.freeze({ ...setup.castlingRights }),
    ...(setup.enPassantSquare === undefined
      ? {}
      : { enPassantSquare: setup.enPassantSquare }),
    halfmoveClock: setup.halfmoveClock,
    fullmoveNumber: setup.fullmoveNumber,
  });
}

export function analysisSetupFromState(state: ChessState): AnalysisSetup {
  const pieces: AnalysisSetupPiece[] = [];
  for (let index = 0; index < state.position.boardKey.length; index += 1) {
    const symbol = state.position.boardKey[index];
    if (symbol === undefined || symbol === '.') continue;
    pieces.push(
      Object.freeze({
        square: squareFromIndex(index),
        color: symbol === symbol.toUpperCase() ? 'white' : 'black',
        role: roleBySymbol[symbol.toLowerCase()]!,
      }),
    );
  }
  return normalizeAnalysisSetup({
    pieces,
    sideToMove: state.position.sideToMove,
    castlingRights: state.position.castlingRights,
    ...(state.position.effectiveEnPassantSquare < 0
      ? {}
      : {
          enPassantSquare: squareFromIndex(
            state.position.effectiveEnPassantSquare,
          ),
        }),
    halfmoveClock: state.playState.halfmoveClock,
    fullmoveNumber: state.playState.fullmoveNumber,
  });
}

const roleBySymbol: Readonly<Record<string, AnalysisSetupPieceRole>> =
  Object.freeze({
    k: 'king',
    q: 'queen',
    r: 'rook',
    b: 'bishop',
    n: 'knight',
    p: 'pawn',
  });

function squareIndex(square: string): number {
  const file = files.indexOf(square[0] ?? '');
  const rank = Number(square[1]);
  return file < 0 || !Number.isInteger(rank) ? 64 : (rank - 1) * 8 + file;
}

function squareFromIndex(index: number): string {
  const file = files[index % 8];
  const rank = Math.floor(index / 8) + 1;
  if (file === undefined || rank < 1 || rank > 8) {
    throw new Error('A setup square index must be inside the board.');
  }
  return `${file}${rank}`;
}
