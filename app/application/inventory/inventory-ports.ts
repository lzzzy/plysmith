import type { AnalysisScratch } from '../../domain/analysis/index.ts';
import type {
  AnchorId,
  InventoryItemId,
  ItemRevisionId,
  RevisionImpactId,
} from '../../domain/identity/index.ts';
import type { WorkScope } from '../../domain/workspace/index.ts';
import type { AnalysisRecordView } from '../analysis/analysis-models.ts';
import type {
  AnalysisRecordCreated,
  DeleteInventoryItemRequest,
  DeleteInventoryItemResult,
  InventoryItemDeleted,
  InventoryItemDeletionPreview,
  PreviewInventoryItemDeletionRequest,
  InventoryRevisionPreview,
  InventoryRevisionComment,
  InventoryRevisionSaved,
  ListInventoryRevisionsResult,
  PendingRevisionImpact,
  ResolvePendingRevisionImpactRequest,
  ResolvePendingRevisionImpactResult,
  RevisionImpactChanged,
  SaveInventoryRevisionResult,
} from './inventory-models.ts';
import type {
  SearchInventoryRequest,
  SearchInventoryResult,
} from './inventory-models.ts';

export interface InventoryReader {
  searchInventory(
    request: Required<Pick<SearchInventoryRequest, 'pageSize'>> &
      Omit<SearchInventoryRequest, 'pageSize'>,
  ): Promise<SearchInventoryResult>;
}

export interface InventoryChangedPublisher {
  publish(event: AnalysisRecordCreated): void;
}

export interface InventoryRevisionSavedPublisher {
  publish(event: InventoryRevisionSaved): void;
}

export interface RevisionImpactChangedPublisher {
  publish(event: RevisionImpactChanged): void;
}

export interface InventoryRevisionReader {
  readAnalysisRevision(request: {
    readonly itemId: InventoryItemId;
    readonly revisionId: ItemRevisionId;
    readonly scope: WorkScope;
    readonly anchorId?: AnchorId;
  }): Promise<AnalysisRecordView | undefined>;
  previewInventoryRevision(request: {
    readonly comment?: InventoryRevisionComment;
    readonly scope: WorkScope;
    readonly scratch: AnalysisScratch;
  }): Promise<InventoryRevisionPreview>;
  listInventoryRevisions(request: {
    readonly itemId: InventoryItemId;
    readonly pageSize: number;
    readonly cursor?: string;
  }): Promise<ListInventoryRevisionsResult>;
  readPendingRevisionImpact(
    impactId: RevisionImpactId,
  ): Promise<PendingRevisionImpact | undefined>;
}

export interface InventoryRevisionWriter {
  saveInventoryRevision(request: {
    readonly comment?: InventoryRevisionComment;
    readonly scope: WorkScope;
    readonly scratch: AnalysisScratch;
    readonly expectedScratchId: string;
    readonly expectedScratchRevision: number;
    readonly previewFingerprint: string;
    readonly occurredAt: string;
  }): Promise<SaveInventoryRevisionResult>;
  resolvePendingRevisionImpact(
    request: ResolvePendingRevisionImpactRequest,
    occurredAt: string,
  ): Promise<ResolvePendingRevisionImpactResult>;
}

export interface InventoryClock {
  now(): string;
}

export interface InventoryLifecycleReader {
  previewInventoryItemDeletion(
    request: PreviewInventoryItemDeletionRequest,
  ): Promise<InventoryItemDeletionPreview | undefined>;
}

export interface InventoryLifecycleWriter {
  deleteInventoryItem(
    request: DeleteInventoryItemRequest,
    occurredAt: string,
  ): Promise<DeleteInventoryItemResult>;
}

export interface InventoryItemDeletedPublisher {
  publish(event: InventoryItemDeleted): void;
}
