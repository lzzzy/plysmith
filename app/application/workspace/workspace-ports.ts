import type { WorkingContextId } from '../../domain/identity/index.ts';
import type { WorkingContextDraft } from '../../domain/workspace/index.ts';
import type {
  AddContextReferenceRequest,
  AddContextReferenceResult,
  CreateWorkingContextResult,
  UpdateWorkingContextMetadataRequest,
  RemoveContextItemRequest,
  RemoveContextItemResult,
  SetWorkScopeResumeRequest,
  SetWorkScopeResumeResult,
  WorkingContextSummary,
  WorkingContextWorkspace,
  WorkspaceChanged,
} from './workspace-models.ts';

export interface WorkingContextReader {
  listWorkingContexts(request: {
    readonly pageSize: number;
    readonly cursor?: string;
  }): Promise<{
    readonly contexts: readonly WorkingContextSummary[];
    readonly nextCursor?: string;
    readonly dataRevision: number;
  }>;
  readWorkingContextWorkspace(
    contextId: WorkingContextId,
  ): Promise<WorkingContextWorkspace | undefined>;
}

export interface WorkingContextWriter {
  updateWorkingContextMetadata(
    request: UpdateWorkingContextMetadataRequest,
    occurredAt: string,
  ): Promise<CreateWorkingContextResult>;
  createWorkingContext(
    draft: WorkingContextDraft,
    occurredAt: string,
  ): Promise<CreateWorkingContextResult>;
  addContextReference(
    request: AddContextReferenceRequest,
    occurredAt: string,
  ): Promise<AddContextReferenceResult>;
  removeContextItem(
    request: RemoveContextItemRequest,
    occurredAt: string,
  ): Promise<RemoveContextItemResult>;
  setWorkScopeResume(
    request: SetWorkScopeResumeRequest,
    occurredAt: string,
  ): Promise<SetWorkScopeResumeResult>;
}

export interface WorkspaceClock {
  now(): string;
}

export interface WorkspaceChangedPublisher {
  publish(event: WorkspaceChanged): void;
}
