import type {
  AnalysisSetup,
  AnalysisSetupValidation,
  AppliedMove,
  CanonicalMove,
  ChessState,
  SideToMove,
} from '../../domain/chess_graph/index.ts';
import type { PlayoutTerminalReason } from '../../domain/playout/index.ts';

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

export type ChessGameStatus =
  | { readonly kind: 'ongoing' }
  | {
      readonly kind: 'terminal';
      readonly reason: PlayoutTerminalReason;
      readonly winner?: SideToMove;
    };

export interface ChessRulesPort {
  initialState(): ChessState;
  parseFen(fen: string): ChessRulesResult<ChessState>;
  validateSetup(setup: AnalysisSetup): AnalysisSetupValidation;
  applyMove(
    root: ChessState,
    moves: readonly CanonicalMove[],
    input: MoveInput,
  ): ChessRulesResult<AppliedMove>;
  legalMoves(
    root: ChessState,
    moves: readonly CanonicalMove[],
  ): ChessRulesResult<readonly CanonicalMove[]>;
  gameStatus(
    root: ChessState,
    moves: readonly CanonicalMove[],
  ): ChessRulesResult<ChessGameStatus>;
}
