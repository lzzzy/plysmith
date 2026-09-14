import type {
  AppliedMove,
  CanonicalMove,
  ChessState,
} from '../../domain/chess_graph/index.ts';

export type NotationLocale = 'de-DE' | 'en-GB';

export type MoveInput =
  | {
      readonly kind: 'coordinates';
      readonly value: string;
    }
  | {
      readonly kind: 'notation';
      readonly value: string;
      readonly locale: NotationLocale;
    };

export type ChessRulesFailure =
  'invalid_fen' | 'invalid_move_input' | 'illegal_move' | 'invalid_line';

export type ChessRulesResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: ChessRulesFailure };

export interface ChessRulesPort {
  initialState(): ChessState;
  parseFen(fen: string): ChessRulesResult<ChessState>;
  applyMove(
    root: ChessState,
    moves: readonly CanonicalMove[],
    input: MoveInput,
  ): ChessRulesResult<AppliedMove>;
  legalMoves(
    root: ChessState,
    moves: readonly CanonicalMove[],
  ): ChessRulesResult<readonly CanonicalMove[]>;
}
