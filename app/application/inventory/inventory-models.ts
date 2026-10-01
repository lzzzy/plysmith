import type {
  AnchorId,
  InventoryItemId,
  InventoryFolderId,
  ItemRevisionId,
  WorkingContextId,
  RevisionImpactId,
} from '../../domain/identity/index.ts';
import type {
  AnalysisScratch,
  AnalysisScratchStep,
} from '../../domain/analysis/index.ts';
import type { InventoryRevisionMode } from '../../domain/inventory/index.ts';
import type { WorkScope } from '../../domain/workspace/index.ts';
import type { MoveInput } from '../chess_graph/index.ts';

export interface InventorySearchItem {
  readonly folderId?: InventoryFolderId;
  readonly lifecycle: 'active' | 'archived' | 'trashed' | 'tombstone';
  readonly itemId: InventoryItemId;
  readonly currentRevisionId: ItemRevisionId;
  readonly rootAnchorId: AnchorId;
  readonly itemType: 'game' | 'analysis' | 'source';
  readonly originKind:
    | 'manual'
    | 'structured_import'
    | 'playout'
    | 'live_observed'
    | 'live_played';
  readonly displayName: string;
  readonly summary?: string;
  readonly languageTag: string;
  readonly contextIds: readonly WorkingContextId[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SearchInventoryRequest {
  readonly query?: string;
  readonly contextId?: WorkingContextId;
  readonly pageSize?: number;
  readonly cursor?: string;
}

export interface SearchInventoryResult {
  readonly items: readonly InventorySearchItem[];
  readonly ancestors: readonly InventorySearchItem[];
  readonly provenanceEdges: readonly {
    readonly itemId: InventoryItemId;
    readonly sourceItemId: InventoryItemId;
    readonly sourceRevisionId: ItemRevisionId;
    readonly sourceAnchorId: AnchorId;
  }[];
  readonly nextCursor?: string;
  readonly dataRevision: number;
}

export interface AnalysisRecordCreated {
  readonly kind: 'inventory.item-created';
  readonly occurredAt: string;
  readonly dataRevision: number;
  readonly itemId: InventoryItemId;
  readonly revisionId: ItemRevisionId;
}

export interface StartInventoryRevisionRequest {
  readonly scope: WorkScope;
  readonly itemId: InventoryItemId;
  readonly baseRevisionId: ItemRevisionId;
  readonly anchorId: AnchorId;
  readonly mode: InventoryRevisionMode;
  readonly expectedScratchId: string | null;
  readonly expectedScratchRevision: number | null;
  readonly displayName?: string;
  readonly summary?: string | null;
  readonly firstMove?: MoveInput;
}

export interface StartInventoryRevisionResult {
  readonly scratch: AnalysisScratch;
  readonly dataRevision: number;
  readonly resumeVersion?: number;
}

export interface PromoteAnalysisToInventoryRevisionRequest {
  readonly scope: WorkScope;
  readonly itemId: InventoryItemId;
  readonly baseRevisionId: ItemRevisionId;
  readonly anchorId: AnchorId;
  readonly expectedScratchId: string;
  readonly expectedScratchRevision: number;
}

export type PromoteAnalysisToInventoryRevisionResult =
  StartInventoryRevisionResult;

export interface InventoryRevisionContextImpactSummary {
  readonly contextId: WorkingContextId;
  readonly contextName: string;
  readonly referenceCount: number;
  readonly contributionCount: number;
  readonly managementResumeCount: number;
  readonly analysisResumeCount: number;
}

export interface InventoryRevisionFollowingContextSummary {
  readonly contextId: WorkingContextId;
  readonly contextName: string;
  readonly updatedAutomatically: boolean;
  readonly referenceCount: number;
  readonly contributionCount: number;
  readonly managementResumeCount: number;
  readonly analysisResumeCount: number;
}

export interface InventoryRevisionPreview {
  readonly itemId: InventoryItemId;
  readonly baseRevisionId: ItemRevisionId;
  readonly mode: InventoryRevisionMode;
  readonly displayName: string;
  readonly summary?: string;
  readonly preservedMoveCount: number;
  readonly addedSteps: readonly AnalysisScratchStep[];
  readonly removedSteps: readonly AnalysisScratchStep[];
  readonly historicalGlobalContributionCount: number;
  readonly affectedContexts: readonly InventoryRevisionContextImpactSummary[];
  readonly followingContexts: readonly InventoryRevisionFollowingContextSummary[];
  readonly noOp: boolean;
  readonly previewFingerprint: string;
  readonly dataRevision: number;
}

export interface PreviewInventoryRevisionRequest {
  readonly scope: WorkScope;
  readonly expectedScratchId: string;
  readonly expectedScratchRevision: number;
}

export interface SaveInventoryRevisionRequest extends PreviewInventoryRevisionRequest {
  readonly previewFingerprint: string;
}

export interface SaveInventoryRevisionResult {
  readonly itemId: InventoryItemId;
  readonly revisionId: ItemRevisionId;
  readonly revisionNumber: number;
  readonly currentAnchorId: AnchorId;
  readonly impacts: readonly {
    readonly impactId: RevisionImpactId;
    readonly contextId: WorkingContextId;
  }[];
  readonly noOp: boolean;
  readonly dataRevision: number;
}

export interface InventoryRevisionSummary {
  readonly itemId: InventoryItemId;
  readonly revisionId: ItemRevisionId;
  readonly revisionNumber: number;
  readonly baseRevisionId?: ItemRevisionId;
  readonly displayName: string;
  readonly summary?: string;
  readonly changeKind: 'created' | InventoryRevisionMode;
  readonly createdAt: string;
  readonly current: boolean;
}

export interface ListInventoryRevisionsRequest {
  readonly itemId: InventoryItemId;
  readonly pageSize?: number;
  readonly cursor?: string;
}

export interface ListInventoryRevisionsResult {
  readonly revisions: readonly InventoryRevisionSummary[];
  readonly nextCursor?: string;
  readonly dataRevision: number;
}

export interface PendingRevisionImpact {
  readonly impactId: RevisionImpactId;
  readonly contextId: WorkingContextId;
  readonly contextName: string;
  readonly itemId: InventoryItemId;
  readonly pinnedRevisionId: ItemRevisionId;
  readonly targetRevisionId: ItemRevisionId;
  readonly targetAnchorId: AnchorId;
  readonly impactVersion: number;
  readonly dataRevision: number;
  readonly referenceCount: number;
  readonly contributionCount: number;
  readonly managementResumeAffected: boolean;
  readonly analysisResumeAffected: boolean;
  readonly useTargetLoss: InventoryItemUsageSummary;
  readonly removeFromContextLoss: InventoryItemUsageSummary;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InventoryItemUsageSummary {
  readonly referenceCount: number;
  readonly activeNoteCount: number;
  readonly noteMoveCount: number;
  readonly scratchCount: number;
  readonly changedScratchCount: number;
  readonly scratchMoveCount: number;
  readonly scratchNoteCount: number;
  readonly managementResumeAffected: boolean;
  readonly analysisResumeAffected: boolean;
}

export interface InventoryItemContextUsage extends InventoryItemUsageSummary {
  readonly contextId: WorkingContextId;
  readonly contextName: string;
}

export interface PreviewInventoryItemDeletionRequest {
  readonly itemId: InventoryItemId;
}

export interface InventoryItemDeletionPreview {
  readonly itemId: InventoryItemId;
  readonly currentRevisionId: ItemRevisionId;
  readonly displayName: string;
  readonly itemType: InventorySearchItem['itemType'];
  readonly contexts: readonly InventoryItemContextUsage[];
  readonly global: InventoryItemUsageSummary;
  readonly retainedDerivedItemCount: number;
  readonly retainedPlayoutCount: number;
  readonly dataRevision: number;
}

export interface DeleteInventoryItemRequest {
  readonly itemId: InventoryItemId;
  readonly expectedCurrentRevisionId: ItemRevisionId;
  readonly expectedDataRevision: number;
}

export interface DeleteInventoryItemResult {
  readonly itemId: InventoryItemId;
  readonly dataRevision: number;
}

export interface InventoryItemDeleted extends DeleteInventoryItemResult {
  readonly kind: 'inventory.item-deleted';
  readonly occurredAt: string;
}

export type RevisionImpactResolution =
  | { readonly kind: 'use_target' }
  | { readonly kind: 'keep_copy'; readonly displayName: string }
  | { readonly kind: 'remove_from_context' };

export interface ResolvePendingRevisionImpactRequest {
  readonly impactId: RevisionImpactId;
  readonly expectedImpactVersion: number;
  readonly expectedDataRevision: number;
  readonly resolution: RevisionImpactResolution;
}

export interface ResolvePendingRevisionImpactResult {
  readonly impactId: RevisionImpactId;
  readonly contextId: WorkingContextId;
  readonly itemId: InventoryItemId;
  readonly resolution: RevisionImpactResolution['kind'];
  readonly contextItemId?: InventoryItemId;
  readonly contextRevisionId?: ItemRevisionId;
  readonly dataRevision: number;
}

export interface InventoryRevisionSaved {
  readonly kind: 'inventory.revision-saved';
  readonly occurredAt: string;
  readonly dataRevision: number;
  readonly itemId: InventoryItemId;
  readonly revisionId: ItemRevisionId;
}

export interface RevisionImpactChanged {
  readonly kind: 'workspace.revision-impact-changed';
  readonly occurredAt: string;
  readonly dataRevision: number;
  readonly contextId: WorkingContextId;
  readonly itemId: InventoryItemId;
  readonly impactId: RevisionImpactId;
  readonly status: 'open' | 'resolved';
}
