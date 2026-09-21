import type { AnalysisSetup } from '../../domain/chess_graph/index.ts';
import type {
  MovePolicyBinding,
  MovePolicyCapability,
  PlayoutDraft,
  PlayoutOrigin,
  PlayoutOutcome,
  PlayoutSourcePath,
  PlayoutTerminalReason,
} from '../../domain/playout/index.ts';
import type {
  AppliedMove,
  CanonicalMove,
  SideToMove,
  ChessState,
} from '../../domain/chess_graph/index.ts';
import type { WorkScope } from '../../domain/workspace/index.ts';
import type { MoveInput } from '../chess_graph/index.ts';
import type {
  AnchorId,
  ContextReferenceId,
  InventoryItemId,
  ItemRevisionId,
  WorkingContextId,
} from '../../domain/identity/index.ts';
import type { GameRecordDraft } from '../../domain/inventory/index.ts';

export type PlayoutStartInput =
  | { readonly kind: 'initial_position' }
  | { readonly kind: 'fen'; readonly fen: string }
  | { readonly kind: 'position_setup'; readonly setup: AnalysisSetup }
  | Extract<PlayoutOrigin, { readonly kind: 'inventory_anchor' }>;

export interface StartPlayoutRequest {
  readonly scope: WorkScope;
  readonly start: PlayoutStartInput;
  readonly sourcePath?: {
    readonly displayName: string;
    readonly rootFen: string;
    readonly moves: readonly MoveInput[];
  };
  readonly providerInstanceId: string;
  readonly capability: MovePolicyCapability;
  readonly opening:
    | { readonly kind: 'user_move'; readonly move: MoveInput }
    | { readonly kind: 'provider_move' };
}

export interface GetPlayoutRequest {
  readonly scope: WorkScope;
}

export interface ExpectedPlayoutRequest {
  readonly scope: WorkScope;
  readonly draftId: PlayoutDraft['draftId'];
  readonly expectedDraftRevision: number;
}

export interface SubmitPlayoutMoveRequest extends ExpectedPlayoutRequest {
  readonly move: MoveInput;
}

export interface PersistStartPlayoutRequest {
  readonly scope: WorkScope;
  readonly origin: PlayoutOrigin;
  readonly sourcePath?: PlayoutSourcePath;
  readonly root: ChessState;
  readonly playerSide: SideToMove;
  readonly policy: MovePolicyBinding;
  readonly initialUserMove?: AppliedMove;
  readonly initialTerminal?: {
    readonly reason: PlayoutTerminalReason;
    readonly outcome: Exclude<PlayoutOutcome, { readonly kind: 'unfinished' }>;
  };
  readonly occurredAt: string;
}

export interface StoredPlayout {
  readonly draft: PlayoutDraft;
  readonly dataRevision: number;
}

export interface PlayoutChanged {
  readonly kind: 'playout.changed';
  readonly occurredAt: string;
  readonly dataRevision: number;
  readonly scope: WorkScope;
  readonly draftId: PlayoutDraft['draftId'];
  readonly draftRevision: number;
}

export interface PlayoutView extends StoredPlayout {
  readonly legalMoves: readonly CanonicalMove[];
}

export interface PersistReplacePlayoutRequest {
  readonly scope: WorkScope;
  readonly expectedDraftRevision: number;
  readonly draft: PlayoutDraft;
  readonly occurredAt: string;
}

export interface PersistDiscardPlayoutRequest {
  readonly scope: WorkScope;
  readonly draftId: PlayoutDraft['draftId'];
  readonly expectedDraftRevision: number;
  readonly occurredAt: string;
}

export interface CompletePlayoutRequest extends ExpectedPlayoutRequest {
  readonly completionId: string;
  readonly displayName: string;
  readonly languageTag: string;
  readonly targetContextId?: WorkingContextId;
}

export interface PersistCompletePlayoutRequest {
  readonly scope: WorkScope;
  readonly draftId: PlayoutDraft['draftId'];
  readonly expectedDraftRevision: number;
  readonly completionId: string;
  readonly game: GameRecordDraft;
  readonly targetContextId?: WorkingContextId;
  readonly occurredAt: string;
}

export interface CompletePlayoutResult {
  readonly itemId: InventoryItemId;
  readonly revisionId: ItemRevisionId;
  readonly rootAnchorId: AnchorId;
  readonly contextReferenceId?: ContextReferenceId;
  readonly dataRevision: number;
}
