import type {
  AnchorId,
  ContextReferenceId,
  InventoryItemId,
  ItemRevisionId,
  PositionId,
  WorkingContextId,
} from '../../domain/identity/index.ts';
import type { WorkingContextDraft } from '../../domain/workspace/index.ts';

export interface WorkingContextSummary extends WorkingContextDraft {
  readonly contextId: WorkingContextId;
  readonly lifecycle: 'active' | 'archived';
  readonly pinnedOrder?: number;
  readonly contextVersion: number;
  readonly referenceCount: number;
  readonly managementResumeVersion?: number;
  readonly analysisResumeVersion?: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ContextReferenceSummary {
  readonly referenceId: ContextReferenceId;
  readonly itemId: InventoryItemId;
  readonly currentRevisionId: ItemRevisionId;
  readonly itemType: 'game' | 'analysis' | 'source';
  readonly displayName: string;
  readonly anchorId: AnchorId;
  readonly anchorKind: 'item' | 'position' | 'occurrence' | 'move_node';
  readonly createdAt: string;
}

export interface ManagementResume {
  readonly resumeVersion: number;
  readonly presentation: 'list' | 'atlas';
  readonly selectedItemId?: InventoryItemId;
  readonly selectedAnchorId?: AnchorId;
  readonly updatedAt: string;
}

export interface AnalysisResume {
  readonly resumeVersion: number;
  readonly mode: 'analyze' | 'edit_inventory' | 'edit_overlay';
  readonly itemId?: InventoryItemId;
  readonly revisionId?: ItemRevisionId;
  readonly anchorId?: AnchorId;
  readonly currentPositionId: PositionId;
  readonly scratchId?: string;
  readonly updatedAt: string;
}

export interface WorkingContextWorkspace {
  readonly context: WorkingContextSummary;
  readonly references: readonly ContextReferenceSummary[];
  readonly managementResume?: ManagementResume;
  readonly analysisResume?: AnalysisResume;
  readonly dataRevision: number;
}

export interface CreateWorkingContextRequest {
  readonly displayName: string;
  readonly purpose?: string;
  readonly boundary?: string;
  readonly nextStep?: string;
}

export interface CreateWorkingContextResult {
  readonly context: WorkingContextSummary;
  readonly dataRevision: number;
}

export interface AddContextReferenceRequest {
  readonly contextId: WorkingContextId;
  readonly itemId: InventoryItemId;
  readonly anchorId: AnchorId;
}

export interface AddContextReferenceResult {
  readonly reference: ContextReferenceSummary;
  readonly dataRevision: number;
}

export type SetWorkScopeResumeRequest =
  | {
      readonly contextId: WorkingContextId;
      readonly area: 'manage';
      readonly expectedResumeVersion: number | null;
      readonly presentation: 'list' | 'atlas';
      readonly selectedItemId?: InventoryItemId;
      readonly selectedAnchorId?: AnchorId;
    }
  | {
      readonly contextId: WorkingContextId;
      readonly area: 'analyze';
      readonly expectedResumeVersion: number | null;
      readonly mode: 'analyze' | 'edit_inventory' | 'edit_overlay';
      readonly itemId?: InventoryItemId;
      readonly revisionId?: ItemRevisionId;
      readonly anchorId?: AnchorId;
    };

export type SetWorkScopeResumeResult =
  | {
      readonly area: 'manage';
      readonly resume: ManagementResume;
      readonly dataRevision: number;
    }
  | {
      readonly area: 'analyze';
      readonly resume: AnalysisResume;
      readonly dataRevision: number;
    };

export type WorkspaceChanged =
  | {
      readonly kind: 'workspace.context-created';
      readonly occurredAt: string;
      readonly dataRevision: number;
      readonly contextId: WorkingContextId;
      readonly contextVersion: number;
    }
  | {
      readonly kind: 'workspace.reference-added';
      readonly occurredAt: string;
      readonly dataRevision: number;
      readonly contextId: WorkingContextId;
      readonly referenceId: ContextReferenceId;
    }
  | {
      readonly kind: 'workspace.resume-updated';
      readonly occurredAt: string;
      readonly dataRevision: number;
      readonly contextId: WorkingContextId;
      readonly area: 'manage' | 'analyze';
      readonly resumeVersion: number;
    };
