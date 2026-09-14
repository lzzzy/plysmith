import type {
  AnalysisNoteDraft,
  AnalysisScratch,
  AnalysisScratchOrigin,
  AnalysisScratchStep,
} from '../../domain/analysis/index.ts';
import type {
  CanonicalMove,
  ChessState,
} from '../../domain/chess_graph/index.ts';
import type {
  AnchorId,
  ContextReferenceId,
  ContributionId,
  InventoryItemId,
  ItemRevisionId,
  WorkingContextId,
} from '../../domain/identity/index.ts';
import type { WorkScope } from '../../domain/workspace/index.ts';
import type { MoveInput } from '../chess_graph/index.ts';

export interface AnalysisContributionView {
  readonly contributionId: ContributionId;
  readonly anchorId: AnchorId;
  readonly body: string;
  readonly moves: readonly CanonicalMove[];
  readonly languageTag: string;
  readonly scopeKind: 'global' | 'context';
  readonly contextId?: WorkingContextId;
  readonly contributionVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AnalysisRecordStepView extends AnalysisScratchStep {
  readonly anchorId: AnchorId;
}

export interface AnalysisSourceLineStepView extends AnalysisRecordStepView {
  readonly itemId: InventoryItemId;
  readonly revisionId: ItemRevisionId;
}

export interface AnalysisSourceLineView {
  readonly sourceItemId: InventoryItemId;
  readonly sourceRevisionId: ItemRevisionId;
  readonly sourceAnchorId: AnchorId;
  readonly sourceDisplayName: string;
  readonly root: ChessState;
  readonly rootTarget: {
    readonly itemId: InventoryItemId;
    readonly revisionId: ItemRevisionId;
    readonly anchorId: AnchorId;
  };
  readonly steps: readonly AnalysisSourceLineStepView[];
  readonly contributions: readonly AnalysisContributionView[];
}

export interface AnalysisRecordView {
  readonly itemId: InventoryItemId;
  readonly revisionId: ItemRevisionId;
  readonly rootAnchorId: AnchorId;
  readonly currentAnchorId: AnchorId;
  readonly displayName: string;
  readonly languageTag: string;
  readonly origin: AnalysisScratchOrigin;
  readonly sourceLine?: AnalysisSourceLineView;
  readonly root: ChessState;
  readonly steps: readonly AnalysisRecordStepView[];
  readonly cursor: number;
  readonly contributions: readonly AnalysisContributionView[];
  readonly contextMember: boolean;
  readonly readOnlyPreview: boolean;
}

export interface StoredContextAnalysisWorkspace {
  readonly contextId: WorkingContextId;
  readonly contextName: string;
  readonly dataRevision: number;
  readonly resumeVersion?: number;
  readonly scratch?: AnalysisScratch;
  readonly record?: AnalysisRecordView;
}

export interface AnalysisWorkspace {
  readonly scope: WorkScope;
  readonly dataRevision: number;
  readonly contextName?: string;
  readonly resumeVersion?: number;
  readonly scratch?: AnalysisScratch;
  readonly record?: AnalysisRecordView;
  readonly currentState: ChessState;
  readonly legalMoves: readonly CanonicalMove[];
  readonly allowedActions: readonly (
    | 'start_scratch'
    | 'apply_move'
    | 'move_cursor'
    | 'prepare_note'
    | 'clear_note'
    | 'discard_scratch'
    | 'create_analysis_note'
    | 'create_analysis_record'
  )[];
}

export interface GetAnalysisWorkspaceRequest {
  readonly scope: WorkScope;
  readonly preview?: {
    readonly itemId: InventoryItemId;
    readonly revisionId: ItemRevisionId;
    readonly anchorId: AnchorId;
  };
}

export type UpdateAnalysisScratchAction =
  | {
      readonly kind: 'start';
      readonly origin:
        | { readonly kind: 'initial_position' }
        | { readonly kind: 'fen'; readonly fen: string }
        | {
            readonly kind: 'inventory_anchor';
            readonly itemId: InventoryItemId;
            readonly revisionId: ItemRevisionId;
            readonly anchorId: AnchorId;
          };
    }
  | { readonly kind: 'apply_move'; readonly move: MoveInput }
  | { readonly kind: 'move_cursor'; readonly cursor: number }
  | { readonly kind: 'prepare_note'; readonly body: string }
  | { readonly kind: 'clear_note' }
  | { readonly kind: 'discard' };

export interface UpdateAnalysisScratchRequest {
  readonly scope: WorkScope;
  readonly expectedScratchId: string | null;
  readonly expectedScratchRevision: number | null;
  readonly action: UpdateAnalysisScratchAction;
}

export interface UpdateAnalysisScratchResult {
  readonly scratch?: AnalysisScratch;
  readonly discarded: boolean;
  readonly dataRevision: number;
  readonly resumeVersion?: number;
}

export interface CreateAnalysisRecordRequest {
  readonly scope: WorkScope;
  readonly expectedScratchId: string;
  readonly expectedScratchRevision: number;
  readonly displayName: string;
  readonly languageTag: string;
  readonly targetContextId?: WorkingContextId;
  readonly noteScope?: AnalysisNoteScope;
}

export type AnalysisNoteScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'context'; readonly contextId: WorkingContextId };

