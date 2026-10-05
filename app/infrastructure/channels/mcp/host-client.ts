import type { components } from '../../../../contracts/host/index.ts';

export type RegisterImportInputRequest =
  components['schemas']['RegisterImportInputBody'];
export type ImportInputDescriptor =
  components['schemas']['ImportInputDescriptor'];
export type PrepareImportRequest = components['schemas']['PrepareImportBody'];
export type ImportPreview = components['schemas']['ImportPreview'];
export type CheckImportNamesRequest =
  components['schemas']['CheckImportNamesBody'];
export type ImportNameChecks = components['schemas']['ImportNameChecks'];
export type PublishImportRequest = components['schemas']['PublishImportBody'];
export type ImportPublished = components['schemas']['ImportPublished'];
export type DiscardImportRequest = components['schemas']['DiscardImportBody'];
export type DiscardImportResult = components['schemas']['DiscardImportResult'];

export type GetInventoryOrganizationRequest =
  components['schemas']['InventoryOrganizationQuery'];
export type InventoryOrganization =
  components['schemas']['InventoryOrganization'];
export type ChangeInventoryOrganizationRequest =
  components['schemas']['ChangeInventoryOrganizationBody'];
export type ChangeInventoryOrganizationResult =
  components['schemas']['ChangeInventoryOrganizationResult'];
export type PreviewContextFolderRemovalRequest =
  components['schemas']['ContextFolderRemovalQuery'];
export type ContextFolderRemovalPreview =
  components['schemas']['ContextFolderRemovalPreview'];
export type CheckInventoryNameAvailabilityRequest =
  components['schemas']['InventoryNameAvailabilityQuery'];
export type InventoryNameAvailability =
  components['schemas']['InventoryNameAvailability'];
export type SystemStatus = components['schemas']['SystemStatus'];
export type ContextRemovalPreview =
  components['schemas']['ContextRemovalPreview'];
export type InventoryItemDeletionPreview =
  components['schemas']['InventoryItemDeletionPreview'];
export type WorkScopeWorkspace = components['schemas']['WorkScopeWorkspace'];
export type StartupResume = components['schemas']['StartupResume'];
export type SetStartupResumeRequest =
  components['schemas']['SetStartupResumeBody'];
export type DeleteWorkingContextRequest =
  components['schemas']['DeleteWorkingContextBody'];
export type DeleteInventoryItemRequest =
  components['schemas']['DeleteInventoryItemBody'];
export type RemoveContextItemRequest =
  components['schemas']['RemoveContextItemBody'];
export type DeleteWorkingContextResult =
  components['schemas']['DeleteWorkingContextResult'];
export type DeleteInventoryItemResult =
  components['schemas']['DeleteInventoryItemResult'];
export type GetWorkScopeWorkspaceRequest =
  components['schemas']['WorkScopeWorkspaceQuery'];
export type UserPreferences = components['schemas']['UserPreferences'];
export type SetUiLanguageRequest = components['schemas']['SetUiLanguageBody'];
export type SetUiLanguageResult = components['schemas']['SetUiLanguageResult'];
export type DiagnosticSettings = components['schemas']['DiagnosticSettings'];
export type SetDiagnosticLogLevelRequest =
  components['schemas']['SetDiagnosticLogLevelBody'];
export type SetDiagnosticLogLevelResult =
  components['schemas']['SetDiagnosticLogLevelResult'];
export type DiagnosticReportManifest =
  components['schemas']['DiagnosticReportManifest'];
export type CreateDiagnosticReportRequest =
  components['schemas']['CreateDiagnosticReportBody'];
export type CreateDiagnosticReportResult =
  components['schemas']['CreateDiagnosticReportResult'];
export type UiLocale = UserPreferences['uiLocale'];
export type GetAnalysisWorkspaceRequest =
  components['schemas']['GetAnalysisWorkspaceQuery'];
export type AnalysisWorkspace = components['schemas']['AnalysisWorkspace'];
export type ValidateAnalysisSetupRequest =
  components['schemas']['ValidateAnalysisSetupBody'];
export type ValidateAnalysisSetupResult =
  components['schemas']['ValidateAnalysisSetupResult'];
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
export type StartInventoryRevisionRequest =
  components['schemas']['StartInventoryRevisionBody'];
export type StartInventoryRevisionResult =
  components['schemas']['StartInventoryRevisionResult'];
export type PromoteAnalysisToInventoryRevisionRequest =
  components['schemas']['PromoteAnalysisToInventoryRevisionBody'];
