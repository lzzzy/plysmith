import createClient, { type Client } from 'openapi-fetch';

import {
  contractFingerprint,
  productRelease,
  type components,
  type paths,
} from '../../../../contracts/host/index.ts';
import {
  createHostFetch,
  type HostConnection,
  type HostFetchOptions,
} from './host-fetch.ts';
import {
  HostClientProblem,
  localHostProblem,
  type SafeHostProblem,
} from './host-client-problem.ts';

export type RegisterImportInputRequestDto =
  components['schemas']['RegisterImportInputBody'];
export type ImportInputDescriptorDto =
  components['schemas']['ImportInputDescriptor'];
export type PrepareImportRequestDto =
  components['schemas']['PrepareImportBody'];
export type ImportPreviewDto = components['schemas']['ImportPreview'];
export type CheckImportNamesRequestDto =
  components['schemas']['CheckImportNamesBody'];
export type ImportNameChecksDto = components['schemas']['ImportNameChecks'];
export type PublishImportRequestDto =
  components['schemas']['PublishImportBody'];
export type ImportPublishedDto = components['schemas']['ImportPublished'];
export type DiscardImportRequestDto =
  components['schemas']['DiscardImportBody'];
export type DiscardImportResultDto =
  components['schemas']['DiscardImportResult'];

export type GetInventoryOrganizationRequestDto =
  components['schemas']['InventoryOrganizationQuery'];
export type InventoryOrganizationDto =
  components['schemas']['InventoryOrganization'];
export type ChangeInventoryOrganizationRequestDto =
  components['schemas']['ChangeInventoryOrganizationBody'];
export type ChangeInventoryOrganizationResultDto =
  components['schemas']['ChangeInventoryOrganizationResult'];
export type PreviewContextFolderRemovalRequestDto =
  components['schemas']['ContextFolderRemovalQuery'];
export type ContextFolderRemovalPreviewDto =
  components['schemas']['ContextFolderRemovalPreview'];
export type CheckInventoryNameAvailabilityRequestDto =
  components['schemas']['InventoryNameAvailabilityQuery'];
export type InventoryNameAvailabilityDto =
  components['schemas']['InventoryNameAvailability'];
export type SystemStatusDto = components['schemas']['SystemStatus'];
export type ContextRemovalPreviewDto =
  components['schemas']['ContextRemovalPreview'];
export type InventoryItemDeletionPreviewDto =
  components['schemas']['InventoryItemDeletionPreview'];
export type WorkScopeWorkspaceDto = components['schemas']['WorkScopeWorkspace'];
export type StartupResumeDto = components['schemas']['StartupResume'];
export type SetStartupResumeRequestDto =
  components['schemas']['SetStartupResumeBody'];
export type DeleteWorkingContextRequestDto =
  components['schemas']['DeleteWorkingContextBody'];
export type DeleteInventoryItemRequestDto =
  components['schemas']['DeleteInventoryItemBody'];
export type RemoveContextItemRequestDto =
  components['schemas']['RemoveContextItemBody'];
export type DeleteWorkingContextResultDto =
  components['schemas']['DeleteWorkingContextResult'];
export type DeleteInventoryItemResultDto =
  components['schemas']['DeleteInventoryItemResult'];
export type GetWorkScopeWorkspaceRequestDto =
  components['schemas']['WorkScopeWorkspaceQuery'];
export type UserPreferencesDto = components['schemas']['UserPreferences'];
export type SetUiLanguageResultDto =
  components['schemas']['SetUiLanguageResult'];
export type DiagnosticSettingsDto = components['schemas']['DiagnosticSettings'];
export type SetDiagnosticLogLevelRequestDto =
  components['schemas']['SetDiagnosticLogLevelBody'];
export type SetDiagnosticLogLevelResultDto =
  components['schemas']['SetDiagnosticLogLevelResult'];
export type DiagnosticReportManifestDto =
  components['schemas']['DiagnosticReportManifest'];
export type CreateDiagnosticReportRequestDto =
  components['schemas']['CreateDiagnosticReportBody'];
export type CreateDiagnosticReportResultDto =
  components['schemas']['CreateDiagnosticReportResult'];