export interface CreateAnalysisNoteRequest {
  readonly scope: WorkScope;
  readonly expectedScratchId: string;
  readonly expectedScratchRevision: number;
  readonly languageTag: string;
  readonly noteScope: AnalysisNoteScope;
}

export interface CreateAnalysisNoteResult {
  readonly contributionId: ContributionId;
  readonly itemId: InventoryItemId;
  readonly revisionId: ItemRevisionId;
  readonly anchorId: AnchorId;
  readonly scopeKind: AnalysisNoteScope['kind'];
  readonly contextId?: WorkingContextId;
  readonly resumeUpdate?: {
    readonly contextId: WorkingContextId;
    readonly resumeVersion: number;
  };
  readonly dataRevision: number;
}

export interface CreatePositionNoteRequest {
  readonly scope: WorkScope;
  readonly itemId: InventoryItemId;
  readonly revisionId: ItemRevisionId;
  readonly anchorId: AnchorId;
  readonly body: string;
  readonly languageTag: string;
  readonly noteScope: AnalysisNoteScope;
}

export interface UpdateAnalysisNoteRequest {
  readonly scope: WorkScope;
  readonly contributionId: ContributionId;
  readonly expectedContributionVersion: number;
  readonly body: string;
}

export interface DeleteAnalysisNoteRequest {
  readonly scope: WorkScope;
  readonly contributionId: ContributionId;
  readonly expectedContributionVersion: number;
}

export interface AnalysisNoteMutationResult {
  readonly contributionId: ContributionId;
  readonly itemId: InventoryItemId;
  readonly anchorId: AnchorId;
  readonly contributionVersion: number;
  readonly dataRevision: number;
}

export interface CreateAnalysisRecordResult {
  readonly itemId: InventoryItemId;
  readonly revisionId: ItemRevisionId;
  readonly rootAnchorId: AnchorId;
  readonly contributionId?: ContributionId;
  readonly contextReferenceId?: ContextReferenceId;
  readonly resumeUpdates: readonly {
    readonly contextId: WorkingContextId;
    readonly resumeVersion: number;
  }[];
  readonly dataRevision: number;
}

export interface PersistAnalysisRecordRequest {
  readonly sourceContextId?: WorkingContextId;
  readonly expectedScratchId?: string;
  readonly expectedScratchRevision?: number;
  readonly targetContextId?: WorkingContextId;
  readonly displayName: string;
  readonly languageTag: string;
  readonly origin: AnalysisScratchOrigin;
  readonly root: ChessState;
  readonly steps: readonly AnalysisScratchStep[];
  readonly note?: AnalysisNoteDraft;
  readonly noteScope?: AnalysisNoteScope;
  readonly occurredAt: string;
}

export interface PersistAnalysisNoteRequest {
  readonly sourceContextId?: WorkingContextId;
  readonly expectedScratchId?: string;
  readonly expectedScratchRevision?: number;
  readonly origin: Extract<
    AnalysisScratchOrigin,
    { readonly kind: 'inventory_anchor' }
  >;
  readonly note: AnalysisNoteDraft;
  readonly noteScope: AnalysisNoteScope;
  readonly languageTag: string;
  readonly occurredAt: string;
}

export interface PersistPositionNoteRequest {
  readonly scope: WorkScope;
  readonly itemId: InventoryItemId;
  readonly revisionId: ItemRevisionId;
  readonly anchorId: AnchorId;
  readonly note: AnalysisNoteDraft;
  readonly noteScope: AnalysisNoteScope;
  readonly languageTag: string;
  readonly occurredAt: string;
}

export interface PersistUpdateAnalysisNoteRequest {
  readonly scope: WorkScope;
  readonly contributionId: ContributionId;
  readonly expectedContributionVersion: number;
  readonly body: string;
  readonly occurredAt: string;
}

export interface PersistDeleteAnalysisNoteRequest {
  readonly scope: WorkScope;
  readonly contributionId: ContributionId;
  readonly expectedContributionVersion: number;
  readonly occurredAt: string;
}

export interface AnalysisScratchChanged {
  readonly kind: 'analysis.scratch-changed';
  readonly occurredAt: string;
  readonly dataRevision: number;
  readonly scope: WorkScope;
  readonly scratchId?: string;
  readonly scratchRevision?: number;
}

export interface AnalysisContributionCreated {
  readonly kind: 'analysis.contribution-created';
  readonly occurredAt: string;
  readonly dataRevision: number;
  readonly itemId: InventoryItemId;
  readonly contributionId: ContributionId;
}

export interface AnalysisContributionChanged {
  readonly kind: 'analysis.contribution-changed';
  readonly changeKind: 'updated' | 'deleted';
  readonly occurredAt: string;
  readonly dataRevision: number;
  readonly itemId: InventoryItemId;
  readonly contributionId: ContributionId;
}