export type PreviewInventoryRevisionRequest =
  components['schemas']['InventoryRevisionScratchBody'];
export type InventoryRevisionPreview =
  components['schemas']['InventoryRevisionPreview'];
export type SaveInventoryRevisionRequest =
  components['schemas']['SaveInventoryRevisionBody'];
export type SaveInventoryRevisionResult =
  components['schemas']['SaveInventoryRevisionResult'];
export type GetInventoryRevisionRequest =
  components['schemas']['InventoryRevisionReadQuery'];
export type AnalysisRecord = components['schemas']['AnalysisRecord'];
export type ListInventoryRevisionsRequest = components['schemas']['PageQuery'];
export type ListInventoryRevisionsResult =
  components['schemas']['ListInventoryRevisionsResult'];
export type PendingRevisionImpact =
  components['schemas']['PendingRevisionImpact'];
export type ResolvePendingRevisionImpactRequest =
  components['schemas']['ResolvePendingRevisionImpactBody'];
export type ResolvePendingRevisionImpactResult =
  components['schemas']['ResolvePendingRevisionImpactResult'];
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
export type RemoveContextItemResult =
  components['schemas']['RemoveContextItemResult'];
export type SetWorkScopeResumeRequest =
  components['schemas']['SetWorkScopeResumeBody'];
export type SetWorkScopeResumeResult =
  components['schemas']['SetWorkScopeResumeResult'];
export type SetManagementPresentationRequest =
  components['schemas']['SetManagementPresentationBody'];
export type SetManagementPresentationResult =
  components['schemas']['SetManagementPresentationResult'];
export type ListMovePolicyProvidersResult =
  components['schemas']['ListMovePolicyProvidersResult'];
export type ListPositionAnalysisProvidersResult =
  components['schemas']['ListPositionAnalysisProvidersResult'];
export type AnalyzePositionRequest =
  components['schemas']['AnalyzePositionBody'];
export type PositionAnalysisSnapshot =
  components['schemas']['PositionAnalysisSnapshot'];
export type Playout = components['schemas']['PlayoutResult'];
export type StartPlayoutRequest = components['schemas']['StartPlayoutBody'];
export type ExpectedPlayoutRequest =
  components['schemas']['ExpectedPlayoutBody'];
export type SubmitPlayoutMoveRequest =
  components['schemas']['SubmitPlayoutMoveBody'];
export type CompletePlayoutRequest =
  components['schemas']['CompletePlayoutBody'];
export type CompletePlayoutResult =
  components['schemas']['CompletePlayoutResult'];
