import type {
  CanonicalMove,
  ChessState,
  SideToMove,
} from '../../domain/chess_graph/index.ts';
import type { PositionAnalysisFocus } from '../analysis/position-analysis.ts';
import type { LiveOutcome, LiveOwnGame, LivePlayer } from './live-ports.ts';

export interface LiveRecordedMove {
  readonly move: CanonicalMove;
  readonly after: ChessState;
}

export interface LiveSessionView {
  readonly analysisRevision: number;
  readonly gameId: string;
  readonly role: 'observe' | 'play';
  readonly white: LivePlayer;
  readonly black: LivePlayer;
  readonly playerSide?: SideToMove;
  readonly root: ChessState;
  readonly steps: readonly LiveRecordedMove[];
  readonly selectedPly: number;
  readonly current: ChessState;
  readonly legalMoves: readonly CanonicalMove[];
  readonly status: 'ongoing' | 'finalizing' | 'ended';
  readonly connected: boolean;
  readonly outcome: LiveOutcome;
  readonly pendingMove: boolean;
  readonly whiteClockMs?: number;
  readonly blackClockMs?: number;
  readonly clockUpdatedAt?: string;
  readonly whiteDrawOffer?: boolean;
  readonly blackDrawOffer?: boolean;
  readonly focus?: PositionAnalysisFocus;
  readonly problemCode?: string;
}

export interface LiveState {
  readonly revision: number;
  readonly configured: boolean;
  readonly online: boolean;
  readonly connection:
    | 'unconfigured'
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'failed';
  readonly fairPlayBlocked: boolean;
  readonly accountName?: string;
  readonly games: readonly LiveOwnGame[];
  readonly session?: LiveSessionView;
  readonly problemCode?: string;
}

export interface SaveLiveRequest {
  readonly expectedRevision: number;
  readonly displayName: string;
  readonly languageTag: 'de-DE' | 'en-GB';
  readonly folderId?: number;
  readonly workingContextId?: number;
}

export interface LiveSaved {
  readonly itemId: number;
  readonly revisionId: number;
  readonly dataRevision: number;
}

export interface LiveRecordWriter {
  saveLiveGame(request: {
    readonly gameId: string;
    readonly role: 'observe' | 'play';
    readonly white: LivePlayer;
    readonly black: LivePlayer;
    readonly root: ChessState;
    readonly steps: readonly LiveRecordedMove[];
    readonly outcome: LiveOutcome;
    readonly displayName: string;
    readonly languageTag: 'de-DE' | 'en-GB';
    readonly folderId?: number;
    readonly workingContextId?: number;
    readonly occurredAt: string;
  }): Promise<LiveSaved>;
}

export interface LiveFairPlayGuardState {
  readonly blocked: boolean;
  readonly accountId?: string;
}

export interface LiveFairPlayGuard {
  readLiveFairPlayGuard(): Promise<LiveFairPlayGuardState>;
  writeLiveFairPlayGuard(state: LiveFairPlayGuardState): Promise<void>;
}