export type GetAnalysisWorkspaceRequestDto =
  components['schemas']['GetAnalysisWorkspaceQuery'];
export type AnalysisWorkspaceDto = components['schemas']['AnalysisWorkspace'];
export type ListPositionAnalysisProvidersResultDto =
  components['schemas']['ListPositionAnalysisProvidersResult'];
export type AnalyzePositionRequestDto =
  components['schemas']['AnalyzePositionBody'];
export type PositionAnalysisSnapshotDto =
  components['schemas']['PositionAnalysisSnapshot'];
export type ValidateAnalysisSetupRequestDto =
  components['schemas']['ValidateAnalysisSetupBody'];
export type ValidateAnalysisSetupResultDto =
  components['schemas']['ValidateAnalysisSetupResult'];
export type UpdateAnalysisScratchRequestDto =
  components['schemas']['UpdateAnalysisScratchBody'];
export type UpdateAnalysisScratchResultDto =
  components['schemas']['UpdateAnalysisScratchResult'];
export type CreateAnalysisRecordRequestDto =
  components['schemas']['CreateAnalysisRecordBody'];
export type CreateAnalysisRecordResultDto =
  components['schemas']['CreateAnalysisRecordResult'];
export type CreateAnalysisNoteRequestDto =
  components['schemas']['CreateAnalysisNoteBody'];
export type CreateAnalysisNoteResultDto =
  components['schemas']['CreateAnalysisNoteResult'];
export type CreatePositionNoteRequestDto =
  components['schemas']['CreatePositionNoteBody'];
export type UpdateAnalysisNoteRequestDto =
  components['schemas']['UpdateAnalysisNoteBody'];
export type DeleteAnalysisNoteRequestDto =
  components['schemas']['DeleteAnalysisNoteBody'];
export type AnalysisNoteMutationResultDto =
  components['schemas']['AnalysisNoteMutationResult'];
export type SearchInventoryRequestDto =
  components['schemas']['InventorySearchQuery'];
export type SearchInventoryResultDto =
  components['schemas']['SearchInventoryResult'];
export type StartInventoryRevisionRequestDto =
  components['schemas']['StartInventoryRevisionBody'];
export type StartInventoryRevisionResultDto =
  components['schemas']['StartInventoryRevisionResult'];
export type PromoteAnalysisToInventoryRevisionRequestDto =
  components['schemas']['PromoteAnalysisToInventoryRevisionBody'];
export type InventoryRevisionScratchRequestDto =
  components['schemas']['InventoryRevisionScratchBody'];
export type InventoryRevisionPreviewDto =
  components['schemas']['InventoryRevisionPreview'];
export type SaveInventoryRevisionRequestDto =
  components['schemas']['SaveInventoryRevisionBody'];
export type SaveInventoryRevisionResultDto =
  components['schemas']['SaveInventoryRevisionResult'];
export type InventoryRevisionReadRequestDto =
  components['schemas']['InventoryRevisionReadQuery'];
export type AnalysisRecordDto = components['schemas']['AnalysisRecord'];
export type ListInventoryRevisionsRequestDto =
  components['schemas']['PageQuery'];
export type ListInventoryRevisionsResultDto =
  components['schemas']['ListInventoryRevisionsResult'];
export type PendingRevisionImpactDto =
  components['schemas']['PendingRevisionImpact'];
export type ResolvePendingRevisionImpactRequestDto =
  components['schemas']['ResolvePendingRevisionImpactBody'];
export type ResolvePendingRevisionImpactResultDto =
  components['schemas']['ResolvePendingRevisionImpactResult'];
export type ListWorkingContextsRequestDto = components['schemas']['PageQuery'];
export type ListWorkingContextsResultDto =
  components['schemas']['ListWorkingContextsResult'];
export type WorkingContextWorkspaceDto =
  components['schemas']['WorkingContextWorkspace'];
export type CreateWorkingContextRequestDto =
  components['schemas']['CreateWorkingContextBody'];
export type UpdateWorkingContextMetadataRequestDto =
  components['schemas']['UpdateWorkingContextMetadataBody'];
export type CreateWorkingContextResultDto =
  components['schemas']['CreateWorkingContextResult'];
