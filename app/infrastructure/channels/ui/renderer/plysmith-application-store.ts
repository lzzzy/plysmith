import {
  HostClientProblem,
  HostEventClient,
  PlysmithHostClient,
  type AddContextReferenceRequestDto,
  type AddContextReferenceResultDto,
  type AnalyzePositionRequestDto,
  type RemoveContextItemResultDto,
  type AnalysisNoteMutationResultDto,
  type AnalysisRecordDto,
  type AnalysisWorkspaceDto,
  type CreateAnalysisRecordRequestDto,
  type CreateAnalysisRecordResultDto,
  type CreateAnalysisNoteRequestDto,
  type CreateAnalysisNoteResultDto,
  type CreateDiagnosticReportRequestDto,
  type CreateDiagnosticReportResultDto,
  type CreatePositionNoteRequestDto,
  type CreateWorkingContextRequestDto,
  type CreateWorkingContextResultDto,
  type GetAnalysisWorkspaceRequestDto,
  type DiagnosticReportManifestDto,
  type DiagnosticSettingsDto,
  type HostConnection,
  type HostEvent,
  type HostRequestDiagnostic,
  type ListWorkingContextsRequestDto,
  type ListWorkingContextsResultDto,
  type InventoryRevisionPreviewDto,
  type InventoryRevisionScratchRequestDto,
  type PendingRevisionImpactDto,
  type CompletePlayoutRequestDto,
  type CompletePlayoutResultDto,
  type ExpectedPlayoutRequestDto,
  type ListMovePolicyProvidersResultDto,
  type ListPositionAnalysisProvidersResultDto,
  type PlayoutDto,
  type PositionAnalysisSnapshotDto,
  type StartPlayoutRequestDto,
  type SubmitPlayoutMoveRequestDto,
  type EngineProviderConfigurationInputDto,
  type EngineProviderConfigurationDto,
  type EngineProviderConfigurationPreviewDto,
  type ListEngineProviderConfigurationsResultDto,
  type PromoteAnalysisToInventoryRevisionRequestDto,
  type ResolvePendingRevisionImpactRequestDto,
  type ResolvePendingRevisionImpactResultDto,
  type SaveInventoryRevisionRequestDto,
  type SaveInventoryRevisionResultDto,
  type SearchInventoryRequestDto,
  type SearchInventoryResultDto,
  type SetUiLanguageResultDto,
  type SetDiagnosticLogLevelRequestDto,
  type SetDiagnosticLogLevelResultDto,
  type SetWorkScopeResumeRequestDto,
  type SetWorkScopeResumeResultDto,
  type SetManagementPresentationRequestDto,
  type StartInventoryRevisionRequestDto,
  type StartInventoryRevisionResultDto,
  type SystemStatusDto,
  type DeleteAnalysisNoteRequestDto,
  type UpdateAnalysisScratchRequestDto,
  type UpdateAnalysisScratchResultDto,
  type UpdateAnalysisNoteRequestDto,
  type UserPreferencesDto,
  type ValidateAnalysisSetupRequestDto,
  type ValidateAnalysisSetupResultDto,
  type WorkingContextWorkspaceDto,
  type WorkScopeWorkspaceDto,
  type StartupResumeDto,
  type SetStartupResumeRequestDto,
  type ContextRemovalPreviewDto,
  type InventoryItemDeletionPreviewDto,
  type RemoveContextItemRequestDto,
  type DeleteWorkingContextRequestDto,
  type DeleteInventoryItemRequestDto,
  type UpdateWorkingContextMetadataRequestDto,
} from '../../host_client/index.ts';
import type {
  DesktopBootstrap,
  RendererDiagnosticEvent,
} from '../desktop/contract.ts';
import { localizeSan } from './chess-display.ts';
import { analysisPathPresentation } from './analysis-path-presentation.ts';
import { contextRemovalHasContentLoss } from './work-loss-presentation.ts';
import type { UiLocale } from './messages.ts';
import {
  EngineConfigurationDrafts,
  mapEngineConfigurationIssues,
  type EngineConfigurationDraftPatch,
  type EngineConfigurationDraftsState,
  type EngineConfigurationForm,
} from './engine-configuration-drafts.ts';

export type ActivityId = 'manage' | 'analyze' | 'playout' | 'settings';
export type WorkScope = AnalysisWorkspaceDto['scope'];
export type InventoryItem = SearchInventoryResultDto['items'][number];
export type InventoryOrganization = Awaited<
  ReturnType<PlysmithHostClient['getInventoryOrganization']>
>;
export type InventoryOrganizationChange = Parameters<
  PlysmithHostClient['changeInventoryOrganization']
>[0]['change'];
export type ContextFolderRemovalPreview = Awaited<
  ReturnType<PlysmithHostClient['previewContextFolderRemoval']>
>;
export type WorkingContext = ListWorkingContextsResultDto['contexts'][number];
type MoveRequest = NonNullable<StartInventoryRevisionRequestDto['firstMove']>;
type CanonicalMove = AnalysisWorkspaceDto['legalMoves'][number];
type ObjectiveBudget = Extract<
  AnalyzePositionRequestDto['mode'],
  { kind: 'objective' }
>['budget'];
export type ApplicationCommand =
  | 'change_inventory_organization'
  | 'set_language'
  | 'set_diagnostic_log_level'
  | 'create_diagnostic_report'
  | 'validate_analysis_setup'
  | 'start_scratch'
  | 'update_scratch'
  | 'prepare_note'
  | 'clear_note'
  | 'discard_scratch'
  | 'create_analysis_note'
  | 'create_position_note'
  | 'update_analysis_note'
  | 'delete_analysis_note'
  | 'create_analysis_record'
  | 'start_inventory_revision'
  | 'promote_analysis_to_inventory_revision'
  | 'remove_last_move'
  | 'prepare_inventory_metadata_revision'
  | 'save_inventory_revision'
  | 'save_managed_inventory_revision'
  | 'discard_managed_inventory_revision'
  | 'load_revision_impact'
  | 'resolve_revision_impact'
  | 'create_context'
  | 'update_context_metadata'
  | 'add_context_reference'
  | 'remove_context_item'
  | 'delete_context'
  | 'delete_inventory_item'
  | 'set_resume'
  | 'load_more_inventory'
  | 'load_more_contexts'
  | 'prepare_playout'
  | 'start_playout'
  | 'submit_playout_move'
  | 'retry_playout'
  | 'pause_playout'
  | 'resume_playout'
  | 'cancel_playout_completion'
  | 'stop_playout'
  | 'complete_playout'
  | 'discard_playout'
  | 'preview_engine_provider'
  | 'save_engine_provider'
  | 'remove_engine_provider';

export interface PlysmithApplicationClient {
  getInventoryOrganization: PlysmithHostClient['getInventoryOrganization'];
  changeInventoryOrganization: PlysmithHostClient['changeInventoryOrganization'];
  previewContextFolderRemoval: PlysmithHostClient['previewContextFolderRemoval'];
  checkInventoryNameAvailability: PlysmithHostClient['checkInventoryNameAvailability'];
  getSystemStatus(): Promise<SystemStatusDto>;
  getUserPreferences(): Promise<UserPreferencesDto>;
  setUiLanguage(request: {
    readonly uiLocale: UiLocale;
    readonly expectedRevision: number;
  }): Promise<SetUiLanguageResultDto>;
  getDiagnosticSettings(): Promise<DiagnosticSettingsDto>;
  setDiagnosticLogLevel(
    request: SetDiagnosticLogLevelRequestDto,
  ): Promise<SetDiagnosticLogLevelResultDto>;
  getDiagnosticReportManifest(): Promise<DiagnosticReportManifestDto>;
  createDiagnosticReport(
    request: CreateDiagnosticReportRequestDto,
  ): Promise<CreateDiagnosticReportResultDto>;
  getAnalysisWorkspace(
    request: GetAnalysisWorkspaceRequestDto,
  ): Promise<AnalysisWorkspaceDto>;
  validateAnalysisSetup(
    request: ValidateAnalysisSetupRequestDto,
  ): Promise<ValidateAnalysisSetupResultDto>;
  updateAnalysisScratch(
    request: UpdateAnalysisScratchRequestDto,
  ): Promise<UpdateAnalysisScratchResultDto>;
  createAnalysisRecord(
    request: CreateAnalysisRecordRequestDto,
  ): Promise<CreateAnalysisRecordResultDto>;
  startInventoryRevision(
    itemId: string,
    request: StartInventoryRevisionRequestDto,
  ): Promise<StartInventoryRevisionResultDto>;
  promoteAnalysisToInventoryRevision(
    itemId: string,
    request: PromoteAnalysisToInventoryRevisionRequestDto,
  ): Promise<StartInventoryRevisionResultDto>;
  previewInventoryRevision(
    request: InventoryRevisionScratchRequestDto,
  ): Promise<InventoryRevisionPreviewDto>;
  saveInventoryRevision(
    request: SaveInventoryRevisionRequestDto,
  ): Promise<SaveInventoryRevisionResultDto>;
  getInventoryRevision(
    itemId: string,
    revisionId: string,
    request: { readonly scopeKind: 'free' },
  ): Promise<AnalysisRecordDto>;
  getPendingRevisionImpact(impactId: string): Promise<PendingRevisionImpactDto>;
  resolvePendingRevisionImpact(
    impactId: string,
    request: ResolvePendingRevisionImpactRequestDto,
  ): Promise<ResolvePendingRevisionImpactResultDto>;
  createAnalysisNote(
    request: CreateAnalysisNoteRequestDto,
  ): Promise<CreateAnalysisNoteResultDto>;
  createPositionNote(
    request: CreatePositionNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto>;
  updateAnalysisNote(
    contributionId: string,
    request: UpdateAnalysisNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto>;
  deleteAnalysisNote(
    contributionId: string,
    request: DeleteAnalysisNoteRequestDto,
  ): Promise<AnalysisNoteMutationResultDto>;
  searchInventory(
    request: SearchInventoryRequestDto,
  ): Promise<SearchInventoryResultDto>;
  listWorkingContexts(
    request: ListWorkingContextsRequestDto,
  ): Promise<ListWorkingContextsResultDto>;
  getWorkingContextWorkspace(
    contextId: string,
  ): Promise<WorkingContextWorkspaceDto>;
  getWorkScopeWorkspace(request: {
    readonly scopeKind: WorkScope['kind'];
    readonly contextId?: string;
  }): Promise<WorkScopeWorkspaceDto>;
  getStartupResume(): Promise<StartupResumeDto>;
  setStartupResume(
    request: SetStartupResumeRequestDto,
  ): Promise<StartupResumeDto>;
  previewContextItemRemoval(
    contextId: string,
    itemId: string,
  ): Promise<ContextRemovalPreviewDto>;
  previewWorkingContextDeletion(
    contextId: string,
  ): Promise<ContextRemovalPreviewDto>;
  deleteWorkingContext(
    contextId: string,
    request: DeleteWorkingContextRequestDto,
  ): Promise<{ readonly contextId: string; readonly dataRevision: number }>;
  previewInventoryItemDeletion(
    itemId: string,
  ): Promise<InventoryItemDeletionPreviewDto>;
  deleteInventoryItem(
    itemId: string,
    request: DeleteInventoryItemRequestDto,
  ): Promise<{ readonly itemId: string; readonly dataRevision: number }>;
  createWorkingContext(
    request: CreateWorkingContextRequestDto,
  ): Promise<CreateWorkingContextResultDto>;
  updateWorkingContextMetadata(
    contextId: string,
    request: UpdateWorkingContextMetadataRequestDto,
  ): Promise<CreateWorkingContextResultDto>;
  addContextReference(
    contextId: string,
    request: AddContextReferenceRequestDto,
  ): Promise<AddContextReferenceResultDto>;
  removeContextItem(
    contextId: string,
    itemId: string,
    request: RemoveContextItemRequestDto,
  ): Promise<RemoveContextItemResultDto>;
  setWorkScopeResume(
    request: SetWorkScopeResumeRequestDto,
  ): Promise<SetWorkScopeResumeResultDto>;
  setManagementPresentation(
    request: SetManagementPresentationRequestDto,
  ): Promise<SetWorkScopeResumeResultDto>;
  listMovePolicyProviders(): Promise<ListMovePolicyProvidersResultDto>;
  listPositionAnalysisProviders(): Promise<ListPositionAnalysisProvidersResultDto>;
  analyzePosition(
    request: AnalyzePositionRequestDto,
  ): Promise<PositionAnalysisSnapshotDto>;
  getPlayout(request: {
    readonly scopeKind: 'free' | 'context';
    readonly contextId?: string;
  }): Promise<PlayoutDto | null>;
  startPlayout(request: StartPlayoutRequestDto): Promise<PlayoutDto>;
  submitPlayoutMove(request: SubmitPlayoutMoveRequestDto): Promise<PlayoutDto>;
  retryPlayout(request: ExpectedPlayoutRequestDto): Promise<PlayoutDto>;
  pausePlayout(request: ExpectedPlayoutRequestDto): Promise<PlayoutDto>;
  resumePlayout(request: ExpectedPlayoutRequestDto): Promise<PlayoutDto>;
  cancelPlayoutCompletion(
    request: ExpectedPlayoutRequestDto,
  ): Promise<PlayoutDto>;
  stopPlayout(request: ExpectedPlayoutRequestDto): Promise<PlayoutDto>;
  completePlayout(
    request: CompletePlayoutRequestDto,
  ): Promise<CompletePlayoutResultDto>;
  discardPlayout(
    request: ExpectedPlayoutRequestDto,
  ): Promise<{ readonly dataRevision: number }>;
  getEngineProviderConfigurations(): Promise<ListEngineProviderConfigurationsResultDto>;
  previewEngineProviderConfiguration(
    request: EngineProviderConfigurationInputDto,
  ): Promise<EngineProviderConfigurationPreviewDto>;
  saveEngineProviderConfiguration(
    instanceId: string,
    request: {
      readonly input: EngineProviderConfigurationInputDto;
      readonly expectedConfigurationRevision: string | null;
    },
  ): Promise<EngineProviderConfigurationDto>;
  removeEngineProviderConfiguration(
    instanceId: string,
    request: { readonly expectedConfigurationRevision: string },
  ): Promise<EngineProviderConfigurationDto>;
}

export interface HostEventSubscription {
  readonly ready: Promise<void>;
  close(): void;
}

export interface PlysmithApplicationStoreOptions {
  readonly getBootstrap: () => Promise<DesktopBootstrap>;
  readonly chooseDiagnosticReportDestination?: (
    suggestedFileName: string,
  ) => Promise<string | undefined>;
  readonly chooseEngineExecutable?: () => Promise<string | undefined>;
  readonly chooseEngineWeights?: () => Promise<string | undefined>;
  readonly recordDiagnostic?: (event: RendererDiagnosticEvent) => void;
  readonly createClient?: (
    connection: HostConnection,
  ) => PlysmithApplicationClient;
  readonly createEventSubscription?: (
    connection: HostConnection,
    onChange: (event: HostEvent) => void,
    onReconnect: () => void,
    onInvalidEvent: () => void,
  ) => HostEventSubscription;
}

interface AnalysisFocus {
  readonly itemId: string;
  readonly revisionId: string;
  readonly anchorId: string;
}

export interface PlayoutStartSelection {
  readonly title: string;
  readonly start: StartPlayoutRequestDto['start'];
  readonly workspace: AnalysisWorkspaceDto;
  readonly sourcePath?: NonNullable<PlayoutDto['draft']['sourcePath']>;
}

export interface RevisionImpactDetails {
  readonly impact: PendingRevisionImpactDto;
  readonly pinnedRevision: AnalysisRecordDto;
  readonly targetRevision: AnalysisRecordDto;
}

export interface ManageInventoryRevisionDraft {
  readonly itemId: string;
  readonly scratchId: string;
  readonly scratchRevision: number;
  readonly previousRevision: AnalysisRecordDto;
  readonly preview: InventoryRevisionPreviewDto;
}

export type InventoryDetailsRead =
  | { readonly kind: 'completed'; readonly record: AnalysisRecordDto }
  | { readonly kind: 'failed'; readonly errorCode: string }
  | { readonly kind: 'cancelled' };

export interface AnalysisUnavailable {
  readonly reason: 'removed_from_context' | 'deleted_from_inventory';
  readonly itemId: string;
  readonly displayName: string;
}

type DestructiveActionState = {
  readonly status: 'loading' | 'ready' | 'error' | 'stale' | 'submitting';
  readonly displayName: string;
  readonly errorMessageId?: string;
};

export type DestructiveAction = DestructiveActionState &
  (
    | {
        readonly kind: 'context_item';
        readonly contextId: string;
        readonly itemId: string;
        readonly preview?: ContextRemovalPreviewDto;
      }
    | {
        readonly kind: 'context';
        readonly contextId: string;
        readonly preview?: ContextRemovalPreviewDto;
      }
    | {
        readonly kind: 'inventory';
        readonly itemId: string;
        readonly preview?: InventoryItemDeletionPreviewDto;
      }
  );

interface BoundInventoryRevisionPreview {
  readonly scope: WorkScope;
  readonly scratchId: string;
  readonly scratchRevision: number;
  readonly preview: InventoryRevisionPreviewDto;
}

export type PlysmithApplicationState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'unavailable'; readonly errorCode?: string }
  | {
      readonly phase: 'ready';
      readonly status: SystemStatusDto;
      readonly preferences: UserPreferencesDto;
      readonly diagnostics: DiagnosticSettingsDto;
      readonly diagnosticReportManifest: DiagnosticReportManifestDto;
      readonly contexts: ListWorkingContextsResultDto;
      readonly inventory: SearchInventoryResultDto;
      readonly inventoryOrganization: InventoryOrganization;
      readonly selectedInventoryFolderId?: string;
      readonly inspectedInventoryFolderId?: string | null;
      readonly inventoryPresentation: 'folders' | 'origins';
      readonly analysis: AnalysisWorkspaceDto;
      readonly analysisUnavailable?: AnalysisUnavailable;
      readonly analysisProviders: ListPositionAnalysisProvidersResultDto;
      readonly playoutProviders: ListMovePolicyProvidersResultDto;
      readonly engineProviders: ListEngineProviderConfigurationsResultDto;
      readonly engineConfigurationDrafts: EngineConfigurationDraftsState;
      readonly playout: PlayoutDto | null;
      readonly playoutStart?: PlayoutStartSelection;
      readonly pendingPlayoutStart?: PlayoutStartSelection;
      readonly completedPlayout?: CompletePlayoutResultDto & {
        readonly displayName: string;
      };
      readonly completedPlayoutView?: PlayoutDto;
      readonly pendingPlayoutCompletion?: {
        readonly request: CompletePlayoutRequestDto;
        readonly view: PlayoutDto;
      };
      readonly inventoryRevisionPreview?: InventoryRevisionPreviewDto;
      readonly manageInventoryRevisionDraft?: ManageInventoryRevisionDraft;
      readonly revisionImpact?: RevisionImpactDetails;
      readonly contextWorkspace?: WorkingContextWorkspaceDto;
      readonly scopeWorkspace: WorkScopeWorkspaceDto;
      readonly startupNotice?: NonNullable<
        StartupResumeDto['unavailableContext']
      >;
      readonly destructiveAction?: DestructiveAction;
      readonly activity: ActivityId;
      readonly scope: WorkScope;
      readonly inventoryQuery: string;
      readonly inventoryContextOnly: boolean;
      readonly selectedInventoryItemId?: string;
      readonly refreshing: boolean;
      readonly busyCommand?: ApplicationCommand;
      readonly errorCode?: string;
      readonly announcement?: string;
    };

export class PlysmithApplicationStore {
  readonly #options: PlysmithApplicationStoreOptions;
  readonly #listeners = new Set<() => void>();
  #state: PlysmithApplicationState = Object.freeze({ phase: 'loading' });
  #client: PlysmithApplicationClient | undefined;
  #events: HostEventSubscription | undefined;
  #lifecycle = 0;
  #readVersion = 0;
  #committedReadVersion = 0;
  #refreshPromise: Promise<void> | undefined;
  #refreshAgain = false;
  #activity: ActivityId = 'manage';
  #scope: WorkScope = Object.freeze({ kind: 'free' });
  #analysisFocus: AnalysisFocus | undefined;
  #positionAnalysisBudget: ObjectiveBudget = 'fast';
  #positionAnalysisHumanSelection: ReadonlySet<string> | undefined;
  #inventoryQuery = '';
  #inventoryContextOnly = false;
  readonly #selectedInventoryFolders = new Map<string, string>();
  #inventoryPresentation: 'folders' | 'origins' = 'folders';
  // Undefined restores resume; null is an explicit empty management selection.
  #selectedInventoryItemId: string | null | undefined;
  #inspectedInventoryFolderId: string | null | undefined;
  readonly #engineConfigurationDrafts = new EngineConfigurationDrafts();
  #busyCommand: ApplicationCommand | undefined;
  #errorCode: string | undefined;
  #announcement: string | undefined;
  #pendingEventRevision: number | undefined;
  #pendingUnversionedEvent = false;
  #committedReadKey: string | undefined;
  #startupNotice: StartupResumeDto['unavailableContext'];
  #startupSavePromise: Promise<void> = Promise.resolve();
  #destructiveAction: DestructiveAction | undefined;
  #destructiveVersion = 0;
  #folderRemovalPreviewVersion = 0;
  readonly #contextAnalysisItems = new Map<
    string,
    Pick<AnalysisUnavailable, 'itemId' | 'displayName'>
  >();
  readonly #analysisUnavailable = new Map<string, AnalysisUnavailable>();
  #inventoryRevisionPreview: BoundInventoryRevisionPreview | undefined;
  #manageInventoryRevisionDraft: ManageInventoryRevisionDraft | undefined;
  #revisionImpact: RevisionImpactDetails | undefined;
  #playoutStart: PlayoutStartSelection | undefined;
  #pendingPlayoutStart: PlayoutStartSelection | undefined;
  #completedPlayout:
    (CompletePlayoutResultDto & { readonly displayName: string }) | undefined;
  #completedPlayoutView: PlayoutDto | undefined;
  #pendingPlayoutCompletion:
    | { readonly request: CompletePlayoutRequestDto; readonly view: PlayoutDto }
    | undefined;
  readonly #analysisConsumerId = `desktop-${crypto.randomUUID()}`;

