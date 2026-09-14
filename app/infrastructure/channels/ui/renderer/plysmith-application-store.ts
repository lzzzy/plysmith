import {
  HostClientProblem,
  HostEventClient,
  PlysmithHostClient,
  type AddContextReferenceRequestDto,
  type AddContextReferenceResultDto,
  type AnalysisNoteMutationResultDto,
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
  type SearchInventoryRequestDto,
  type SearchInventoryResultDto,
  type SetUiLanguageResultDto,
  type SetDiagnosticLogLevelRequestDto,
  type SetDiagnosticLogLevelResultDto,
  type SetWorkScopeResumeRequestDto,
  type SetWorkScopeResumeResultDto,
  type SystemStatusDto,
  type DeleteAnalysisNoteRequestDto,
  type UpdateAnalysisScratchRequestDto,
  type UpdateAnalysisScratchResultDto,
  type UpdateAnalysisNoteRequestDto,
  type UserPreferencesDto,
  type WorkingContextWorkspaceDto,
} from '../../host_client/index.ts';
import type {
  DesktopBootstrap,
  RendererDiagnosticEvent,
} from '../desktop/contract.ts';
import type { UiLocale } from './messages.ts';

export type ActivityId = 'manage' | 'analyze' | 'settings';
export type WorkScope = AnalysisWorkspaceDto['scope'];
export type InventoryItem = SearchInventoryResultDto['items'][number];
export type WorkingContext = ListWorkingContextsResultDto['contexts'][number];
export type ApplicationCommand =
  | 'set_language'
  | 'set_diagnostic_log_level'
  | 'create_diagnostic_report'
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
  | 'create_context'
  | 'add_context_reference'
  | 'set_resume'
  | 'load_more_inventory'
  | 'load_more_contexts';

export interface PlysmithApplicationClient {
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
  updateAnalysisScratch(
    request: UpdateAnalysisScratchRequestDto,
  ): Promise<UpdateAnalysisScratchResultDto>;
  createAnalysisRecord(
    request: CreateAnalysisRecordRequestDto,
  ): Promise<CreateAnalysisRecordResultDto>;
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
  createWorkingContext(
    request: CreateWorkingContextRequestDto,
  ): Promise<CreateWorkingContextResultDto>;
  addContextReference(
    contextId: string,
    request: AddContextReferenceRequestDto,
  ): Promise<AddContextReferenceResultDto>;
  setWorkScopeResume(
    contextId: string,
    request: SetWorkScopeResumeRequestDto,
  ): Promise<SetWorkScopeResumeResultDto>;
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
      readonly analysis: AnalysisWorkspaceDto;
      readonly contextWorkspace?: WorkingContextWorkspaceDto;
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
  #inventoryQuery = '';
  #inventoryContextOnly = false;
  #selectedInventoryItemId: string | undefined;
  #busyCommand: ApplicationCommand | undefined;
  #errorCode: string | undefined;
  #announcement: string | undefined;
  #pendingEventRevision: number | undefined;
  #pendingUnversionedEvent = false;
  #committedReadKey: string | undefined;
  #freeAnalysisFocus: AnalysisFocus | undefined;

  constructor(options: PlysmithApplicationStoreOptions) {
    this.#options = options;
  }

