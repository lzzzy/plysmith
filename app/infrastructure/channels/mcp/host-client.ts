import type { components } from '../../../../contracts/host/index.ts';

export type SystemStatus = components['schemas']['SystemStatus'];
export type UserPreferences = components['schemas']['UserPreferences'];
export type SetUiLanguageRequest = components['schemas']['SetUiLanguageBody'];
export type SetUiLanguageResult = components['schemas']['SetUiLanguageResult'];
export type UiLocale = UserPreferences['uiLocale'];
export type GetAnalysisWorkspaceRequest =
  components['schemas']['GetAnalysisWorkspaceQuery'];
export type AnalysisWorkspace = components['schemas']['AnalysisWorkspace'];
export type UpdateAnalysisScratchRequest =
  components['schemas']['UpdateAnalysisScratchBody'];
export type UpdateAnalysisScratchResult =
  components['schemas']['UpdateAnalysisScratchResult'];
export type CreateAnalysisRecordRequest =
  components['schemas']['CreateAnalysisRecordBody'];
export type CreateAnalysisRecordResult =
  components['schemas']['CreateAnalysisRecordResult'];
export type CreateAnalysisNoteRequest =
  components['schemas']['CreateAnalysisNoteBody'];
export type CreateAnalysisNoteResult =
  components['schemas']['CreateAnalysisNoteResult'];
export type CreatePositionNoteRequest =
  components['schemas']['CreatePositionNoteBody'];
export type UpdateAnalysisNoteRequest =
  components['schemas']['UpdateAnalysisNoteBody'];
export type DeleteAnalysisNoteRequest =
  components['schemas']['DeleteAnalysisNoteBody'];
export type AnalysisNoteMutationResult =
  components['schemas']['AnalysisNoteMutationResult'];
export type SearchInventoryRequest =
  components['schemas']['InventorySearchQuery'];
export type SearchInventoryResult =
  components['schemas']['SearchInventoryResult'];
export type ListWorkingContextsRequest = components['schemas']['PageQuery'];
export type ListWorkingContextsResult =
  components['schemas']['ListWorkingContextsResult'];
export type WorkingContextWorkspace =
  components['schemas']['WorkingContextWorkspace'];
export type CreateWorkingContextRequest =
  components['schemas']['CreateWorkingContextBody'];
export type CreateWorkingContextResult =
  components['schemas']['CreateWorkingContextResult'];
export type AddContextReferenceRequest =
  components['schemas']['AddContextReferenceBody'];
export type AddContextReferenceResult =
  components['schemas']['AddContextReferenceResult'];
export type SetWorkScopeResumeRequest =
  components['schemas']['SetWorkScopeResumeBody'];
export type SetWorkScopeResumeResult =
  components['schemas']['SetWorkScopeResumeResult'];

/** Safe RFC 9457 DTO from the host; text must already be redacted. */
export type HostProblem = components['schemas']['ProblemDetails'];

export interface HostClientFailure {
  readonly problem: HostProblem;
}

/**
 * Supplied by the composition root using the shared, release-checked host client.
 * Safe failures reject with HostClientFailure. All other rejections are private.
 * setUiLanguage must send at most once, including after a connection failure.
 */
export interface HostClient {
  getSystemStatus(): Promise<SystemStatus>;
  getUserPreferences(): Promise<UserPreferences>;
  setUiLanguage(request: SetUiLanguageRequest): Promise<SetUiLanguageResult>;
  getAnalysisWorkspace(
    request: GetAnalysisWorkspaceRequest,
  ): Promise<AnalysisWorkspace>;
  updateAnalysisScratch(
    request: UpdateAnalysisScratchRequest,
  ): Promise<UpdateAnalysisScratchResult>;
  createAnalysisRecord(
    request: CreateAnalysisRecordRequest,
  ): Promise<CreateAnalysisRecordResult>;
  createAnalysisNote(
    request: CreateAnalysisNoteRequest,
  ): Promise<CreateAnalysisNoteResult>;
  createPositionNote(
    request: CreatePositionNoteRequest,
  ): Promise<AnalysisNoteMutationResult>;
  updateAnalysisNote(
    contributionId: string,
    request: UpdateAnalysisNoteRequest,
  ): Promise<AnalysisNoteMutationResult>;
  deleteAnalysisNote(
    contributionId: string,
    request: DeleteAnalysisNoteRequest,
  ): Promise<AnalysisNoteMutationResult>;
  searchInventory(
    request: SearchInventoryRequest,
  ): Promise<SearchInventoryResult>;
  listWorkingContexts(
    request: ListWorkingContextsRequest,
  ): Promise<ListWorkingContextsResult>;
  getWorkingContextWorkspace(
    contextId: string,
  ): Promise<WorkingContextWorkspace>;
  createWorkingContext(
    request: CreateWorkingContextRequest,
  ): Promise<CreateWorkingContextResult>;
  addContextReference(
    contextId: string,
    request: AddContextReferenceRequest,
  ): Promise<AddContextReferenceResult>;
  setWorkScopeResume(
    contextId: string,
    request: SetWorkScopeResumeRequest,
  ): Promise<SetWorkScopeResumeResult>;
}