  constructor(options: PlysmithApplicationStoreOptions) {
    this.#options = options;
  }

  getSnapshot = (): PlysmithApplicationState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getPositionAnalysisHumanSelection(): ReadonlySet<string> | undefined {
    return this.#positionAnalysisHumanSelection;
  }

  getPositionAnalysisBudget(): ObjectiveBudget {
    return this.#positionAnalysisBudget;
  }

  setPositionAnalysisBudget(budget: ObjectiveBudget): void {
    this.#positionAnalysisBudget = budget;
  }

  setPositionAnalysisHumanSelection(ids: ReadonlySet<string>): void {
    this.#positionAnalysisHumanSelection = new Set(ids);
  }

  async start(): Promise<void> {
    this.#diagnose({
      level: 'info',
      eventCode: 'renderer.lifecycle.starting',
      status: 'starting',
    });
    const lifecycle = ++this.#lifecycle;
    this.#pendingEventRevision = undefined;
    this.#pendingUnversionedEvent = false;
    this.#events?.close();
    this.#events = undefined;
    this.#client = undefined;
    this.#setState(Object.freeze({ phase: 'loading' }));

    let bootstrap: DesktopBootstrap;
    try {
      bootstrap = await this.#options.getBootstrap();
    } catch {
      this.#diagnose({
        level: 'error',
        eventCode: 'renderer.bootstrap.unavailable',
        status: 'unavailable',
        problemCode: 'host.unavailable',
      });
      this.#setUnavailable(lifecycle, 'host.unavailable');
      return;
    }
    if (lifecycle !== this.#lifecycle) return;
    if (bootstrap.kind === 'unavailable') {
      this.#diagnose({
        level: 'error',
        eventCode: 'renderer.bootstrap.unavailable',
        status: 'unavailable',
        generation: bootstrap.generation,
      });
      this.#setUnavailable(lifecycle);
      return;
    }

    this.#client = this.#createClient(bootstrap.connection);
    const events = this.#createEventSubscription(
      bootstrap.connection,
      (event) => this.#handleHostEvent(event),
      () => void this.refresh(),
      () => this.#setReadyError('host.invalid_event'),
    );
    this.#events = events;
    try {
      await events.ready;
    } catch {
      this.#diagnose({
        level: 'error',
        eventCode: 'renderer.bootstrap.unavailable',
        status: 'unavailable',
        problemCode: 'host.unavailable',
        generation: bootstrap.generation,
      });
      events.close();
      if (this.#events === events) this.#events = undefined;
      this.#client = undefined;
      this.#setUnavailable(lifecycle, 'host.unavailable');
      return;
    }
    if (lifecycle !== this.#lifecycle || this.#events !== events) return;
    try {
      const startup = await this.#client.getStartupResume();
      if (lifecycle !== this.#lifecycle) return;
      this.#scope = startup.scope;
      this.#activity = startup.area;
      this.#startupNotice = startup.unavailableContext;
      this.#analysisFocus = undefined;
      this.#selectedInventoryItemId = undefined;
      this.#inventoryContextOnly = startup.scope.kind === 'context';
    } catch (error) {
      this.#setUnavailable(lifecycle, hostErrorCode(error));
      return;
    }
    await this.refresh();
    if (lifecycle !== this.#lifecycle) return;
    if (this.#activity === 'playout') await this.#prepareDefaultPlayout();
  }

  async refresh(): Promise<void> {
    if (this.#client === undefined) return this.start();
    if (this.#refreshPromise !== undefined) {
      this.#refreshAgain = true;
      return this.#refreshPromise;
    }

    const lifecycle = this.#lifecycle;
    this.#setRefreshing(true);
    this.#refreshPromise = (async () => {
      let recoveredContextFocus = false;
      do {
        const startedAt = performance.now();
        this.#refreshAgain = false;
        const readVersion = ++this.#readVersion;
        const readKey = this.#readKey();
        const analysisRequest = this.#analysisRequest();
        try {
          const client = this.#client;
          if (client === undefined) return;
          const contextId =
            this.#scope.kind === 'context' ? this.#scope.contextId : undefined;
          const [
            status,
            preferences,
            diagnostics,
            diagnosticReportManifest,
            contexts,
            inventory,
            inventoryOrganization,
            analysisResult,
            workspace,
            scopeWorkspace,
            analysisProviders,
            playoutProviders,
            playout,
            engineProviders,
          ] = await Promise.all([
            client.getSystemStatus(),
            client.getUserPreferences(),
            client.getDiagnosticSettings(),
            client.getDiagnosticReportManifest(),
            client.listWorkingContexts({ pageSize: '100' }),
            client.searchInventory(this.#inventoryRequest()),
            client.getInventoryOrganization(
              contextId === undefined ? {} : { contextId },
            ),
            client.getAnalysisWorkspace(analysisRequest).then(
              (analysis) => ({ kind: 'completed' as const, analysis }),
              (error: unknown) => ({ kind: 'failed' as const, error }),
            ),
            contextId === undefined
              ? Promise.resolve(undefined)
              : client.getWorkingContextWorkspace(contextId),
            client.getWorkScopeWorkspace(this.#playoutRequest()),
            client.listPositionAnalysisProviders(),
            client.listMovePolicyProviders(),
            client.getPlayout(this.#playoutRequest()),
            client.getEngineProviderConfigurations(),
          ]);
          if (analysisResult.kind === 'failed') {
            if (lifecycle !== this.#lifecycle) return;
            if (
              readVersion < this.#committedReadVersion ||
              readKey !== this.#readKey()
            ) {
              if (readKey !== this.#readKey()) this.#refreshAgain = true;
              continue;
            }
            // Recover an explicit focus only when fresh membership proves its removal.
            if (
              !recoveredContextFocus &&
              analysisRequest.scopeKind === 'context' &&
              analysisRequest.itemId !== undefined &&
              hostErrorCode(analysisResult.error) ===
                'workspace.inventory_work_not_allowed' &&
              workspace !== undefined &&
              workspace.context.contextId === analysisRequest.contextId &&
              !workspace.members.some(
                (member) => member.itemId === analysisRequest.itemId,
              ) &&
              sameDataRevision(
                status,
                preferences,
                contexts,
                inventory,
                undefined,
                workspace,
                playout,
              ) &&
              isCurrentOrNewerRead(this.#state, status, preferences)
            ) {
              const previous = this.#contextAnalysisItems.get(
                workspace.context.contextId,
              );
              if (previous?.itemId === analysisRequest.itemId) {
                this.#analysisUnavailable.set(workspace.context.contextId, {
                  reason: 'removed_from_context',
                  ...previous,
                });
              }
              this.#analysisFocus = undefined;
              recoveredContextFocus = true;
              this.#refreshAgain = true;
              continue;
            }
            throw analysisResult.error;
          }
          const analysis = analysisResult.analysis;
          if (
            scopeWorkspace.dataRevision !== status.persistence.dataRevision ||
            inventoryOrganization.dataRevision !==
              status.persistence.dataRevision ||
            !sameScope(scopeWorkspace.scope, this.#scope) ||
            !sameDataRevision(
              status,
              preferences,
              contexts,
              inventory,
              analysis,
              workspace,
              playout,
            )
          ) {
            this.#diagnose({
              level: 'debug',
              eventCode: 'renderer.refresh.discarded',
              status: 'discarded',
              readVersion,
              durationMilliseconds: performance.now() - startedAt,
            });
            this.#refreshAgain = true;
            continue;
          }
          const inventoryRevisionPreview =
            await this.#loadInventoryRevisionPreview(
              client,
              analysis,
              status.persistence.dataRevision,
            );
          if (
            inventoryRevisionPreview !== undefined &&
            inventoryRevisionPreview.preview.dataRevision !==
              status.persistence.dataRevision
          ) {
            this.#refreshAgain = true;
            continue;
          }
          if (
            lifecycle !== this.#lifecycle ||
            readVersion < this.#committedReadVersion ||
            readKey !== this.#readKey() ||
            !isCurrentOrNewerRead(this.#state, status, preferences)
          ) {
            this.#diagnose({
              level: 'debug',
              eventCode: 'renderer.refresh.discarded',
              status: 'discarded',
              readVersion,
              dataRevision: status.persistence.dataRevision,
              durationMilliseconds: performance.now() - startedAt,
            });
            if (readKey !== this.#readKey()) this.#refreshAgain = true;
            continue;
          }
          this.#committedReadVersion = readVersion;
          this.#inventoryPresentation =
            scopeWorkspace.managementResume?.presentation ?? 'folders';
          const folderKey = scopeKey(this.#scope);
          const selectedFolder = this.#selectedInventoryFolders.get(folderKey);
          if (
            selectedFolder !== undefined &&
            !inventoryOrganization.folders.some(
              (folder) => folder.folderId === selectedFolder,
            )
          ) {
            this.#selectedInventoryFolders.delete(folderKey);
          }
          if (
            this.#inspectedInventoryFolderId != null &&
            !inventoryOrganization.folders.some(
              (folder) => folder.folderId === this.#inspectedInventoryFolderId,
            )
          )
            this.#inspectedInventoryFolderId = undefined;
          this.#committedReadKey = readKey;
          this.#updateAnalysisUnavailable(analysis, workspace);
          const analysisUnavailable =
            this.#visibleAnalysisUnavailable(analysis);
          this.#errorCode = undefined;
          this.#inventoryRevisionPreview = inventoryRevisionPreview;
          this.#acknowledgeEventsThrough(status.persistence.dataRevision);
          if (this.#selectedInventoryItemId === undefined) {
            this.#selectedInventoryItemId =
              scopeWorkspace.managementResume?.selectedItemId ?? null;
          }
          if (
            this.#destructiveAction?.status === 'ready' &&
            this.#destructiveAction.preview?.dataRevision !==
              status.persistence.dataRevision
          ) {
            this.#destructiveAction = {
              ...this.#destructiveAction,
              status: 'stale',
            };
          }
          const selectedInventoryItemId = this.#selectedInventoryItemId;
          this.#engineConfigurationDrafts.synchronize(
            engineProviders.providers,
          );
          if (
            this.#revisionImpact !== undefined &&
            !workspace?.pendingRevisionImpacts.some(
              (impact) =>
                impact.impactId === this.#revisionImpact?.impact.impactId,
            )
          ) {
            this.#revisionImpact = undefined;
          }
          this.#setState(
            Object.freeze({
              phase: 'ready',
              status,
              preferences,
              diagnostics,
              diagnosticReportManifest,
              contexts,
              inventory,
              inventoryOrganization,
              inventoryPresentation: this.#inventoryPresentation,
              ...(this.#inspectedInventoryFolderId === undefined
                ? {}
                : {
                    inspectedInventoryFolderId:
                      this.#inspectedInventoryFolderId,
                  }),
              ...(this.#selectedInventoryFolders.get(folderKey) === undefined
                ? {}
                : {
                    selectedInventoryFolderId:
                      this.#selectedInventoryFolders.get(folderKey)!,
                  }),
              analysis,
              scopeWorkspace,
              ...(this.#startupNotice === undefined
                ? {}
                : { startupNotice: this.#startupNotice }),
              ...(this.#destructiveAction === undefined
                ? {}
                : { destructiveAction: this.#destructiveAction }),
              ...(analysisUnavailable === undefined
                ? {}
                : { analysisUnavailable }),
              analysisProviders,
              playoutProviders,
              playout,
              engineProviders,
              engineConfigurationDrafts:
                this.#engineConfigurationDrafts.snapshot,
              ...(this.#playoutStart === undefined
                ? {}
                : { playoutStart: this.#playoutStart }),
              ...(this.#pendingPlayoutStart === undefined
                ? {}
                : { pendingPlayoutStart: this.#pendingPlayoutStart }),
              ...(this.#completedPlayout === undefined
                ? {}
                : { completedPlayout: this.#completedPlayout }),
              ...(this.#completedPlayoutView === undefined
                ? {}
                : { completedPlayoutView: this.#completedPlayoutView }),
              ...(this.#pendingPlayoutCompletion === undefined
                ? {}
                : { pendingPlayoutCompletion: this.#pendingPlayoutCompletion }),
              ...(inventoryRevisionPreview === undefined
                ? {}
                : {
                    inventoryRevisionPreview: inventoryRevisionPreview.preview,
                  }),
              ...(this.#manageInventoryRevisionDraft === undefined
                ? {}
                : {
                    manageInventoryRevisionDraft:
                      this.#manageInventoryRevisionDraft,
                  }),
              ...(this.#revisionImpact === undefined
                ? {}
                : { revisionImpact: this.#revisionImpact }),
              ...(workspace === undefined
                ? {}
                : { contextWorkspace: workspace }),
              activity: this.#activity,
              scope: this.#scope,
              inventoryQuery: this.#inventoryQuery,
              inventoryContextOnly: this.#inventoryContextOnly,
              ...(selectedInventoryItemId === null
                ? {}
                : { selectedInventoryItemId }),
              refreshing: false,
              ...(this.#busyCommand === undefined
                ? {}
                : { busyCommand: this.#busyCommand }),
              ...(this.#announcement === undefined
                ? {}
                : { announcement: this.#announcement }),
            }),
          );
          this.#diagnose({
            level: 'debug',
            eventCode: 'renderer.refresh.completed',
            status: 'succeeded',
            readVersion,
            dataRevision: status.persistence.dataRevision,
            durationMilliseconds: performance.now() - startedAt,
          });
        } catch (error) {
          if (lifecycle !== this.#lifecycle) return;
          const errorCode = hostErrorCode(error);
          this.#diagnose({
            level: 'error',
            eventCode: 'renderer.refresh.failed',
            status: 'failed',
            problemCode: errorCode,
            readVersion,
            durationMilliseconds: performance.now() - startedAt,
          });
          if (this.#state.phase === 'ready') {
            this.#setReadyError(errorCode);
          } else {
            this.#setUnavailable(lifecycle, errorCode);
          }
        }
      } while (this.#refreshAgain && lifecycle === this.#lifecycle);
    })().finally(() => {
      this.#refreshPromise = undefined;
      this.#setRefreshing(false);
    });
    return this.#refreshPromise;
  }

  setActivity(activity: ActivityId): void {
    if (
      this.#busyCommand !== undefined ||
      this.#pendingPlayoutCompletion !== undefined
    )
      return;
    if (activity !== this.#activity) this.cancelDestructiveAction();
    const returningToContextAnalysis =
      activity === 'analyze' && this.#activity !== 'analyze';
    this.#activity = activity;
    if (returningToContextAnalysis) this.#analysisFocus = undefined;
    this.#publishViewState();
    void this.#persistStartup();
    if (returningToContextAnalysis) void this.refresh();
    if (activity === 'playout') void this.#prepareDefaultPlayout();
  }

  async analyzePosition(
    request: Omit<AnalyzePositionRequestDto, 'consumerId'>,
  ): Promise<
    | {
        readonly kind: 'completed';
        readonly snapshot: PositionAnalysisSnapshotDto;
      }
    | { readonly kind: 'cancelled' }
    | { readonly kind: 'failed'; readonly errorCode: string }
  > {
    const client = this.#client;
    const state = this.#readyState();
    if (client === undefined || state === undefined) {
      return Object.freeze({
        kind: 'failed' as const,
        errorCode: 'host.unavailable',
      });
    }
    if (!sameScope(request.work.scope, state.scope)) {
      return Object.freeze({ kind: 'cancelled' as const });
    }
    if (
      request.work.subject.kind === 'inventory_item' &&
      !this.canWorkWithInventoryItem(request.work.subject.itemId)
    ) {
      return Object.freeze({
        kind: 'failed' as const,
        errorCode: 'workspace.inventory_work_not_allowed',
      });
    }
    const lifecycle = this.#lifecycle;
    try {
      const snapshot = await client.analyzePosition({
        ...request,
        consumerId: this.#analysisConsumerId,
      });
      if (lifecycle !== this.#lifecycle) {
        return Object.freeze({ kind: 'cancelled' as const });
      }
      return Object.freeze({ kind: 'completed' as const, snapshot });
    } catch (error) {
      if (lifecycle !== this.#lifecycle) {
        return Object.freeze({ kind: 'cancelled' as const });
      }
      const errorCode = hostErrorCode(error);
      if (errorCode === 'analysis.position_interrupted') {
        return Object.freeze({ kind: 'cancelled' as const });
      }
      return Object.freeze({ kind: 'failed' as const, errorCode });
    }
  }

  openPlayoutFromCurrentAnalysis(): void {
    const state = this.#readyState();
    if (state === undefined) return;
    const record = state.analysis.record;
    const scratch = state.analysis.scratch;
    const start: StartPlayoutRequestDto['start'] =
      scratch?.origin.kind === 'inventory_anchor'
        ? {
            kind: 'inventory_anchor',
            itemId: scratch.origin.itemId,
            revisionId: scratch.origin.revisionId,
            anchorId: scratch.origin.anchorId,
            continuation: scratch.steps
              .slice(0, scratch.cursor)
              .map((step) => ({
                kind: 'coordinates' as const,
                value: `${step.move.from}${step.move.to}${promotionLetter(step.move.promotion)}`,
              })),
          }
        : record !== undefined && scratch === undefined
          ? {
              kind: 'inventory_anchor',
              itemId: record.itemId,
              revisionId: record.revisionId,
              anchorId: record.currentAnchorId,
            }
          : { kind: 'fen', fen: state.analysis.currentState.fen };
    const selection = Object.freeze({
      title: record?.displayName ?? 'Neue Partie',
      start,
      workspace: state.analysis,
      ...playoutSourcePath(
        record?.displayName ?? 'Neue Partie',
        state.analysis,
      ),
    });
    this.#openPreparedPlayout(selection);
  }

  async openNewPlayout(): Promise<void> {
    const workspace = await this.#getInitialPlayoutWorkspace();
    if (workspace === undefined) return;
    this.#openPreparedPlayout(
      Object.freeze({
        title: 'Grundstellung',
        start: { kind: 'initial_position' as const },
        workspace,
      }),
    );
    this.#finishCommand();
  }

  cancelPendingPlayoutStart(): void {
    if (this.#pendingPlayoutStart === undefined) return;
    this.#pendingPlayoutStart = undefined;
    this.#publishViewState();
  }

  async discardPlayoutAndOpenPending(): Promise<void> {
    const pending = this.#pendingPlayoutStart;
    const request = this.#expectedPlayout();
    if (pending === undefined || request === undefined) return;
    const result = await this.#runCommand('discard_playout', (client) =>
      client.discardPlayout(request),
    );
    if (result === undefined) return;
    this.#pendingPlayoutStart = undefined;
    this.#playoutStart = pending;
    this.#completedPlayout = undefined;
    this.#completedPlayoutView = undefined;
    this.#activity = 'playout';
    this.#finishCommand();
    await this.#persistStartup();
  }

  #openPreparedPlayout(selection: PlayoutStartSelection): void {
    const state = this.#readyState();
    if (state?.playout !== null && state?.playout !== undefined) {
      this.#pendingPlayoutStart = selection;
      this.#publishViewState();
      return;
    }
    this.#pendingPlayoutStart = undefined;
    this.#playoutStart = selection;
    this.#completedPlayout = undefined;
    this.#completedPlayoutView = undefined;
    this.#activity = 'playout';
    this.#publishViewState();
    void this.#persistStartup();
  }

  async #prepareDefaultPlayout(): Promise<void> {
    const state = this.#readyState();
    if (
      state === undefined ||
      state.playout !== null ||
      this.#playoutStart !== undefined ||
      this.#completedPlayout !== undefined ||
      this.#pendingPlayoutStart !== undefined
    ) {
      return;
    }
    const workspace = await this.#getInitialPlayoutWorkspace();
    if (workspace === undefined) return;
    this.#playoutStart = Object.freeze({
      title: 'Grundstellung',
      start: { kind: 'initial_position' as const },
      workspace,
    });
    this.#finishCommand();
  }

  async #getInitialPlayoutWorkspace(): Promise<
    AnalysisWorkspaceDto | undefined
  > {
    const scope = this.#scope;
    const workspace = await this.#runCommand(
      'prepare_playout',
      (client) =>
        client.getAnalysisWorkspace({
          scopeKind: scope.kind,
          ...(scope.kind === 'context' ? { contextId: scope.contextId } : {}),
          mode: 'initial_position',
        }),
      false,
    );
    if (workspace === undefined) return;
    if (!sameScope(scope, this.#scope)) {
      this.#finishCommand();
      return;
    }
    return workspace;
  }

  async letProviderStartPlayout(providerInstanceId: string): Promise<boolean> {
    return this.#startPlayout(providerInstanceId, { kind: 'provider_move' });
  }

  async startPlayoutWithMove(
    providerInstanceId: string,
    from: string,
    to: string,
    promotion?: 'queen' | 'rook' | 'bishop' | 'knight',
  ): Promise<boolean> {
    const suffix = promotionLetter(promotion);
    return this.#startPlayout(providerInstanceId, {
      kind: 'user_move',
      move: { kind: 'coordinates', value: `${from}${to}${suffix}` },
    });
  }

  async #startPlayout(
    providerInstanceId: string,
    opening: StartPlayoutRequestDto['opening'],
  ): Promise<boolean> {
    const start = this.#playoutStart;
    const state = this.#readyState();
    const provider = state?.playoutProviders.providers.find(
      (candidate) => candidate.instanceId === providerInstanceId,
    );
    const capability = provider?.capabilities[0];
    if (start === undefined || capability === undefined) return false;
    const result = await this.#runCommand('start_playout', (client) =>
      client.startPlayout({
        scope: this.#scope,
        start: start.start,
        ...(start.sourcePath === undefined
          ? {}
          : {
              sourcePath: {
                displayName: start.sourcePath.displayName,
                rootFen: start.sourcePath.root.fen,
                moves: start.sourcePath.steps.map((step) => ({
                  kind: 'coordinates' as const,
                  value: `${step.move.from}${step.move.to}${promotionLetter(step.move.promotion)}`,
                })),
              },
            }),
        providerInstanceId,
        capability,
        opening,
      }),
    );
    if (result === undefined) return false;
    this.#playoutStart = undefined;
    this.#completedPlayout = undefined;
    this.#completedPlayoutView = undefined;
    this.#finishCommand();
    return true;
  }

  async submitPlayoutMove(
    from: string,
    to: string,
    promotion?: 'queen' | 'rook' | 'bishop' | 'knight',
  ): Promise<void> {
    const request = this.#expectedPlayout();
    if (request === undefined) return;
    const suffix = promotionLetter(promotion);
    await this.#runCommand('submit_playout_move', (client) =>
      client.submitPlayoutMove({
        ...request,
        move: { kind: 'coordinates', value: `${from}${to}${suffix}` },
      }),
    );
  }

  async retryPlayout(): Promise<void> {
    await this.#runPlayoutCommand('retry_playout', (client, request) =>
      client.retryPlayout(request),
    );
  }

  async pausePlayout(): Promise<void> {
    await this.#runPlayoutCommand('pause_playout', (client, request) =>
      client.pausePlayout(request),
    );
  }

  async resumePlayout(): Promise<void> {
    await this.#runPlayoutCommand('resume_playout', (client, request) =>
      client.resumePlayout(request),
    );
  }

  async cancelPlayoutCompletion(): Promise<void> {
    await this.#runPlayoutCommand(
      'cancel_playout_completion',
      (client, request) => client.cancelPlayoutCompletion(request),
    );
  }

  async stopPlayout(): Promise<void> {
    await this.#runPlayoutCommand('stop_playout', (client, request) =>
      client.stopPlayout(request),
    );
  }

  async discardPlayout(): Promise<void> {
    const request = this.#expectedPlayout();
    if (request === undefined) return;
    const result = await this.#runCommand('discard_playout', (client) =>
      client.discardPlayout(request),
    );
    if (result !== undefined) {
      this.#playoutStart = undefined;
      this.#completedPlayout = undefined;
      this.#completedPlayoutView = undefined;
      this.#finishCommand();
      if (this.#activity === 'playout') await this.#prepareDefaultPlayout();
    }
  }

  async completePlayout(
    displayName: string,
    addToContext: boolean,
    manualResult?: CompletePlayoutRequestDto['manualResult'],
    folderId?: string | null,
  ): Promise<boolean> {
    if (this.#busyCommand !== undefined) return false;
    if (this.#pendingPlayoutCompletion === undefined) {
      const request = this.#expectedPlayout();
      const view = this.#readyState()?.playout ?? undefined;
      if (
        request === undefined ||
        view === undefined ||
        displayName.trim() === ''
      )
        return false;
      this.#pendingPlayoutCompletion = {
        view,
        request: {
          ...request,
          completionId: crypto.randomUUID(),
          displayName: displayName.trim(),
          languageTag: this.#readyState()?.preferences.uiLocale ?? 'de-DE',
          ...(folderId === undefined ? {} : { folderId }),
          ...(manualResult === undefined ? {} : { manualResult }),
          ...(addToContext && this.#scope.kind === 'context'
            ? { targetContextId: this.#scope.contextId }
            : {}),
        },
      };
    }
    const pending = this.#pendingPlayoutCompletion;
    const result = await this.#runCommand(
      'complete_playout',
      async (client) => {
        try {
          return await client.completePlayout(pending.request);
        } catch (error) {
          if (hostErrorCode(error) !== 'host.unavailable') throw error;
          return client.completePlayout(pending.request);
        }
      },
    );
    if (result === undefined && this.#errorCode !== 'host.unavailable') {
      this.#pendingPlayoutCompletion = undefined;
      this.#publishViewState();
    }
    if (result === undefined) return false;
    this.#completedPlayout = {
      ...result,
      displayName: pending.request.displayName,
    };
    this.#completedPlayoutView = pending.view;
    this.#pendingPlayoutCompletion = undefined;
    this.#playoutStart = undefined;
    this.#finishCommand();
    return true;
  }

  async openCompletedPlayout(): Promise<void> {
    const completed = this.#completedPlayout;
    if (
      completed === undefined ||
      !this.canWorkWithInventoryItem(completed.itemId)
    )
      return;
    const result = await this.#runCommand(
      'set_resume',
      (client) =>
        client.setWorkScopeResume({
          scope: this.#scope,
          area: 'analyze',
          expectedResumeVersion:
            this.#readyState()?.scopeWorkspace.analysisResume?.resumeVersion ??
            null,
          mode: 'analyze',
          itemId: completed.itemId,
          revisionId: completed.revisionId,
          anchorId: completed.rootAnchorId,
        }),
      false,
    );
    if (result === undefined) return;
    this.#analysisFocus = undefined;
    this.#activity = 'analyze';
    this.#completedPlayout = undefined;
    this.#completedPlayoutView = undefined;
    this.#publishViewState();
    await this.refresh();
    this.#finishCommand();
    await this.#persistStartup();
  }

  async setScope(scope: WorkScope): Promise<void> {
    if (
      this.#busyCommand !== undefined ||
      this.#pendingPlayoutCompletion !== undefined
    )
      return;
    if (
      scope.kind === this.#scope.kind &&
      (scope.kind === 'free' ||
        (this.#scope.kind === 'context' &&
          scope.contextId === this.#scope.contextId))
    ) {
      return;
    }
    this.cancelDestructiveAction();
    this.#startupNotice = undefined;
    this.#scope = Object.freeze({ ...scope });
    this.#inspectedInventoryFolderId = undefined;
    this.#analysisFocus = undefined;
    this.#selectedInventoryItemId = undefined;
    this.#revisionImpact = undefined;
    this.#playoutStart = undefined;
    this.#pendingPlayoutStart = undefined;
    this.#completedPlayout = undefined;
    this.#completedPlayoutView = undefined;
    this.#inventoryContextOnly = scope.kind === 'context';
    this.#publishViewState();
    await this.refresh();
    await this.#persistStartup();
    if (this.#activity === 'playout') await this.#prepareDefaultPlayout();
  }

  async selectManagementScope(scope: WorkScope): Promise<void> {
    if (this.#busyCommand !== undefined) return;
    await this.setScope(scope);
    this.#inspectedInventoryFolderId = undefined;
    this.#selectedInventoryItemId = null;
    this.#revisionImpact = undefined;
    this.#publishViewState();
    await this.#persistManagementSelection();
  }

  async searchInventory(query: string): Promise<void> {
    this.#inspectedInventoryFolderId = undefined;
    this.#inventoryQuery = query.trim();
    this.#selectedInventoryItemId = null;
    this.#publishViewState();
    await this.refresh();
  }

  async setInventoryContextOnly(contextOnly: boolean): Promise<void> {
    this.#inspectedInventoryFolderId = undefined;
    this.#inventoryContextOnly = this.#scope.kind === 'context' && contextOnly;
    this.#selectedInventoryItemId = null;
    this.#publishViewState();
    await this.refresh();
  }

  async loadMoreInventory(): Promise<void> {
    const state = this.#readyState();
    const cursor = state?.inventory.nextCursor;
    if (state === undefined || cursor === undefined) return;
    const readKey = this.#readKey();
    const result = await this.#runCommand(
      'load_more_inventory',
      (client) =>
        client.searchInventory({ ...this.#inventoryRequest(), cursor }),
      false,
    );
    if (result === undefined) return;
    const current = this.#readyState();
    if (
      current === undefined ||
      readKey !== this.#readKey() ||
      result.dataRevision !== current.status.persistence.dataRevision
    ) {
      await this.refresh();
      this.#finishCommand();
      return;
    }
    const known = new Set(current.inventory.items.map((item) => item.itemId));
    const items = [
      ...current.inventory.items,
      ...result.items.filter((item) => !known.has(item.itemId)),
    ];
    const itemIds = new Set(items.map((item) => item.itemId));
    const ancestors = new Map(
      [...current.inventory.ancestors, ...result.ancestors].map(
        (item) => [item.itemId, item] as const,
      ),
    );
    const edges = new Map(
      [...current.inventory.provenanceEdges, ...result.provenanceEdges].map(
        (edge) => [edge.itemId, edge] as const,
      ),
    );
    this.#setState(
      Object.freeze({
        ...current,
        inventory: Object.freeze({
          items: Object.freeze(items),
          ancestors: Object.freeze(
            [...ancestors.values()].filter((item) => !itemIds.has(item.itemId)),
          ),
          provenanceEdges: Object.freeze([...edges.values()]),
          dataRevision: result.dataRevision,
          ...(result.nextCursor === undefined
            ? {}
            : { nextCursor: result.nextCursor }),
        }),
      }),
    );
    this.#finishCommand();
  }

  async loadMoreContexts(): Promise<void> {
    const state = this.#readyState();
    const cursor = state?.contexts.nextCursor;
    if (state === undefined || cursor === undefined) return;
    const result = await this.#runCommand(
      'load_more_contexts',
      (client) => client.listWorkingContexts({ pageSize: '100', cursor }),
      false,
    );
    if (result === undefined) return;
    const current = this.#readyState();
    if (
      current === undefined ||
      result.dataRevision !== current.status.persistence.dataRevision
    ) {
      await this.refresh();
      this.#finishCommand();
      return;
    }
    const known = new Set(
      current.contexts.contexts.map((context) => context.contextId),
    );
    this.#setState(
      Object.freeze({
        ...current,
        contexts: Object.freeze({
          contexts: Object.freeze([
            ...current.contexts.contexts,
            ...result.contexts.filter(
              (context) => !known.has(context.contextId),
            ),
          ]),
          dataRevision: result.dataRevision,
          ...(result.nextCursor === undefined
            ? {}
            : { nextCursor: result.nextCursor }),
        }),
      }),
    );
    this.#finishCommand();
  }

  async selectInventoryItem(item: InventoryItem): Promise<void> {
    if (this.#busyCommand !== undefined) return;
    this.cancelDestructiveAction();
    this.#inspectedInventoryFolderId = undefined;
    this.#selectedInventoryItemId =
      this.#selectedInventoryItemId === item.itemId ? null : item.itemId;
    if (this.#revisionImpact?.impact.itemId !== item.itemId) {
      this.#revisionImpact = undefined;
    }
    this.#publishViewState();
    await this.#persistManagementSelection(
      this.#selectedInventoryItemId === null ? undefined : item,
    );
  }

  async inspectInventoryItem(item: InventoryItem): Promise<void> {
    if (this.#busyCommand !== undefined) return;
    this.cancelDestructiveAction();
    this.#inspectedInventoryFolderId = undefined;
    this.#selectedInventoryItemId = item.itemId;
    if (this.#revisionImpact?.impact.itemId !== item.itemId) {
      this.#revisionImpact = undefined;
    }
    this.#publishViewState();
    await this.#persistManagementSelection(item);
  }

  async selectInventoryFolder(folderId?: string): Promise<void> {
    if (this.#busyCommand !== undefined) return;
    this.cancelDestructiveAction();
    this.#selectedInventoryItemId = null;
    this.#revisionImpact = undefined;
    this.#inspectedInventoryFolderId = folderId ?? null;
    const key = scopeKey(this.#scope);
    if (folderId === undefined) this.#selectedInventoryFolders.delete(key);
    else this.#selectedInventoryFolders.set(key, folderId);
    this.#publishViewState();
    await this.#persistManagementSelection();
  }

  async setInventoryPresentation(
    presentation: 'folders' | 'origins',
  ): Promise<void> {
    const state = this.#readyState();
    if (
      state === undefined ||
      state.refreshing ||
      this.#busyCommand !== undefined ||
      presentation === state.inventoryPresentation
    )
      return;
    this.#folderRemovalPreviewVersion++;
    await this.#runCommand('set_resume', (client) =>
      client.setManagementPresentation({
        scope: state.scope,
        expectedResumeVersion:
          state.scopeWorkspace.managementResume?.resumeVersion ?? null,
        presentation,
      }),
    );
  }

  async changeInventoryOrganization(
    change: InventoryOrganizationChange,
    expectedDataRevision?: number,
  ): Promise<boolean> {
    const state = this.#readyState();
    if (state === undefined || state.refreshing) return false;
    const result = await this.#runCommand(
      'change_inventory_organization',
      (client) =>
        client.changeInventoryOrganization({
          change,
          expectedDataRevision:
            expectedDataRevision ?? state.inventoryOrganization.dataRevision,
        }),
    );
    if (result === undefined) return false;
    if (change.kind === 'create_folder' && result.folderId !== undefined)
      await this.selectInventoryFolder(result.folderId);
    return true;
  }

  async previewContextFolderRemoval(
    folderId: string,
  ): Promise<ContextFolderRemovalPreview | undefined> {
    const state = this.#readyState();
    const client = this.#client;
    if (
      state?.scope.kind !== 'context' ||
      client === undefined ||
      this.#busyCommand !== undefined
    )
      return undefined;
    const readKey = this.#readKey();
    const lifecycle = this.#lifecycle;
    const activity = this.#activity;
    const version = ++this.#folderRemovalPreviewVersion;
    const current = () =>
      lifecycle === this.#lifecycle &&
      client === this.#client &&
      activity === this.#activity &&
      readKey === this.#readKey() &&
      version === this.#folderRemovalPreviewVersion;
    try {
      const preview = await client.previewContextFolderRemoval({
        folderId,
        contextId: state.scope.contextId,
      });
      if (!current()) return undefined;
      return preview;
    } catch (error) {
      if (!current()) return undefined;
      this.#setReadyError(hostErrorCode(error));
      return undefined;
    }
  }

  async checkInventoryName(displayName: string, excludingItemId?: string) {
    if (this.#client === undefined || displayName.trim() === '')
      return undefined;
    return this.#client.checkInventoryNameAvailability({
      displayName: displayName.trim(),
      ...(excludingItemId === undefined ? {} : { excludingItemId }),
    });
  }

  async readInventoryDetails(
    item: Pick<InventoryItem, 'itemId' | 'currentRevisionId'>,
  ): Promise<InventoryDetailsRead> {
    const client = this.#client;
    if (client === undefined) return { kind: 'cancelled' };
    const lifecycle = this.#lifecycle;
    try {
      // Management reads do not open analysis or change its work scope/resume.
      const record = await client.getInventoryRevision(
        item.itemId,
        item.currentRevisionId,
        { scopeKind: 'free' },
      );
      if (lifecycle !== this.#lifecycle || client !== this.#client)
        return { kind: 'cancelled' };
      return { kind: 'completed', record };
    } catch (error) {
      if (lifecycle !== this.#lifecycle || client !== this.#client)
        return { kind: 'cancelled' };
      return { kind: 'failed', errorCode: hostErrorCode(error) };
    }
  }

  async #persistManagementSelection(item?: InventoryItem): Promise<void> {
    const state = this.#readyState();
    if (state === undefined) return;
    if (
      this.#scope.kind === 'context' &&
      item !== undefined &&
      !item.contextIds.includes(this.#scope.contextId)
    ) {
      return;
    }
    if (item !== undefined && this.#hasPendingRevisionImpact(item.itemId))
      return;
    const expectedResumeVersion =
      state.scopeWorkspace.managementResume?.resumeVersion ?? null;
    await this.#runCommand('set_resume', async (client) =>
      client.setWorkScopeResume({
        scope: state.scope,
        area: 'manage',
        expectedResumeVersion,
        presentation: state.inventoryPresentation,
        ...(item === undefined
          ? {}
          : {
              selectedItemId: item.itemId,
              selectedAnchorId: item.rootAnchorId,
            }),
      }),
    );
  }

  async openInventoryItem(item: InventoryItem): Promise<boolean> {
    const scope = this.#scope;
    const lifecycle = this.#lifecycle;
    if (item.lifecycle !== 'active') return false;
    if (
      this.#scope.kind === 'context' &&
      !item.contextIds.includes(this.#scope.contextId)
    )
      return false;
    if (this.#hasPendingRevisionImpact(item.itemId)) return false;
    const workspace = this.#readyState()?.analysis;
    if (workspace?.scratch !== undefined) {
      if (workspace.scratchHasChanges) return false;
      if (!(await this.discardAnalysisScratch())) return false;
      if (lifecycle !== this.#lifecycle || !sameScope(scope, this.#scope))
        return false;
    }
    const revisionId = this.#effectiveRevisionId(item);
    this.#analysisFocus = Object.freeze({
      itemId: item.itemId,
      revisionId,
      anchorId: item.rootAnchorId,
    });
    this.#activity = 'analyze';
    this.#publishViewState();
    const expectedResumeVersion =
      this.#readyState()?.scopeWorkspace.analysisResume?.resumeVersion ?? null;
    const result = await this.#runCommand(
      'set_resume',
      async (client) =>
        client.setWorkScopeResume({
          scope: this.#scope,
          area: 'analyze',
          expectedResumeVersion,
          mode: 'analyze',
          itemId: item.itemId,
          revisionId,
          anchorId: item.rootAnchorId,
        }),
      false,
    );
    if (result === undefined) return false;
    this.#analysisFocus = undefined;
    await this.refresh();
    this.#finishCommand();
    await this.#persistStartup();
    return true;
  }

  async openRecordAnchor(anchorId: string): Promise<void> {
    const state = this.#readyState();
    const record = state?.analysis.record;
    if (state === undefined || record === undefined) return;
    this.#analysisFocus = Object.freeze({
      itemId: record.itemId,
      revisionId: record.revisionId,
      anchorId,
    });
    this.#publishViewState();
    if (this.#hasPendingRevisionImpact(record.itemId)) {
      await this.refresh();
      return;
    }
    const expectedResumeVersion =
      state.scopeWorkspace.analysisResume?.resumeVersion ?? null;
    const result = await this.#runCommand(
      'set_resume',
      (client) =>
        client.setWorkScopeResume({
          scope: state.scope,
          area: 'analyze',
          expectedResumeVersion,
          mode: 'analyze',
          itemId: record.itemId,
          revisionId: record.revisionId,
          anchorId,
        }),
      false,
    );
    if (result === undefined) return;
    this.#analysisFocus = undefined;
    await this.refresh();
    this.#finishCommand();
  }

  canWorkWithInventoryItem(itemId: string): boolean {
    const state = this.#readyState();
    const known =
      state === undefined
        ? undefined
        : [...state.inventory.items, ...state.inventory.ancestors].find(
            (item) => item.itemId === itemId,
          );
    return (
      state !== undefined &&
      (known === undefined || known.lifecycle === 'active') &&
      (state.scope.kind === 'free' ||
        state.contextWorkspace?.members.some(
          (member) => member.itemId === itemId,
        ) === true)
    );
  }

  async openAnalysisTarget(target: AnalysisFocus): Promise<void> {
    const state = this.#readyState();
    const record = state?.analysis.record;
    if (state === undefined || record === undefined) return;
    if (!this.canWorkWithInventoryItem(target.itemId)) return;
    this.#diagnose({
      level: 'debug',
      eventCode: 'renderer.analysis.navigation_requested',
      itemId: target.itemId,
      revisionId: target.revisionId,
      anchorId: target.anchorId,
    });
    if (
      target.itemId === record.itemId &&
      target.revisionId === record.revisionId
    ) {
      await this.openRecordAnchor(target.anchorId);
      return;
    }
    this.#analysisFocus = Object.freeze({
      itemId: target.itemId,
      revisionId: target.revisionId,
      anchorId: target.anchorId,
    });
    this.#publishViewState();
    await this.refresh();
  }

  async addInventoryItemToCurrentContext(item: InventoryItem): Promise<void> {
    if (this.#scope.kind !== 'context') return;
    const contextId = this.#scope.contextId;
    await this.#runCommand('add_context_reference', (client) =>
      client.addContextReference(contextId, {
        itemId: item.itemId,
        anchorId: item.rootAnchorId,
      }),
    );
  }

  async removeInventoryItemFromCurrentContext(
    item: InventoryItem,
    preview: ContextRemovalPreviewDto,
  ): Promise<boolean> {
    if (this.#scope.kind !== 'context') return false;
    const contextId = this.#scope.contextId;
    const previous = this.#readyState()?.analysis;
    const lifecycle = this.#lifecycle;
    const wasOpen =
      previous?.scope.kind === 'context' &&
      previous.scope.contextId === contextId &&
      (previous.record?.itemId === item.itemId ||
        (previous.scratch?.origin.kind === 'inventory_anchor' &&
          previous.scratch.origin.itemId === item.itemId));
    const result = await this.#runCommand(
      'remove_context_item',
      async (client) => {
        const removed = await client.removeContextItem(contextId, item.itemId, {
          expectedDataRevision: preview.dataRevision,
          expectedContextVersion: preview.contextVersion,
        });
        // Keep the prior identity before the command's refresh clears the workspace.
        if (wasOpen && lifecycle === this.#lifecycle) {
          this.#analysisUnavailable.set(contextId, {
            reason: 'removed_from_context',
            itemId: item.itemId,
            displayName: previous.record?.displayName ?? item.displayName,
          });
        }
        return removed;
      },
    );
    return result !== undefined;
  }

  async prepareContextItemRemoval(item: InventoryItem): Promise<void> {
    if (this.#scope.kind !== 'context') return;
    await this.#prepareDestructiveAction({
      kind: 'context_item',
      contextId: this.#scope.contextId,
      itemId: item.itemId,
      displayName: item.displayName,
      status: 'loading',
    });
  }

  async prepareContextDeletion(contextId: string): Promise<void> {
    const context = this.#readyState()?.contexts.contexts.find(
      (entry) => entry.contextId === contextId,
    );
    if (context === undefined) return;
    await this.#prepareDestructiveAction({
      kind: 'context',
      contextId,
      displayName: context.displayName,
      status: 'loading',
    });
  }

  async prepareInventoryItemDeletion(item: InventoryItem): Promise<void> {
    await this.#prepareDestructiveAction({
      kind: 'inventory',
      itemId: item.itemId,
      displayName: item.displayName,
      status: 'loading',
    });
  }

  cancelDestructiveAction(): void {
    this.#folderRemovalPreviewVersion++;
    if (this.#destructiveAction?.status === 'submitting') return;
    this.#destructiveVersion++;
    this.#destructiveAction = undefined;
    this.#publishViewState();
  }

  async #prepareDestructiveAction(action: DestructiveAction): Promise<void> {
    const client = this.#client;
    if (client === undefined || this.#busyCommand !== undefined) return;
    const version = ++this.#destructiveVersion;
    const lifecycle = this.#lifecycle;
    this.#destructiveAction =
      action.kind === 'context_item' ? undefined : action;
    this.#publishViewState();
    try {
      const prepared: DestructiveAction =
        action.kind === 'inventory'
          ? {
              ...action,
              status: 'ready',
              preview: await client.previewInventoryItemDeletion(action.itemId),
            }
          : {
              ...action,
              status: 'ready',
              preview:
                action.kind === 'context'
                  ? await client.previewWorkingContextDeletion(action.contextId)
                  : await client.previewContextItemRemoval(
                      action.contextId,
                      action.itemId,
                    ),
            };
      if (version !== this.#destructiveVersion || lifecycle !== this.#lifecycle)
        return;
      const dataRevision = this.#readyState()?.status.persistence.dataRevision;
      if (
        prepared.kind === 'context_item' &&
        prepared.preview !== undefined &&
        !contextRemovalHasContentLoss(prepared.preview)
      ) {
        if (prepared.preview.dataRevision !== dataRevision) {
          this.#setReadyError('workspace.removal_preview_conflict');
          return;
        }
        await this.#submitDestructiveAction(prepared, false);
        return;
      }
      this.#destructiveAction =
        prepared.preview!.dataRevision === dataRevision
          ? prepared
          : { ...prepared, status: 'stale' };
    } catch (error) {
      if (version !== this.#destructiveVersion || lifecycle !== this.#lifecycle)
        return;
      if (action.kind === 'context_item') {
        this.#setReadyError(hostErrorCode(error));
        return;
      }
      this.#destructiveAction = {
        ...action,
        status: 'error',
        errorMessageId: 'destructive.failed',
      };
    }
    this.#publishViewState();
  }

  async confirmDestructiveAction(): Promise<boolean> {
    return this.#submitDestructiveAction(this.#destructiveAction, true);
  }

  async #submitDestructiveAction(
    action: DestructiveAction | undefined,
    showDialog: boolean,
  ): Promise<boolean> {
    const state = this.#readyState();
    if (
      action?.status !== 'ready' ||
      action.preview === undefined ||
      state === undefined ||
      this.#busyCommand !== undefined
    )
      return false;
    if (action.preview.dataRevision !== state.status.persistence.dataRevision) {
      if (!showDialog) {
        this.#setReadyError('workspace.removal_preview_conflict');
        return false;
      }
      this.#destructiveAction = { ...action, status: 'stale' };
      this.#publishViewState();
      return false;
    }
    this.#destructiveAction = showDialog
      ? { ...action, status: 'submitting' }
      : undefined;
    const lifecycle = this.#lifecycle;
    this.#publishViewState();
    const result = await this.#runCommand(
      action.kind === 'inventory'
        ? 'delete_inventory_item'
        : action.kind === 'context'
          ? 'delete_context'
          : 'remove_context_item',
      async (client) => {
        if (action.kind === 'inventory') {
          if (action.preview === undefined) return undefined;
          const removed = await client.deleteInventoryItem(action.itemId, {
            expectedCurrentRevisionId: action.preview.currentRevisionId,
            expectedDataRevision: action.preview.dataRevision,
          });
          const boundItem =
            state.analysis.record?.itemId ??
            (state.analysis.scratch?.origin.kind === 'inventory_anchor'
              ? state.analysis.scratch.origin.itemId
              : undefined);
          if (boundItem === action.itemId) {
            this.#analysisUnavailable.set(scopeKey(state.scope), {
              reason: 'deleted_from_inventory',
              itemId: action.itemId,
              displayName: action.displayName,
            });
            this.#analysisFocus = undefined;
          }
          return removed;
        }
        if (action.preview === undefined) return undefined;
        const confirmation = {
          expectedContextVersion: action.preview.contextVersion,
          expectedDataRevision: action.preview.dataRevision,
        };
        if (action.kind === 'context') {
          const removed = await client.deleteWorkingContext(
            action.contextId,
            confirmation,
          );
          if (
            this.#scope.kind === 'context' &&
            this.#scope.contextId === action.contextId
          ) {
            this.#startupNotice = {
              contextId: action.contextId,
              displayName: action.displayName,
              reason: 'deleted',
            };
            this.#scope = { kind: 'free' };
            this.#inspectedInventoryFolderId = undefined;
            this.#analysisFocus = undefined;
            this.#selectedInventoryItemId = undefined;
            this.#inventoryContextOnly = false;
            this.#playoutStart = undefined;
            this.#pendingPlayoutStart = undefined;
            this.#completedPlayout = undefined;
            this.#completedPlayoutView = undefined;
          }
          return removed;
        }
        const removed = await client.removeContextItem(
          action.contextId,
          action.itemId,
          confirmation,
        );
        const boundItem =
          state.analysis.record?.itemId ??
          (state.analysis.scratch?.origin.kind === 'inventory_anchor'
            ? state.analysis.scratch.origin.itemId
            : undefined);
        if (boundItem === action.itemId) {
          this.#analysisUnavailable.set(action.contextId, {
            reason: 'removed_from_context',
            itemId: action.itemId,
            displayName: action.displayName,
          });
          this.#analysisFocus = undefined;
        }
        return removed;
      },
      false,
    );
    if (lifecycle !== this.#lifecycle) return false;
    if (result === undefined) {
      if (!showDialog) return false;
      const conflict = this.#errorCode?.endsWith('_conflict') === true;
      this.#destructiveAction = {
        ...action,
        status: conflict ? 'stale' : 'error',
        errorMessageId: conflict ? 'destructive.stale' : 'destructive.failed',
      };
      this.#publishViewState();
      return false;
    }
    this.#destructiveVersion++;
    this.#destructiveAction = undefined;
    this.#selectedInventoryItemId = null;
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  #persistStartup(): Promise<void> {
    const client = this.#client;
    if (client === undefined) return Promise.resolve();
    const lifecycle = this.#lifecycle;
    const scope = this.#scope;
    const area = this.#activity;
    const save = this.#startupSavePromise
      .then(async () => {
        if (
          lifecycle !== this.#lifecycle ||
          !sameScope(scope, this.#scope) ||
          area !== this.#activity
        )
          return;
        const current = await client.getStartupResume();
        if (
          lifecycle !== this.#lifecycle ||
          !sameScope(scope, this.#scope) ||
          area !== this.#activity
        )
          return;
        if (
          sameScope(current.scope, scope) &&
          current.area === area &&
          current.unavailableContext === undefined
        )
          return;
        await client.setStartupResume({
          scope,
          area,
          expectedStartupVersion: current.startupVersion,
        });
        if (lifecycle === this.#lifecycle) await this.refresh();
      })
      .catch((error: unknown) => {
        if (lifecycle === this.#lifecycle)
          this.#setReadyError(hostErrorCode(error));
      });
    this.#startupSavePromise = save;
    return save;
  }

  async validateAnalysisSetup(
    request: ValidateAnalysisSetupRequestDto,
  ): Promise<ValidateAnalysisSetupResultDto | undefined> {
    const result = await this.#runCommand(
      'validate_analysis_setup',
      (client) => client.validateAnalysisSetup(request),
      false,
    );
    if (result !== undefined) this.#finishCommand();
    return result;
  }

  async startScratchAtInitialPosition(): Promise<boolean> {
    return this.#startScratch({ kind: 'initial_position' });
  }

  async startScratchAtFen(fen: string): Promise<boolean> {
    return this.#startScratch({ kind: 'fen', fen: fen.trim() });
  }

  async startScratchAtSetup(
    setup: Extract<
      ValidateAnalysisSetupRequestDto['input'],
      { kind: 'position_setup' }
    >['setup'],
  ): Promise<boolean> {
    return this.#startScratch({ kind: 'position_setup', setup });
  }

  async prepareInventoryItemRename(
    item: InventoryItem,
    displayName: string,
    summary: string | null,
  ): Promise<void> {
    const state = this.#readyState();
    if (
      state === undefined ||
      this.#manageInventoryRevisionDraft !== undefined ||
      (state.scope.kind === 'free' && state.analysis.scratch !== undefined) ||
      this.#hasPendingRevisionImpact(item.itemId)
    )
      return;
    const scope = Object.freeze({ kind: 'free' as const });
    const draft = await this.#runCommand(
      'prepare_inventory_metadata_revision',
      async (client) => {
        const previousRevision = await client.getInventoryRevision(
          item.itemId,
          item.currentRevisionId,
          { scopeKind: 'free' },
        );
        const started = await client.startInventoryRevision(item.itemId, {
          scope,
          baseRevisionId: item.currentRevisionId,
          anchorId: item.rootAnchorId,
          mode: 'metadata',
          expectedScratchId: null,
          expectedScratchRevision: null,
          displayName,
          summary,
        });
        try {
          const preview = await client.previewInventoryRevision({
            scope,
            expectedScratchId: started.scratch.scratchId,
            expectedScratchRevision: started.scratch.scratchRevision,
          });
          return Object.freeze({
            itemId: item.itemId,
            scratchId: started.scratch.scratchId,
            scratchRevision: started.scratch.scratchRevision,
            previousRevision,
            preview,
          });
        } catch (error) {
          await client
            .updateAnalysisScratch({
              scope,
              expectedScratchId: started.scratch.scratchId,
              expectedScratchRevision: started.scratch.scratchRevision,
              action: { kind: 'discard' },
            })
            .catch(() => undefined);
          throw error;
        }
      },
      false,
    );
    if (draft === undefined) return;
    this.#manageInventoryRevisionDraft = draft;
    this.#publishViewState();
    this.#finishCommand();
  }

  async renameInventoryItem(
    item: InventoryItem,
    displayName: string,
    summary: string | null,
  ): Promise<boolean> {
    const state = this.#readyState();
    if (state === undefined || this.#busyCommand !== undefined) return false;
    const lifecycle = this.#lifecycle;
    if (
      state.scope.kind === 'free' &&
      state.analysis.scratch !== undefined &&
      this.#manageInventoryRevisionDraft === undefined
    ) {
      if (state.analysis.scratchHasChanges) return false;
      if (!(await this.discardAnalysisScratch())) return false;
      if (lifecycle !== this.#lifecycle || !sameScope(state.scope, this.#scope))
        return false;
    }
    const draft = this.#manageInventoryRevisionDraft;
    if (
      draft !== undefined &&
      (draft.itemId !== item.itemId ||
        draft.preview.displayName !== displayName ||
        draft.preview.summary !== (summary ?? undefined))
    ) {
      if (!(await this.discardManagedInventoryRevision())) return false;
      if (lifecycle !== this.#lifecycle || !sameScope(state.scope, this.#scope))
        return false;
    }
    if (this.#manageInventoryRevisionDraft === undefined) {
      await this.prepareInventoryItemRename(item, displayName, summary);
      if (lifecycle !== this.#lifecycle || !sameScope(state.scope, this.#scope))
        return false;
    } else {
      const currentDraft = this.#manageInventoryRevisionDraft;
      const preview = await this.#runCommand(
        'prepare_inventory_metadata_revision',
        (client) =>
          client.previewInventoryRevision({
            scope: { kind: 'free' },
            expectedScratchId: currentDraft.scratchId,
            expectedScratchRevision: currentDraft.scratchRevision,
          }),
        false,
      );
      if (preview === undefined) return false;
      this.#manageInventoryRevisionDraft = { ...currentDraft, preview };
      this.#finishCommand();
      if (lifecycle !== this.#lifecycle || !sameScope(state.scope, this.#scope))
        return false;
    }
    if (this.#manageInventoryRevisionDraft === undefined) return false;
    if (this.#manageInventoryRevisionDraft.preview.noOp) {
      return this.discardManagedInventoryRevision();
    }
    return this.saveManagedInventoryRevision();
  }

  async saveManagedInventoryRevision(): Promise<boolean> {
    const draft = this.#manageInventoryRevisionDraft;
    if (draft === undefined) return false;
    const result = await this.#runCommand(
      'save_managed_inventory_revision',
      (client) =>
        client.saveInventoryRevision({
          scope: { kind: 'free' },
          expectedScratchId: draft.scratchId,
          expectedScratchRevision: draft.scratchRevision,
          previewFingerprint: draft.preview.previewFingerprint,
        }),
      false,
    );
    if (result === undefined) return false;
    this.#manageInventoryRevisionDraft = undefined;
    this.#announcement = 'inventory.revisionSaved';
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  async discardManagedInventoryRevision(): Promise<boolean> {
    const draft = this.#manageInventoryRevisionDraft;
    if (draft === undefined) return false;
    const result = await this.#runCommand(
      'discard_managed_inventory_revision',
      async (client) => {
        const current = await client.getAnalysisWorkspace({
          scopeKind: 'free',
        });
        const owned = (scratch: AnalysisWorkspaceDto['scratch']) =>
          scratch?.scratchId === draft.scratchId &&
          scratch.scratchRevision === draft.scratchRevision;
        if (!owned(current.scratch)) return { discarded: false };
        try {
          return await client.updateAnalysisScratch({
            scope: { kind: 'free' },
            expectedScratchId: draft.scratchId,
            expectedScratchRevision: draft.scratchRevision,
            action: { kind: 'discard' },
          });
        } catch (error) {
          if (hostErrorCode(error) === 'analysis.scratch_revision_conflict') {
            const latest = await client.getAnalysisWorkspace({
              scopeKind: 'free',
            });
            if (!owned(latest.scratch)) return { discarded: false };
          }
          throw error;
        }
      },
      false,
    );
    if (result === undefined) return false;
    this.#manageInventoryRevisionDraft = undefined;
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  async applyMove(value: string): Promise<void> {
    const state = this.#readyState();
    const trimmed = value.trim();
    if (state === undefined || trimmed === '') return;
    const move = moveRequest(trimmed, state.preferences.uiLocale);
    await this.#applyMoveRequest(move);
  }

  async applyBoardMove(
    from: string,
    to: string,
    promotion?: 'queen' | 'rook' | 'bishop' | 'knight',
  ): Promise<void> {
    const suffix =
      promotion === undefined
        ? ''
        : ({ queen: 'q', rook: 'r', bishop: 'b', knight: 'n' } as const)[
            promotion
          ];
    await this.#applyMoveRequest({
      kind: 'coordinates',
      value: `${from}${to}${suffix}`,
    });
  }

  async takeBackLastMove(): Promise<void> {
    const state = this.#readyState();
    if (state === undefined) return;
    const scratch = state.analysis.scratch;
    if (scratch !== undefined) {
      if (scratch.cursor !== scratch.steps.length) return;
      if (scratch.steps.length > 0) {
        if (
          scratch.steps.length === 1 &&
          scratch.intent.kind === 'exploration' &&
          scratch.origin.kind === 'inventory_anchor'
        ) {
          await this.discardAnalysisScratch();
          return;
        }
        await this.#updateScratch('remove_last_move', {
          kind: 'remove_last_move',
        });
        return;
      }
      if (scratch.intent.kind !== 'inventory_revision') return;
      const record = state.analysis.record;
      const preservedMoveCount = this.#visibleInventoryRevisionPreview(
        state.analysis,
      )?.preservedMoveCount;
      if (
        record === undefined ||
        preservedMoveCount === undefined ||
        preservedMoveCount === 0
      ) {
        return;
      }
      await this.#startInventoryRevision(
        'truncate_after',
        anchorBeforeMoveCount(record, preservedMoveCount - 1),
      );
      return;
    }

    const record = state.analysis.record;
    if (
      record === undefined ||
      record.historical ||
      record.revisionId !== record.currentRevisionId ||
      record.cursor !== record.steps.length ||
      record.steps.length === 0 ||
      record.itemType !== 'analysis'
    ) {
      return;
    }
    await this.#startInventoryRevision(
      'truncate_after',
      anchorBeforeMoveCount(record, record.steps.length - 1),
    );
  }

  async continueAnalysisExploration(): Promise<void> {
    const state = this.#readyState();
    if (!state?.analysis.allowedActions.includes('continue_exploration'))
      return;
    await this.#updateScratch('update_scratch', {
      kind: 'continue_exploration',
    });
  }

  async promoteAnalysisToInventoryRevision(): Promise<void> {
    const state = this.#readyState();
    const scratch = state?.analysis.scratch;
    const record = state?.analysis.record;
    const origin = scratch?.origin;
    if (
      state === undefined ||
      scratch === undefined ||
      record === undefined ||
      record.itemType !== 'analysis' ||
      scratch.intent.kind !== 'exploration' ||
      origin?.kind !== 'inventory_anchor' ||
      origin.itemId !== record.itemId ||
      origin.revisionId !== record.revisionId ||
      scratch.cursor !== scratch.steps.length ||
      scratch.steps.length === 0
    ) {
      return;
    }
    const outcome = await this.#runCommand(
      'promote_analysis_to_inventory_revision',
      async (client) => {
        const result = await client.promoteAnalysisToInventoryRevision(
          record.itemId,
          {
            scope: state.scope,
            baseRevisionId: record.revisionId,
            anchorId: origin.anchorId,
            expectedScratchId: scratch.scratchId,
            expectedScratchRevision: scratch.scratchRevision,
          },
        );
        const preview = await client.previewInventoryRevision({
          scope: state.scope,
          expectedScratchId: result.scratch.scratchId,
          expectedScratchRevision: result.scratch.scratchRevision,
        });
        return Object.freeze({ result, preview });
      },
      false,
    );
    if (outcome === undefined) return;
    this.#inventoryRevisionPreview = bindInventoryRevisionPreview(
      state.scope,
      outcome.result.scratch,
      outcome.preview,
    );
    await this.refresh();
    this.#finishCommand();
  }

  async moveAnalysisCursor(cursor: number): Promise<void> {
    const state = this.#readyState();
    const scratchRevision = state?.analysis.scratch?.scratchRevision;
    const scratchId = state?.analysis.scratch?.scratchId;
    if (
      state === undefined ||
      scratchId === undefined ||
      scratchRevision === undefined
    )
      return;
    await this.#runCommand('update_scratch', (client) =>
      client.updateAnalysisScratch({
        scope: state.scope,
        expectedScratchId: scratchId,
        expectedScratchRevision: scratchRevision,
        action: { kind: 'move_cursor', cursor },
      }),
    );
  }

  async prepareAnalysisNote(body: string): Promise<void> {
    const state = this.#readyState();
    const scratchRevision = state?.analysis.scratch?.scratchRevision;
    const scratchId = state?.analysis.scratch?.scratchId;
    if (
      state === undefined ||
      scratchId === undefined ||
      scratchRevision === undefined
    )
      return;
    await this.#runCommand('prepare_note', (client) =>
      client.updateAnalysisScratch({
        scope: state.scope,
        expectedScratchId: scratchId,
        expectedScratchRevision: scratchRevision,
        action: { kind: 'prepare_note', body: body.trim() },
      }),
    );
  }

  async clearAnalysisNote(): Promise<void> {
    const state = this.#readyState();
    const scratchRevision = state?.analysis.scratch?.scratchRevision;
    const scratchId = state?.analysis.scratch?.scratchId;
    if (
      state === undefined ||
      scratchId === undefined ||
      scratchRevision === undefined ||
      state.analysis.scratch?.noteDraft === undefined
    ) {
      return;
    }
    await this.#runCommand('clear_note', (client) =>
      client.updateAnalysisScratch({
        scope: state.scope,
        expectedScratchId: scratchId,
        expectedScratchRevision: scratchRevision,
        action: { kind: 'clear_note' },
      }),
    );
  }

  async discardAnalysisScratch(): Promise<boolean> {
    const state = this.#readyState();
    const scratch = state?.analysis.scratch;
    if (state === undefined || scratch === undefined) return false;
    this.#inventoryRevisionPreview = undefined;
    const result = await this.#runCommand(
      'discard_scratch',
      (client) =>
        client.updateAnalysisScratch({
          scope: state.scope,
          expectedScratchId: scratch.scratchId,
          expectedScratchRevision: scratch.scratchRevision,
          action: { kind: 'discard' },
        }),
      false,
    );
    if (result === undefined) return false;
    if (!result.discarded) {
      this.#finishCommand();
      return false;
    }
    if (
      state.scope.kind === 'free' &&
      scratch.origin.kind === 'inventory_anchor'
    ) {
      this.#analysisFocus = Object.freeze({
        itemId: scratch.origin.itemId,
        revisionId: scratch.origin.revisionId,
        anchorId: scratch.origin.anchorId,
      });
    }
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  async discardAnalysisScratchAndOpenInventoryItem(
    item: InventoryItem,
  ): Promise<boolean> {
    if (!(await this.discardAnalysisScratch())) return false;
    return this.openInventoryItem(item);
  }

  async saveInventoryRevision(): Promise<boolean> {
    const state = this.#readyState();
    const scratch = state?.analysis.scratch;
    const preview = this.#visibleInventoryRevisionPreview(state?.analysis);
    if (
      state === undefined ||
      scratch === undefined ||
      scratch.intent.kind !== 'inventory_revision' ||
      preview === undefined
    ) {
      return false;
    }
    const result = await this.#runCommand(
      'save_inventory_revision',
      (client) =>
        client.saveInventoryRevision({
          scope: state.scope,
          expectedScratchId: scratch.scratchId,
          expectedScratchRevision: scratch.scratchRevision,
          previewFingerprint: preview.previewFingerprint,
        }),
      false,
    );
    if (result === undefined) return false;
    this.#inventoryRevisionPreview = undefined;
    this.#analysisFocus = Object.freeze({
      itemId: result.itemId,
      revisionId: result.revisionId,
      anchorId: result.currentAnchorId,
    });
    this.#announcement = 'inventory.revisionSaved';
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  async openRevisionImpact(impactId: string): Promise<void> {
    const state = this.#readyState();
    if (
      state?.scope.kind !== 'context' ||
      !state.contextWorkspace?.pendingRevisionImpacts.some(
        (impact) => impact.impactId === impactId,
      )
    ) {
      return;
    }
    const details = await this.#runCommand(
      'load_revision_impact',
      async (client) => {
        const impact = await client.getPendingRevisionImpact(impactId);
        const [pinnedRevision, targetRevision] = await Promise.all([
          client.getInventoryRevision(impact.itemId, impact.pinnedRevisionId, {
            scopeKind: 'free',
          }),
          client.getInventoryRevision(impact.itemId, impact.targetRevisionId, {
            scopeKind: 'free',
          }),
        ]);
        return Object.freeze({ impact, pinnedRevision, targetRevision });
      },
      false,
    );
    if (details === undefined) return;
    this.#revisionImpact = details;
    this.#publishViewState();
    this.#finishCommand();
  }

  closeRevisionImpact(): void {
    this.#revisionImpact = undefined;
    this.#publishViewState();
  }

  async resolveRevisionImpact(
    request: ResolvePendingRevisionImpactRequestDto,
  ): Promise<boolean> {
    const details = this.#revisionImpact;
    if (details === undefined) return false;
    const result = await this.#runCommand(
      'resolve_revision_impact',
      (client) =>
        client.resolvePendingRevisionImpact(details.impact.impactId, request),
      false,
    );
    if (result === undefined) return false;
    this.#revisionImpact = undefined;
    this.#announcement = 'inventory.revisionImpactResolved';
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  async createAnalysisRecord(
    displayName: string,
    destination: 'inventory' | 'context',
    noteScope: 'global' | 'context',
    noteBody: string,
    folderId?: string | null,
  ): Promise<boolean> {
    const state = this.#readyState();
    const scratch = state?.analysis.scratch;
    if (
      state === undefined ||
      scratch === undefined ||
      displayName.trim() === ''
    )
      return false;
    const scratchRevision = scratch.scratchRevision;
    const targetContextId =
      destination === 'context' && state.scope.kind === 'context'
        ? state.scope.contextId
        : undefined;
    const normalizedNote = noteBody.trim();
    const includesNote = normalizedNote !== '';
    const result = await this.#runCommand(
      'create_analysis_record',
      async (client) => {
        let expectedScratchRevision = scratchRevision;
        if (includesNote && scratch.noteDraft?.body !== normalizedNote) {
          const prepared = await client.updateAnalysisScratch({
            scope: state.scope,
            expectedScratchId: scratch.scratchId,
            expectedScratchRevision,
            action: { kind: 'prepare_note', body: normalizedNote },
          });
          if (prepared.scratch === undefined) {
            throw new Error('The analysis scratch unexpectedly disappeared.');
          }
          expectedScratchRevision = prepared.scratch.scratchRevision;
        } else if (!includesNote && scratch.noteDraft !== undefined) {
          const cleared = await client.updateAnalysisScratch({
            scope: state.scope,
            expectedScratchId: scratch.scratchId,
            expectedScratchRevision,
            action: { kind: 'clear_note' },
          });
          if (cleared.scratch === undefined) {
            throw new Error('The analysis scratch unexpectedly disappeared.');
          }
          expectedScratchRevision = cleared.scratch.scratchRevision;
        }
        return client.createAnalysisRecord({
          scope: state.scope,
          expectedScratchId: scratch.scratchId,
          expectedScratchRevision,
          displayName: displayName.trim(),
          languageTag: state.preferences.uiLocale,
          ...(folderId === undefined ? {} : { folderId }),
          ...(targetContextId === undefined ? {} : { targetContextId }),
          ...(!includesNote
            ? {}
            : {
                noteScope:
                  noteScope === 'context' && state.scope.kind === 'context'
                    ? {
                        kind: 'context' as const,
                        contextId: state.scope.contextId,
                      }
                    : { kind: 'global' as const },
              }),
        });
      },
      false,
    );
    if (result === undefined) return false;
    this.#analysisFocus = undefined;
    this.#announcement = includesNote
      ? 'analysis.savedWithNote'
      : 'analysis.saved';
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  async createAnalysisNote(
    noteScope: 'global' | 'context',
    body: string,
  ): Promise<boolean> {
    const state = this.#readyState();
    const scratch = state?.analysis.scratch;
    const normalizedBody = body.trim();
    if (
      state === undefined ||
      scratch?.origin.kind !== 'inventory_anchor' ||
      scratch.noteDraft === undefined ||
      normalizedBody === ''
    ) {
      return false;
    }
    const result = await this.#runCommand(
      'create_analysis_note',
      async (client) => {
        let expectedScratchRevision = scratch.scratchRevision;
        if (scratch.noteDraft?.body !== normalizedBody) {
          const prepared = await client.updateAnalysisScratch({
            scope: state.scope,
            expectedScratchId: scratch.scratchId,
            expectedScratchRevision,
            action: { kind: 'prepare_note', body: normalizedBody },
          });
          if (prepared.scratch === undefined) {
            throw new Error('The analysis scratch unexpectedly disappeared.');
          }
          expectedScratchRevision = prepared.scratch.scratchRevision;
        }
        return client.createAnalysisNote({
          scope: state.scope,
          expectedScratchId: scratch.scratchId,
          expectedScratchRevision,
          languageTag: state.preferences.uiLocale,
          noteScope:
            noteScope === 'context' && state.scope.kind === 'context'
              ? {
                  kind: 'context',
                  contextId: state.scope.contextId,
                }
              : { kind: 'global' },
        });
      },
      false,
    );
    if (result === undefined) return false;
    this.#analysisFocus = Object.freeze({
      itemId: result.itemId,
      revisionId: result.revisionId,
      anchorId: result.anchorId,
    });
    this.#announcement = 'analysis.noteSaved';
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  async createPositionNote(
    target: {
      readonly itemId: string;
      readonly revisionId: string;
      readonly anchorId: string;
    },
    body: string,
    noteScope: 'global' | 'context',
  ): Promise<boolean> {
    const state = this.#readyState();
    if (state === undefined || body.trim() === '') return false;
    const result = await this.#runCommand(
      'create_position_note',
      (client) =>
        client.createPositionNote({
          scope: state.scope,
          itemId: target.itemId,
          revisionId: target.revisionId,
          anchorId: target.anchorId,
          body: body.trim(),
          languageTag: state.preferences.uiLocale,
          noteScope:
            noteScope === 'context' && state.scope.kind === 'context'
              ? { kind: 'context', contextId: state.scope.contextId }
              : { kind: 'global' },
        }),
      false,
    );
    if (result === undefined) return false;
    this.#announcement = 'analysis.positionNoteSaved';
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  async updateAnalysisNote(
    contributionId: string,
    expectedContributionVersion: number,
    body: string,
  ): Promise<boolean> {
    const state = this.#readyState();
    if (state === undefined || body.trim() === '') return false;
    const result = await this.#runCommand(
      'update_analysis_note',
      (client) =>
        client.updateAnalysisNote(contributionId, {
          scope: state.scope,
          expectedContributionVersion,
          body: body.trim(),
        }),
      false,
    );
    if (result === undefined) return false;
    this.#announcement = 'analysis.positionNoteUpdated';
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  async deleteAnalysisNote(
    contributionId: string,
    expectedContributionVersion: number,
  ): Promise<boolean> {
    const state = this.#readyState();
    if (state === undefined) return false;
    const result = await this.#runCommand(
      'delete_analysis_note',
      (client) =>
        client.deleteAnalysisNote(contributionId, {
          scope: state.scope,
          expectedContributionVersion,
        }),
      false,
    );
    if (result === undefined) return false;
    this.#announcement = 'analysis.positionNoteDeleted';
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  async createWorkingContext(
    request: CreateWorkingContextRequestDto,
  ): Promise<boolean> {
    const result = await this.#runCommand(
      'create_context',
      (client) => client.createWorkingContext(request),
      false,
    );
    if (result === undefined) return false;
    this.#scope = Object.freeze({
      kind: 'context',
      contextId: result.context.contextId,
    });
    this.#inspectedInventoryFolderId = undefined;
    this.#inventoryContextOnly = true;
    this.#selectedInventoryItemId = null;
    this.#analysisFocus = undefined;
    this.#announcement = 'context.created';
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  async updateWorkingContextMetadata(
    contextId: string,
    request: UpdateWorkingContextMetadataRequestDto,
  ): Promise<boolean> {
    const result = await this.#runCommand('update_context_metadata', (client) =>
      client.updateWorkingContextMetadata(contextId, request),
    );
    return result !== undefined;
  }

  async setUiLanguage(uiLocale: UiLocale): Promise<void> {
    const state = this.#readyState();
    if (state === undefined) return;
    await this.#runCommand('set_language', (client) =>
      client.setUiLanguage({
        uiLocale,
        expectedRevision: state.preferences.preferenceRevision,
      }),
    );
  }

  async setDiagnosticLogLevel(
    level: DiagnosticSettingsDto['configuredLevel'],
  ): Promise<boolean> {
    const state = this.#readyState();
    if (state === undefined) return false;
    const result = await this.#runCommand(
      'set_diagnostic_log_level',
      (client) =>
        client.setDiagnosticLogLevel({
          level,
          expectedConfigurationRevision:
            state.diagnostics.configurationRevision,
        }),
      false,
    );
    if (result === undefined) return false;
    this.#announcement = result.settings.restartRequired
      ? 'diagnostics.levelSavedPendingRestart'
      : 'diagnostics.levelActive';
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  async createDiagnosticReport(): Promise<boolean> {
    const state = this.#readyState();
    const chooseDestination = this.#options.chooseDiagnosticReportDestination;
    if (
      state === undefined ||
      this.#busyCommand !== undefined ||
      chooseDestination === undefined
    ) {
      return false;
    }
    let destinationPath: string | undefined;
    try {
      destinationPath = await chooseDestination(
        state.diagnosticReportManifest.suggestedFileName,
      );
    } catch {
      this.#setReadyError('diagnostics.destination_unavailable');
      return false;
    }
    if (destinationPath === undefined) return false;
    const result = await this.#runCommand(
      'create_diagnostic_report',
      (client) =>
        client.createDiagnosticReport({
          acceptedManifestVersion:
            state.diagnosticReportManifest.manifestVersion,
          destinationPath,
        }),
      false,
    );
    if (result === undefined) return false;
    this.#announcement = 'diagnostics.reportCreated';
    this.#finishCommand();
    return true;
  }

  async chooseEngineExecutable(): Promise<string | undefined> {
    if (this.#busyCommand !== undefined) return undefined;
    try {
      return await this.#options.chooseEngineExecutable?.();
    } catch {
      this.#setReadyError('configuration.engine_picker_unavailable');
      return undefined;
    }
  }

  async chooseEngineWeights(): Promise<string | undefined> {
    if (this.#busyCommand !== undefined) return undefined;
    try {
      return await this.#options.chooseEngineWeights?.();
    } catch {
      this.#setReadyError('configuration.engine_picker_unavailable');
      return undefined;
    }
  }

  async previewEngineProviderConfiguration(
    input: EngineProviderConfigurationInputDto,
  ): Promise<EngineProviderConfigurationPreviewDto | undefined> {
    const result = await this.#runCommand(
      'preview_engine_provider',
      (client) => client.previewEngineProviderConfiguration(input),
      false,
    );
    if (result !== undefined) this.#finishCommand();
    return result;
  }

  selectEngineConfiguration(key: string): void {
    if (this.#busyCommand !== undefined) return;
    this.#engineConfigurationDrafts.select(key);
    this.#publishViewState();
  }

  createEngineConfigurationDraft(
    providerType: EngineConfigurationForm['providerType'],
  ): void {
    if (this.#busyCommand !== undefined) return;
    this.#engineConfigurationDrafts.create(providerType);
    this.#publishViewState();
  }

  updateEngineConfigurationDraft(
    key: string,
    patch: EngineConfigurationDraftPatch,
  ): void {
    if (this.#busyCommand !== undefined) return;
    this.#engineConfigurationDrafts.update(key, patch);
    this.#publishViewState();
  }

  discardEngineConfigurationDraft(key: string): void {
    const state = this.#readyState();
    if (state === undefined || this.#busyCommand !== undefined) return;
    this.#engineConfigurationDrafts.discard(key);
    this.#engineConfigurationDrafts.synchronize(
      state.engineProviders.providers,
    );
    this.#publishViewState();
  }

  async saveEngineConfigurationDraft(key: string): Promise<boolean> {
    if (this.#busyCommand !== undefined) return false;
    const request = this.#engineConfigurationDrafts.prepareSave(key);
    this.#publishViewState();
    if (request === undefined) return false;
    const lifecycle = this.#lifecycle;
    const provider = await this.#runCommand(
      'save_engine_provider',
      async (client) => {
        const preview = await client.previewEngineProviderConfiguration(
          request.input,
        );
        if (lifecycle !== this.#lifecycle) return null;
        if (preview.issues.length > 0) {
          this.#engineConfigurationDrafts.setIssues(
            key,
            mapEngineConfigurationIssues(preview.issues),
          );
          return null;
        }
        return client.saveEngineProviderConfiguration(
          request.input.instanceId,
          request,
        );
      },
      false,
    );
    if (provider === undefined) return false;
    if (provider === null) {
      this.#finishCommand();
      return false;
    }
    this.#committedReadVersion = ++this.#readVersion;
    this.#engineConfigurationDrafts.saved(key, provider);
    this.#announcement = 'engines.savedPendingRestart';
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  async saveEngineProviderConfiguration(
    input: EngineProviderConfigurationInputDto,
    expectedConfigurationRevision: string | null,
  ): Promise<boolean> {
    const result = await this.#runCommand(
      'save_engine_provider',
      (client) =>
        client.saveEngineProviderConfiguration(input.instanceId, {
          input,
          expectedConfigurationRevision,
        }),
      false,
    );
    if (result === undefined) return false;
    this.#announcement = 'engines.savedPendingRestart';
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  async removeEngineProviderConfiguration(
    provider: EngineProviderConfigurationDto,
  ): Promise<boolean> {
    const result = await this.#runCommand(
      'remove_engine_provider',
      (client) =>
        client.removeEngineProviderConfiguration(provider.instanceId, {
          expectedConfigurationRevision: provider.configurationRevision,
        }),
      false,
    );
    if (result === undefined) return false;
    this.#announcement = 'engines.removedPendingRestart';
    this.#engineConfigurationDrafts.removed(provider.instanceId);
    await this.refresh();
    this.#finishCommand();
    return true;
  }

  clearAnnouncement(): void {
    this.#announcement = undefined;
    this.#publishViewState();
  }

  close(): void {
    this.#lifecycle += 1;
    this.#busyCommand = undefined;
    this.#destructiveAction = undefined;
    this.#destructiveVersion += 1;
    this.#pendingEventRevision = undefined;
    this.#pendingUnversionedEvent = false;
    this.#events?.close();
    this.#events = undefined;
    this.#client = undefined;
    this.#inventoryRevisionPreview = undefined;
    this.#manageInventoryRevisionDraft = undefined;
    this.#revisionImpact = undefined;
    this.#contextAnalysisItems.clear();
    this.#analysisUnavailable.clear();
    this.#listeners.clear();
  }

  async #applyMoveRequest(move: MoveRequest): Promise<void> {
    const state = this.#readyState();
    if (state === undefined) return;
    const scratch = state.analysis.scratch;
    if (scratch !== undefined) {
      if (scratch.cursor !== scratch.steps.length) return;
      await this.#updateScratch('update_scratch', {
        kind: 'apply_move',
        move,
      });
      return;
    }

    const record = state.analysis.record;
    if (
      record === undefined &&
      state.analysis.allowedActions.includes('start_scratch')
    ) {
      await this.#startScratch({ kind: 'initial_position' }, move);
      return;
    }
    if (
      record === undefined ||
      record.historical ||
      record.revisionId !== record.currentRevisionId
    ) {
      return;
    }
    const savedNextStep = record.steps[record.cursor];
    if (
      savedNextStep !== undefined &&
      matchesSavedMove(move, savedNextStep.move, state.preferences.uiLocale)
    ) {
      await this.openRecordAnchor(savedNextStep.anchorId);
      return;
    }
    await this.#startScratch(
      {
        kind: 'inventory_anchor',
        itemId: record.itemId,
        revisionId: record.revisionId,
        anchorId: record.currentAnchorId,
      },
      move,
    );
  }

  async #updateScratch(
    command: 'update_scratch' | 'remove_last_move',
    action: UpdateAnalysisScratchRequestDto['action'],
  ): Promise<void> {
    const state = this.#readyState();
    const scratch = state?.analysis.scratch;
    if (state === undefined || scratch === undefined) return;
    const outcome = await this.#runCommand(
      command,
      async (client) => {
        const result = await client.updateAnalysisScratch({
          scope: state.scope,
          expectedScratchId: scratch.scratchId,
          expectedScratchRevision: scratch.scratchRevision,
          action,
        });
        const preview =
          result.scratch?.intent.kind === 'inventory_revision'
            ? await client.previewInventoryRevision({
                scope: state.scope,
                expectedScratchId: result.scratch.scratchId,
                expectedScratchRevision: result.scratch.scratchRevision,
              })
            : undefined;
        return Object.freeze({ result, preview });
      },
      false,
    );
    if (outcome === undefined) return;
    this.#inventoryRevisionPreview = bindInventoryRevisionPreview(
      state.scope,
      outcome.result.scratch,
      outcome.preview,
    );
    await this.refresh();
    this.#finishCommand();
  }

  async #startInventoryRevision(
    mode: 'extend' | 'truncate_after' | 'replace_move' | 'metadata',
    anchorId: string,
    metadata?: {
      readonly displayName: string;
      readonly summary: string | null;
    },
  ): Promise<void> {
    const state = this.#readyState();
    const record = state?.analysis.record;
    const existingScratch = state?.analysis.scratch;
    if (
      state === undefined ||
      record === undefined ||
      record.itemType !== 'analysis' ||
      (existingScratch !== undefined &&
        existingScratch.intent.kind !== 'inventory_revision') ||
      record.historical ||
      record.revisionId !== record.currentRevisionId
    ) {
      return;
    }
    const outcome = await this.#runCommand(
      'start_inventory_revision',
      async (client) => {
        const result = await client.startInventoryRevision(record.itemId, {
          scope: state.scope,
          baseRevisionId: record.revisionId,
          anchorId,
          mode,
          expectedScratchId: existingScratch?.scratchId ?? null,
          expectedScratchRevision: existingScratch?.scratchRevision ?? null,
          ...(metadata === undefined ? {} : metadata),
        });
        const preview =
          mode === 'replace_move' && result.scratch.steps.length === 0
            ? undefined
            : await client.previewInventoryRevision({
                scope: state.scope,
                expectedScratchId: result.scratch.scratchId,
                expectedScratchRevision: result.scratch.scratchRevision,
              });
        return Object.freeze({ result, preview });
      },
      false,
    );
    if (outcome === undefined) return;
    this.#analysisFocus =
      state.scope.kind === 'context'
        ? undefined
        : Object.freeze({
            itemId: record.itemId,
            revisionId: record.revisionId,
            anchorId,
          });
    this.#inventoryRevisionPreview = bindInventoryRevisionPreview(
      state.scope,
      outcome.result.scratch,
      outcome.preview,
    );
    await this.refresh();
    this.#finishCommand();
  }

  async #startScratch(
    origin: Extract<
      UpdateAnalysisScratchRequestDto['action'],
      { kind: 'start' }
    >['origin'],
    firstMove?: MoveRequest,
  ): Promise<boolean> {
    const state = this.#readyState();
    const lifecycle = this.#lifecycle;
    if (state === undefined) return false;
    if (state.analysis.scratch !== undefined) {
      if (state.analysis.scratchHasChanges) return false;
      if (!(await this.discardAnalysisScratch())) return false;
      if (lifecycle !== this.#lifecycle || !sameScope(state.scope, this.#scope))
        return false;
      return this.#startScratch(origin, firstMove);
    }
    const result = await this.#runCommand(
      'start_scratch',
      (client) =>
        client.updateAnalysisScratch({
          scope: state.scope,
          expectedScratchId: null,
          expectedScratchRevision: null,
          action: {
            kind: 'start',
            origin,
            ...(firstMove === undefined ? {} : { firstMove }),
          },
        }),
      false,
    );
    if (result === undefined) return false;
    if (result.scratch === undefined) {
      this.#finishCommand();
      return false;
    }
    this.#clearAnalysisUnavailable(state.scope);
    this.#analysisFocus = undefined;
    this.#activity = 'analyze';
    this.#publishViewState();
    await this.refresh();
    this.#finishCommand();
    await this.#persistStartup();
    return true;
  }

  async #loadInventoryRevisionPreview(
    client: PlysmithApplicationClient,
    analysis: AnalysisWorkspaceDto,
    dataRevision: number,
  ): Promise<BoundInventoryRevisionPreview | undefined> {
    const scratch = analysis.scratch;
    if (
      scratch?.intent.kind !== 'inventory_revision' ||
      (scratch.intent.mode === 'replace_move' && scratch.steps.length === 0)
    ) {
      return undefined;
    }
    const existing = this.#inventoryRevisionPreview;
    if (
      existing !== undefined &&
      sameScope(existing.scope, analysis.scope) &&
      existing.scratchId === scratch.scratchId &&
      existing.scratchRevision === scratch.scratchRevision &&
      existing.preview.dataRevision === dataRevision
    ) {
      return existing;
    }
    const preview = await client.previewInventoryRevision({
      scope: analysis.scope,
      expectedScratchId: scratch.scratchId,
      expectedScratchRevision: scratch.scratchRevision,
    });
    return bindInventoryRevisionPreview(analysis.scope, scratch, preview);
  }

  #visibleInventoryRevisionPreview(
    analysis: AnalysisWorkspaceDto | undefined,
  ): InventoryRevisionPreviewDto | undefined {
    if (analysis === undefined || !sameScope(analysis.scope, this.#scope))
      return undefined;
    const scratch = analysis.scratch;
    const bound = this.#inventoryRevisionPreview;
    if (
      scratch === undefined ||
      bound === undefined ||
      !sameScope(bound.scope, analysis.scope) ||
      bound.scratchId !== scratch.scratchId ||
      bound.scratchRevision !== scratch.scratchRevision
    ) {
      return undefined;
    }
    return bound.preview;
  }

  #analysisRequest(): GetAnalysisWorkspaceRequestDto {
    return {
      scopeKind: this.#scope.kind,
      ...(this.#scope.kind === 'context'
        ? { contextId: this.#scope.contextId }
        : {}),
      ...(this.#analysisFocus ?? {}),
    };
  }

  #playoutRequest(): {
    readonly scopeKind: 'free' | 'context';
    readonly contextId?: string;
  } {
    return {
      scopeKind: this.#scope.kind,
      ...(this.#scope.kind === 'context'
        ? { contextId: this.#scope.contextId }
        : {}),
    };
  }

  #expectedPlayout(): ExpectedPlayoutRequestDto | undefined {
    const playout = this.#readyState()?.playout;
    if (playout === null || playout === undefined) return undefined;
    return {
      scope: this.#scope,
      draftId: playout.draft.draftId,
      expectedDraftRevision: playout.draft.draftRevision,
    };
  }

  async #runPlayoutCommand(
    command:
      | 'retry_playout'
      | 'pause_playout'
      | 'resume_playout'
      | 'stop_playout'
      | 'cancel_playout_completion',
    action: (
      client: PlysmithApplicationClient,
      request: ExpectedPlayoutRequestDto,
    ) => Promise<PlayoutDto>,
  ): Promise<void> {
    const request = this.#expectedPlayout();
    if (request === undefined) return;
    await this.#runCommand(command, (client) => action(client, request));
  }

  #inventoryRequest(): SearchInventoryRequestDto {
    return {
      pageSize: '50',
      ...(this.#inventoryQuery === '' ? {} : { query: this.#inventoryQuery }),
      ...(this.#scope.kind === 'context' && this.#inventoryContextOnly
        ? { contextId: this.#scope.contextId }
        : {}),
    };
  }

  #effectiveRevisionId(item: InventoryItem): string {
    const state = this.#readyState();
    if (state?.scope.kind !== 'context') return item.currentRevisionId;
    const member = state.contextWorkspace?.members.find(
      (candidate) => candidate.itemId === item.itemId,
    );
    if (member !== undefined) return member.currentRevisionId;
    return (
      state.contextWorkspace?.pendingRevisionImpacts.find(
        (impact) => impact.itemId === item.itemId,
      )?.pinnedRevisionId ?? item.currentRevisionId
    );
  }

  #hasPendingRevisionImpact(itemId: string): boolean {
    const state = this.#readyState();
    return (
      state?.scope.kind === 'context' &&
      (state.contextWorkspace?.pendingRevisionImpacts.some(
        (impact) => impact.itemId === itemId,
      ) ??
        false)
    );
  }

  #readKey(): string {
    return JSON.stringify({
      scope: this.#scope,
      analysisFocus: this.#analysisFocus,
      inventoryQuery: this.#inventoryQuery,
      inventoryContextOnly: this.#inventoryContextOnly,
    });
  }

  async #runCommand<T>(
    command: ApplicationCommand,
    action: (client: PlysmithApplicationClient) => Promise<T>,
    refreshAfter = true,
  ): Promise<T | undefined> {
    const client = this.#client;
    if (
      client === undefined ||
      this.#readyState() === undefined ||
      this.#busyCommand !== undefined
    )
      return undefined;
    const lifecycle = this.#lifecycle;
    const startedAt = performance.now();
    this.#busyCommand = command;
    this.#errorCode = undefined;
    this.#announcement = undefined;
    this.#publishViewState();
    let succeeded = false;
    try {
      const result = await action(client);
      if (lifecycle !== this.#lifecycle) return undefined;
      succeeded = true;
      if (refreshAfter) await this.refresh();
      this.#diagnose({
        level: 'info',
        eventCode: 'renderer.command.completed',
        operation: command,
        status: 'succeeded',
        durationMilliseconds: performance.now() - startedAt,
      });
      return result;
    } catch (error) {
      if (lifecycle !== this.#lifecycle) return undefined;
      const errorCode = hostErrorCode(error);
      await this.refresh();
      this.#errorCode = errorCode;
      this.#diagnose({
        level: 'error',
        eventCode: 'renderer.command.failed',
        operation: command,
        status: 'failed',
        problemCode: errorCode,
        durationMilliseconds: performance.now() - startedAt,
      });
      return undefined;
    } finally {
      if (lifecycle === this.#lifecycle && (refreshAfter || !succeeded))
        this.#finishCommand();
    }
  }

  #finishCommand(): void {
    this.#busyCommand = undefined;
    this.#publishViewState();
    if (this.#hasUnobservedEvent()) void this.refresh();
  }

  #readyState():
    Extract<PlysmithApplicationState, { phase: 'ready' }> | undefined {
    return this.#state.phase === 'ready' ? this.#state : undefined;
  }

  #createClient(connection: HostConnection): PlysmithApplicationClient {
    return (
      this.#options.createClient?.(connection) ??
      new PlysmithHostClient(connection, {
        origin: 'app://plysmith',
        onDiagnostic: (event) => this.#recordHostRequestDiagnostic(event),
      })
    );
  }

  #createEventSubscription(
    connection: HostConnection,
    onChange: (event: HostEvent) => void,
    onReconnect: () => void,
    onInvalidEvent: () => void,
  ): HostEventSubscription {
    return (
      this.#options.createEventSubscription?.(
        connection,
        onChange,
        onReconnect,
        onInvalidEvent,
      ) ??
      new HostEventClient(connection, {
        origin: 'app://plysmith',
        onDiagnostic: (event) => this.#recordHostRequestDiagnostic(event),
        onEvent: onChange,
        onGap: () => undefined,
        onReconnect: () => {
          this.#diagnose({
            level: 'info',
            eventCode: 'renderer.events.reconnected',
            status: 'ready',
          });
          onReconnect();
        },
        onInvalidEvent: () => {
          this.#diagnose({
            level: 'error',
            eventCode: 'renderer.events.invalid',
            status: 'failed',
            problemCode: 'host.invalid_event',
          });
          onInvalidEvent();
        },
      })
    );
  }

  #recordHostRequestDiagnostic(event: HostRequestDiagnostic): void {
    if (event.kind === 'completed') return;
    this.#diagnose({
      level: 'error',
      eventCode: 'client.request.failed',
      correlationId: event.correlationId,
      status: 'failed',
      durationMilliseconds: event.durationMilliseconds,
    });
  }

  #diagnose(event: RendererDiagnosticEvent): void {
    try {
      this.#options.recordDiagnostic?.(event);
    } catch {
      // Diagnostics must never change application behavior.
    }
  }

  #handleHostEvent(event: HostEvent): void {
    const state = this.#readyState();
    if (event.kind === 'inventory.item-deleted' && state !== undefined) {
      const itemId = event.payload.itemId;
      const knownRemoval = this.#analysisUnavailable.get(scopeKey(state.scope));
      const boundItem =
        state.analysis.record?.itemId ??
        (state.analysis.scratch?.origin.kind === 'inventory_anchor'
          ? state.analysis.scratch.origin.itemId
          : undefined);
      if (boundItem === itemId || knownRemoval?.itemId === itemId) {
        this.#analysisUnavailable.set(scopeKey(state.scope), {
          reason: 'deleted_from_inventory',
          itemId,
          displayName:
            state.analysis.record?.displayName ??
            knownRemoval?.displayName ??
            state.inventory.items.find((item) => item.itemId === itemId)
              ?.displayName ??
            itemId,
        });
        this.#analysisFocus = undefined;
        this.#publishViewState();
      }
    }
    if (
      event.kind === 'workspace.context-deleted' &&
      this.#scope.kind === 'context' &&
      event.payload.contextId === this.#scope.contextId
    ) {
      this.#startupNotice = {
        contextId: this.#scope.contextId,
        reason: 'deleted',
        ...(state?.contextWorkspace === undefined
          ? {}
          : { displayName: state.contextWorkspace.context.displayName }),
      };
      this.#scope = { kind: 'free' };
      this.#inspectedInventoryFolderId = undefined;
      this.#analysisFocus = undefined;
      this.#selectedInventoryItemId = undefined;
      this.#inventoryContextOnly = false;
      this.#playoutStart = undefined;
      this.#pendingPlayoutStart = undefined;
      this.#completedPlayout = undefined;
      this.#completedPlayoutView = undefined;
    }
    const scratchEventNeedsRefresh =
      event.kind === 'analysis.scratch-changed' &&
      state !== undefined &&
      sameScope(state.scope, event.payload.scope) &&
      (state.analysis.scratch?.scratchId !== event.payload.scratchId ||
        state.analysis.scratch?.scratchRevision !==
          event.payload.scratchRevision);
    const playoutEventNeedsRefresh =
      event.kind === 'playout.changed' &&
      state !== undefined &&
      sameScope(state.scope, event.payload.scope) &&
      (state.playout?.draft.draftId !== event.payload.draftId ||
        state.playout.draft.draftRevision !== event.payload.draftRevision);
    if (event.kind === 'host.replay-gap') {
      void this.refresh();
      return;
    }
    if (playoutEventNeedsRefresh && this.#busyCommand !== undefined) {
      void this.refresh();
      return;
    }
    if (
      !scratchEventNeedsRefresh &&
      !playoutEventNeedsRefresh &&
      state !== undefined &&
      state.status.persistence.dataRevision >= event.dataRevision
    ) {
      return;
    }
    if (this.#busyCommand === undefined) {
      void this.refresh();
      return;
    }
    if (scratchEventNeedsRefresh) {
      this.#pendingUnversionedEvent = true;
      return;
    }
    this.#pendingEventRevision = Math.max(
      this.#pendingEventRevision ?? 0,
      event.dataRevision,
    );
  }

  #acknowledgeEventsThrough(dataRevision: number): void {
    if (
      this.#pendingEventRevision !== undefined &&
      this.#pendingEventRevision <= dataRevision
    ) {
      this.#pendingEventRevision = undefined;
    }
    this.#pendingUnversionedEvent = false;
  }

  #hasUnobservedEvent(): boolean {
    if (this.#pendingUnversionedEvent) return true;
    const pendingRevision = this.#pendingEventRevision;
    if (pendingRevision === undefined) return false;
    const state = this.#readyState();
    if (
      state !== undefined &&
      state.status.persistence.dataRevision >= pendingRevision
    ) {
      this.#pendingEventRevision = undefined;
      return false;
    }
    return true;
  }

  #clearAnalysisUnavailable(scope: WorkScope): void {
    this.#analysisUnavailable.delete(scopeKey(scope));
    this.#contextAnalysisItems.delete(scopeKey(scope));
  }

  #updateAnalysisUnavailable(
    analysis: AnalysisWorkspaceDto,
    workspace: WorkingContextWorkspaceDto | undefined,
  ): void {
    if (analysis.scope.kind === 'free') {
      if (analysis.record !== undefined || analysis.scratch !== undefined)
        this.#analysisUnavailable.delete('free');
      return;
    }
    if (
      analysis.scope.kind !== 'context' ||
      workspace?.context.contextId !== analysis.scope.contextId
    )
      return;
    const contextId = analysis.scope.contextId;
    const previous = this.#contextAnalysisItems.get(contextId);
    const notice = this.#analysisUnavailable.get(contextId);
    const hasContent =
      analysis.record !== undefined || analysis.scratch !== undefined;
    if (
      hasContent ||
      workspace.members.some((member) => member.itemId === notice?.itemId)
    ) {
      this.#analysisUnavailable.delete(contextId);
    } else if (
      notice?.reason !== 'deleted_from_inventory' &&
      previous !== undefined &&
      !workspace.members.some((member) => member.itemId === previous.itemId)
    ) {
      this.#analysisUnavailable.set(contextId, {
        reason: 'removed_from_context',
        ...previous,
      });
    }

    // Only accepted content with a proven assignment can establish later removal.
    const itemId =
      analysis.record?.itemId ??
      (analysis.scratch?.origin.kind === 'inventory_anchor'
        ? analysis.scratch.origin.itemId
        : undefined);
    const member = workspace.members.find((entry) => entry.itemId === itemId);
    if (member === undefined) {
      this.#contextAnalysisItems.delete(contextId);
    } else {
      this.#contextAnalysisItems.set(contextId, {
        itemId: member.itemId,
        displayName: analysis.record?.displayName ?? member.displayName,
      });
    }
  }

  #visibleAnalysisUnavailable(
    analysis: AnalysisWorkspaceDto,
  ): AnalysisUnavailable | undefined {
    if (
      !sameScope(this.#scope, analysis.scope) ||
      analysis.record !== undefined ||
      analysis.scratch !== undefined
    )
      return undefined;
    return this.#analysisUnavailable.get(scopeKey(this.#scope));
  }

  #publishViewState(): void {
    if (this.#state.phase !== 'ready') return;
    const state = this.#state;
    const analysisUnavailable = this.#visibleAnalysisUnavailable(
      state.analysis,
    );
    const inventoryRevisionPreview = this.#visibleInventoryRevisionPreview(
      state.analysis,
    );
    this.#setState(
      Object.freeze({
        phase: 'ready',
        status: state.status,
        preferences: state.preferences,
        diagnostics: state.diagnostics,
        diagnosticReportManifest: state.diagnosticReportManifest,
        contexts: state.contexts,
        inventory: state.inventory,
        inventoryOrganization: state.inventoryOrganization,
        inventoryPresentation: this.#inventoryPresentation,
        ...(this.#inspectedInventoryFolderId === undefined
          ? {}
          : { inspectedInventoryFolderId: this.#inspectedInventoryFolderId }),
        ...(this.#selectedInventoryFolders.get(scopeKey(this.#scope)) ===
        undefined
          ? {}
          : {
              selectedInventoryFolderId: this.#selectedInventoryFolders.get(
                scopeKey(this.#scope),
              )!,
            }),
        analysis: state.analysis,
        scopeWorkspace: state.scopeWorkspace,
        ...(this.#startupNotice === undefined
          ? {}
          : { startupNotice: this.#startupNotice }),
        ...(this.#destructiveAction === undefined
          ? {}
          : { destructiveAction: this.#destructiveAction }),
        ...(analysisUnavailable === undefined ? {} : { analysisUnavailable }),
        analysisProviders: state.analysisProviders,
        playoutProviders: state.playoutProviders,
        engineProviders: state.engineProviders,
        engineConfigurationDrafts: this.#engineConfigurationDrafts.snapshot,
        playout: state.playout,
        ...(this.#playoutStart === undefined
          ? {}
          : { playoutStart: this.#playoutStart }),
        ...(this.#pendingPlayoutStart === undefined
          ? {}
          : { pendingPlayoutStart: this.#pendingPlayoutStart }),
        ...(this.#completedPlayout === undefined
          ? {}
          : { completedPlayout: this.#completedPlayout }),
        ...(this.#completedPlayoutView === undefined
          ? {}
          : { completedPlayoutView: this.#completedPlayoutView }),
        ...(this.#pendingPlayoutCompletion === undefined
          ? {}
          : { pendingPlayoutCompletion: this.#pendingPlayoutCompletion }),
        ...(inventoryRevisionPreview === undefined
          ? {}
          : { inventoryRevisionPreview }),
        ...(this.#manageInventoryRevisionDraft === undefined
          ? {}
          : {
              manageInventoryRevisionDraft: this.#manageInventoryRevisionDraft,
            }),
        ...(this.#revisionImpact === undefined
          ? {}
          : { revisionImpact: this.#revisionImpact }),
        ...(state.contextWorkspace === undefined
          ? {}
          : { contextWorkspace: state.contextWorkspace }),
        activity: this.#activity,
        scope: this.#scope,
        inventoryQuery: this.#inventoryQuery,
        inventoryContextOnly: this.#inventoryContextOnly,
        ...(this.#selectedInventoryItemId == null
          ? {}
          : { selectedInventoryItemId: this.#selectedInventoryItemId }),
        refreshing:
          state.refreshing || this.#committedReadKey !== this.#readKey(),
        ...(this.#busyCommand === undefined
          ? {}
          : { busyCommand: this.#busyCommand }),
        ...(this.#errorCode === undefined
          ? {}
          : { errorCode: this.#errorCode }),
        ...(this.#announcement === undefined
          ? {}
          : { announcement: this.#announcement }),
      }),
    );
  }

  #setRefreshing(refreshing: boolean): void {
    if (this.#state.phase !== 'ready' || this.#state.refreshing === refreshing)
      return;
    this.#setState(Object.freeze({ ...this.#state, refreshing }));
  }

  #setUnavailable(lifecycle: number, errorCode?: string): void {
    if (lifecycle !== this.#lifecycle) return;
    this.#setState(
      errorCode === undefined
        ? Object.freeze({ phase: 'unavailable' })
        : Object.freeze({ phase: 'unavailable', errorCode }),
    );
  }

  #setReadyError(errorCode: string): void {
    if (this.#state.phase !== 'ready') return;
    this.#errorCode = errorCode;
    this.#publishViewState();
  }

  #setState(state: PlysmithApplicationState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}

function playoutSourcePath(
  displayName: string,
  workspace: AnalysisWorkspaceDto,
): { readonly sourcePath?: NonNullable<PlayoutDto['draft']['sourcePath']> } {
  if (workspace.record === undefined && workspace.scratch === undefined)
    return {};
  const path = analysisPathPresentation({
    ...(workspace.record === undefined ? {} : { record: workspace.record }),
    ...(workspace.scratch === undefined ? {} : { scratch: workspace.scratch }),
  });
  const root = path.positions[0]?.state;
  if (root === undefined) return {};
  return {
    sourcePath: Object.freeze({
      displayName,
      root,
      steps: Object.freeze(
        path.entries.slice(0, path.currentPositionIndex).map((entry) =>
          Object.freeze({
            before: entry.before,
            move: Object.freeze({ ...entry.move }),
            after: entry.after,
          }),
        ),
      ),
    }),
  };
}

function moveRequest(value: string, locale: UiLocale): MoveRequest {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(value)
    ? { kind: 'coordinates', value }
    : { kind: 'notation', value, locale };
}

function promotionLetter(
  promotion?: 'queen' | 'rook' | 'bishop' | 'knight',
): string {
  return promotion === undefined
    ? ''
    : { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }[promotion];
}

function matchesSavedMove(
  request: MoveRequest,
  saved: CanonicalMove,
  locale: UiLocale,
): boolean {
  if (request.kind === 'notation') {
    const value = normalizeCastleNotation(request.value.trim());
    return (
      value === normalizeCastleNotation(saved.san) ||
      value === normalizeCastleNotation(localizeSan(saved.san, locale))
    );
  }
  const promotion =
    saved.promotion === undefined
      ? ''
      : ({ queen: 'q', rook: 'r', bishop: 'b', knight: 'n' } as const)[
          saved.promotion
        ];
  return request.value.toLowerCase() === `${saved.from}${saved.to}${promotion}`;
}

function normalizeCastleNotation(value: string): string {
  return value.replaceAll('0', 'O');
}

function anchorBeforeMoveCount(
  record: AnalysisRecordDto,
  moveCount: number,
): string {
  if (moveCount <= 0) return record.rootAnchorId;
  return record.steps[moveCount - 1]?.anchorId ?? record.rootAnchorId;
}

function sameDataRevision(
  status: SystemStatusDto,
  preferences: UserPreferencesDto,
  contexts: ListWorkingContextsResultDto,
  inventory: SearchInventoryResultDto,
  analysis: AnalysisWorkspaceDto | undefined,
  workspace: WorkingContextWorkspaceDto | undefined,
  playout: PlayoutDto | null,
): boolean {
  const revisions = [
    status.persistence.dataRevision,
    preferences.dataRevision,
    contexts.dataRevision,
    inventory.dataRevision,
    ...(analysis === undefined ? [] : [analysis.dataRevision]),
    ...(playout === null ? [] : [playout.dataRevision]),
    ...(workspace === undefined ? [] : [workspace.dataRevision]),
  ];
  return revisions.every((revision) => revision === revisions[0]);
}

function hostErrorCode(error: unknown): string {
  return error instanceof HostClientProblem
    ? error.problem.code
    : 'host.unavailable';
}

function sameScope(left: WorkScope, right: WorkScope): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === 'free' ||
      (right.kind === 'context' && left.contextId === right.contextId))
  );
}

function scopeKey(scope: WorkScope): string {
  return scope.kind === 'free' ? 'free' : scope.contextId;
}

function bindInventoryRevisionPreview(
  scope: WorkScope,
  scratch: AnalysisWorkspaceDto['scratch'],
  preview: InventoryRevisionPreviewDto | undefined,
): BoundInventoryRevisionPreview | undefined {
  if (scratch === undefined || preview === undefined) return undefined;
  return Object.freeze({
    scope,
    scratchId: scratch.scratchId,
    scratchRevision: scratch.scratchRevision,
    preview,
  });
}

function isCurrentOrNewerRead(
  state: PlysmithApplicationState,
  status: SystemStatusDto,
  preferences: UserPreferencesDto,
): boolean {
  if (state.phase !== 'ready') return true;
  return (
    status.persistence.dataRevision >= state.status.persistence.dataRevision &&
    preferences.dataRevision >= state.preferences.dataRevision &&
    preferences.preferenceRevision >= state.preferences.preferenceRevision
  );
}