  getSnapshot = (): PlysmithApplicationState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

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
    await this.refresh();
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
      do {
        const startedAt = performance.now();
        this.#refreshAgain = false;
        const readVersion = ++this.#readVersion;
        const readKey = this.#readKey();
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
            analysis,
            workspace,
          ] = await Promise.all([
            client.getSystemStatus(),
            client.getUserPreferences(),
            client.getDiagnosticSettings(),
            client.getDiagnosticReportManifest(),
            client.listWorkingContexts({ pageSize: '100' }),
            client.searchInventory(this.#inventoryRequest()),
            client.getAnalysisWorkspace(this.#analysisRequest()),
            contextId === undefined
              ? Promise.resolve(undefined)
              : client.getWorkingContextWorkspace(contextId),
          ]);
          if (
            !sameDataRevision(
              status,
              preferences,
              contexts,
              inventory,
              analysis,
              workspace,
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
          this.#committedReadKey = readKey;
          this.#errorCode = undefined;
          this.#acknowledgeEventsThrough(status.persistence.dataRevision);
          const selectedInventoryItemId =
            this.#selectedInventoryItemId ??
            workspace?.managementResume?.selectedItemId;
          this.#setState(
            Object.freeze({
              phase: 'ready',
              status,
              preferences,
              diagnostics,
              diagnosticReportManifest,
              contexts,
              inventory,
              analysis,
              ...(workspace === undefined
                ? {}
                : { contextWorkspace: workspace }),
              activity: this.#activity,
              scope: this.#scope,
              inventoryQuery: this.#inventoryQuery,
              inventoryContextOnly: this.#inventoryContextOnly,
              ...(selectedInventoryItemId === undefined
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
    const returningToContextAnalysis =
      activity === 'analyze' &&
      this.#activity !== 'analyze' &&
      this.#scope.kind === 'context';
    this.#activity = activity;
    if (returningToContextAnalysis) this.#analysisFocus = undefined;
    this.#publishViewState();
    if (returningToContextAnalysis) void this.refresh();
  }

  async setScope(scope: WorkScope): Promise<void> {
    if (
      scope.kind === this.#scope.kind &&
      (scope.kind === 'free' ||
        (this.#scope.kind === 'context' &&
          scope.contextId === this.#scope.contextId))
    ) {
      return;
    }
    if (this.#scope.kind === 'free') {
      this.#freeAnalysisFocus = this.#analysisFocus;
    }
    this.#scope = Object.freeze({ ...scope });
    this.#analysisFocus =
      scope.kind === 'free' ? this.#freeAnalysisFocus : undefined;
    this.#selectedInventoryItemId = undefined;
    this.#inventoryContextOnly = scope.kind === 'context';
    this.#publishViewState();
    await this.refresh();
  }

  async searchInventory(query: string): Promise<void> {
    this.#inventoryQuery = query.trim();
    this.#selectedInventoryItemId = undefined;
    this.#publishViewState();
    await this.refresh();
  }

  async setInventoryContextOnly(contextOnly: boolean): Promise<void> {
    this.#inventoryContextOnly = this.#scope.kind === 'context' && contextOnly;
    this.#selectedInventoryItemId = undefined;
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
    this.#setState(
      Object.freeze({
        ...current,
        inventory: Object.freeze({
          items: Object.freeze([
            ...current.inventory.items,
            ...result.items.filter((item) => !known.has(item.itemId)),
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
    this.#selectedInventoryItemId = item.itemId;
    this.#publishViewState();
    if (
      this.#scope.kind !== 'context' ||
      !item.contextIds.includes(this.#scope.contextId)
    ) {
      return;
    }
    const expectedResumeVersion =
      this.#readyState()?.contextWorkspace?.managementResume?.resumeVersion ??
      null;
    const contextId = this.#scope.contextId;
    await this.#runCommand('set_resume', async (client) =>
      client.setWorkScopeResume(contextId, {
        area: 'manage',
        expectedResumeVersion,
        presentation: 'list',
        selectedItemId: item.itemId,
        selectedAnchorId: item.rootAnchorId,
      }),
    );
  }

  async openInventoryItem(item: InventoryItem): Promise<void> {
    this.#analysisFocus = Object.freeze({
      itemId: item.itemId,
      revisionId: item.currentRevisionId,
      anchorId: item.rootAnchorId,
    });
    this.#activity = 'analyze';
    this.#publishViewState();
    if (
      this.#scope.kind !== 'context' ||
      !item.contextIds.includes(this.#scope.contextId)
    ) {
      await this.refresh();
      return;
    }
    const expectedResumeVersion =
      this.#readyState()?.contextWorkspace?.analysisResume?.resumeVersion ??
      null;
    const contextId = this.#scope.contextId;
    const result = await this.#runCommand(
      'set_resume',
      async (client) =>
        client.setWorkScopeResume(contextId, {
          area: 'analyze',
          expectedResumeVersion,
          mode: 'analyze',
          itemId: item.itemId,
          revisionId: item.currentRevisionId,
          anchorId: item.rootAnchorId,
        }),
      false,
    );
    if (result === undefined) return;
    this.#analysisFocus = undefined;
    await this.refresh();
    this.#finishCommand();
  }

  async openCurrentRecordWithoutContext(): Promise<void> {
    const record = this.#readyState()?.analysis.record;
    if (record === undefined) return;
    this.#scope = Object.freeze({ kind: 'free' });
    this.#inventoryContextOnly = false;
    this.#analysisFocus = Object.freeze({
      itemId: record.itemId,
      revisionId: record.revisionId,
      anchorId: record.currentAnchorId,
    });
    this.#publishViewState();
    await this.refresh();
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
    if (state.scope.kind !== 'context' || record.readOnlyPreview) {
      await this.refresh();
      return;
    }
    const contextId = state.scope.contextId;
    const expectedResumeVersion =
      state.contextWorkspace?.analysisResume?.resumeVersion ?? null;
    const result = await this.#runCommand(
      'set_resume',
      (client) =>
        client.setWorkScopeResume(contextId, {
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

  async openAnalysisTarget(target: AnalysisFocus): Promise<void> {
    const state = this.#readyState();
    const record = state?.analysis.record;
    if (state === undefined || record === undefined) return;
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

  async addCurrentRecordToContext(): Promise<void> {
    const state = this.#readyState();
    if (state?.scope.kind !== 'context' || state.analysis.record === undefined)
      return;
    const contextId = state.scope.contextId;
    const record = state.analysis.record;
    await this.#runCommand('add_context_reference', (client) =>
      client.addContextReference(contextId, {
        itemId: record.itemId,
        anchorId: record.rootAnchorId,
      }),
    );
  }

  async startScratchAtInitialPosition(): Promise<void> {
    await this.#startScratch({ kind: 'initial_position' });
  }

  async startScratchAtFen(fen: string): Promise<void> {
    await this.#startScratch({ kind: 'fen', fen: fen.trim() });
  }

  async startScratchAtTarget(target: AnalysisFocus): Promise<void> {
    const record = this.#readyState()?.analysis.record;
    if (record === undefined || record.readOnlyPreview) return;
    await this.#startScratch({
      kind: 'inventory_anchor',
      itemId: target.itemId,
      revisionId: target.revisionId,
      anchorId: target.anchorId,
    });
  }

  async applyMove(value: string): Promise<void> {
    const state = this.#readyState();
    const scratchRevision = state?.analysis.scratch?.scratchRevision;
    const scratchId = state?.analysis.scratch?.scratchId;
    const trimmed = value.trim();
    if (
      state === undefined ||
      scratchId === undefined ||
      scratchRevision === undefined ||
      trimmed === ''
    )
      return;
    const coordinates = /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(trimmed);
    await this.#runCommand('update_scratch', (client) =>
      client.updateAnalysisScratch({
        scope: state.scope,
        expectedScratchId: scratchId,
        expectedScratchRevision: scratchRevision,
        action: coordinates
          ? {
              kind: 'apply_move',
              move: { kind: 'coordinates', value: trimmed },
            }
          : {
              kind: 'apply_move',
              move: {
                kind: 'notation',
                value: trimmed,
                locale: state.preferences.uiLocale,
              },
            },
      }),
    );
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
    await this.applyMove(`${from}${to}${suffix}`);
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

  async discardAnalysisScratch(): Promise<void> {
    const state = this.#readyState();
    const scratchRevision = state?.analysis.scratch?.scratchRevision;
    const scratchId = state?.analysis.scratch?.scratchId;
    if (
      state === undefined ||
      scratchId === undefined ||
      scratchRevision === undefined
    )
      return;
    await this.#runCommand('discard_scratch', (client) =>
      client.updateAnalysisScratch({
        scope: state.scope,
        expectedScratchId: scratchId,
        expectedScratchRevision: scratchRevision,
        action: { kind: 'discard' },
      }),
    );
  }

  async createAnalysisRecord(
    displayName: string,
    destination: 'inventory' | 'context',
    noteScope: 'global' | 'context',
    noteBody: string,
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
    this.#analysisFocus = Object.freeze({
      itemId: result.itemId,
      revisionId: result.revisionId,
      anchorId: result.rootAnchorId,
    });
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
    this.#inventoryContextOnly = true;
    this.#selectedInventoryItemId = undefined;
    this.#analysisFocus = undefined;
    this.#announcement = 'context.created';
    await this.refresh();
    this.#finishCommand();
    return true;
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

  clearAnnouncement(): void {
    this.#announcement = undefined;
    this.#publishViewState();
  }

  close(): void {
    this.#lifecycle += 1;
    this.#pendingEventRevision = undefined;
    this.#pendingUnversionedEvent = false;
    this.#events?.close();
    this.#events = undefined;
    this.#client = undefined;
    this.#listeners.clear();
  }

  async #startScratch(
    origin: Extract<
      UpdateAnalysisScratchRequestDto['action'],
      { kind: 'start' }
    >['origin'],
  ): Promise<void> {
    const state = this.#readyState();
    if (state === undefined || state.analysis.scratch !== undefined) return;
    await this.#runCommand('start_scratch', (client) =>
      client.updateAnalysisScratch({
        scope: state.scope,
        expectedScratchId: null,
        expectedScratchRevision: null,
        action: { kind: 'start', origin },
      }),
    );
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

  #inventoryRequest(): SearchInventoryRequestDto {
    return {
      pageSize: '50',
      ...(this.#inventoryQuery === '' ? {} : { query: this.#inventoryQuery }),
      ...(this.#scope.kind === 'context' && this.#inventoryContextOnly
        ? { contextId: this.#scope.contextId }
        : {}),
    };
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
    this.#diagnose({
      level: event.kind === 'failed' ? 'error' : 'debug',
      eventCode:
        event.kind === 'failed'
          ? 'client.request.failed'
          : 'client.request.completed',
      correlationId: event.correlationId,
      status: event.kind === 'failed' ? 'failed' : 'succeeded',
      ...(event.kind === 'completed' ? { statusCode: event.statusCode } : {}),
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
    const scratchEventNeedsRefresh =
      event.kind === 'analysis.scratch-changed' &&
      state !== undefined &&
      sameScope(state.scope, event.payload.scope) &&
      (state.analysis.scratch?.scratchId !== event.payload.scratchId ||
        state.analysis.scratch?.scratchRevision !==
          event.payload.scratchRevision);
    if (event.kind === 'host.replay-gap') {
      void this.refresh();
      return;
    }
    if (
      !scratchEventNeedsRefresh &&
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

  #publishViewState(): void {
    if (this.#state.phase !== 'ready') return;
    const state = this.#state;
    this.#setState(
      Object.freeze({
        phase: 'ready',
        status: state.status,
        preferences: state.preferences,
        diagnostics: state.diagnostics,
        diagnosticReportManifest: state.diagnosticReportManifest,
        contexts: state.contexts,
        inventory: state.inventory,
        analysis: state.analysis,
        ...(state.contextWorkspace === undefined
          ? {}
          : { contextWorkspace: state.contextWorkspace }),
        activity: this.#activity,
        scope: this.#scope,
        inventoryQuery: this.#inventoryQuery,
        inventoryContextOnly: this.#inventoryContextOnly,
        ...(this.#selectedInventoryItemId === undefined
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

function sameDataRevision(
  status: SystemStatusDto,
  preferences: UserPreferencesDto,
  contexts: ListWorkingContextsResultDto,
  inventory: SearchInventoryResultDto,
  analysis: AnalysisWorkspaceDto,
  workspace: WorkingContextWorkspaceDto | undefined,
): boolean {
  const revisions = [
    status.persistence.dataRevision,
    preferences.dataRevision,
    contexts.dataRevision,
    inventory.dataRevision,
    analysis.dataRevision,
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
