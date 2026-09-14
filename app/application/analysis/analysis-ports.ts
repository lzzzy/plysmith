import type { AnalysisScratch } from '../../domain/analysis/index.ts';
import type {
  AnchorId,
  InventoryItemId,
  ItemRevisionId,
  WorkingContextId,
} from '../../domain/identity/index.ts';
import type {
  AnalysisRecordView,
  AnalysisContributionCreated,
  AnalysisContributionChanged,
  AnalysisNoteMutationResult,
  CreateAnalysisNoteResult,
  AnalysisScratchChanged,
  CreateAnalysisRecordResult,
  PersistAnalysisRecordRequest,
  PersistAnalysisNoteRequest,
  PersistDeleteAnalysisNoteRequest,
  PersistPositionNoteRequest,
  PersistUpdateAnalysisNoteRequest,
  StoredContextAnalysisWorkspace,
} from './analysis-models.ts';

export interface ContextAnalysisReader {
  readContextAnalysisWorkspace(
    contextId: WorkingContextId,
  ): Promise<StoredContextAnalysisWorkspace | undefined>;
  readAnalysisRecord(request: {
    readonly itemId: InventoryItemId;
    readonly revisionId: ItemRevisionId;
    readonly anchorId: AnchorId;
    readonly contextId?: WorkingContextId;
    readonly readOnlyPreview: boolean;
  }): Promise<AnalysisRecordView | undefined>;
}

export interface ContextAnalysisWriter {
  replaceContextAnalysisScratch(request: {
    readonly contextId: WorkingContextId;
    readonly expectedScratchId: string | null;
    readonly expectedScratchRevision: number | null;
    readonly scratch: AnalysisScratch;
    readonly occurredAt: string;
  }): Promise<{
    readonly scratch: AnalysisScratch;
    readonly dataRevision: number;
    readonly resumeVersion: number;
  }>;
  discardContextAnalysisScratch(request: {
    readonly contextId: WorkingContextId;
    readonly expectedScratchId: string;
    readonly expectedScratchRevision: number;
    readonly occurredAt: string;
  }): Promise<{
    readonly dataRevision: number;
    readonly resumeVersion: number;
  }>;
}

export interface AnalysisRecordWriter {
  createAnalysisRecord(
    request: PersistAnalysisRecordRequest,
  ): Promise<CreateAnalysisRecordResult>;
}

export interface AnalysisNoteWriter {
  createAnalysisNote(
    request: PersistAnalysisNoteRequest,
  ): Promise<CreateAnalysisNoteResult>;
  createPositionNote(
    request: PersistPositionNoteRequest,
  ): Promise<AnalysisNoteMutationResult>;
  updateAnalysisNote(
    request: PersistUpdateAnalysisNoteRequest,
  ): Promise<AnalysisNoteMutationResult>;
  deleteAnalysisNote(
    request: PersistDeleteAnalysisNoteRequest,
  ): Promise<AnalysisNoteMutationResult>;
}

export interface AnalysisClock {
  now(): string;
}

export interface AnalysisScratchChangedPublisher {
  publish(event: AnalysisScratchChanged): void;
}

export interface AnalysisContributionCreatedPublisher {
  publish(event: AnalysisContributionCreated): void;
}

export interface AnalysisContributionChangedPublisher {
  publish(event: AnalysisContributionChanged): void;
}
