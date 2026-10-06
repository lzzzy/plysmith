import {
  connectHost,
  type LiveStateDto,
  type LiveSavedDto,
  type LiveCommandRequestDto,
  type SaveLiveGameRequestDto,
  type LiveProviderConfigurationDto,
  type SaveLiveProviderConfigurationRequestDto,
  type RegisterImportInputRequestDto,
  type ImportInputDescriptorDto,
  type PrepareImportRequestDto,
  type ImportPreviewDto,
  type CheckImportNamesRequestDto,
  type ImportNameChecksDto,
  type DiscardImportRequestDto,
  type DiscardImportResultDto,
  type CancelImportPreparationRequestDto,
  type CancelImportPreparationResultDto,
  type PublishImportRequestDto,
  type ImportPublishedDto,
  type ContextRemovalPreviewDto,
  type InventoryItemDeletionPreviewDto,
  type WorkScopeWorkspaceDto,
  type StartupResumeDto,
  type SetStartupResumeRequestDto,
  type DeleteWorkingContextRequestDto,
  type DeleteInventoryItemRequestDto,
  type RemoveContextItemRequestDto,
  type DeleteWorkingContextResultDto,
  type DeleteInventoryItemResultDto,
  type GetWorkScopeWorkspaceRequestDto,
  type PlysmithHostClient,
  type PlysmithHostClientOptions,
  type SetUiLanguageResultDto,
  type SystemStatusDto,
  type UserPreferencesDto,
  type AddContextReferenceRequestDto,
  type AddContextReferenceResultDto,
  type RemoveContextItemResultDto,
  type AnalysisWorkspaceDto,
  type AnalyzePositionRequestDto,
  type ListPositionAnalysisProvidersResultDto,
  type PositionAnalysisSnapshotDto,
  type AnalysisRecordDto,
  type AnalysisNoteMutationResultDto,
  type CreateAnalysisRecordRequestDto,
  type CreateAnalysisRecordResultDto,
  type CreateAnalysisNoteRequestDto,
  type CreateAnalysisNoteResultDto,
  type CreateDiagnosticReportRequestDto,
  type CreateDiagnosticReportResultDto,
  type CreatePositionNoteRequestDto,
  type DeleteAnalysisNoteRequestDto,
  type DiagnosticReportManifestDto,
  type DiagnosticSettingsDto,
  type CreateWorkingContextRequestDto,
  type UpdateWorkingContextMetadataRequestDto,
  type CreateWorkingContextResultDto,
  type GetAnalysisWorkspaceRequestDto,
  type ListWorkingContextsRequestDto,
  type ListWorkingContextsResultDto,
  type ListInventoryRevisionsRequestDto,
  type ListInventoryRevisionsResultDto,
  type InventoryRevisionReadRequestDto,
  type InventoryRevisionScratchRequestDto,
  type InventoryRevisionPreviewDto,
  type PendingRevisionImpactDto,
  type PromoteAnalysisToInventoryRevisionRequestDto,
  type ResolvePendingRevisionImpactRequestDto,
  type ResolvePendingRevisionImpactResultDto,
  type SaveInventoryRevisionRequestDto,
  type SaveInventoryRevisionResultDto,
  type SearchInventoryRequestDto,
  type GetInventoryOrganizationRequestDto,
  type InventoryOrganizationDto,
  type ChangeInventoryOrganizationRequestDto,
  type ChangeInventoryOrganizationResultDto,
  type PreviewContextFolderRemovalRequestDto,
  type ContextFolderRemovalPreviewDto,
  type CheckInventoryNameAvailabilityRequestDto,
  type InventoryNameAvailabilityDto,
  type SearchInventoryResultDto,
  type SetDiagnosticLogLevelRequestDto,
  type SetDiagnosticLogLevelResultDto,
  type SetWorkScopeResumeRequestDto,
  type SetWorkScopeResumeResultDto,
  type SetManagementPresentationRequestDto,
  type SetManagementPresentationResultDto,
  type StartInventoryRevisionRequestDto,
  type StartInventoryRevisionResultDto,
  type UpdateAnalysisScratchRequestDto,
  type UpdateAnalysisScratchResultDto,
  type UpdateAnalysisNoteRequestDto,
  type ValidateAnalysisSetupRequestDto,
  type ValidateAnalysisSetupResultDto,
  type WorkingContextWorkspaceDto,
  type CompletePlayoutRequestDto,
  type CompletePlayoutResultDto,
  type DiscardPlayoutResultDto,
  type ExpectedPlayoutRequestDto,
  type ListMovePolicyProvidersResultDto,
  type PlayoutDto,
  type StartPlayoutRequestDto,
  type SubmitPlayoutMoveRequestDto,
  type EngineProviderConfigurationInputDto,
  type EngineProviderConfigurationDto,
  type ListEngineProviderConfigurationsResultDto,
  type EngineProviderConfigurationPreviewDto,
  type SaveEngineProviderConfigurationRequestDto,
} from './host-client.ts';
import { HostClientProblem, localHostProblem } from './host-client-problem.ts';
import type { HostConnection } from './host-fetch.ts';

