import type { MoveInput } from '../chess_graph/index.ts';
import type { SideToMove } from '../../domain/chess_graph/index.ts';

export interface LivePlayer {
  readonly id?: string;
  readonly name: string;
  readonly rating?: number;
}

export interface LiveOwnGame {
  readonly gameId: string;
  readonly displayName: string;
  readonly opponentRating?: number;
  readonly playerSide: SideToMove;
  readonly boardCompatible: boolean;
  readonly standard: boolean;
}

export interface LiveAccount {
  readonly id: string;
  readonly name: string;
  readonly games: readonly LiveOwnGame[];
}

export type LiveOutcome = 'white_win' | 'black_win' | 'draw' | 'unfinished';

export interface LiveGameSnapshot {
  readonly gameId: string;
  readonly standard: boolean;
  readonly initialFen: string;
  readonly white: LivePlayer;
  readonly black: LivePlayer;
  readonly moves: readonly MoveInput[];
  readonly status: 'ongoing' | 'ended';
  readonly outcome: LiveOutcome;
  readonly whiteClockMs?: number;
  readonly blackClockMs?: number;
  readonly whiteDrawOffer?: boolean;
  readonly blackDrawOffer?: boolean;
}

export type LiveAccountEvent =
  | { readonly kind: 'connected' }
  | { readonly kind: 'game_started'; readonly game: LiveOwnGame }
  | { readonly kind: 'game_finished'; readonly gameId: string };

export type LiveGameEvent =
  | { readonly kind: 'snapshot'; readonly game: LiveGameSnapshot }
  | {
      readonly kind: 'position';
      readonly fen: string;
      readonly lastMove?: string;
      readonly whiteClockMs?: number;
      readonly blackClockMs?: number;
    }
  | { readonly kind: 'finished' };

export type LiveProviderFailure =
  | 'live.authentication_failed'
  | 'live.provider_unavailable'
  | 'live.rate_limited'
  | 'live.invalid_game'
  | 'live.protocol_error'
  | 'live.move_rejected'
  | 'live.move_uncertain';

export class LiveProviderError extends Error {
  readonly code: LiveProviderFailure;
  constructor(code: LiveProviderFailure) {
    super(code);
    this.name = 'LiveProviderError';
    this.code = code;
  }
}

export interface LiveProviderPort {
  readAccount(signal: AbortSignal): Promise<LiveAccount>;
  streamAccount(signal: AbortSignal): AsyncIterable<LiveAccountEvent>;
  readGame(gameId: string, signal: AbortSignal): Promise<LiveGameSnapshot>;
  streamGame(
    gameId: string,
    role: 'observe' | 'play',
    signal: AbortSignal,
  ): AsyncIterable<LiveGameEvent>;
  submitMove(gameId: string, move: string, signal: AbortSignal): Promise<void>;
  act(
    gameId: string,
    action: 'resign' | 'abort' | 'offer_draw' | 'accept_draw' | 'decline_draw',
    signal: AbortSignal,
  ): Promise<void>;
}