export type AddContextReferenceRequestDto =
  components['schemas']['AddContextReferenceBody'];
export type AddContextReferenceResultDto =
  components['schemas']['AddContextReferenceResult'];
export type RemoveContextItemResultDto =
  components['schemas']['RemoveContextItemResult'];
export type SetWorkScopeResumeRequestDto =
  components['schemas']['SetWorkScopeResumeBody'];
export type SetWorkScopeResumeResultDto =
  components['schemas']['SetWorkScopeResumeResult'];
export type SetManagementPresentationRequestDto =
  components['schemas']['SetManagementPresentationBody'];
export type SetManagementPresentationResultDto =
  components['schemas']['SetManagementPresentationResult'];
export type MovePolicyProviderDto = components['schemas']['MovePolicyProvider'];
export type ListMovePolicyProvidersResultDto =
  components['schemas']['ListMovePolicyProvidersResult'];
export type PlayoutDto = components['schemas']['PlayoutResult'];
export type StartPlayoutRequestDto = components['schemas']['StartPlayoutBody'];
export type ExpectedPlayoutRequestDto =
  components['schemas']['ExpectedPlayoutBody'];
export type SubmitPlayoutMoveRequestDto =
  components['schemas']['SubmitPlayoutMoveBody'];
export type CompletePlayoutRequestDto =
  components['schemas']['CompletePlayoutBody'];
export type CompletePlayoutResultDto =
  components['schemas']['CompletePlayoutResult'];
export type DiscardPlayoutResultDto =
  components['schemas']['DiscardPlayoutResult'];
export type EngineProviderConfigurationInputDto =
  components['schemas']['EngineProviderConfigurationInput'];
export type EngineProviderConfigurationDto =
  components['schemas']['EngineProviderConfiguration'];
export type ListEngineProviderConfigurationsResultDto =
  components['schemas']['ListEngineProviderConfigurationsResult'];
export type EngineProviderConfigurationPreviewDto =
  components['schemas']['EngineProviderConfigurationPreview'];
export type SaveEngineProviderConfigurationRequestDto =
  components['schemas']['SaveEngineProviderConfigurationBody'];

export type PlysmithHostClientOptions = HostFetchOptions;

export class PlysmithHostClient {
  readonly #client: Client<paths>;