export type DiscoverHost = () => Promise<HostConnection>;

export class RediscoveringHostClient {
  readonly #discover: DiscoverHost;
  readonly #options: PlysmithHostClientOptions;
  #connected:
    | {
        readonly connection: HostConnection;
        readonly client: PlysmithHostClient;
      }
    | undefined;

  constructor(discover: DiscoverHost, options: PlysmithHostClientOptions = {}) {
    this.#discover = discover;
    this.#options = options;
  }

  async attach(): Promise<void> {
    await this.#currentClient();
  }

  async registerImportInput(
    request: RegisterImportInputRequestDto,
  ): Promise<ImportInputDescriptorDto> {
    return (await this.#currentClient()).registerImportInput(request);
  }

  getLiveState(): Promise<LiveStateDto> {
    return this.#read((client) => client.getLiveState());
  }
  async liveCommand(request: LiveCommandRequestDto): Promise<LiveStateDto> {
    return (await this.#currentClient()).liveCommand(request);
  }
  async observeLiveGame(
    request: Omit<Extract<LiveCommandRequestDto, { kind: 'observe' }>, 'kind'>,
  ): Promise<LiveStateDto> {
    return (await this.#currentClient()).observeLiveGame(request);
  }
  async playLiveGame(
    request: Omit<Extract<LiveCommandRequestDto, { kind: 'play' }>, 'kind'>,
  ): Promise<LiveStateDto> {
    return (await this.#currentClient()).playLiveGame(request);
  }
  async selectLivePosition(
    request: Omit<Extract<LiveCommandRequestDto, { kind: 'select' }>, 'kind'>,
  ): Promise<LiveStateDto> {
    return (await this.#currentClient()).selectLivePosition(request);
  }
  async submitLiveMove(
    request: Omit<Extract<LiveCommandRequestDto, { kind: 'move' }>, 'kind'>,
  ): Promise<LiveStateDto> {
    return (await this.#currentClient()).submitLiveMove(request);
  }
  async actLiveGame(
    request: Omit<Extract<LiveCommandRequestDto, { kind: 'act' }>, 'kind'>,
  ): Promise<LiveStateDto> {
    return (await this.#currentClient()).actLiveGame(request);
  }
  async refreshLiveGame(request: {
    readonly expectedRevision: number;
  }): Promise<LiveStateDto> {
    return (await this.#currentClient()).refreshLiveGame(request);
  }
  async disconnectLiveGame(request: {
    readonly expectedRevision: number;
  }): Promise<LiveStateDto> {
    return (await this.#currentClient()).disconnectLiveGame(request);
  }
  async discardLiveGame(request: {
    readonly expectedRevision: number;
  }): Promise<LiveStateDto> {
    return (await this.#currentClient()).discardLiveGame(request);
  }
  async saveLiveGame(request: SaveLiveGameRequestDto): Promise<LiveSavedDto> {
    return (await this.#currentClient()).saveLiveGame(request);
  }
  getLiveProviderConfiguration(): Promise<LiveProviderConfigurationDto> {
    return this.#read((client) => client.getLiveProviderConfiguration());
  }
  async saveLiveProviderConfiguration(
    request: SaveLiveProviderConfigurationRequestDto,
  ): Promise<LiveProviderConfigurationDto> {
    return (await this.#currentClient()).saveLiveProviderConfiguration(request);
  }

  async prepareImport(
    request: PrepareImportRequestDto,
  ): Promise<ImportPreviewDto> {
    return (await this.#currentClient()).prepareImport(request);
  }
  async checkImportNames(
    request: CheckImportNamesRequestDto,
  ): Promise<ImportNameChecksDto> {
    return (await this.#currentClient()).checkImportNames(request);
  }
  async cancelImportPreparation(
    request: CancelImportPreparationRequestDto,
  ): Promise<CancelImportPreparationResultDto> {
    return (await this.#currentClient()).cancelImportPreparation(request);
  }
  async publishImport(
    request: PublishImportRequestDto,
  ): Promise<ImportPublishedDto> {
    return (await this.#currentClient()).publishImport(request);
  }
  async discardImport(
    request: DiscardImportRequestDto,
  ): Promise<DiscardImportResultDto> {
    return (await this.#currentClient()).discardImport(request);
  }

  async getWorkScopeWorkspace(
    request: GetWorkScopeWorkspaceRequestDto,
  ): Promise<WorkScopeWorkspaceDto> {
    return this.#read((client) => client.getWorkScopeWorkspace(request));
  }

  async getStartupResume(): Promise<StartupResumeDto> {
    return this.#read((client) => client.getStartupResume());
  }

  async setStartupResume(
    request: SetStartupResumeRequestDto,
  ): Promise<StartupResumeDto> {
    return (await this.#currentClient()).setStartupResume(request);
  }

  async previewContextItemRemoval(
    contextId: string,
    itemId: string,
  ): Promise<ContextRemovalPreviewDto> {
    return this.#read((client) =>
      client.previewContextItemRemoval(contextId, itemId),
    );
  }

  async previewWorkingContextDeletion(
    contextId: string,
  ): Promise<ContextRemovalPreviewDto> {
    return this.#read((client) =>
      client.previewWorkingContextDeletion(contextId),
    );
  }

  async deleteWorkingContext(
    contextId: string,
    request: DeleteWorkingContextRequestDto,
  ): Promise<DeleteWorkingContextResultDto> {
    return (await this.#currentClient()).deleteWorkingContext(
      contextId,
      request,
    );
  }

  async previewInventoryItemDeletion(
    itemId: string,
  ): Promise<InventoryItemDeletionPreviewDto> {
    return this.#read((client) => client.previewInventoryItemDeletion(itemId));
  }

  async deleteInventoryItem(
    itemId: string,
    request: DeleteInventoryItemRequestDto,
  ): Promise<DeleteInventoryItemResultDto> {
    return (await this.#currentClient()).deleteInventoryItem(itemId, request);
  }

  async getSystemStatus(): Promise<SystemStatusDto> {
    return this.#read((client) => client.getSystemStatus());
  }

  async getUserPreferences(): Promise<UserPreferencesDto> {
    return this.#read((client) => client.getUserPreferences());
  }

  async setUiLanguage(request: {
    readonly uiLocale: 'de-DE' | 'en-GB';
    readonly expectedRevision: number;
  }): Promise<SetUiLanguageResultDto> {
    const client = await this.#currentClient();
    return client.setUiLanguage(request);
  }

  async getDiagnosticSettings(): Promise<DiagnosticSettingsDto> {
    return this.#read((client) => client.getDiagnosticSettings());
  }

  async setDiagnosticLogLevel(
    request: SetDiagnosticLogLevelRequestDto,
  ): Promise<SetDiagnosticLogLevelResultDto> {
    return (await this.#currentClient()).setDiagnosticLogLevel(request);
  }

  async getDiagnosticReportManifest(): Promise<DiagnosticReportManifestDto> {
    return this.#read((client) => client.getDiagnosticReportManifest());
  }

  async createDiagnosticReport(
    request: CreateDiagnosticReportRequestDto,
  ): Promise<CreateDiagnosticReportResultDto> {
    return (await this.#currentClient()).createDiagnosticReport(request);
  }

  async getAnalysisWorkspace(
    request: GetAnalysisWorkspaceRequestDto,
  ): Promise<AnalysisWorkspaceDto> {
    return this.#read((client) => client.getAnalysisWorkspace(request));
  }

  async listPositionAnalysisProviders(): Promise<ListPositionAnalysisProvidersResultDto> {
    return this.#read((client) => client.listPositionAnalysisProviders());
  }

  async analyzePosition(
    request: AnalyzePositionRequestDto,
  ): Promise<PositionAnalysisSnapshotDto> {
    return (await this.#currentClient()).analyzePosition(request);
  }

  async validateAnalysisSetup(
    request: ValidateAnalysisSetupRequestDto,
  ): Promise<ValidateAnalysisSetupResultDto> {
    return this.#read((client) => client.validateAnalysisSetup(request));
  }

  async updateAnalysisScratch(
    request: UpdateAnalysisScratchRequestDto,
  ): Promise<UpdateAnalysisScratchResultDto> {
    return (await this.#currentClient()).updateAnalysisScratch(request);
  }

  async createAnalysisRecord(
    request: CreateAnalysisRecordRequestDto,
  ): Promise<CreateAnalysisRecordResultDto> {
    return (await this.#currentClient()).createAnalysisRecord(request);
  }

  async createAnalysisNote(
    request: CreateAnalysisNoteRequestDto,
  ): Promise<CreateAnalysisNoteResultDto> {
    return (await this.#currentClient()).createAnalysisNote(request);
  }

  async createPositionNote(
    request: CreatePositionNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto> {
    return (await this.#currentClient()).createPositionNote(request);
  }

  async updateAnalysisNote(
    contributionId: string,
    request: UpdateAnalysisNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto> {
    return (await this.#currentClient()).updateAnalysisNote(
      contributionId,
      request,
    );
  }

  async deleteAnalysisNote(
    contributionId: string,
    request: DeleteAnalysisNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto> {
    return (await this.#currentClient()).deleteAnalysisNote(
      contributionId,
      request,
    );
  }

  async getInventoryOrganization(
    request: GetInventoryOrganizationRequestDto,
  ): Promise<InventoryOrganizationDto> {
    return this.#read((client) => client.getInventoryOrganization(request));
  }

  async changeInventoryOrganization(
    request: ChangeInventoryOrganizationRequestDto,
  ): Promise<ChangeInventoryOrganizationResultDto> {
    return (await this.#currentClient()).changeInventoryOrganization(request);
  }

  async previewContextFolderRemoval(
    request: PreviewContextFolderRemovalRequestDto,
  ): Promise<ContextFolderRemovalPreviewDto> {
    return this.#read((client) => client.previewContextFolderRemoval(request));
  }

  async checkInventoryNameAvailability(
    request: CheckInventoryNameAvailabilityRequestDto,
  ): Promise<InventoryNameAvailabilityDto> {
    return this.#read((client) =>
      client.checkInventoryNameAvailability(request),
    );
  }

  async searchInventory(
    request: SearchInventoryRequestDto,
  ): Promise<SearchInventoryResultDto> {
    return this.#read((client) => client.searchInventory(request));
  }

  async startInventoryRevision(
    itemId: string,
    request: StartInventoryRevisionRequestDto,
  ): Promise<StartInventoryRevisionResultDto> {
    return (await this.#currentClient()).startInventoryRevision(
      itemId,
      request,
    );
  }

  async previewInventoryRevision(
    request: InventoryRevisionScratchRequestDto,
  ): Promise<InventoryRevisionPreviewDto> {
    return this.#read((client) => client.previewInventoryRevision(request));
  }

  async promoteAnalysisToInventoryRevision(
    itemId: string,
    request: PromoteAnalysisToInventoryRevisionRequestDto,
  ): Promise<StartInventoryRevisionResultDto> {
    return (await this.#currentClient()).promoteAnalysisToInventoryRevision(
      itemId,
      request,
    );
  }

  async saveInventoryRevision(
    request: SaveInventoryRevisionRequestDto,
  ): Promise<SaveInventoryRevisionResultDto> {
    return (await this.#currentClient()).saveInventoryRevision(request);
  }

  async getInventoryRevision(
    itemId: string,
    revisionId: string,
    request: InventoryRevisionReadRequestDto,
  ): Promise<AnalysisRecordDto> {
    return this.#read((client) =>
      client.getInventoryRevision(itemId, revisionId, request),
    );
  }

  async listInventoryRevisions(
    itemId: string,
    request: ListInventoryRevisionsRequestDto,
  ): Promise<ListInventoryRevisionsResultDto> {
    return this.#read((client) =>
      client.listInventoryRevisions(itemId, request),
    );
  }

  async getPendingRevisionImpact(
    impactId: string,
  ): Promise<PendingRevisionImpactDto> {
    return this.#read((client) => client.getPendingRevisionImpact(impactId));
  }

  async resolvePendingRevisionImpact(
    impactId: string,
    request: ResolvePendingRevisionImpactRequestDto,
  ): Promise<ResolvePendingRevisionImpactResultDto> {
    return (await this.#currentClient()).resolvePendingRevisionImpact(
      impactId,
      request,
    );
  }

  async listWorkingContexts(
    request: ListWorkingContextsRequestDto,
  ): Promise<ListWorkingContextsResultDto> {
    return this.#read((client) => client.listWorkingContexts(request));
  }

  async getWorkingContextWorkspace(
    contextId: string,
  ): Promise<WorkingContextWorkspaceDto> {
    return this.#read((client) => client.getWorkingContextWorkspace(contextId));
  }

  async updateWorkingContextMetadata(
    contextId: string,
    request: UpdateWorkingContextMetadataRequestDto,
  ): Promise<CreateWorkingContextResultDto> {
    return (await this.#currentClient()).updateWorkingContextMetadata(
      contextId,
      request,
    );
  }

  async createWorkingContext(
    request: CreateWorkingContextRequestDto,
  ): Promise<CreateWorkingContextResultDto> {
    return (await this.#currentClient()).createWorkingContext(request);
  }

  async addContextReference(
    contextId: string,
    request: AddContextReferenceRequestDto,
  ): Promise<AddContextReferenceResultDto> {
    return (await this.#currentClient()).addContextReference(
      contextId,
      request,
    );
  }

  async removeContextItem(
    contextId: string,
    itemId: string,
    request: RemoveContextItemRequestDto,
  ): Promise<RemoveContextItemResultDto> {
    return (await this.#currentClient()).removeContextItem(
      contextId,
      itemId,
      request,
    );
  }

  async setWorkScopeResume(
    request: SetWorkScopeResumeRequestDto,
  ): Promise<SetWorkScopeResumeResultDto> {
    return (await this.#currentClient()).setWorkScopeResume(request);
  }

  async setManagementPresentation(
    request: SetManagementPresentationRequestDto,
  ): Promise<SetManagementPresentationResultDto> {
    return (await this.#currentClient()).setManagementPresentation(request);
  }

  async listMovePolicyProviders(): Promise<ListMovePolicyProvidersResultDto> {
    return this.#read((client) => client.listMovePolicyProviders());
  }

  async getPlayout(request: {
    readonly scopeKind: 'free' | 'context';
    readonly contextId?: string;
  }): Promise<PlayoutDto | null> {
    return this.#read((client) => client.getPlayout(request));
  }

  async startPlayout(request: StartPlayoutRequestDto): Promise<PlayoutDto> {
    return (await this.#currentClient()).startPlayout(request);
  }

  async submitPlayoutMove(
    request: SubmitPlayoutMoveRequestDto,
  ): Promise<PlayoutDto> {
    return (await this.#currentClient()).submitPlayoutMove(request);
  }

  async retryPlayout(request: ExpectedPlayoutRequestDto): Promise<PlayoutDto> {
    return (await this.#currentClient()).retryPlayout(request);
  }

  async pausePlayout(request: ExpectedPlayoutRequestDto): Promise<PlayoutDto> {
    return (await this.#currentClient()).pausePlayout(request);
  }

  async resumePlayout(request: ExpectedPlayoutRequestDto): Promise<PlayoutDto> {
    return (await this.#currentClient()).resumePlayout(request);
  }

  async stopPlayout(request: ExpectedPlayoutRequestDto): Promise<PlayoutDto> {
    return (await this.#currentClient()).stopPlayout(request);
  }

  async cancelPlayoutCompletion(
    request: ExpectedPlayoutRequestDto,
  ): Promise<PlayoutDto> {
    return (await this.#currentClient()).cancelPlayoutCompletion(request);
  }

  async completePlayout(
    request: CompletePlayoutRequestDto,
  ): Promise<CompletePlayoutResultDto> {
    return (await this.#currentClient()).completePlayout(request);
  }

  async discardPlayout(
    request: ExpectedPlayoutRequestDto,
  ): Promise<DiscardPlayoutResultDto> {
    return (await this.#currentClient()).discardPlayout(request);
  }

  async getEngineProviderConfigurations(): Promise<ListEngineProviderConfigurationsResultDto> {
    return this.#read((client) => client.getEngineProviderConfigurations());
  }

  async previewEngineProviderConfiguration(
    request: EngineProviderConfigurationInputDto,
  ): Promise<EngineProviderConfigurationPreviewDto> {
    return this.#read((client) =>
      client.previewEngineProviderConfiguration(request),
    );
  }

  async saveEngineProviderConfiguration(
    instanceId: string,
    request: SaveEngineProviderConfigurationRequestDto,
  ): Promise<EngineProviderConfigurationDto> {
    return (await this.#currentClient()).saveEngineProviderConfiguration(
      instanceId,
      request,
    );
  }

  async removeEngineProviderConfiguration(
    instanceId: string,
    request: { readonly expectedConfigurationRevision: string },
  ): Promise<EngineProviderConfigurationDto> {
    return (await this.#currentClient()).removeEngineProviderConfiguration(
      instanceId,
      request,
    );
  }

  async #read<T>(operation: (client: PlysmithHostClient) => Promise<T>) {
    try {
      return await operation(await this.#currentClient());
    } catch (error) {
      if (!isHostUnavailable(error)) {
        throw error;
      }
      return operation(await this.#currentClient(true));
    }
  }

  async #currentClient(forceReconnect = false): Promise<PlysmithHostClient> {
    const connection = await this.#discoverConnection();
    if (
      !forceReconnect &&
      this.#connected !== undefined &&
      sameConnection(this.#connected.connection, connection)
    ) {
      return this.#connected.client;
    }

    const client = await connectHost(connection, this.#options);
    this.#connected = { connection, client };
    return client;
  }

  async #discoverConnection(): Promise<HostConnection> {
    try {
      return await this.#discover();
    } catch (error) {
      if (error instanceof HostClientProblem) {
        throw error;
      }
      throw localHostProblem('host.unavailable');
    }
  }
}

export async function connectRediscoveringHost(
  discover: DiscoverHost,
  options: PlysmithHostClientOptions = {},
): Promise<RediscoveringHostClient> {
  const client = new RediscoveringHostClient(discover, options);
  await client.attach();
  return client;
}

function sameConnection(left: HostConnection, right: HostConnection): boolean {
  return (
    left.endpoint === right.endpoint &&
    left.productRelease === right.productRelease &&
    left.contractFingerprint === right.contractFingerprint &&
    left.token === right.token
  );
}

function isHostUnavailable(error: unknown): boolean {
  return (
    error instanceof HostClientProblem &&
    error.problem.code === 'host.unavailable'
  );
}