export type DiscardPlayoutResult =
  components['schemas']['DiscardPlayoutResult'];

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
  registerImportInput(
    request: RegisterImportInputRequest,
  ): Promise<ImportInputDescriptor>;
  prepareImport(request: PrepareImportRequest): Promise<ImportPreview>;
  checkImportNames(request: CheckImportNamesRequest): Promise<ImportNameChecks>;
  publishImport(request: PublishImportRequest): Promise<ImportPublished>;
  discardImport(request: DiscardImportRequest): Promise<DiscardImportResult>;
  getInventoryOrganization(
    request: GetInventoryOrganizationRequest,
  ): Promise<InventoryOrganization>;
  changeInventoryOrganization(
    request: ChangeInventoryOrganizationRequest,
  ): Promise<ChangeInventoryOrganizationResult>;
  previewContextFolderRemoval(
    request: PreviewContextFolderRemovalRequest,
  ): Promise<ContextFolderRemovalPreview>;
  checkInventoryNameAvailability(
    request: CheckInventoryNameAvailabilityRequest,
  ): Promise<InventoryNameAvailability>;
  getWorkScopeWorkspace(
    request: GetWorkScopeWorkspaceRequest,
  ): Promise<WorkScopeWorkspace>;
  getStartupResume(): Promise<StartupResume>;
  setStartupResume(request: SetStartupResumeRequest): Promise<StartupResume>;
  previewContextItemRemoval(
    contextId: string,
    itemId: string,
  ): Promise<ContextRemovalPreview>;
  previewWorkingContextDeletion(
    contextId: string,
  ): Promise<ContextRemovalPreview>;
  deleteWorkingContext(
    contextId: string,
    request: DeleteWorkingContextRequest,
  ): Promise<DeleteWorkingContextResult>;
  previewInventoryItemDeletion(
    itemId: string,
  ): Promise<InventoryItemDeletionPreview>;
  deleteInventoryItem(
    itemId: string,
    request: DeleteInventoryItemRequest,
  ): Promise<DeleteInventoryItemResult>;
  getSystemStatus(): Promise<SystemStatus>;
  getUserPreferences(): Promise<UserPreferences>;
  setUiLanguage(request: SetUiLanguageRequest): Promise<SetUiLanguageResult>;
  getDiagnosticSettings(): Promise<DiagnosticSettings>;
  setDiagnosticLogLevel(
    request: SetDiagnosticLogLevelRequest,
  ): Promise<SetDiagnosticLogLevelResult>;
  getDiagnosticReportManifest(): Promise<DiagnosticReportManifest>;
  createDiagnosticReport(
    request: CreateDiagnosticReportRequest,
  ): Promise<CreateDiagnosticReportResult>;
  getAnalysisWorkspace(
    request: GetAnalysisWorkspaceRequest,
  ): Promise<AnalysisWorkspace>;
  validateAnalysisSetup(
    request: ValidateAnalysisSetupRequest,
  ): Promise<ValidateAnalysisSetupResult>;
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
  startInventoryRevision(
    itemId: string,
    request: StartInventoryRevisionRequest,
  ): Promise<StartInventoryRevisionResult>;
  promoteAnalysisToInventoryRevision(
    itemId: string,
    request: PromoteAnalysisToInventoryRevisionRequest,
  ): Promise<StartInventoryRevisionResult>;
  previewInventoryRevision(
    request: PreviewInventoryRevisionRequest,
  ): Promise<InventoryRevisionPreview>;
  saveInventoryRevision(
    request: SaveInventoryRevisionRequest,
  ): Promise<SaveInventoryRevisionResult>;
  getInventoryRevision(
    itemId: string,
    revisionId: string,
    request: GetInventoryRevisionRequest,
  ): Promise<AnalysisRecord>;
  listInventoryRevisions(
    itemId: string,
    request: ListInventoryRevisionsRequest,
  ): Promise<ListInventoryRevisionsResult>;
  getPendingRevisionImpact(impactId: string): Promise<PendingRevisionImpact>;
  resolvePendingRevisionImpact(
    impactId: string,
    request: ResolvePendingRevisionImpactRequest,
  ): Promise<ResolvePendingRevisionImpactResult>;
  listWorkingContexts(
    request: ListWorkingContextsRequest,
  ): Promise<ListWorkingContextsResult>;
  getWorkingContextWorkspace(
    contextId: string,
  ): Promise<WorkingContextWorkspace>;
  createWorkingContext(
    request: CreateWorkingContextRequest,
  ): Promise<CreateWorkingContextResult>;
  updateWorkingContextMetadata(
    contextId: string,
    request: components['schemas']['UpdateWorkingContextMetadataBody'],
  ): Promise<CreateWorkingContextResult>;
  addContextReference(
    contextId: string,
    request: AddContextReferenceRequest,
  ): Promise<AddContextReferenceResult>;
  removeContextItem(
    contextId: string,
    itemId: string,
    request: RemoveContextItemRequest,
  ): Promise<RemoveContextItemResult>;
  setWorkScopeResume(
    request: SetWorkScopeResumeRequest,
  ): Promise<SetWorkScopeResumeResult>;
  setManagementPresentation(
    request: SetManagementPresentationRequest,
  ): Promise<SetManagementPresentationResult>;
  listPositionAnalysisProviders(): Promise<ListPositionAnalysisProvidersResult>;
  analyzePosition(
    request: AnalyzePositionRequest,
  ): Promise<PositionAnalysisSnapshot>;
  listMovePolicyProviders(): Promise<ListMovePolicyProvidersResult>;
  getPlayout(request: {
    readonly scopeKind: 'free' | 'context';
    readonly contextId?: string;
  }): Promise<Playout | null>;
  startPlayout(request: StartPlayoutRequest): Promise<Playout>;
  submitPlayoutMove(request: SubmitPlayoutMoveRequest): Promise<Playout>;
  retryPlayout(request: ExpectedPlayoutRequest): Promise<Playout>;
  pausePlayout(request: ExpectedPlayoutRequest): Promise<Playout>;
  resumePlayout(request: ExpectedPlayoutRequest): Promise<Playout>;
  stopPlayout(request: ExpectedPlayoutRequest): Promise<Playout>;
  cancelPlayoutCompletion(request: ExpectedPlayoutRequest): Promise<Playout>;
  completePlayout(
    request: CompletePlayoutRequest,
  ): Promise<CompletePlayoutResult>;
  discardPlayout(
    request: ExpectedPlayoutRequest,
  ): Promise<DiscardPlayoutResult>;
}