  constructor(
    connection: HostConnection,
    options: PlysmithHostClientOptions = {},
  ) {
    this.#client = createClient<paths>({
      baseUrl: connection.endpoint,
      fetch: createHostFetch(connection, options),
    });
  }

  async registerImportInput(
    request: RegisterImportInputRequestDto,
  ): Promise<ImportInputDescriptorDto> {
    try {
      const result = await this.#client.POST('/inventory/import-inputs', {
        body: request,
      });
      return unwrap<ImportInputDescriptorDto>(
        result.data as unknown as ImportInputDescriptorDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async prepareImport(
    request: PrepareImportRequestDto,
  ): Promise<ImportPreviewDto> {
    try {
      const result = await this.#client.POST('/inventory/imports/preview', {
        body: request,
      });
      return unwrap<ImportPreviewDto>(
        result.data as unknown as ImportPreviewDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async checkImportNames(
    request: CheckImportNamesRequestDto,
  ): Promise<ImportNameChecksDto> {
    try {
      const result = await this.#client.POST('/inventory/imports/names', {
        body: request,
      });
      return unwrap<ImportNameChecksDto>(
        result.data as unknown as ImportNameChecksDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async publishImport(
    request: PublishImportRequestDto,
  ): Promise<ImportPublishedDto> {
    try {
      const result = await this.#client.POST('/inventory/imports/publish', {
        body: request,
      });
      return unwrap<ImportPublishedDto>(
        result.data as unknown as ImportPublishedDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async discardImport(
    request: DiscardImportRequestDto,
  ): Promise<DiscardImportResultDto> {
    try {
      const result = await this.#client.POST('/inventory/imports/discard', {
        body: request,
      });
      return unwrap<DiscardImportResultDto>(
        result.data as unknown as DiscardImportResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getWorkScopeWorkspace(
    request: GetWorkScopeWorkspaceRequestDto,
  ): Promise<WorkScopeWorkspaceDto> {
    try {
      const result = await this.#client.GET('/workspace/scope', {
        params: { query: request },
      });
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getStartupResume(): Promise<StartupResumeDto> {
    try {
      const result = await this.#client.GET('/workspace/startup');
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async setStartupResume(
    request: SetStartupResumeRequestDto,
  ): Promise<StartupResumeDto> {
    try {
      const result = await this.#client.PUT('/workspace/startup', {
        body: request,
      });
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async previewContextItemRemoval(
    contextId: string,
    itemId: string,
  ): Promise<ContextRemovalPreviewDto> {
    try {
      const result = await this.#client.GET(
        '/working-contexts/{contextId}/items/{itemId}/removal-preview',
        { params: { path: { contextId, itemId } } },
      );
      return unwrap<ContextRemovalPreviewDto>(
        result.data as unknown as ContextRemovalPreviewDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async previewWorkingContextDeletion(
    contextId: string,
  ): Promise<ContextRemovalPreviewDto> {
    try {
      const result = await this.#client.GET(
        '/working-contexts/{contextId}/deletion-preview',
        { params: { path: { contextId } } },
      );
      return unwrap<ContextRemovalPreviewDto>(
        result.data as unknown as ContextRemovalPreviewDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async deleteWorkingContext(
    contextId: string,
    request: DeleteWorkingContextRequestDto,
  ): Promise<DeleteWorkingContextResultDto> {
    try {
      const result = await this.#client.DELETE(
        '/working-contexts/{contextId}',
        { params: { path: { contextId } }, body: request },
      );
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async previewInventoryItemDeletion(
    itemId: string,
  ): Promise<InventoryItemDeletionPreviewDto> {
    try {
      const result = await this.#client.GET(
        '/inventory/items/{itemId}/deletion-preview',
        { params: { path: { itemId } } },
      );
      return unwrap<InventoryItemDeletionPreviewDto>(
        result.data as unknown as InventoryItemDeletionPreviewDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async deleteInventoryItem(
    itemId: string,
    request: DeleteInventoryItemRequestDto,
  ): Promise<DeleteInventoryItemResultDto> {
    try {
      const result = await this.#client.DELETE('/inventory/items/{itemId}', {
        params: { path: { itemId } },
        body: request,
      });
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getSystemStatus(): Promise<SystemStatusDto> {
    try {
      const result = await this.#client.GET('/status');
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getUserPreferences(): Promise<UserPreferencesDto> {
    try {
      const result = await this.#client.GET('/preferences');
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async setUiLanguage(request: {
    readonly uiLocale: 'de-DE' | 'en-GB';
    readonly expectedRevision: number;
  }): Promise<SetUiLanguageResultDto> {
    try {
      const result = await this.#client.PUT('/preferences/ui-language', {
        body: request,
      });
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getDiagnosticSettings(): Promise<DiagnosticSettingsDto> {
    try {
      const result = await this.#client.GET('/diagnostics/settings');
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async setDiagnosticLogLevel(
    request: SetDiagnosticLogLevelRequestDto,
  ): Promise<SetDiagnosticLogLevelResultDto> {
    try {
      const result = await this.#client.PUT('/diagnostics/settings/log-level', {
        body: request,
      });
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getDiagnosticReportManifest(): Promise<DiagnosticReportManifestDto> {
    try {
      const result = await this.#client.GET('/diagnostics/report-manifest');
      return unwrap<DiagnosticReportManifestDto>(
        result.data as unknown as DiagnosticReportManifestDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async createDiagnosticReport(
    request: CreateDiagnosticReportRequestDto,
  ): Promise<CreateDiagnosticReportResultDto> {
    try {
      const result = await this.#client.POST('/diagnostics/reports', {
        body: request,
      });
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getAnalysisWorkspace(
    request: GetAnalysisWorkspaceRequestDto,
  ): Promise<AnalysisWorkspaceDto> {
    try {
      const result = await this.#client.GET('/analysis/workspace', {
        params: { query: request },
      });
      return unwrap<AnalysisWorkspaceDto>(
        result.data as unknown as AnalysisWorkspaceDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async listPositionAnalysisProviders(): Promise<ListPositionAnalysisProvidersResultDto> {
    try {
      const result = await this.#client.GET('/analysis/providers');
      return unwrap<ListPositionAnalysisProvidersResultDto>(
        result.data as ListPositionAnalysisProvidersResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async analyzePosition(
    request: AnalyzePositionRequestDto,
  ): Promise<PositionAnalysisSnapshotDto> {
    try {
      const result = await this.#client.POST('/analysis/position', {
        body: request,
      });
      return unwrap<PositionAnalysisSnapshotDto>(
        result.data as PositionAnalysisSnapshotDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async validateAnalysisSetup(
    request: ValidateAnalysisSetupRequestDto,
  ): Promise<ValidateAnalysisSetupResultDto> {
    try {
      const result = await this.#client.POST('/analysis/setup-validation', {
        body: request,
      });
      return unwrap<ValidateAnalysisSetupResultDto>(
        result.data as unknown as ValidateAnalysisSetupResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async updateAnalysisScratch(
    request: UpdateAnalysisScratchRequestDto,
  ): Promise<UpdateAnalysisScratchResultDto> {
    try {
      const result = await this.#client.PUT('/analysis/scratch', {
        body: request,
      });
      return unwrap<UpdateAnalysisScratchResultDto>(
        result.data as unknown as UpdateAnalysisScratchResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async createAnalysisRecord(
    request: CreateAnalysisRecordRequestDto,
  ): Promise<CreateAnalysisRecordResultDto> {
    try {
      const result = await this.#client.POST('/inventory/analysis-records', {
        body: request,
      });
      return unwrap<CreateAnalysisRecordResultDto>(
        result.data as unknown as CreateAnalysisRecordResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async createAnalysisNote(
    request: CreateAnalysisNoteRequestDto,
  ): Promise<CreateAnalysisNoteResultDto> {
    try {
      const result = await this.#client.POST('/analysis/notes', {
        body: request,
      });
      return unwrap<CreateAnalysisNoteResultDto>(
        result.data as unknown as CreateAnalysisNoteResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async createPositionNote(
    request: CreatePositionNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto> {
    try {
      const result = await this.#client.POST('/analysis/position-notes', {
        body: request,
      });
      return unwrap<AnalysisNoteMutationResultDto>(
        result.data as unknown as AnalysisNoteMutationResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async updateAnalysisNote(
    contributionId: string,
    request: UpdateAnalysisNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto> {
    try {
      const result = await this.#client.PATCH(
        '/analysis/notes/{contributionId}',
        {
          params: { path: { contributionId } },
          body: request,
        },
      );
      return unwrap<AnalysisNoteMutationResultDto>(
        result.data as unknown as AnalysisNoteMutationResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async deleteAnalysisNote(
    contributionId: string,
    request: DeleteAnalysisNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto> {
    try {
      const result = await this.#client.DELETE(
        '/analysis/notes/{contributionId}',
        {
          params: { path: { contributionId } },
          body: request,
        },
      );
      return unwrap<AnalysisNoteMutationResultDto>(
        result.data as unknown as AnalysisNoteMutationResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getInventoryOrganization(
    request: GetInventoryOrganizationRequestDto,
  ): Promise<InventoryOrganizationDto> {
    try {
      const result = await this.#client.GET('/inventory/organization', {
        params: { query: request },
      });
      return unwrap<InventoryOrganizationDto>(
        result.data as unknown as InventoryOrganizationDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async changeInventoryOrganization(
    request: ChangeInventoryOrganizationRequestDto,
  ): Promise<ChangeInventoryOrganizationResultDto> {
    try {
      const result = await this.#client.POST('/inventory/organization', {
        body: request,
      });
      return unwrap<ChangeInventoryOrganizationResultDto>(
        result.data,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async previewContextFolderRemoval(
    request: PreviewContextFolderRemovalRequestDto,
  ): Promise<ContextFolderRemovalPreviewDto> {
    try {
      const result = await this.#client.GET(
        '/inventory/organization/removal-preview',
        { params: { query: request } },
      );
      return unwrap<ContextFolderRemovalPreviewDto>(
        result.data as unknown as ContextFolderRemovalPreviewDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async checkInventoryNameAvailability(
    request: CheckInventoryNameAvailabilityRequestDto,
  ): Promise<InventoryNameAvailabilityDto> {
    try {
      const result = await this.#client.GET('/inventory/name-availability', {
        params: { query: request },
      });
      return unwrap<InventoryNameAvailabilityDto>(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async searchInventory(
    request: SearchInventoryRequestDto,
  ): Promise<SearchInventoryResultDto> {
    try {
      const result = await this.#client.GET('/inventory', {
        params: { query: request },
      });
      return unwrap<SearchInventoryResultDto>(
        result.data as unknown as SearchInventoryResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async startInventoryRevision(
    itemId: string,
    request: StartInventoryRevisionRequestDto,
  ): Promise<StartInventoryRevisionResultDto> {
    try {
      const result = await this.#client.POST(
        '/inventory/items/{itemId}/revision-edits',
        { params: { path: { itemId } }, body: request },
      );
      return unwrap<StartInventoryRevisionResultDto>(
        result.data as StartInventoryRevisionResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async previewInventoryRevision(
    request: InventoryRevisionScratchRequestDto,
  ): Promise<InventoryRevisionPreviewDto> {
    try {
      const result = await this.#client.POST(
        '/inventory/revision-edits/preview',
        { body: request },
      );
      return unwrap<InventoryRevisionPreviewDto>(
        result.data as InventoryRevisionPreviewDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async promoteAnalysisToInventoryRevision(
    itemId: string,
    request: PromoteAnalysisToInventoryRevisionRequestDto,
  ): Promise<StartInventoryRevisionResultDto> {
    try {
      const result = await this.#client.POST(
        '/inventory/items/{itemId}/revision-edits/promote-analysis',
        { params: { path: { itemId } }, body: request },
      );
      return unwrap<StartInventoryRevisionResultDto>(
        result.data as StartInventoryRevisionResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async saveInventoryRevision(
    request: SaveInventoryRevisionRequestDto,
  ): Promise<SaveInventoryRevisionResultDto> {
    try {
      const result = await this.#client.POST('/inventory/revision-edits/save', {
        body: request,
      });
      return unwrap<SaveInventoryRevisionResultDto>(
        result.data as SaveInventoryRevisionResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getInventoryRevision(
    itemId: string,
    revisionId: string,
    request: InventoryRevisionReadRequestDto,
  ): Promise<AnalysisRecordDto> {
    try {
      const result = await this.#client.GET(
        '/inventory/items/{itemId}/revisions/{revisionId}',
        {
          params: {
            path: { itemId, revisionId },
            query: request,
          },
        },
      );
      return unwrap<AnalysisRecordDto>(
        result.data as AnalysisRecordDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async listInventoryRevisions(
    itemId: string,
    request: ListInventoryRevisionsRequestDto,
  ): Promise<ListInventoryRevisionsResultDto> {
    try {
      const result = await this.#client.GET(
        '/inventory/items/{itemId}/revisions',
        { params: { path: { itemId }, query: request } },
      );
      return unwrap<ListInventoryRevisionsResultDto>(
        result.data as ListInventoryRevisionsResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getPendingRevisionImpact(
    impactId: string,
  ): Promise<PendingRevisionImpactDto> {
    try {
      const result = await this.#client.GET(
        '/workspace/revision-impacts/{impactId}',
        { params: { path: { impactId } } },
      );
      return unwrap<PendingRevisionImpactDto>(
        result.data as PendingRevisionImpactDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async resolvePendingRevisionImpact(
    impactId: string,
    request: ResolvePendingRevisionImpactRequestDto,
  ): Promise<ResolvePendingRevisionImpactResultDto> {
    try {
      const result = await this.#client.POST(
        '/workspace/revision-impacts/{impactId}/resolution',
        { params: { path: { impactId } }, body: request },
      );
      return unwrap<ResolvePendingRevisionImpactResultDto>(
        result.data as ResolvePendingRevisionImpactResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async listWorkingContexts(
    request: ListWorkingContextsRequestDto,
  ): Promise<ListWorkingContextsResultDto> {
    try {
      const result = await this.#client.GET('/working-contexts', {
        params: { query: request },
      });
      return unwrap<ListWorkingContextsResultDto>(
        result.data as unknown as ListWorkingContextsResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getWorkingContextWorkspace(
    contextId: string,
  ): Promise<WorkingContextWorkspaceDto> {
    try {
      const result = await this.#client.GET('/working-contexts/{contextId}', {
        params: { path: { contextId } },
      });
      return unwrap<WorkingContextWorkspaceDto>(
        result.data as unknown as WorkingContextWorkspaceDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async updateWorkingContextMetadata(
    contextId: string,
    request: UpdateWorkingContextMetadataRequestDto,
  ): Promise<CreateWorkingContextResultDto> {
    try {
      const result = await this.#client.PUT(
        '/working-contexts/{contextId}/metadata',
        {
          params: { path: { contextId } },
          body: request,
        },
      );
      return unwrap<CreateWorkingContextResultDto>(
        result.data as unknown as CreateWorkingContextResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async createWorkingContext(
    request: CreateWorkingContextRequestDto,
  ): Promise<CreateWorkingContextResultDto> {
    try {
      const result = await this.#client.POST('/working-contexts', {
        body: request,
      });
      return unwrap<CreateWorkingContextResultDto>(
        result.data as unknown as CreateWorkingContextResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async addContextReference(
    contextId: string,
    request: AddContextReferenceRequestDto,
  ): Promise<AddContextReferenceResultDto> {
    try {
      const result = await this.#client.POST(
        '/working-contexts/{contextId}/references',
        { params: { path: { contextId } }, body: request },
      );
      return unwrap<AddContextReferenceResultDto>(
        result.data as unknown as AddContextReferenceResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async removeContextItem(
    contextId: string,
    itemId: string,
    request: RemoveContextItemRequestDto,
  ): Promise<RemoveContextItemResultDto> {
    try {
      const result = await this.#client.DELETE(
        '/working-contexts/{contextId}/items/{itemId}',
        { params: { path: { contextId, itemId } }, body: request },
      );
      return unwrap<RemoveContextItemResultDto>(
        result.data as RemoveContextItemResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async setWorkScopeResume(
    request: SetWorkScopeResumeRequestDto,
  ): Promise<SetWorkScopeResumeResultDto> {
    try {
      const result = await this.#client.PUT('/workspace/resume', {
        body: request,
      });
      return unwrap<SetWorkScopeResumeResultDto>(
        result.data as unknown as SetWorkScopeResumeResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async setManagementPresentation(
    request: SetManagementPresentationRequestDto,
  ): Promise<SetManagementPresentationResultDto> {
    try {
      const result = await this.#client.PUT(
        '/workspace/management-presentation',
        { body: request },
      );
      return unwrap<SetManagementPresentationResultDto>(
        result.data as SetManagementPresentationResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async listMovePolicyProviders(): Promise<ListMovePolicyProvidersResultDto> {
    try {
      const result = await this.#client.GET('/playout/providers');
      return unwrap<ListMovePolicyProvidersResultDto>(
        result.data as unknown as ListMovePolicyProvidersResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getPlayout(request: {
    readonly scopeKind: 'free' | 'context';
    readonly contextId?: string;
  }): Promise<PlayoutDto | null> {
    try {
      const result = await this.#client.GET('/playout', {
        params: { query: request },
      });
      return unwrap<PlayoutDto | null>(
        result.data as unknown as PlayoutDto | null | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async startPlayout(request: StartPlayoutRequestDto): Promise<PlayoutDto> {
    try {
      const result = await this.#client.POST('/playout', { body: request });
      return unwrap<PlayoutDto>(
        result.data as unknown as PlayoutDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async submitPlayoutMove(
    request: SubmitPlayoutMoveRequestDto,
  ): Promise<PlayoutDto> {
    try {
      const result = await this.#client.POST('/playout/moves', {
        body: request,
      });
      return unwrap<PlayoutDto>(
        result.data as unknown as PlayoutDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async retryPlayout(request: ExpectedPlayoutRequestDto): Promise<PlayoutDto> {
    return this.#playoutCommand('/playout/retry', request);
  }

  async pausePlayout(request: ExpectedPlayoutRequestDto): Promise<PlayoutDto> {
    return this.#playoutCommand('/playout/pause', request);
  }

  async resumePlayout(request: ExpectedPlayoutRequestDto): Promise<PlayoutDto> {
    return this.#playoutCommand('/playout/resume', request);
  }

  async stopPlayout(request: ExpectedPlayoutRequestDto): Promise<PlayoutDto> {
    return this.#playoutCommand('/playout/stop', request);
  }

  async cancelPlayoutCompletion(
    request: ExpectedPlayoutRequestDto,
  ): Promise<PlayoutDto> {
    return this.#playoutCommand('/playout/cancel-completion', request);
  }

  async completePlayout(
    request: CompletePlayoutRequestDto,
  ): Promise<CompletePlayoutResultDto> {
    try {
      const result = await this.#client.POST('/playout/complete', {
        body: request,
      });
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async discardPlayout(
    request: ExpectedPlayoutRequestDto,
  ): Promise<DiscardPlayoutResultDto> {
    try {
      const result = await this.#client.DELETE('/playout', { body: request });
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getEngineProviderConfigurations(): Promise<ListEngineProviderConfigurationsResultDto> {
    try {
      const result = await this.#client.GET('/engine-providers/configurations');
      return unwrap<ListEngineProviderConfigurationsResultDto>(
        result.data as unknown as
          ListEngineProviderConfigurationsResultDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async previewEngineProviderConfiguration(
    request: EngineProviderConfigurationInputDto,
  ): Promise<EngineProviderConfigurationPreviewDto> {
    try {
      const result = await this.#client.POST(
        '/engine-providers/configuration-preview',
        { body: request },
      );
      return unwrap<EngineProviderConfigurationPreviewDto>(
        result.data as unknown as
          EngineProviderConfigurationPreviewDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async saveEngineProviderConfiguration(
    instanceId: string,
    request: SaveEngineProviderConfigurationRequestDto,
  ): Promise<EngineProviderConfigurationDto> {
    try {
      const result = await this.#client.PUT(
        '/engine-providers/configurations/{instanceId}',
        { params: { path: { instanceId } }, body: request },
      );
      return unwrap<EngineProviderConfigurationDto>(
        result.data as unknown as EngineProviderConfigurationDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async removeEngineProviderConfiguration(
    instanceId: string,
    request: { readonly expectedConfigurationRevision: string },
  ): Promise<EngineProviderConfigurationDto> {
    try {
      const result = await this.#client.DELETE(
        '/engine-providers/configurations/{instanceId}',
        { params: { path: { instanceId } }, body: request },
      );
      return unwrap<EngineProviderConfigurationDto>(
        result.data as unknown as EngineProviderConfigurationDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async #playoutCommand(
    path:
      | '/playout/retry'
      | '/playout/pause'
      | '/playout/resume'
      | '/playout/stop'
      | '/playout/cancel-completion',
    request: ExpectedPlayoutRequestDto,
  ): Promise<PlayoutDto> {
    try {
      const result = await this.#client.POST(path, { body: request });
      return unwrap<PlayoutDto>(
        result.data as unknown as PlayoutDto | undefined,
        result.error,
      );
    } catch (error) {
      throw normalizeClientError(error);
    }
  }
}

export async function connectHost(
  connection: HostConnection,
  options: PlysmithHostClientOptions = {},
): Promise<PlysmithHostClient> {
  if (
    connection.productRelease !== productRelease ||
    connection.contractFingerprint !== contractFingerprint
  ) {
    throw localHostProblem('host.contract_mismatch');
  }
  const client = new PlysmithHostClient(connection, options);
  const status = await client.getSystemStatus();
  if (
    status.productRelease !== productRelease ||
    status.contractFingerprint !== contractFingerprint
  ) {
    throw localHostProblem('host.contract_mismatch');
  }
  return client;
}

function unwrap<T>(data: T | undefined, error: SafeHostProblem | undefined): T {
  if (data !== undefined) {
    return data;
  }
  if (error !== undefined) {
    throw new HostClientProblem(error);
  }
  throw localHostProblem('host.unavailable');
}

function normalizeClientError(error: unknown): HostClientProblem {
  return error instanceof HostClientProblem
    ? error
    : localHostProblem('host.unavailable');
}
