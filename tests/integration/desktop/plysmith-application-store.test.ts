import assert from 'node:assert/strict';
import test from 'node:test';
import { HostClientProblem } from '../../../app/infrastructure/channels/host_client/index.ts';

import type {
  AnalysisWorkspaceDto,
  ContextRemovalPreviewDto,
  AnalyzePositionRequestDto,
  DiagnosticReportManifestDto,
  DiagnosticSettingsDto,
  GetAnalysisWorkspaceRequestDto,
  HostConnection,
  HostEvent,
  InventoryRevisionPreviewDto,
  ListWorkingContextsResultDto,
  PlayoutDto,
  SearchInventoryResultDto,
  SetWorkScopeResumeRequestDto,
  StartupResumeDto,
  WorkScopeWorkspaceDto,
  StartInventoryRevisionRequestDto,
  UserPreferencesDto,
  WorkingContextWorkspaceDto,
} from '../../../app/infrastructure/channels/host_client/index.ts';
import {
  PlysmithApplicationStore,
  type PlysmithApplicationClient,
} from '../../../app/infrastructure/channels/ui/renderer/plysmith-application-store.ts';

const connection: HostConnection = {
  endpoint: 'http://127.0.0.1:43121/',
  productRelease: '0.0.0',
  contractFingerprint: 'sha256:store-test',
  token: 'desktop-store-test-token-000000000000',
};

const initialState = {
  position: {
    ruleSetId: 'standardChess' as const,
    boardKey:
      'RNBQKBNRPPPPPPPP................................pppppppprnbqkbnr',
    sideToMove: 'white' as const,
    castlingRights: {
      whiteKingSide: true,
      whiteQueenSide: true,
      blackKingSide: true,
      blackQueenSide: true,
    },
    effectiveEnPassantSquare: -1,
    positionKey:
      'standardChess|RNBQKBNRPPPPPPPP................................pppppppprnbqkbnr|white|1|1|1|1|-1',
  },
  playState: {
    halfmoveClock: 0,
    fullmoveNumber: 1,
    historyKnowledge: 'complete' as const,
  },
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
};

function status(dataRevision = 0) {
  return {
    state: 'ready' as const,
    persistence: { schemaVersion: 4, dataRevision },
    productRelease: '0.0.0',
    contractFingerprint: 'sha256:store-test',
  };
}

function preferences(dataRevision = 0): UserPreferencesDto {
  return {
    uiLocale: 'de-DE',
    preferenceRevision: dataRevision + 1,
    dataRevision,
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
}

function analysis(dataRevision = 0): AnalysisWorkspaceDto {
  return {
    scope: { kind: 'free' },
    dataRevision,
    currentState: initialState,
    legalMoves: [],
    allowedActions: ['start_scratch'],
  };
}

function savedAnalysis(dataRevision = 0): AnalysisWorkspaceDto {
  return {
    ...analysis(dataRevision),
    record: {
      itemType: 'analysis',
      itemId: '11',
      revisionId: '12',
      currentRevisionId: '12',
      revisionNumber: 1,
      historical: false,
      rootAnchorId: '13',
      currentAnchorId: '13',
      displayName: 'Französisch',
      languageTag: 'de-DE',
      origin: { kind: 'initial_position' },
      root: initialState,
      steps: [],
      cursor: 0,
      contributions: [],
      contextMember: false,
    },
    legalMoves: [{ from: 'e2', to: 'e4', san: 'e4' }],
  };
}

function savedLineAnalysis(
  currentAnchorId: '13' | '14',
  dataRevision = 0,
): AnalysisWorkspaceDto {
  return {
    ...savedAnalysis(dataRevision),
    record: {
      ...savedAnalysis(dataRevision).record!,
      currentAnchorId,
      steps: [
        {
          anchorId: '14',
          before: initialState,
          move: { from: 'e2', to: 'e4', san: 'e4' },
          after: initialState,
        },
      ],
      cursor: currentAnchorId === '14' ? 1 : 0,
    },
  };
}

function savedGameLineAnalysis(): AnalysisWorkspaceDto {
  const workspace = savedLineAnalysis('14');
  return {
    ...workspace,
    record: { ...workspace.record!, itemType: 'game' },
  };
}

function revisionPreview(
  overrides: Partial<InventoryRevisionPreviewDto> = {},
): InventoryRevisionPreviewDto {
  return {
    itemId: '11',
    baseRevisionId: '12',
    mode: 'truncate_after',
    displayName: 'Französisch',
    preservedMoveCount: 0,
    addedSteps: [],
    removedSteps: [],
    historicalGlobalContributionCount: 0,
    affectedContexts: [],
    followingContexts: [],
    noOp: false,
    previewFingerprint:
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    dataRevision: 0,
    ...overrides,
  };
}

function diagnosticSettings(
  configuredLevel: DiagnosticSettingsDto['configuredLevel'] = 'off',
  activeLevel: DiagnosticSettingsDto['activeLevel'] = configuredLevel,
): DiagnosticSettingsDto {
  return {
    configuredLevel,
    activeLevel,
    restartRequired: configuredLevel !== activeLevel,
    configurationRevision: 'sha256:diagnostic-settings-test',
  };
}

function diagnosticManifest(): DiagnosticReportManifestDto {
  return {
    manifestVersion: 1,
    format: 'plysmith-diagnostics-json-gzip-v1',
    suggestedFileName: 'plysmith-diagnostics-20260914154309.json.gz',
    maximumBytes: 10_485_760,
    includedCategories: [
      'product_identity',
      'runtime_environment',
      'diagnostic_settings',
      'redacted_diagnostic_events',
      'excluded_data_declaration',
    ],
    excludedCategories: [
      'secrets_and_credentials',
      'active_configuration',
      'database_and_backups',
      'local_paths',
      'chess_and_user_content',
      'external_identities',
      'provider_payloads',
      'memory_and_raw_errors',
    ],
  };
}

function contexts(dataRevision = 0): ListWorkingContextsResultDto {
  return { contexts: [], dataRevision };
}

function inventory(dataRevision = 0): SearchInventoryResultDto {
  return { ancestors: [], provenanceEdges: [], items: [], dataRevision };
}

function removalPreview(dataRevision = 0): ContextRemovalPreviewDto {
  return {
    contextId: '7',
    contextName: 'Repertoire',
    contextVersion: 1,
    dataRevision,
    items: [{ itemId: '11', displayName: 'Inventory title' }],
    referenceCount: 1,
    losses: { notes: [] },
  };
}

function changedEvent(dataRevision: number): HostEvent {
  return {
    kind: 'inventory.item-created',
    eventId: `event-${dataRevision}`,
    sequence: dataRevision + 1,
    dataRevision,
    occurredAt: '2026-09-11T18:00:00.000Z',
    subscriptionRevision: 1,
    correlationId: `correlation-${dataRevision}`,
    payload: { itemId: '1', revisionId: '1' },
  };
}

function scratchChangedEvent(
  scratchId: string | undefined,
  scratchRevision: number | undefined,
  dataRevision = 0,
): HostEvent {
  return {
    kind: 'analysis.scratch-changed',
    eventId: `scratch-event-${scratchId ?? 'discarded'}`,
    sequence: 1,
    dataRevision,
    occurredAt: '2026-09-11T18:00:00.000Z',
    subscriptionRevision: 1,
    correlationId: 'scratch-correlation',
    payload: {
      scope: { kind: 'free' },
      ...(scratchId === undefined ? {} : { scratchId }),
      ...(scratchRevision === undefined ? {} : { scratchRevision }),
    },
  };
}

function playout(
  draftRevision: number,
  dataRevision: number,
  steps: readonly {
    readonly actor: 'user' | 'provider';
    readonly san: string;
  }[],
  statusKind: 'active' | 'awaiting_policy' | 'stopped' = 'active',
): PlayoutDto {
  return {
    dataRevision,
    draft: {
      draftId: '41',
      draftRevision,
      decisionGeneration: 1,
      origin: { kind: 'initial_position' },
      root: initialState,
      playerSide: 'white',
      policy: {
        capability: 'best_move',
        providerInstanceId: 'engine-main',
        providerFingerprint: 'engine-main:v1',
        providerType: 'test-engine',
        providerDisplayName: 'Test engine',
      },
      status:
        statusKind === 'awaiting_policy'
          ? { kind: 'awaiting_policy', decisionId: 1 }
          : statusKind === 'stopped'
            ? { kind: 'stopped', outcome: { kind: 'unfinished' } }
            : { kind: 'active' },
      steps: steps.map((step, index) => ({
        actor: step.actor,
        before: initialState,
        after: initialState,
        move:
          index === 0
            ? { from: 'e2', to: 'e4', san: step.san }
            : { from: 'e7', to: 'e5', san: step.san },
        ...(step.actor === 'provider' ? { decisionId: 1 } : {}),
      })),
    },
    legalMoves: [],
  };
}

function playoutChangedEvent(
  draftRevision: number,
  dataRevision: number,
): HostEvent {
  return {
    kind: 'playout.changed',
    eventId: `playout-event-${draftRevision}`,
    sequence: dataRevision + 1,
    dataRevision,
    occurredAt: '2026-09-11T18:00:00.000Z',
    subscriptionRevision: 1,
    correlationId: `playout-correlation-${draftRevision}`,
    payload: {
      scope: { kind: 'free' },
      draftId: '41',
      draftRevision,
    },
  };
}

function createClient(
  overrides: Partial<PlysmithApplicationClient> = {},
): PlysmithApplicationClient {
  let startup: StartupResumeDto = {
    scope: { kind: 'free' },
    area: 'manage',
    startupVersion: null,
    dataRevision: 0,
  };
  let statusRead: ReturnType<PlysmithApplicationClient['getSystemStatus']> =
    Promise.resolve(status());
  const workspaces = new Map<string, WorkScopeWorkspaceDto>();
  const contextReads = new Map<string, Promise<WorkingContextWorkspaceDto>>();
  const scopeKey = (scope: WorkScopeWorkspaceDto['scope']) =>
    scope.kind === 'free' ? 'free' : scope.contextId;
  const client: PlysmithApplicationClient = {
    getSystemStatus: async () => status(),
    getUserPreferences: async () => preferences(),
    setUiLanguage: async () => assert.fail('no language write expected'),
    getDiagnosticSettings: async () => diagnosticSettings(),
    setDiagnosticLogLevel: async () =>
      assert.fail('no diagnostic settings write expected'),
    getDiagnosticReportManifest: async () => diagnosticManifest(),
    createDiagnosticReport: async () =>
      assert.fail('no diagnostic report write expected'),
    getAnalysisWorkspace: async () => analysis(),
    validateAnalysisSetup: async () =>
      assert.fail('no analysis setup validation expected'),
    updateAnalysisScratch: async () => assert.fail('no scratch write expected'),
    createAnalysisRecord: async () => assert.fail('no record write expected'),
    startInventoryRevision: async () =>
      assert.fail('no inventory revision write expected'),
    promoteAnalysisToInventoryRevision: async () =>
      assert.fail('no analysis promotion expected'),
    previewInventoryRevision: async () =>
      assert.fail('no inventory revision preview expected'),
    saveInventoryRevision: async () =>
      assert.fail('no inventory revision save expected'),
    getInventoryRevision: async () =>
      assert.fail('no inventory revision read expected'),
    getPendingRevisionImpact: async () =>
      assert.fail('no revision impact read expected'),
    resolvePendingRevisionImpact: async () =>
      assert.fail('no revision impact resolution expected'),
    createAnalysisNote: async () => assert.fail('no note write expected'),
    createPositionNote: async () => assert.fail('no note write expected'),
    updateAnalysisNote: async () => assert.fail('no note write expected'),
    deleteAnalysisNote: async () => assert.fail('no note write expected'),
    searchInventory: async () => inventory(),
    listWorkingContexts: async () => contexts(),
    getWorkingContextWorkspace: async () =>
      assert.fail('no context workspace read expected'),
    createWorkingContext: async () => assert.fail('no context write expected'),
    updateWorkingContextMetadata: async () =>
      assert.fail('no context metadata write expected'),
    addContextReference: async () => assert.fail('no reference write expected'),
    removeContextItem: async () =>
      assert.fail('no context item removal expected'),
    getStartupResume: async () => ({
      ...startup,
      dataRevision: (await statusRead).persistence.dataRevision,
    }),
    setStartupResume: async (request) => {
      assert.equal(request.expectedStartupVersion, startup.startupVersion);
      startup = {
        scope: request.scope,
        area: request.area,
        startupVersion: (startup.startupVersion ?? 0) + 1,
        dataRevision: (await statusRead).persistence.dataRevision,
      };
      return startup;
    },
    getWorkScopeWorkspace: async (request) => {
      const scope: WorkScopeWorkspaceDto['scope'] =
        request.scopeKind === 'free'
          ? { kind: 'free' }
          : { kind: 'context', contextId: request.contextId! };
      const workspace = workspaces.get(scopeKey(scope));
      const context =
        scope.kind === 'context'
          ? await contextReads.get(scope.contextId)
          : undefined;
      return {
        ...context,
        ...workspace,
        scope,
        dataRevision: (await statusRead).persistence.dataRevision,
      };
    },
    setWorkScopeResume: async (request) => {
      const workspace = await client.getWorkScopeWorkspace({
        scopeKind: request.scope.kind,
        ...(request.scope.kind === 'context'
          ? { contextId: request.scope.contextId }
          : {}),
      });
      const previous =
        request.area === 'manage'
          ? workspace.managementResume
          : workspace.analysisResume;
      assert.equal(
        request.expectedResumeVersion,
        previous?.resumeVersion ?? null,
      );
      const resumeVersion = (previous?.resumeVersion ?? 0) + 1;
      const updatedAt = '2026-09-27T12:00:00.000Z';
      if (request.area === 'manage') {
        const { presentation, selectedItemId, selectedAnchorId } = request;
        const resume = {
          resumeVersion,
          presentation,
          ...(selectedItemId === undefined ? {} : { selectedItemId }),
          ...(selectedAnchorId === undefined ? {} : { selectedAnchorId }),
          updatedAt,
        };
        workspaces.set(scopeKey(request.scope), {
          ...workspace,
          managementResume: resume,
        });
        return { area: 'manage', resume, dataRevision: workspace.dataRevision };
      }
      const { mode, itemId, revisionId, anchorId } = request;
      const resume = {
        resumeVersion,
        mode,
        ...(itemId === undefined ? {} : { itemId }),
        ...(revisionId === undefined ? {} : { revisionId }),
        ...(anchorId === undefined ? {} : { anchorId }),
        currentPositionId: '21',
        updatedAt,
      };
      workspaces.set(scopeKey(request.scope), {
        ...workspace,
        analysisResume: resume,
      });
      return { area: 'analyze', resume, dataRevision: workspace.dataRevision };
    },
    previewContextItemRemoval: async () =>
      assert.fail('no removal preview expected'),
    previewWorkingContextDeletion: async () =>
      assert.fail('no context deletion preview expected'),
    deleteWorkingContext: async () =>
      assert.fail('no context deletion expected'),
    previewInventoryItemDeletion: async () =>
      assert.fail('no inventory deletion preview expected'),
    deleteInventoryItem: async () =>
      assert.fail('no inventory deletion expected'),
    listPositionAnalysisProviders: async () => ({ providers: [] }),
    analyzePosition: async () => assert.fail('no position analysis expected'),
    listMovePolicyProviders: async () => ({
      providers: [
        {
          instanceId: 'engine-main',
          providerType: 'stockfish-uci',
          displayName: 'Stockfish',
          fingerprint: 'sha256:engine-main',
          capabilities: ['best_move'],
          readiness: 'cold',
          status: 'available',
        },
      ],
    }),
    getPlayout: async () => null,
    startPlayout: async () => assert.fail('no playout start expected'),
    submitPlayoutMove: async () => assert.fail('no playout move expected'),
    retryPlayout: async () => assert.fail('no playout retry expected'),
    pausePlayout: async () => assert.fail('no playout pause expected'),
    resumePlayout: async () => assert.fail('no playout resume expected'),
    cancelPlayoutCompletion: async () =>
      assert.fail('no completion cancel expected'),
    stopPlayout: async () => assert.fail('no playout stop expected'),
    completePlayout: async () => assert.fail('no playout completion expected'),
    discardPlayout: async () => assert.fail('no playout discard expected'),
    getEngineProviderConfigurations: async () => ({ providers: [] }),
    previewEngineProviderConfiguration: async () =>
      assert.fail('no engine preview expected'),
    saveEngineProviderConfiguration: async () =>
      assert.fail('no engine settings write expected'),
    removeEngineProviderConfiguration: async () =>
      assert.fail('no engine settings write expected'),
    ...overrides,
  };
  const readStatus = client.getSystemStatus;
  client.getSystemStatus = () => (statusRead = readStatus());
  const readContext = client.getWorkingContextWorkspace;
  client.getWorkingContextWorkspace = (contextId) => {
    const read = readContext(contextId);
    contextReads.set(contextId, read);
    return read;
  };
  const readAnalysis = client.getAnalysisWorkspace;
  client.getAnalysisWorkspace = (request) => {
    const resume = workspaces.get(request.contextId ?? 'free')?.analysisResume;
    return readAnalysis(
      request.itemId === undefined &&
        request.mode !== 'initial_position' &&
        resume?.itemId !== undefined
        ? {
            ...request,
            itemId: resume.itemId,
            ...(resume.revisionId === undefined
              ? {}
              : { revisionId: resume.revisionId }),
            ...(resume.anchorId === undefined
              ? {}
              : { anchorId: resume.anchorId }),
          }
        : request,
    );
  };
  const updateScratch = client.updateAnalysisScratch;
  client.updateAnalysisScratch = async (request) => {
    const result = await updateScratch(request);
    if (result.scratch !== undefined) {
      const key = scopeKey(request.scope);
      const workspace = workspaces.get(key);
      if (workspace !== undefined) {
        workspaces.set(key, {
          scope: workspace.scope,
          dataRevision: result.dataRevision,
          ...(workspace.managementResume === undefined
            ? {}
            : { managementResume: workspace.managementResume }),
        });
      }
    }
    return result;
  };
  return client;
}

test('renderer subscribes to events before loading all authoritative snapshots', async () => {
  const order: string[] = [];
  let markSubscriptionReady: (() => void) | undefined;
  const subscriptionReady = new Promise<void>((resolve) => {
    markSubscriptionReady = resolve;
  });
  const client = createClient({
    getSystemStatus: async () => {
      order.push('status');
      return status();
    },
    getUserPreferences: async () => {
      order.push('preferences');
      return preferences();
    },
    getDiagnosticSettings: async () => {
      order.push('diagnostics');
      return diagnosticSettings();
    },
    getDiagnosticReportManifest: async () => {
      order.push('diagnostic-manifest');
      return diagnosticManifest();
    },
    getAnalysisWorkspace: async () => {
      order.push('analysis');
      return analysis();
    },
    searchInventory: async () => {
      order.push('inventory');
      return inventory();
    },
    listWorkingContexts: async () => {
      order.push('contexts');
      return contexts();
    },
  });
  const store = new PlysmithApplicationStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: () => {
      order.push('events');
      return { ready: subscriptionReady, close: () => undefined };
    },
  });

  const start = store.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['events']);
  markSubscriptionReady?.();
  await start;

  assert.equal(order[0], 'events');
  assert.deepEqual(
    new Set(order.slice(1)),
    new Set([
      'status',
      'preferences',
      'diagnostics',
      'diagnostic-manifest',
      'analysis',
      'inventory',
      'contexts',
    ]),
  );
  assert.equal(store.getSnapshot().phase, 'ready');
  store.close();
});

test('position analysis uses a stable desktop consumer without taking the global command lock', async () => {
  const consumerIds: string[] = [];
  let releaseAnalysis: (() => void) | undefined;
  const client = createClient({
    listPositionAnalysisProviders: async () => ({
      providers: [
        {
          instanceId: 'stockfish-main',
          providerType: 'stockfish-uci',
          displayName: 'Stockfish',
          capability: 'objective_position_analysis',
          readiness: 'ready',
          status: 'available',
        },
      ],
    }),
    analyzePosition: async (request) => {
      consumerIds.push(request.consumerId);
      await new Promise<void>((resolve) => {
        releaseAnalysis = resolve;
      });
      return {
        kind: 'objective',
        focusKey: request.focus.focusKey,
        providerInstanceId: request.providerInstanceId,
        providerDisplayName: 'Stockfish',
        historyCompleteness: 'complete',
        budget: 'fast',
        perspective: 'white',
        candidates: [],
        search: { limiter: { kind: 'movetime', value: 300 } },
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();
  const request = {
    laneId: 'objective',
    work: {
      scope: { kind: 'free' as const },
      subject: { kind: 'position' as const },
    },
    providerInstanceId: 'stockfish-main',
    candidateCount: 3,
    focus: {
      focusKey: 'initial',
      root: initialState,
      moves: [],
      current: initialState,
    },
    mode: { kind: 'objective' as const, budget: 'fast' as const },
  };

  const first = store.analyzePosition(request);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const pendingState = store.getSnapshot();
  assert.equal(
    pendingState.phase === 'ready' ? pendingState.busyCommand : undefined,
    undefined,
  );
  releaseAnalysis?.();
  assert.equal((await first).kind, 'completed');

  const second = store.analyzePosition(request);
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseAnalysis?.();
  assert.equal((await second).kind, 'completed');
  assert.equal(consumerIds.length, 2);
  assert.equal(consumerIds[0], consumerIds[1]);
  store.close();
});

test('renderer coalesces event refreshes across all read models', async () => {
  let releaseStatus: (() => void) | undefined;
  let statusReads = 0;
  let onChange: (event: HostEvent) => void = () => undefined;
  const client = createClient({
    getSystemStatus: async () => {
      statusReads += 1;
      if (statusReads === 2) {
        await new Promise<void>((resolve) => {
          releaseStatus = resolve;
        });
      }
      return status();
    },
  });
  const store = new PlysmithApplicationStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: (_connection, change) => {
      onChange = change;
      return { ready: Promise.resolve(), close: () => undefined };
    },
  });
  await store.start();

  onChange(changedEvent(1));
  onChange(changedEvent(2));
  onChange(changedEvent(3));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(statusReads, 2);
  releaseStatus?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(statusReads, 3);
  store.close();
});

test('a stale scope read cannot replace the current workspace', async () => {
  let releaseContextRead: (() => void) | undefined;
  let contextReadStarted: (() => void) | undefined;
  const contextStarted = new Promise<void>((resolve) => {
    contextReadStarted = resolve;
  });
  const context = {
    contextId: '7',
    displayName: 'Repertoire',
    lifecycle: 'active' as const,
    contextVersion: 1,
    referenceCount: 0,
    pendingRevisionImpactCount: 0,
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
  const client = createClient({
    listWorkingContexts: async () => ({ contexts: [context], dataRevision: 0 }),
    getWorkingContextWorkspace: async () => ({
      context,
      references: [],
      pendingRevisionImpacts: [],
      dataRevision: 0,
    }),
    getAnalysisWorkspace: async (request) => {
      if (request.scopeKind === 'context') {
        contextReadStarted?.();
        await new Promise<void>((resolve) => {
          releaseContextRead = resolve;
        });
        return {
          ...analysis(),
          scope: { kind: 'context', contextId: request.contextId! },
          contextName: 'Repertoire',
        };
      }
      return analysis();
    },
  });
  const store = createReadyStore(client);
  await store.start();

  const enterContext = store.setScope({ kind: 'context', contextId: '7' });
  await contextStarted;
  const returnToFree = store.setScope({ kind: 'free' });
  releaseContextRead?.();
  await Promise.all([enterContext, returnToFree]);

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.phase, 'ready');
  if (snapshot.phase === 'ready') {
    assert.deepEqual(snapshot.scope, { kind: 'free' });
    assert.deepEqual(snapshot.analysis.scope, { kind: 'free' });
    assert.equal(snapshot.refreshing, false);
  }
  store.close();
});

test('a free scratch event refreshes despite an unchanged data revision', async () => {
  const backend: { scratch?: AnalysisWorkspaceDto['scratch'] } = {};
  let reads = 0;
  let emit: (event: HostEvent) => void = () => undefined;
  const client = createClient({
    getAnalysisWorkspace: async () => {
      reads += 1;
      return {
        ...analysis(),
        ...(backend.scratch === undefined ? {} : { scratch: backend.scratch }),
      };
    },
  });
  const store = new PlysmithApplicationStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: (_connection, onChange) => {
      emit = onChange;
      return { ready: Promise.resolve(), close: () => undefined };
    },
  });
  await store.start();
  backend.scratch = {
    scratchId: 'external-scratch',
    scratchRevision: 1,
    intent: { kind: 'exploration' },
    origin: { kind: 'initial_position' },
    root: initialState,
    steps: [],
    cursor: 0,
  };

  emit(scratchChangedEvent('external-scratch', 1));
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(reads, 2);
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.analysis.scratch?.scratchId
      : undefined,
    'external-scratch',
  );
  store.close();
});

test('a committed playout move refreshes while its policy command is still running', async () => {
  let dataRevision = 0;
  let currentPlayout = playout(1, 0, []);
  let emit: (event: HostEvent) => void = () => undefined;
  let markCommandStarted: (() => void) | undefined;
  const commandStarted = new Promise<void>((resolve) => {
    markCommandStarted = resolve;
  });
  let releaseCommand: ((result: PlayoutDto) => void) | undefined;
  const commandResult = new Promise<PlayoutDto>((resolve) => {
    releaseCommand = resolve;
  });
  const client = createClient({
    getSystemStatus: async () => status(dataRevision),
    getUserPreferences: async () => preferences(dataRevision),
    getAnalysisWorkspace: async () => analysis(dataRevision),
    searchInventory: async () => inventory(dataRevision),
    listWorkingContexts: async () => contexts(dataRevision),
    getPlayout: async () => currentPlayout,
    submitPlayoutMove: async () => {
      markCommandStarted?.();
      return commandResult;
    },
  });
  const store = new PlysmithApplicationStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: (_connection, onChange) => {
      emit = onChange;
      return { ready: Promise.resolve(), close: () => undefined };
    },
  });
  await store.start();

  const submit = store.submitPlayoutMove('e2', 'e4');
  await commandStarted;
  dataRevision = 1;
  currentPlayout = playout(
    2,
    dataRevision,
    [{ actor: 'user', san: 'e4' }],
    'awaiting_policy',
  );
  emit(playoutChangedEvent(2, dataRevision));
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));

  let snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.playout?.draft.steps.length : -1,
    1,
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.busyCommand : undefined,
    'submit_playout_move',
  );

  dataRevision = 2;
  currentPlayout = playout(3, dataRevision, [
    { actor: 'user', san: 'e4' },
    { actor: 'provider', san: 'e5' },
  ]);
  releaseCommand?.(currentPlayout);
  await submit;
  snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.playout?.draft.steps.length : -1,
    2,
  );
  store.close();
});

test('starting from the current position sends the first user move without a side choice', async () => {
  const blackToMove = {
    ...initialState,
    position: {
      ...initialState.position,
      sideToMove: 'black' as const,
      positionKey:
        'standardChess|RNBQKBNRPPPPPPPP................................pppppppprnbqkbnr|black|1|1|1|1|-1',
    },
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1',
  };
  let request:
    Parameters<PlysmithApplicationClient['startPlayout']>[0] | undefined;
  const client = createClient({
    getAnalysisWorkspace: async () => ({
      ...analysis(),
      currentState: blackToMove,
    }),
    startPlayout: async (input) => {
      request = input;
      return {
        ...playout(1, 0, []),
        draft: {
          ...playout(1, 0, []).draft,
          root: blackToMove,
          playerSide: 'black',
        },
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  store.openPlayoutFromCurrentAnalysis();
  assert.equal(
    await store.startPlayoutWithMove('engine-main', 'a7', 'a6'),
    true,
  );
  assert.deepEqual(request, {
    scope: { kind: 'free' },
    start: { kind: 'fen', fen: blackToMove.fen },
    providerInstanceId: 'engine-main',
    capability: 'best_move',
    opening: {
      kind: 'user_move',
      move: { kind: 'coordinates', value: 'a7a6' },
    },
  });
  store.close();
});

test('letting the provider move first binds the opening without a side choice', async () => {
  let request:
    Parameters<PlysmithApplicationClient['startPlayout']>[0] | undefined;
  const client = createClient({
    startPlayout: async (input) => {
      request = input;
      return playout(2, 1, [{ actor: 'provider', san: 'e5' }]);
    },
  });
  const store = createReadyStore(client);
  await store.start();

  store.openPlayoutFromCurrentAnalysis();
  assert.equal(await store.letProviderStartPlayout('engine-main'), true);
  assert.deepEqual(request, {
    scope: { kind: 'free' },
    start: { kind: 'fen', fen: initialState.fen },
    providerInstanceId: 'engine-main',
    capability: 'best_move',
    opening: { kind: 'provider_move' },
  });
  store.close();
});

test('opening Ausspielen directly prepares the authoritative initial position', async () => {
  const requests: GetAnalysisWorkspaceRequestDto[] = [];
  const client = createClient({
    getAnalysisWorkspace: async (request) => {
      requests.push(request);
      return analysis();
    },
  });
  const store = createReadyStore(client);
  await store.start();
  requests.length = 0;

  store.setActivity('playout');
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(requests, [
    { scopeKind: 'free', mode: 'initial_position' },
    { scopeKind: 'free' },
  ]);
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'playout',
  );
  assert.deepEqual(
    snapshot.phase === 'ready' ? snapshot.playoutStart?.start : undefined,
    { kind: 'initial_position' },
  );
  store.close();
});

test('new game from manage replaces a prepared source with the initial position', async () => {
  const requests: GetAnalysisWorkspaceRequestDto[] = [];
  const client = createClient({
    getAnalysisWorkspace: async (request) => {
      requests.push(request);
      return request.mode === 'initial_position'
        ? analysis()
        : savedLineAnalysis('14');
    },
  });
  const store = createReadyStore(client);
  await store.start();
  store.openPlayoutFromCurrentAnalysis();
  const prepared = store.getSnapshot();
  assert.equal(
    prepared.phase === 'ready' ? prepared.playoutStart?.start.kind : undefined,
    'inventory_anchor',
  );
  store.setActivity('manage');

  await store.openNewPlayout();

  assert.deepEqual(requests.at(-1), {
    scopeKind: 'free',
    mode: 'initial_position',
  });
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'playout',
  );
  assert.deepEqual(
    snapshot.phase === 'ready' ? snapshot.playoutStart?.start : undefined,
    { kind: 'initial_position' },
  );
  store.close();
});

test('new game from manage asks before discarding a running game', async () => {
  let currentPlayout: PlayoutDto | null = playout(3, 0, []);
  let discardCount = 0;
  const client = createClient({
    getAnalysisWorkspace: async () => analysis(),
    getPlayout: async () => currentPlayout,
    discardPlayout: async () => {
      discardCount += 1;
      currentPlayout = null;
      return { dataRevision: 0 };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.openNewPlayout();
  let snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'manage',
  );
  assert.deepEqual(
    snapshot.phase === 'ready'
      ? snapshot.pendingPlayoutStart?.start
      : undefined,
    { kind: 'initial_position' },
  );
  assert.equal(discardCount, 0);

  store.cancelPendingPlayoutStart();
  snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.pendingPlayoutStart : undefined,
    undefined,
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'manage',
  );

  await store.openNewPlayout();
  await store.discardPlayoutAndOpenPending();
  snapshot = store.getSnapshot();
  assert.equal(discardCount, 1);
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'playout',
  );
  assert.deepEqual(
    snapshot.phase === 'ready' ? snapshot.playoutStart?.start : undefined,
    { kind: 'initial_position' },
  );
  store.close();
});

test('restoring Ausspielen after startup prepares the authoritative initial position', async () => {
  const requests: GetAnalysisWorkspaceRequestDto[] = [];
  const client = createClient({
    getStartupResume: async () => ({
      scope: { kind: 'free' },
      area: 'playout',
      startupVersion: 1,
      dataRevision: 0,
    }),
    getAnalysisWorkspace: async (request) => {
      requests.push(request);
      return analysis();
    },
  });
  const store = createReadyStore(client);

  await store.start();

  assert.deepEqual(requests, [
    { scopeKind: 'free' },
    { scopeKind: 'free', mode: 'initial_position' },
  ]);
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'playout',
  );
  assert.deepEqual(
    snapshot.phase === 'ready' ? snapshot.playoutStart?.start : undefined,
    { kind: 'initial_position' },
  );
  store.close();
});

test('returning from completion prepares a paused game without resuming the engine', async (t) => {
  let current = playout(3, 0, [], 'stopped');
  let cancels = 0;
  const store = createReadyStore(
    createClient({
      getPlayout: async () => current,
      cancelPlayoutCompletion: async (request) => {
        cancels += 1;
        assert.deepEqual(request, {
          scope: { kind: 'free' },
          draftId: '41',
          expectedDraftRevision: 3,
        });
        current = {
          ...current,
          dataRevision: 1,
          draft: {
            ...current.draft,
            draftRevision: 4,
            status: { kind: 'paused' },
          },
        };
        return current;
      },
      getSystemStatus: async () => status(current.dataRevision),
      getAnalysisWorkspace: async () => analysis(current.dataRevision),
      getUserPreferences: async () => preferences(current.dataRevision),
      searchInventory: async () => inventory(current.dataRevision),
      listWorkingContexts: async () => contexts(current.dataRevision),
    }),
  );
  t.after(() => store.close());
  await store.start();
  store.setActivity('playout');
  await store.cancelPlayoutCompletion();
  const snapshot = store.getSnapshot();
  assert.equal(cancels, 1);
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.playout?.draft.status.kind
      : undefined,
    'paused',
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'playout',
  );
});

test('failed completion cancellation keeps the stopped draft available for retry', async (t) => {
  const current = playout(3, 0, [], 'stopped');
  const store = createReadyStore(
    createClient({
      getPlayout: async () => current,
      cancelPlayoutCompletion: async () => {
        throw new Error('unavailable');
      },
    }),
  );
  t.after(() => store.close());
  await store.start();
  await store.cancelPlayoutCompletion();
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.playout?.draft.status.kind
      : undefined,
    'stopped',
  );
  assert.ok(snapshot.phase === 'ready' && snapshot.errorCode !== undefined);
});

test('starting from an analysis sends its visible path as separate source context', async () => {
  let request:
    Parameters<PlysmithApplicationClient['startPlayout']>[0] | undefined;
  const workspace = savedLineAnalysis('14');
  const client = createClient({
    getAnalysisWorkspace: async () => workspace,
    startPlayout: async (input) => {
      request = input;
      return playout(1, 0, []);
    },
  });
  const store = createReadyStore(client);
  await store.start();

  store.openPlayoutFromCurrentAnalysis();
  assert.equal(await store.letProviderStartPlayout('engine-main'), true);
  assert.deepEqual(request?.sourcePath, {
    displayName: 'Französisch',
    rootFen: initialState.fen,
    moves: [{ kind: 'coordinates', value: 'e2e4' }],
  });
  store.close();
});

test('a new playout intent keeps the analysis open until the running game is explicitly discarded', async () => {
  let currentPlayout: PlayoutDto | null = playout(3, 0, []);
  let discarded:
    Parameters<PlysmithApplicationClient['discardPlayout']>[0] | undefined;
  const client = createClient({
    getAnalysisWorkspace: async () => savedAnalysis(),
    getPlayout: async () => currentPlayout,
    discardPlayout: async (request) => {
      discarded = request;
      currentPlayout = null;
      return { dataRevision: 0 };
    },
  });
  const store = createReadyStore(client);
  await store.start();
  store.setActivity('analyze');

  store.openPlayoutFromCurrentAnalysis();
  let snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'analyze',
  );
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.pendingPlayoutStart?.title
      : undefined,
    'Französisch',
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.playoutStart : undefined,
    undefined,
  );

  store.cancelPendingPlayoutStart();
  snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.pendingPlayoutStart : undefined,
    undefined,
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'analyze',
  );

  store.openPlayoutFromCurrentAnalysis();
  await store.discardPlayoutAndOpenPending();
  snapshot = store.getSnapshot();
  assert.deepEqual(discarded, {
    scope: { kind: 'free' },
    draftId: '41',
    expectedDraftRevision: 3,
  });
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'playout',
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.playoutStart?.title : undefined,
    'Französisch',
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.pendingPlayoutStart : undefined,
    undefined,
  );
  store.close();
});

test('a saved playout keeps its board and move list visible until it is opened as analysis', async () => {
  const stoppedPlayout = playout(
    3,
    0,
    [
      { actor: 'user', san: 'e4' },
      { actor: 'provider', san: 'e5' },
    ],
    'stopped',
  );
  let currentPlayout: PlayoutDto | null = stoppedPlayout;
  const client = createClient({
    getPlayout: async () => currentPlayout,
    completePlayout: async (request) => {
      assert.equal(request.displayName, 'Trainingspartie');
      currentPlayout = null;
      return {
        itemId: '51',
        revisionId: '52',
        rootAnchorId: '53',
        outcome: { kind: 'unfinished' },
        outcomeSource: 'manual',
        dataRevision: 0,
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  assert.equal(await store.completePlayout('Trainingspartie', false), true);

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.phase === 'ready' ? snapshot.playout : undefined, null);
  assert.deepEqual(
    snapshot.phase === 'ready' ? snapshot.completedPlayoutView : undefined,
    stoppedPlayout,
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.completedPlayout?.itemId : undefined,
    '51',
  );
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.completedPlayout?.displayName
      : undefined,
    'Trainingspartie',
  );
  store.close();
});

for (const failedResponses of [1, 2]) {
  test(`completion keeps one committed game and the full request after ${failedResponses} lost responses`, async (t) => {
    const view = playout(3, 0, [{ actor: 'user', san: 'e4' }], 'stopped');
    let current: PlayoutDto | null = view;
    const requests: Parameters<
      PlysmithApplicationClient['completePlayout']
    >[0][] = [];
    let commits = 0;
    const receipt = {
      itemId: '51',
      revisionId: '52',
      rootAnchorId: '53',
      contextReferenceId: '54',
      outcome: { kind: 'win' as const, winner: 'white' as const },
      outcomeSource: 'manual' as const,
      dataRevision: 0,
    };
    const client = contextWorkClient(
      () => 0,
      () => ['11'],
      {
        getPlayout: async () => current,
        completePlayout: async (request) => {
          requests.push(structuredClone(request));
          if (commits === 0) {
            commits++;
            current = null;
          } else assert.deepEqual(request, requests[0]);
          if (requests.length <= failedResponses)
            throw workAccessProblem('host.unavailable');
          return receipt;
        },
      },
    );
    const store = createReadyStore(client);
    t.after(() => store.close());
    await store.start();
    await store.setScope({ kind: 'context', contextId: '7' });
    store.setActivity('playout');
    assert.equal(
      await store.completePlayout('  Original game  ', true, 'white_win'),
      failedResponses === 1,
    );
    assert.equal(requests.length, 2);
    assert.equal(
      await client.getPlayout({ scopeKind: 'context', contextId: '7' }),
      null,
    );
    assert.deepEqual(requests[0], {
      scope: { kind: 'context', contextId: '7' },
      draftId: '41',
      expectedDraftRevision: 3,
      completionId: requests[0]!.completionId,
      displayName: 'Original game',
      languageTag: 'de-DE',
      manualResult: 'white_win',
      targetContextId: '7',
    });
    assert.ok(requests[0]!.completionId.length > 0);
    if (failedResponses === 2) {
      await store.refresh();
      const pending = readyStore(store);
      assert.equal(pending.playout, null);
      assert.deepEqual(pending.pendingPlayoutCompletion, {
        request: requests[0],
        view,
      });
      assert.equal(pending.completedPlayout, undefined);
      store.setActivity('manage');
      await store.setScope({ kind: 'free' });
      assert.equal(readyStore(store).activity, 'playout');
      assert.deepEqual(readyStore(store).scope, {
        kind: 'context',
        contextId: '7',
      });
      assert.equal(
        await store.completePlayout('Changed title', false, 'black_win'),
        true,
      );
      assert.equal(requests.length, 3);
    }
    assert.equal(commits, 1);
    for (const request of requests) assert.deepEqual(request, requests[0]);
    assert.deepEqual(readyStore(store).completedPlayout, {
      ...receipt,
      displayName: 'Original game',
    });
    assert.deepEqual(readyStore(store).completedPlayoutView, view);
    assert.equal(readyStore(store).pendingPlayoutCompletion, undefined);
  });
}

function readyStore(store: PlysmithApplicationStore) {
  const state = store.getSnapshot();
  assert.equal(state.phase, 'ready');
  if (state.phase !== 'ready') assert.fail('Expected ready store');
  return state;
}

for (const manualResult of [
  'white_win',
  'black_win',
  'draw',
  'unfinished',
] as const) {
  test(`completion displays the confirmed ${manualResult} outcome with manual provenance`, async (t) => {
    let current: PlayoutDto | null = playout(3, 0, [], 'stopped');
    const outcome =
      manualResult === 'white_win' || manualResult === 'black_win'
        ? {
            kind: 'win' as const,
            winner:
              manualResult === 'white_win'
                ? ('white' as const)
                : ('black' as const),
          }
        : manualResult === 'draw'
          ? { kind: 'draw' as const }
          : { kind: 'unfinished' as const };
    const store = createReadyStore(
      createClient({
        getPlayout: async () => current,
        completePlayout: async (request) => {
          assert.equal(request.manualResult, manualResult);
          current = null;
          return {
            itemId: '51',
            revisionId: '52',
            rootAnchorId: '53',
            outcome,
            outcomeSource: 'manual',
            dataRevision: 0,
          };
        },
      }),
    );
    t.after(() => store.close());
    await store.start();
    assert.equal(
      await store.completePlayout('Result', false, manualResult),
      true,
    );
    assert.deepEqual(readyStore(store).completedPlayout?.outcome, outcome);
    assert.equal(readyStore(store).completedPlayout?.outcomeSource, 'manual');
  });
}

test('terminal completion preserves the confirmed automatic result without a manual override', async (t) => {
  const view = playout(3, 0, []);
  const outcome = { kind: 'draw' as const, reason: 'stalemate' as const };
  let current: PlayoutDto | null = {
    ...view,
    draft: {
      ...view.draft,
      status: { kind: 'terminal', reason: 'stalemate', outcome },
    },
  };
  const store = createReadyStore(
    createClient({
      getPlayout: async () => current,
      completePlayout: async (request) => {
        assert.equal(request.manualResult, undefined);
        current = null;
        return {
          itemId: '51',
          revisionId: '52',
          rootAnchorId: '53',
          outcome,
          outcomeSource: 'automatic',
          dataRevision: 0,
        };
      },
    }),
  );
  t.after(() => store.close());
  await store.start();
  assert.equal(await store.completePlayout('Terminal game', false), true);
  assert.deepEqual(readyStore(store).completedPlayout?.outcome, outcome);
  assert.equal(readyStore(store).completedPlayout?.outcomeSource, 'automatic');
});

test('opening a completed game persists free analysis and restores it after restart', async (t) => {
  let current: PlayoutDto | null = playout(3, 0, [], 'stopped');
  const fixture = lifecycleFixture({
    getPlayout: async () => current,
    completePlayout: async () => {
      current = null;
      return {
        itemId: '11',
        revisionId: '12',
        rootAnchorId: '13',
        outcome: { kind: 'draw' },
        outcomeSource: 'manual',
        dataRevision: fixture.backend.revision,
      };
    },
  });
  const store = createReadyStore(fixture.client);
  t.after(() => store.close());
  await store.start();
  store.setActivity('playout');
  assert.equal(await store.completePlayout('Saved game', false, 'draw'), true);
  await store.openCompletedPlayout();
  assert.deepEqual(fixture.resumeWrites, [
    {
      scope: { kind: 'free' },
      area: 'analyze',
      expectedResumeVersion: null,
      mode: 'analyze',
      itemId: '11',
      revisionId: '12',
      anchorId: '13',
    },
  ]);
  assert.equal(readyStore(store).errorCode, undefined);
  store.close();
  const restarted = createReadyStore(fixture.client);
  t.after(() => restarted.close());
  await restarted.start();
  assert.equal(readyStore(restarted).activity, 'analyze');
  assert.equal(readyStore(restarted).analysis.record?.currentAnchorId, '13');
});

function lifecycleFixture(overrides: Partial<PlysmithApplicationClient> = {}) {
  const backend = {
    revision: 0,
    contextExists: true,
    itemExists: true,
    startup: {
      scope: { kind: 'free' },
      area: 'manage',
      startupVersion: null,
      dataRevision: 0,
    } as StartupResumeDto,
  };
  const item: SearchInventoryResultDto['items'][number] = {
    lifecycle: 'active' as const,
    itemId: '11',
    currentRevisionId: '12',
    rootAnchorId: '13',
    itemType: 'analysis',
    originKind: 'manual',
    displayName: 'Saved analysis',
    languageTag: 'en-GB',
    contextIds: ['7'],
    createdAt: '2026-09-27T12:00:00.000Z',
    updatedAt: '2026-09-27T12:00:00.000Z',
  };
  const context = {
    contextId: '7',
    displayName: 'Repertoire',
    lifecycle: 'active' as const,
    contextVersion: 4,
    referenceCount: 1,
    pendingRevisionImpactCount: 0,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
  const workspaces = new Map<string, WorkScopeWorkspaceDto>();
  const key = (scope: WorkScopeWorkspaceDto['scope']) =>
    scope.kind === 'free' ? 'free' : scope.contextId;
  const startupWrites: Parameters<
    PlysmithApplicationClient['setStartupResume']
  >[0][] = [];
  const resumeWrites: SetWorkScopeResumeRequestDto[] = [];
  const deletions: unknown[] = [];
  const client = createClient({
    getSystemStatus: async () => status(backend.revision),
    getUserPreferences: async () => preferences(backend.revision),
    searchInventory: async () => ({
      ...inventory(backend.revision),
      items: backend.itemExists ? [item] : [],
    }),
    listWorkingContexts: async () => ({
      contexts: backend.contextExists ? [context] : [],
      dataRevision: backend.revision,
    }),
    getWorkingContextWorkspace: async (contextId) => {
      assert.equal(contextId, '7');
      assert.equal(backend.contextExists, true);
      return {
        context,
        references: [],
        pendingRevisionImpacts: [],
        dataRevision: backend.revision,
      };
    },
    getStartupResume: async () => ({
      ...backend.startup,
      dataRevision: backend.revision,
    }),
    setStartupResume: async (request) => {
      startupWrites.push(structuredClone(request));
      if (request.expectedStartupVersion !== backend.startup.startupVersion)
        throw workAccessProblem('workspace.startup_conflict');
      backend.revision++;
      backend.startup = {
        scope: request.scope,
        area: request.area,
        startupVersion: (backend.startup.startupVersion ?? 0) + 1,
        dataRevision: backend.revision,
      };
      return backend.startup;
    },
    getWorkScopeWorkspace: async (request) => {
      const scope: WorkScopeWorkspaceDto['scope'] =
        request.scopeKind === 'free'
          ? { kind: 'free' }
          : { kind: 'context', contextId: request.contextId! };
      return {
        ...workspaces.get(key(scope)),
        scope,
        dataRevision: backend.revision,
      };
    },
    setWorkScopeResume: async (request) => {
      resumeWrites.push(structuredClone(request));
      const scope = request.scope;
      const workspace = workspaces.get(key(scope)) ?? {
        scope,
        dataRevision: backend.revision,
      };
      const previous =
        request.area === 'manage'
          ? workspace.managementResume
          : workspace.analysisResume;
      if (request.expectedResumeVersion !== (previous?.resumeVersion ?? null))
        throw workAccessProblem('workspace.resume_conflict');
      const resumeVersion = (previous?.resumeVersion ?? 0) + 1;
      backend.revision++;
      if (request.area === 'manage') {
        const resume = {
          resumeVersion,
          presentation: request.presentation,
          ...(request.selectedItemId === undefined
            ? {}
            : { selectedItemId: request.selectedItemId }),
          ...(request.selectedAnchorId === undefined
            ? {}
            : { selectedAnchorId: request.selectedAnchorId }),
          updatedAt: item.updatedAt,
        };
        workspaces.set(key(scope), {
          ...workspace,
          managementResume: resume,
          dataRevision: backend.revision,
        });
        return { area: 'manage', resume, dataRevision: backend.revision };
      }
      const resume = {
        resumeVersion,
        mode: request.mode,
        ...(request.itemId === undefined ? {} : { itemId: request.itemId }),
        ...(request.revisionId === undefined
          ? {}
          : { revisionId: request.revisionId }),
        ...(request.anchorId === undefined
          ? {}
          : { anchorId: request.anchorId }),
        currentPositionId: '21',
        updatedAt: item.updatedAt,
      };
      workspaces.set(key(scope), {
        ...workspace,
        analysisResume: resume,
        dataRevision: backend.revision,
      });
      return { area: 'analyze', resume, dataRevision: backend.revision };
    },
    getAnalysisWorkspace: async (request) => {
      const scope: WorkScopeWorkspaceDto['scope'] =
        request.scopeKind === 'free'
          ? { kind: 'free' }
          : { kind: 'context', contextId: request.contextId! };
      const resume = workspaces.get(key(scope))?.analysisResume;
      const anchorId = request.anchorId ?? resume?.anchorId;
      return {
        ...(backend.itemExists &&
        (request.itemId ?? resume?.itemId) !== undefined
          ? savedLineAnalysis(anchorId === '14' ? '14' : '13', backend.revision)
          : analysis(backend.revision)),
        scope,
      };
    },
    previewWorkingContextDeletion: async () => ({
      ...removalPreview(backend.revision),
      contextVersion: context.contextVersion,
    }),
    previewContextItemRemoval: async () => ({
      ...removalPreview(backend.revision),
      contextVersion: context.contextVersion,
    }),
    deleteWorkingContext: async (contextId, confirmation) => {
      deletions.push({ contextId, confirmation });
      assert.equal(confirmation.expectedDataRevision, backend.revision);
      assert.equal(confirmation.expectedContextVersion, context.contextVersion);
      backend.contextExists = false;
      backend.revision++;
      backend.startup = {
        ...backend.startup,
        scope: { kind: 'free' },
        unavailableContext: {
          contextId,
          displayName: context.displayName,
          reason: 'deleted',
        },
        dataRevision: backend.revision,
      };
      return { contextId, dataRevision: backend.revision };
    },
    previewInventoryItemDeletion: async () => ({
      itemId: item.itemId,
      currentRevisionId: item.currentRevisionId,
      displayName: item.displayName,
      itemType: item.itemType,
      contexts: [],
      global: emptyUsage(),
      retainedDerivedItemCount: 2,
      retainedPlayoutCount: 1,
      dataRevision: backend.revision,
    }),
    deleteInventoryItem: async (itemId, confirmation) => {
      deletions.push({ itemId, confirmation });
      assert.equal(
        confirmation.expectedCurrentRevisionId,
        item.currentRevisionId,
      );
      assert.equal(confirmation.expectedDataRevision, backend.revision);
      backend.itemExists = false;
      backend.revision++;
      return { itemId, dataRevision: backend.revision };
    },
    ...overrides,
  });
  return {
    backend,
    client,
    item,
    context,
    workspaces,
    startupWrites,
    resumeWrites,
    deletions,
  };
}

function emptyUsage() {
  return {
    referenceCount: 0,
    activeNoteCount: 0,
    noteMoveCount: 0,
    scratchCount: 0,
    scratchMoveCount: 0,
    scratchNoteCount: 0,
    managementResumeAffected: false,
    analysisResumeAffected: false,
  };
}

for (const scope of [
  { kind: 'free' },
  { kind: 'context', contextId: '7' },
] as const) {
  for (const area of ['manage', 'analyze', 'playout', 'settings'] as const) {
    test(`restart restores ${scope.kind} work and ${area} independently`, async (t) => {
      const fixture = lifecycleFixture();
      const store = createReadyStore(fixture.client);
      t.after(() => store.close());
      await store.start();
      await store.setScope(scope);
      await store.selectInventoryItem(fixture.item);
      assert.equal(await store.openInventoryItem(fixture.item), true);
      await store.openRecordAnchor('14');
      store.setActivity(area);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await store.refresh();
      assert.equal(readyStore(store).errorCode, undefined);
      store.close();
      const restarted = createReadyStore(fixture.client);
      t.after(() => restarted.close());
      await restarted.start();
      const state = readyStore(restarted);
      assert.deepEqual(state.scope, scope);
      assert.equal(state.activity, area);
      assert.equal(state.selectedInventoryItemId, fixture.item.itemId);
      assert.equal(state.analysis.record?.currentAnchorId, '14');
      assert.equal(state.scopeWorkspace.analysisResume?.resumeVersion, 2);
      assert.equal(fixture.resumeWrites.length, 3);
      const writes = fixture.startupWrites.length;
      restarted.setActivity(area);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(fixture.startupWrites.length, writes);
    });
  }
}

for (const reason of ['missing', 'deleted'] as const) {
  test(`startup explains a ${reason} context and restores only the free work`, async (t) => {
    const fixture = lifecycleFixture();
    fixture.backend.contextExists = false;
    fixture.backend.startup = {
      scope: { kind: 'free' },
      area: 'analyze',
      startupVersion: 3,
      dataRevision: 0,
      unavailableContext: {
        contextId: '7',
        displayName: 'Old context',
        reason,
      },
    };
    fixture.workspaces.set('free', {
      scope: { kind: 'free' },
      dataRevision: 0,
      analysisResume: {
        resumeVersion: 2,
        mode: 'analyze',
        itemId: '11',
        revisionId: '12',
        anchorId: '14',
        currentPositionId: '21',
        updatedAt: fixture.item.updatedAt,
      },
    });
    const store = createReadyStore(fixture.client);
    t.after(() => store.close());
    await store.start();
    assert.deepEqual(readyStore(store).scope, { kind: 'free' });
    assert.equal(readyStore(store).analysis.record?.currentAnchorId, '14');
    assert.deepEqual(
      readyStore(store).startupNotice,
      fixture.backend.startup.unavailableContext,
    );
    assert.equal(fixture.startupWrites.length, 0);
    assert.equal(fixture.resumeWrites.length, 0);
  });
}

test('queued navigation persists the newest area using the latest startup version', async (t) => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fixture = lifecycleFixture();
  const save = fixture.client.setStartupResume;
  fixture.client.setStartupResume = async (request) => {
    if (request.area === 'analyze') {
      entered.resolve();
      await release.promise;
    }
    return save(request);
  };
  const store = createReadyStore(fixture.client);
  t.after(() => {
    release.resolve();
    store.close();
  });
  await store.start();
  store.setActivity('analyze');
  await entered.promise;
  store.setActivity('settings');
  store.setActivity('manage');
  release.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(
    fixture.startupWrites.map(({ area, expectedStartupVersion }) => ({
      area,
      expectedStartupVersion,
    })),
    [
      { area: 'analyze', expectedStartupVersion: null },
      { area: 'manage', expectedStartupVersion: 1 },
    ],
  );
  assert.equal(fixture.backend.startup.area, 'manage');
  assert.equal(readyStore(store).activity, 'manage');
});

test('navigation changed during startup lookup skips the old target before writing', async (t) => {
  const fixture = lifecycleFixture();
  const store = createReadyStore(fixture.client);
  t.after(() => store.close());
  await store.start();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<StartupResumeDto>();
  const read = fixture.client.getStartupResume;
  let delayed = false;
  fixture.client.getStartupResume = async () => {
    if (!delayed) {
      delayed = true;
      entered.resolve();
      return release.promise;
    }
    return read();
  };
  store.setActivity('analyze');
  await entered.promise;
  store.setActivity('settings');
  release.resolve(fixture.backend.startup);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(fixture.startupWrites, [
    { scope: { kind: 'free' }, area: 'settings', expectedStartupVersion: null },
  ]);
  assert.equal(readyStore(store).activity, 'settings');
});

test('a startup CAS conflict remains visible and does not overwrite the newer target', async (t) => {
  const fixture = lifecycleFixture();
  fixture.client.setStartupResume = async () => {
    fixture.backend.startup = {
      scope: { kind: 'context', contextId: '7' },
      area: 'manage',
      startupVersion: 5,
      dataRevision: 0,
    };
    throw workAccessProblem('workspace.startup_conflict');
  };
  const store = createReadyStore(fixture.client);
  t.after(() => store.close());
  await store.start();
  store.setActivity('settings');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(readyStore(store).errorCode, 'workspace.startup_conflict');
  assert.equal(fixture.backend.startup.startupVersion, 5);
  assert.deepEqual(fixture.backend.startup.scope, {
    kind: 'context',
    contextId: '7',
  });
});

test('closing during startup lookup prevents writes from the obsolete lifecycle', async (t) => {
  const fixture = lifecycleFixture();
  const store = createReadyStore(fixture.client);
  t.after(() => store.close());
  await store.start();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<StartupResumeDto>();
  fixture.client.getStartupResume = async () => {
    entered.resolve();
    return release.promise;
  };
  store.setActivity('settings');
  await entered.promise;
  store.close();
  release.resolve(fixture.backend.startup);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fixture.startupWrites.length, 0);
});

for (const change of ['cancel', 'scope', 'area', 'close'] as const) {
  test(`late deletion preview cannot reopen the dialog after ${change}`, async (t) => {
    const preview = Promise.withResolvers<ContextRemovalPreviewDto>();
    const fixture = lifecycleFixture({
      previewWorkingContextDeletion: async () => preview.promise,
    });
    const store = createReadyStore(fixture.client);
    t.after(() => store.close());
    await store.start();
    const preparing = store.prepareContextDeletion('7');
    assert.equal(readyStore(store).destructiveAction?.status, 'loading');
    assert.equal(await store.confirmDestructiveAction(), false);
    if (change === 'cancel') store.cancelDestructiveAction();
    if (change === 'scope')
      await store.setScope({ kind: 'context', contextId: '7' });
    if (change === 'area') store.setActivity('settings');
    if (change === 'close') store.close();
    preview.resolve(removalPreview(fixture.backend.revision));
    await preparing;
    if (change !== 'close')
      assert.equal(readyStore(store).destructiveAction, undefined);
    assert.equal(fixture.deletions.length, 0);
  });
}

test('a later preview supersedes an earlier response without changing the confirmation target', async (t) => {
  const first = Promise.withResolvers<ContextRemovalPreviewDto>();
  const fixture = lifecycleFixture({
    previewWorkingContextDeletion: async () => first.promise,
  });
  const store = createReadyStore(fixture.client);
  t.after(() => store.close());
  await store.start();
  const preparing = store.prepareContextDeletion('7');
  await store.prepareInventoryItemDeletion(fixture.item);
  const expected = readyStore(store).destructiveAction;
  first.resolve(removalPreview());
  await preparing;
  assert.deepEqual(readyStore(store).destructiveAction, expected);
  assert.equal(readyStore(store).destructiveAction?.kind, 'inventory');
});

for (const timing of ['during-preview', 'after-preview'] as const) {
  test(`a changed revision ${timing} requires a new destructive preview`, async (t) => {
    const fixture = lifecycleFixture();
    const preview = Promise.withResolvers<ContextRemovalPreviewDto>();
    if (timing === 'during-preview')
      fixture.client.previewWorkingContextDeletion = async () =>
        preview.promise;
    const store = createReadyStore(fixture.client);
    t.after(() => store.close());
    await store.start();
    const preparing = store.prepareContextDeletion('7');
    if (timing === 'after-preview') await preparing;
    fixture.backend.revision++;
    await store.refresh();
    preview.resolve(removalPreview(0));
    await preparing;
    assert.equal(readyStore(store).destructiveAction?.status, 'stale');
    assert.equal(await store.confirmDestructiveAction(), false);
    assert.equal(fixture.deletions.length, 0);
  });
}

for (const stage of ['preview', 'delete'] as const) {
  test(`failed context ${stage} preserves the current work and never invents a deletion cause`, async (t) => {
    const fixture = lifecycleFixture();
    if (stage === 'preview')
      fixture.client.previewWorkingContextDeletion = async () => {
        throw workAccessProblem('host.unavailable');
      };
    else
      fixture.client.deleteWorkingContext = async () => {
        throw workAccessProblem('workspace.removal_conflict');
      };
    const store = createReadyStore(fixture.client);
    t.after(() => store.close());
    await store.start();
    await store.setScope({ kind: 'context', contextId: '7' });
    await store.openInventoryItem(fixture.item);
    await store.prepareContextDeletion('7');
    assert.equal(await store.confirmDestructiveAction(), false);
    assert.deepEqual(readyStore(store).scope, {
      kind: 'context',
      contextId: '7',
    });
    assert.equal(readyStore(store).analysis.record?.itemId, '11');
    assert.equal(readyStore(store).startupNotice, undefined);
    assert.equal(
      readyStore(store).destructiveAction?.status,
      stage === 'preview' ? 'error' : 'stale',
    );
    assert.equal(fixture.backend.contextExists, true);
  });
}

test('confirmed context deletion falls back to the free workspace and preserves its own resume', async (t) => {
  const fixture = lifecycleFixture();
  const store = createReadyStore(fixture.client);
  t.after(() => store.close());
  await store.start();
  await store.openInventoryItem(fixture.item);
  await store.openRecordAnchor('14');
  await store.setScope({ kind: 'context', contextId: '7' });
  await store.openInventoryItem(fixture.item);
  await store.prepareContextDeletion('7');
  const dataRevision = fixture.backend.revision;
  assert.equal(await store.confirmDestructiveAction(), true);
  assert.deepEqual(fixture.deletions, [
    {
      contextId: '7',
      confirmation: {
        expectedContextVersion: 4,
        expectedDataRevision: dataRevision,
      },
    },
  ]);
  assert.deepEqual(readyStore(store).scope, { kind: 'free' });
  assert.equal(readyStore(store).analysis.record?.currentAnchorId, '14');
  assert.deepEqual(readyStore(store).startupNotice, {
    contextId: '7',
    displayName: 'Repertoire',
    reason: 'deleted',
  });
  assert.equal(readyStore(store).destructiveAction, undefined);
  assert.equal(await store.confirmDestructiveAction(), false);
  assert.equal(fixture.deletions.length, 1);
});

test('confirmed inventory deletion binds the current revision and retains its distinct cause', async (t) => {
  const fixture = lifecycleFixture();
  const store = createReadyStore(fixture.client);
  t.after(() => store.close());
  await store.start();
  await store.openInventoryItem(fixture.item);
  await store.prepareInventoryItemDeletion(fixture.item);
  const dataRevision = fixture.backend.revision;
  assert.equal(await store.confirmDestructiveAction(), true);
  assert.deepEqual(fixture.deletions, [
    {
      itemId: '11',
      confirmation: {
        expectedCurrentRevisionId: '12',
        expectedDataRevision: dataRevision,
      },
    },
  ]);
  assert.equal(readyStore(store).analysis.record, undefined);
  assert.deepEqual(readyStore(store).analysisUnavailable, {
    itemId: '11',
    displayName: fixture.item.displayName,
    reason: 'deleted_from_inventory',
  });
  await store.refresh();
  assert.equal(
    readyStore(store).analysisUnavailable?.reason,
    'deleted_from_inventory',
  );
});

test('an old committed deletion response cannot retain its confirmation in the restarted store', async (t) => {
  const release = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const fixture = lifecycleFixture();
  const remove = fixture.client.deleteWorkingContext;
  fixture.client.deleteWorkingContext = async (contextId, confirmation) => {
    const receipt = await remove(contextId, confirmation);
    entered.resolve();
    await release.promise;
    return receipt;
  };
  const store = createReadyStore(fixture.client);
  t.after(() => {
    release.resolve();
    store.close();
  });
  await store.start();
  await store.setScope({ kind: 'context', contextId: '7' });
  await store.prepareContextDeletion('7');
  const deleting = store.confirmDestructiveAction();
  await entered.promise;
  assert.equal(readyStore(store).destructiveAction?.status, 'submitting');
  store.close();
  await store.start();
  assert.deepEqual(readyStore(store).scope, { kind: 'free' });
  release.resolve();
  assert.equal(await deleting, false);
  assert.deepEqual(readyStore(store).scope, { kind: 'free' });
  assert.deepEqual(readyStore(store).startupNotice, {
    contextId: '7',
    displayName: 'Repertoire',
    reason: 'deleted',
  });
  assert.equal(readyStore(store).destructiveAction, undefined);
});

test('language command is sent once and reconciled through authoritative reads', async () => {
  let dataRevision = 0;
  let currentPreferences = preferences();
  let writes = 0;
  const client = createClient({
    getSystemStatus: async () => status(dataRevision),
    getUserPreferences: async () => currentPreferences,
    getAnalysisWorkspace: async () => analysis(dataRevision),
    searchInventory: async () => inventory(dataRevision),
    listWorkingContexts: async () => contexts(dataRevision),
    setUiLanguage: async (request) => {
      writes += 1;
      dataRevision += 1;
      currentPreferences = {
        ...currentPreferences,
        uiLocale: request.uiLocale,
        preferenceRevision: currentPreferences.preferenceRevision + 1,
        dataRevision,
      };
      return { changed: true, preferences: currentPreferences };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.setUiLanguage('en-GB');

  assert.equal(writes, 1);
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.preferences.uiLocale : undefined,
    'en-GB',
  );
  store.close();
});

test('diagnostic level is written once and exposes the pending Plysmith restart', async () => {
  let currentSettings = diagnosticSettings();
  let writes = 0;
  const client = createClient({
    getDiagnosticSettings: async () => currentSettings,
    setDiagnosticLogLevel: async (request) => {
      writes += 1;
      assert.deepEqual(request, {
        level: 'debug',
        expectedConfigurationRevision: 'sha256:diagnostic-settings-test',
      });
      currentSettings = {
        configuredLevel: 'debug',
        activeLevel: 'off',
        restartRequired: true,
        configurationRevision: 'sha256:diagnostic-settings-updated',
      };
      return { changed: true, settings: currentSettings };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  assert.equal(await store.setDiagnosticLogLevel('debug'), true);

  assert.equal(writes, 1);
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.diagnostics.configuredLevel
      : undefined,
    'debug',
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.diagnostics.restartRequired : false,
    true,
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.announcement : undefined,
    'diagnostics.levelSavedPendingRestart',
  );
  store.close();
});

test('diagnostic report requires a chosen destination and sends one write', async () => {
  const requests: unknown[] = [];
  const destinations = [
    undefined,
    'C:\\Users\\test\\Desktop\\plysmith-diagnostics-20260914154309.json.gz',
  ];
  const client = createClient({
    createDiagnosticReport: async (request) => {
      requests.push(request);
      return {
        created: true,
        format: 'plysmith-diagnostics-json-gzip-v1',
        generatedAt: '2026-09-14T15:43:09.000Z',
        bytesWritten: 512,
        eventCount: 3,
        discardedLineCount: 0,
        truncated: false,
      };
    },
  });
  const store = new PlysmithApplicationStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: () => ({
      ready: Promise.resolve(),
      close: () => undefined,
    }),
    chooseDiagnosticReportDestination: async (suggestedFileName) => {
      assert.equal(
        suggestedFileName,
        'plysmith-diagnostics-20260914154309.json.gz',
      );
      return destinations.shift();
    },
  });
  await store.start();

  assert.equal(await store.createDiagnosticReport(), false);
  assert.equal(requests.length, 0);
  assert.equal(await store.createDiagnosticReport(), true);
  assert.deepEqual(requests, [
    {
      acceptedManifestVersion: 1,
      destinationPath:
        'C:\\Users\\test\\Desktop\\plysmith-diagnostics-20260914154309.json.gz',
    },
  ]);
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.announcement : undefined,
    'diagnostics.reportCreated',
  );
  assert.equal(JSON.stringify(snapshot).includes('Users\\\\test'), false);
  store.close();
});

test('engine settings are saved and removed once with a visible restart boundary', async () => {
  const input = {
    instanceId: 'stockfish-main',
    providerType: 'stockfish-uci' as const,
    displayName: 'Stockfish',
    executablePath: 'C:\\Engines\\stockfish.exe',
    arguments: [] as readonly string[],
    threads: 2,
    hashMb: 128,
    moveTimeMs: 500,
    startupTimeoutMs: 5_000,
    moveTimeoutMs: 10_000,
    stopTimeoutMs: 1_000,
    maxOutputBytes: 1_048_576,
  };
  let providers: Awaited<
    ReturnType<PlysmithApplicationClient['getEngineProviderConfigurations']>
  > = { providers: [] };
  const writes: unknown[] = [];
  const client = createClient({
    getEngineProviderConfigurations: async () => providers,
    previewEngineProviderConfiguration: async (request) => {
      assert.deepEqual(request, input);
      return { valid: true, issues: [] };
    },
    saveEngineProviderConfiguration: async (instanceId, request) => {
      writes.push({ instanceId, request });
      const saved = {
        ...input,
        arguments: [...input.arguments],
        configurationRevision: `sha256:${'b'.repeat(64)}`,
        effectiveFingerprint: `sha256:${'c'.repeat(64)}`,
        restartRequired: true,
      };
      providers = { providers: [saved] };
      return saved;
    },
    removeEngineProviderConfiguration: async (instanceId, request) => {
      writes.push({ instanceId, request, remove: true });
      const removed = providers.providers[0];
      assert.ok(removed !== undefined);
      providers = { providers: [] };
      return removed;
    },
  });
  const store = createReadyStore(client);
  await store.start();

  assert.deepEqual(await store.previewEngineProviderConfiguration(input), {
    valid: true,
    issues: [],
  });
  assert.equal(await store.saveEngineProviderConfiguration(input, null), true);

  assert.deepEqual(writes, [
    {
      instanceId: 'stockfish-main',
      request: { input, expectedConfigurationRevision: null },
    },
  ]);
  let snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.engineProviders.providers[0]?.restartRequired
      : false,
    true,
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.announcement : undefined,
    'engines.savedPendingRestart',
  );
  const configured =
    snapshot.phase === 'ready'
      ? snapshot.engineProviders.providers[0]
      : undefined;
  assert.ok(configured !== undefined);
  assert.equal(await store.removeEngineProviderConfiguration(configured), true);
  assert.deepEqual(writes[1], {
    instanceId: 'stockfish-main',
    request: {
      expectedConfigurationRevision: `sha256:${'b'.repeat(64)}`,
    },
    remove: true,
  });
  snapshot = store.getSnapshot();
  assert.deepEqual(
    snapshot.phase === 'ready' ? snapshot.engineProviders.providers : undefined,
    [],
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.announcement : undefined,
    'engines.removedPendingRestart',
  );
  store.close();
});

test('inventory and contexts remain reachable across result pages', async () => {
  const firstItem = {
    lifecycle: 'active' as const,
    itemId: '11',
    currentRevisionId: '12',
    rootAnchorId: '13',
    itemType: 'analysis' as const,
    originKind: 'manual' as const,
    displayName: 'Erster Bestand',
    languageTag: 'de-DE',
    contextIds: [],
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
  const secondItem = {
    ...firstItem,
    lifecycle: 'active' as const,
    itemId: '21',
    currentRevisionId: '22',
    rootAnchorId: '23',
    displayName: 'Zweiter Bestand',
  };
  const firstContext = {
    contextId: '7',
    displayName: 'Erster Context',
    lifecycle: 'active' as const,
    contextVersion: 1,
    referenceCount: 0,
    pendingRevisionImpactCount: 0,
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
  const secondContext = {
    ...firstContext,
    contextId: '8',
    displayName: 'Zweiter Context',
  };
  const client = createClient({
    searchInventory: async (request) =>
      request.cursor === undefined
        ? {
            ancestors: [],
            provenanceEdges: [],
            items: [firstItem],
            nextCursor: 'inventory-page-2',
            dataRevision: 0,
          }
        : {
            ancestors: [],
            provenanceEdges: [],
            items: [firstItem, secondItem],
            dataRevision: 0,
          },
    listWorkingContexts: async (request) =>
      request.cursor === undefined
        ? {
            contexts: [firstContext],
            nextCursor: 'context-page-2',
            dataRevision: 0,
          }
        : { contexts: [firstContext, secondContext], dataRevision: 0 },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.loadMoreInventory();
  await store.loadMoreContexts();

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.phase, 'ready');
  if (snapshot.phase === 'ready') {
    assert.deepEqual(
      snapshot.inventory.items.map((item) => item.itemId),
      ['11', '21'],
    );
    assert.deepEqual(
      snapshot.contexts.contexts.map((context) => context.contextId),
      ['7', '8'],
    );
    assert.equal(snapshot.inventory.nextCursor, undefined);
    assert.equal(snapshot.contexts.nextCursor, undefined);
  }
  store.close();
});

test('analysis navigation restores context and free return points', async () => {
  const item = {
    lifecycle: 'active' as const,
    itemId: '11',
    currentRevisionId: '12',
    rootAnchorId: '13',
    itemType: 'analysis' as const,
    originKind: 'manual' as const,
    displayName: 'Freie Vorschau',
    languageTag: 'de-DE',
    contextIds: [],
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
  const context = {
    contextId: '7',
    displayName: 'Repertoire',
    lifecycle: 'active' as const,
    contextVersion: 1,
    referenceCount: 0,
    pendingRevisionImpactCount: 0,
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
  const requests: Parameters<
    PlysmithApplicationClient['getAnalysisWorkspace']
  >[0][] = [];
  const client = createClient({
    listWorkingContexts: async () => ({ contexts: [context], dataRevision: 0 }),
    searchInventory: async () => ({
      ancestors: [],
      provenanceEdges: [],
      items: [item],
      dataRevision: 0,
    }),
    getWorkingContextWorkspace: async () => ({
      context,
      references: [],
      pendingRevisionImpacts: [],
      dataRevision: 0,
    }),
    getAnalysisWorkspace: async (request) => {
      requests.push(request);
      return {
        ...analysis(),
        scope:
          request.scopeKind === 'context'
            ? { kind: 'context', contextId: request.contextId! }
            : { kind: 'free' },
        ...(request.scopeKind === 'context'
          ? { contextName: context.displayName }
          : {}),
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();
  await store.openInventoryItem(item);
  assert.equal(requests.at(-1)?.itemId, '11');

  await store.setScope({ kind: 'context', contextId: '7' });
  assert.equal(await store.openInventoryItem(item), false);
  assert.equal(requests.at(-1)?.itemId, undefined);
  store.setActivity('manage');
  store.setActivity('analyze');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requests.at(-1)?.scopeKind, 'context');
  assert.equal(requests.at(-1)?.itemId, undefined);

  await store.setScope({ kind: 'free' });
  assert.equal(requests.at(-1)?.scopeKind, 'free');
  assert.equal(requests.at(-1)?.itemId, '11');
  store.close();
});

test('derived analysis navigation sends only the exact source anchor focus', async () => {
  const requests: GetAnalysisWorkspaceRequestDto[] = [];
  const diagnostics: unknown[] = [];
  const currentAnalysis: AnalysisWorkspaceDto = {
    ...analysis(),
    record: {
      itemType: 'analysis',
      itemId: '31',
      revisionId: '32',
      currentRevisionId: '32',
      revisionNumber: 1,
      historical: false,
      rootAnchorId: '33',
      currentAnchorId: '33',
      displayName: 'Abgeleitete Analyse',
      languageTag: 'de-DE',
      origin: {
        kind: 'inventory_anchor',
        itemId: '11',
        revisionId: '12',
        anchorId: '13',
      },
      root: initialState,
      steps: [],
      cursor: 0,
      contributions: [],
      contextMember: false,
    },
  };
  const client = createClient({
    getAnalysisWorkspace: async (request) => {
      requests.push(request);
      return requests.length === 1 ? currentAnalysis : analysis();
    },
  });
  const store = new PlysmithApplicationStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: () => ({
      ready: Promise.resolve(),
      close: () => undefined,
    }),
    recordDiagnostic: (event) => diagnostics.push(event),
  });
  await store.start();

  const richSourceTarget = {
    itemId: '11',
    revisionId: '12',
    anchorId: '13',
    start: initialState,
    contributions: [],
  };
  await store.openAnalysisTarget(richSourceTarget);

  assert.deepEqual(requests.at(-1), {
    scopeKind: 'free',
    itemId: '11',
    revisionId: '12',
    anchorId: '13',
  });
  assert.ok(
    diagnostics.some(
      (event) =>
        (event as { eventCode?: string }).eventCode ===
          'renderer.analysis.navigation_requested' &&
        (event as { itemId?: string }).itemId === '11',
    ),
  );
  store.close();
});

test('opening a context member sets its analysis resume exactly once', async () => {
  let resumeWrites = 0;
  const item: SearchInventoryResultDto['items'][number] = {
    lifecycle: 'active' as const,
    itemId: '11',
    currentRevisionId: '12',
    rootAnchorId: '13',
    itemType: 'analysis',
    originKind: 'manual',
    displayName: 'Caro-Kann Idee',
    languageTag: 'de-DE',
    contextIds: ['7'],
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
  const contextWorkspace: WorkingContextWorkspaceDto = {
    context: {
      contextId: '7',
      displayName: 'Repertoire',
      lifecycle: 'active' as const,
      contextVersion: 1,
      referenceCount: 1,
      pendingRevisionImpactCount: 0,
      createdAt: '2026-09-11T18:00:00.000Z',
      updatedAt: '2026-09-11T18:00:00.000Z',
    },
    references: [],
    pendingRevisionImpacts: [],
    dataRevision: 0,
  };
  const client = createClient({
    listWorkingContexts: async () => ({
      contexts: [contextWorkspace.context],
      dataRevision: 0,
    }),
    searchInventory: async () => ({
      ancestors: [],
      provenanceEdges: [],
      items: [item],
      dataRevision: 0,
    }),
    getWorkingContextWorkspace: async () => contextWorkspace,
    getAnalysisWorkspace: async (request) => ({
      ...analysis(),
      scope:
        request.scopeKind === 'context'
          ? { kind: 'context', contextId: request.contextId! }
          : { kind: 'free' },
    }),
    setWorkScopeResume: async (request) => {
      resumeWrites += 1;
      assert.deepEqual(request.scope, { kind: 'context', contextId: '7' });
      assert.deepEqual(request, {
        scope: { kind: 'context', contextId: '7' },
        area: 'analyze',
        expectedResumeVersion: null,
        mode: 'analyze',
        itemId: '11',
        revisionId: '12',
        anchorId: '13',
      });
      return {
        area: 'analyze',
        dataRevision: 0,
        resume: {
          resumeVersion: 1,
          mode: 'analyze',
          itemId: '11',
          revisionId: '12',
          anchorId: '13',
          currentPositionId: '21',
          updatedAt: '2026-09-11T18:00:00.000Z',
        },
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();
  await store.setScope({ kind: 'context', contextId: '7' });

  await store.openInventoryItem(item);

  assert.equal(resumeWrites, 1);
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'analyze',
  );
  store.close();
});

test('discarding an open draft happens before opening another context analysis', async () => {
  const item: SearchInventoryResultDto['items'][number] = {
    lifecycle: 'active' as const,
    itemId: '11',
    currentRevisionId: '12',
    rootAnchorId: '13',
    itemType: 'analysis',
    originKind: 'manual',
    displayName: 'Caro-Kann Idee',
    languageTag: 'de-DE',
    contextIds: ['7'],
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
  const context: WorkingContextWorkspaceDto['context'] = {
    contextId: '7',
    displayName: 'Repertoire',
    lifecycle: 'active' as const,
    contextVersion: 1,
    referenceCount: 1,
    pendingRevisionImpactCount: 0,
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
  const contextWorkspace: WorkingContextWorkspaceDto = {
    context,
    references: [],
    pendingRevisionImpacts: [],
    dataRevision: 0,
  };
  let scratch: AnalysisWorkspaceDto['scratch'] = {
    scratchId: 'scratch-1',
    scratchRevision: 1,
    intent: { kind: 'exploration' },
    origin: { kind: 'position_setup' },
    root: initialState,
    steps: [],
    cursor: 0,
  };
  const calls: string[] = [];
  let resumeRequest:
    Parameters<PlysmithApplicationClient['setWorkScopeResume']>[0] | undefined;
  const client = createClient({
    listWorkingContexts: async () => ({ contexts: [context], dataRevision: 0 }),
    searchInventory: async () => ({
      ancestors: [],
      provenanceEdges: [],
      items: [item],
      dataRevision: 0,
    }),
    getWorkingContextWorkspace: async () => contextWorkspace,
    getAnalysisWorkspace: async (request) => {
      calls.push(`analysis:${request.itemId ?? 'draft'}`);
      if (scratch !== undefined) {
        return {
          ...analysis(),
          scope: { kind: 'context', contextId: '7' },
          contextName: 'Repertoire',
          scratch,
          allowedActions: ['apply_move', 'discard_scratch'],
        };
      }
      return {
        ...savedAnalysis(),
        scope: { kind: 'context', contextId: '7' },
        contextName: 'Repertoire',
        record: {
          ...savedAnalysis().record!,
          contextMember: true,
        },
      };
    },
    updateAnalysisScratch: async (request) => {
      calls.push(`scratch:${request.action.kind}`);
      scratch = undefined;
      return { discarded: true, dataRevision: 1 };
    },
    setWorkScopeResume: async (request) => {
      calls.push('resume');
      resumeRequest = request;
      return {
        area: 'analyze',
        dataRevision: 1,
        resume: {
          resumeVersion: 1,
          mode: 'analyze',
          itemId: item.itemId,
          revisionId: item.currentRevisionId,
          anchorId: item.rootAnchorId,
          currentPositionId: '21',
          updatedAt: '2026-09-11T18:00:00.000Z',
        },
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();
  await store.setScope({ kind: 'context', contextId: '7' });

  assert.equal(
    await store.discardAnalysisScratchAndOpenInventoryItem(item),
    true,
  );
  assert.deepEqual(calls.slice(calls.indexOf('scratch:discard')), [
    'scratch:discard',
    'analysis:draft',
    'resume',
    'analysis:draft',
    'analysis:draft',
  ]);
  assert.deepEqual(resumeRequest, {
    scope: { kind: 'context', contextId: '7' },
    area: 'analyze',
    expectedResumeVersion: null,
    mode: 'analyze',
    itemId: item.itemId,
    revisionId: item.currentRevisionId,
    anchorId: item.rootAnchorId,
  });
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'analyze',
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.analysis.scratch : undefined,
    undefined,
  );
  store.close();
});

test('removing a context member keeps it in inventory and refreshes its membership', async () => {
  let removed = false;
  const calls: unknown[] = [];
  const item: SearchInventoryResultDto['items'][number] = {
    lifecycle: 'active' as const,
    itemId: '11',
    currentRevisionId: '12',
    rootAnchorId: '13',
    itemType: 'analysis',
    originKind: 'manual',
    displayName: 'Caro-Kann Idee',
    languageTag: 'de-DE',
    contextIds: ['7'],
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
  const context: WorkingContextWorkspaceDto['context'] = {
    contextId: '7',
    displayName: 'Repertoire',
    lifecycle: 'active' as const,
    contextVersion: 1,
    referenceCount: 1,
    pendingRevisionImpactCount: 0,
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
  const client = createClient({
    getSystemStatus: async () => status(removed ? 1 : 0),
    getUserPreferences: async () => preferences(removed ? 1 : 0),
    listWorkingContexts: async () => ({
      contexts: [
        {
          ...context,
          referenceCount: removed ? 0 : 1,
        },
      ],
      dataRevision: removed ? 1 : 0,
    }),
    searchInventory: async () => ({
      ancestors: [],
      provenanceEdges: [],
      items: [
        {
          ...item,
          contextIds: removed ? [] : ['7'],
        },
      ],
      dataRevision: removed ? 1 : 0,
    }),
    getWorkingContextWorkspace: async () => ({
      context: {
        ...context,
        referenceCount: removed ? 0 : 1,
      },
      references: [],
      pendingRevisionImpacts: [],
      dataRevision: removed ? 1 : 0,
    }),
    getAnalysisWorkspace: async (request) => ({
      ...analysis(removed ? 1 : 0),
      scope:
        request.scopeKind === 'context'
          ? { kind: 'context', contextId: request.contextId! }
          : { kind: 'free' },
    }),
    removeContextItem: async (contextId, itemId) => {
      calls.push({ contextId, itemId });
      removed = true;
      return { contextId, itemId, dataRevision: 1 };
    },
  });
  const store = createReadyStore(client);
  await store.start();
  await store.setScope({ kind: 'context', contextId: '7' });

  assert.equal(
    await store.removeInventoryItemFromCurrentContext(item, removalPreview()),
    true,
  );

  assert.deepEqual(calls, [{ contextId: '7', itemId: '11' }]);
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.phase, 'ready');
  if (snapshot.phase === 'ready') {
    assert.equal(snapshot.inventory.items[0]?.itemId, '11');
    assert.deepEqual(snapshot.inventory.items[0]?.contextIds, []);
    assert.equal(snapshot.contextWorkspace?.context.referenceCount, 0);
  }
  store.close();
});

test('a context member with a pending impact cannot be opened before resolution', async () => {
  const item: SearchInventoryResultDto['items'][number] = {
    lifecycle: 'active' as const,
    itemId: '11',
    currentRevisionId: '14',
    rootAnchorId: '13',
    itemType: 'analysis',
    originKind: 'manual',
    displayName: 'Neue globale Fassung',
    languageTag: 'de-DE',
    contextIds: ['7'],
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-14T12:00:00.000Z',
  };
  const context = {
    contextId: '7',
    displayName: 'Repertoire',
    lifecycle: 'active' as const,
    contextVersion: 1,
    referenceCount: 1,
    pendingRevisionImpactCount: 1,
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-14T12:00:00.000Z',
  };
  const analysisRequests: GetAnalysisWorkspaceRequestDto[] = [];
  let resumeWrites = 0;
  const client = createClient({
    listWorkingContexts: async () => ({ contexts: [context], dataRevision: 0 }),
    searchInventory: async () => ({
      ancestors: [],
      provenanceEdges: [],
      items: [item],
      dataRevision: 0,
    }),
    getWorkingContextWorkspace: async () => ({
      context,
      references: [
        {
          referenceId: '31',
          itemId: '11',
          currentRevisionId: '12',
          itemType: 'analysis',
          displayName: 'Bisherige Context-Fassung',
          anchorId: '13',
          anchorKind: 'occurrence',
          createdAt: '2026-09-11T18:00:00.000Z',
        },
      ],
      pendingRevisionImpacts: [
        {
          impactId: '21',
          itemId: '11',
          pinnedRevisionId: '12',
          targetRevisionId: '14',
          impactVersion: 1,
          entryCount: 1,
          updatedAt: '2026-09-14T12:00:00.000Z',
        },
      ],
      dataRevision: 0,
    }),
    getAnalysisWorkspace: async (request) => {
      analysisRequests.push(request);
      const workspace = savedLineAnalysis(
        request.anchorId === '14' ? '14' : '13',
      );
      return {
        ...workspace,
        scope:
          request.scopeKind === 'context'
            ? { kind: 'context', contextId: request.contextId! }
            : { kind: 'free' },
        record: {
          ...workspace.record!,
          revisionId: '12',
          currentRevisionId: '14',
          historical: true,
          contextMember: true,
        },
      };
    },
    setWorkScopeResume: async () => {
      resumeWrites += 1;
      return assert.fail('a pinned context preview must not change the resume');
    },
  });
  const store = createReadyStore(client);
  await store.start();
  await store.setScope({ kind: 'context', contextId: '7' });
  const requestsBeforeOpen = analysisRequests.length;

  await store.selectInventoryItem(item);
  await store.openInventoryItem(item);

  assert.equal(resumeWrites, 0);
  assert.equal(analysisRequests.length, requestsBeforeOpen);
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'manage',
  );
  store.close();
});

test('saving an analysis note sends its explicit context visibility once', async () => {
  let noteRequest: unknown;
  let scratchRequest: unknown;
  const context = {
    contextId: '7',
    displayName: 'Repertoire',
    lifecycle: 'active' as const,
    contextVersion: 1,
    referenceCount: 1,
    pendingRevisionImpactCount: 0,
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
  const client = createClient({
    listWorkingContexts: async () => ({ contexts: [context], dataRevision: 0 }),
    getWorkingContextWorkspace: async () => ({
      context,
      references: [],
      pendingRevisionImpacts: [],
      dataRevision: 0,
    }),
    getAnalysisWorkspace: async (request) =>
      request.scopeKind === 'context'
        ? {
            ...analysis(),
            scope: { kind: 'context', contextId: request.contextId! },
            contextName: 'Repertoire',
            scratch: {
              scratchId: 'scratch-1',
              scratchRevision: 3,
              intent: { kind: 'exploration' },
              origin: {
                kind: 'inventory_anchor',
                itemId: '11',
                revisionId: '12',
                anchorId: '13',
              },
              root: initialState,
              steps: [],
              cursor: 1,
              noteDraft: {
                body: 'Praktische Fortsetzung.',
                moves: [{ from: 'e2', to: 'e4', san: 'e4' }],
              },
            },
            allowedActions: [
              'apply_move',
              'move_cursor',
              'prepare_note',
              'discard_scratch',
              'create_analysis_note',
              'create_analysis_record',
            ],
          }
        : analysis(),
    createAnalysisNote: async (request) => {
      noteRequest = request;
      return {
        contributionId: '21',
        itemId: '11',
        revisionId: '12',
        anchorId: '13',
        scopeKind: 'context',
        contextId: '7',
        resumeUpdate: { contextId: '7', resumeVersion: 4 },
        dataRevision: 1,
      };
    },
    updateAnalysisScratch: async (request) => {
      scratchRequest = request;
      return {
        scratch: {
          scratchId: 'scratch-1',
          scratchRevision: 4,
          intent: { kind: 'exploration' },
          origin: {
            kind: 'inventory_anchor',
            itemId: '11',
            revisionId: '12',
            anchorId: '13',
          },
          root: initialState,
          steps: [],
          cursor: 1,
          noteDraft: {
            body: 'Geänderte Fortsetzung.',
            moves: [{ from: 'e2', to: 'e4', san: 'e4' }],
          },
        },
        discarded: false,
        dataRevision: 1,
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();
  await store.setScope({ kind: 'context', contextId: '7' });

  await store.createAnalysisNote('context', 'Geänderte Fortsetzung.');

  assert.deepEqual(scratchRequest, {
    scope: { kind: 'context', contextId: '7' },
    expectedScratchId: 'scratch-1',
    expectedScratchRevision: 3,
    action: { kind: 'prepare_note', body: 'Geänderte Fortsetzung.' },
  });
  assert.deepEqual(noteRequest, {
    scope: { kind: 'context', contextId: '7' },
    expectedScratchId: 'scratch-1',
    expectedScratchRevision: 4,
    languageTag: 'de-DE',
    noteScope: { kind: 'context', contextId: '7' },
  });
  store.close();
});

test('events from one note save are covered by one authoritative refresh', async () => {
  let dataRevision = 0;
  let analysisReads = 0;
  let emitEvent: (dataRevision: number) => void = () => undefined;
  let currentScratch: AnalysisWorkspaceDto['scratch'] = {
    scratchId: 'scratch-1',
    scratchRevision: 2,
    intent: { kind: 'exploration' },
    origin: {
      kind: 'inventory_anchor',
      itemId: '11',
      revisionId: '12',
      anchorId: '13',
    },
    root: initialState,
    steps: [],
    cursor: 1,
    noteDraft: {
      body: '',
      moves: [{ from: 'e2', to: 'e4', san: 'e4' }],
    },
  };
  const client = createClient({
    getSystemStatus: async () => status(dataRevision),
    getUserPreferences: async () => preferences(dataRevision),
    listWorkingContexts: async () => contexts(dataRevision),
    searchInventory: async () => inventory(dataRevision),
    getAnalysisWorkspace: async () => {
      analysisReads += 1;
      return {
        ...analysis(dataRevision),
        ...(currentScratch === undefined ? {} : { scratch: currentScratch }),
      };
    },
    updateAnalysisScratch: async () => {
      dataRevision += 1;
      currentScratch = {
        ...currentScratch!,
        scratchRevision: 3,
        noteDraft: {
          body: 'Praktische Fortsetzung.',
          moves: [{ from: 'e2', to: 'e4', san: 'e4' }],
        },
      };
      emitEvent(dataRevision);
      return {
        scratch: currentScratch,
        discarded: false,
        dataRevision,
      };
    },
    createAnalysisNote: async () => {
      dataRevision += 1;
      currentScratch = undefined;
      emitEvent(dataRevision);
      return {
        contributionId: '21',
        itemId: '11',
        revisionId: '12',
        anchorId: '13',
        scopeKind: 'global',
        dataRevision,
      };
    },
  });
  const store = new PlysmithApplicationStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: (_connection, onChange) => {
      emitEvent = (revision) => onChange(changedEvent(revision));
      return { ready: Promise.resolve(), close: () => undefined };
    },
  });
  await store.start();

  await store.createAnalysisNote('global', 'Praktische Fortsetzung.');

  assert.equal(dataRevision, 2);
  assert.equal(analysisReads, 2);
  const savedState = store.getSnapshot();
  assert.equal(
    savedState.phase === 'ready' ? savedState.refreshing : undefined,
    false,
  );

  emitEvent(dataRevision);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(
    analysisReads,
    2,
    'a delayed event for the already-read revision must not refresh again',
  );
  store.close();
});

test('path-to-note preparation starts empty and can return to the intact path', async () => {
  const requests: unknown[] = [];
  let currentScratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
    scratchId: 'scratch-1',
    scratchRevision: 2,
    intent: { kind: 'exploration' },
    origin: {
      kind: 'inventory_anchor',
      itemId: '11',
      revisionId: '12',
      anchorId: '13',
    },
    root: initialState,
    steps: [],
    cursor: 1,
  };
  const client = createClient({
    getAnalysisWorkspace: async () => ({
      ...analysis(),
      scratch: currentScratch,
      allowedActions: [
        'apply_move',
        'move_cursor',
        'prepare_note',
        ...(currentScratch.noteDraft === undefined
          ? []
          : ['clear_note' as const]),
        'discard_scratch',
        'create_analysis_record',
      ],
    }),
    updateAnalysisScratch: async (request) => {
      requests.push(request);
      currentScratch =
        request.action.kind === 'prepare_note'
          ? {
              ...currentScratch,
              scratchRevision: currentScratch.scratchRevision + 1,
              noteDraft: {
                body: request.action.body,
                moves: [{ from: 'e2', to: 'e4', san: 'e4' }],
              },
            }
          : {
              scratchId: currentScratch.scratchId,
              scratchRevision: currentScratch.scratchRevision + 1,
              intent: currentScratch.intent,
              origin: currentScratch.origin,
              root: currentScratch.root,
              steps: currentScratch.steps,
              cursor: currentScratch.cursor,
            };
      return { scratch: currentScratch, discarded: false, dataRevision: 0 };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.prepareAnalysisNote('');
  await store.clearAnalysisNote();

  assert.deepEqual(requests, [
    {
      scope: { kind: 'free' },
      expectedScratchId: 'scratch-1',
      expectedScratchRevision: 2,
      action: { kind: 'prepare_note', body: '' },
    },
    {
      scope: { kind: 'free' },
      expectedScratchId: 'scratch-1',
      expectedScratchRevision: 3,
      action: { kind: 'clear_note' },
    },
  ]);
  assert.equal(currentScratch.scratchRevision, 4);
  assert.equal(currentScratch.cursor, 1);
  assert.equal(currentScratch.noteDraft, undefined);
  store.close();
});

test('saving a separate analysis synchronizes its optional visible comment', async () => {
  const requests: unknown[] = [];
  const scratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
    scratchId: 'scratch-1',
    scratchRevision: 2,
    intent: { kind: 'exploration' },
    origin: { kind: 'initial_position' },
    root: initialState,
    steps: [],
    cursor: 1,
  };
  const client = createClient({
    getAnalysisWorkspace: async () => ({
      ...analysis(),
      scratch,
      allowedActions: [
        'apply_move',
        'move_cursor',
        'prepare_note',
        'discard_scratch',
        'create_analysis_record',
      ],
    }),
    updateAnalysisScratch: async (request) => {
      requests.push(['scratch', request]);
      return {
        scratch: {
          ...scratch,
          scratchRevision: 3,
          noteDraft: {
            body: 'Zentraler Gedanke.',
            moves: [{ from: 'e2', to: 'e4', san: 'e4' }],
          },
        },
        discarded: false,
        dataRevision: 0,
      };
    },
    createAnalysisRecord: async (request) => {
      requests.push(['record', request]);
      return {
        itemId: '21',
        revisionId: '22',
        rootAnchorId: '23',
        contributionId: '24',
        resumeUpdates: [],
        dataRevision: 1,
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.createAnalysisRecord(
    'Eigene Analyse',
    'inventory',
    'global',
    'Zentraler Gedanke.',
  );

  assert.deepEqual(requests, [
    [
      'scratch',
      {
        scope: { kind: 'free' },
        expectedScratchId: 'scratch-1',
        expectedScratchRevision: 2,
        action: { kind: 'prepare_note', body: 'Zentraler Gedanke.' },
      },
    ],
    [
      'record',
      {
        scope: { kind: 'free' },
        expectedScratchId: 'scratch-1',
        expectedScratchRevision: 3,
        displayName: 'Eigene Analyse',
        languageTag: 'de-DE',
        noteScope: { kind: 'global' },
      },
    ],
  ]);
  store.close();
});

for (const scopeKind of ['free', 'context'] as const) {
  test(`saving an analysis follows the committed resume and continues from its last anchor in ${scopeKind} scope`, async () => {
    const scope =
      scopeKind === 'free'
        ? { kind: 'free' as const }
        : { kind: 'context' as const, contextId: '7' };
    let dataRevision = 0;
    const reads: GetAnalysisWorkspaceRequestDto[] = [];
    const moves: Parameters<
      PlysmithApplicationClient['updateAnalysisScratch']
    >[0][] = [];
    let scratch: AnalysisWorkspaceDto['scratch'] = {
      scratchId: 'scratch-save',
      scratchRevision: 1,
      intent: { kind: 'exploration' },
      origin: { kind: 'initial_position' },
      root: initialState,
      steps: savedLineAnalysis('14').record!.steps,
      cursor: 1,
    };
    const client = createClient({
      getSystemStatus: async () => status(dataRevision),
      getUserPreferences: async () => preferences(dataRevision),
      searchInventory: async () => inventory(dataRevision),
      listWorkingContexts: async () => contexts(dataRevision),
      getWorkingContextWorkspace: async () => ({
        context: {
          contextId: '7',
          displayName: 'Repertoire',
          lifecycle: 'active',
          contextVersion: 1,
          referenceCount: dataRevision === 0 ? 0 : 1,
          pendingRevisionImpactCount: 0,
          createdAt: '2026-09-11T18:00:00.000Z',
          updatedAt: '2026-09-11T18:00:00.000Z',
        },
        references: [],
        pendingRevisionImpacts: [],
        dataRevision,
      }),
      getAnalysisWorkspace: async (request) => {
        if (scopeKind === 'context' && request.scopeKind !== 'context')
          return analysis(dataRevision);
        if (dataRevision === 0)
          return {
            ...analysis(),
            scope,
            ...(scratch === undefined ? {} : { scratch }),
          };
        reads.push(request);
        const saved = savedLineAnalysis(
          request.anchorId === '13' ? '13' : '14',
          dataRevision,
        );
        return {
          ...saved,
          scope,
          record: { ...saved.record!, contextMember: scopeKind === 'context' },
          ...(scratch === undefined ? {} : { scratch }),
          legalMoves: [{ from: 'c7', to: 'c5', san: 'c5' }],
        };
      },
      createAnalysisRecord: async (request) => {
        assert.deepEqual(request.scope, scope);
        assert.equal(
          request.targetContextId,
          scopeKind === 'context' ? '7' : undefined,
        );
        scratch = undefined;
        dataRevision = 1;
        return {
          itemId: '11',
          revisionId: '12',
          rootAnchorId: '13',
          resumeUpdates: [],
          dataRevision,
        };
      },
      updateAnalysisScratch: async (request) => {
        moves.push(request);
        scratch = {
          scratchId: 'scratch-next',
          scratchRevision: 1,
          intent: { kind: 'exploration' },
          origin: {
            kind: 'inventory_anchor',
            itemId: '11',
            revisionId: '12',
            anchorId: '14',
          },
          root: initialState,
          steps: [
            {
              before: initialState,
              move: { from: 'c7', to: 'c5', san: 'c5' },
              after: initialState,
            },
          ],
          cursor: 1,
        };
        dataRevision = 2;
        return { scratch, discarded: false, dataRevision };
      },
    });
    const store = createReadyStore(client);
    try {
      await store.start();
      if (scopeKind === 'context') await store.setScope(scope);
      assert.equal(
        await store.createAnalysisRecord(
          'Saved line',
          scopeKind === 'context' ? 'context' : 'inventory',
          'global',
          '',
        ),
        true,
      );
      assert.ok(reads.length > 0);
      assert.ok(
        reads.every(
          (request) =>
            request.itemId === undefined &&
            request.revisionId === undefined &&
            request.anchorId === undefined,
        ),
      );
      assert.equal(readyStore(store).analysis.record?.currentAnchorId, '14');
      await store.applyBoardMove('c7', 'c5');
      assert.deepEqual(moves, [
        {
          scope,
          expectedScratchId: null,
          expectedScratchRevision: null,
          action: {
            kind: 'start',
            origin: {
              kind: 'inventory_anchor',
              itemId: '11',
              revisionId: '12',
              anchorId: '14',
            },
            firstMove: { kind: 'coordinates', value: 'c7c5' },
          },
        },
      ]);
      assert.equal(
        readyStore(store).analysis.scratch?.steps[0]?.move.san,
        'c5',
      );
    } finally {
      store.close();
    }
  });
}

test('inline note commands preserve exact anchors and contribution versions', async () => {
  const calls: unknown[] = [];
  const client = createClient({
    createPositionNote: async (request) => {
      calls.push(['create', request]);
      return {
        contributionId: '21',
        itemId: request.itemId,
        anchorId: request.anchorId,
        contributionVersion: 1,
        dataRevision: 1,
      };
    },
    updateAnalysisNote: async (contributionId, request) => {
      calls.push(['update', contributionId, request]);
      return {
        contributionId,
        itemId: '11',
        anchorId: '13',
        contributionVersion: 2,
        dataRevision: 2,
      };
    },
    deleteAnalysisNote: async (contributionId, request) => {
      calls.push(['delete', contributionId, request]);
      return {
        contributionId,
        itemId: '11',
        anchorId: '13',
        contributionVersion: 3,
        dataRevision: 3,
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();
  const targetWithPresentationData = {
    itemId: '11',
    revisionId: '12',
    anchorId: '13',
    contributions: [{ contributionId: 'view-only' }],
  };

  assert.equal(
    await store.createPositionNote(
      targetWithPresentationData,
      '  Nach e4  ',
      'global',
    ),
    true,
  );
  assert.equal(await store.updateAnalysisNote('21', 1, '  Nach e4!  '), true);
  assert.equal(await store.deleteAnalysisNote('21', 2), true);

  assert.deepEqual(calls, [
    [
      'create',
      {
        scope: { kind: 'free' },
        itemId: '11',
        revisionId: '12',
        anchorId: '13',
        body: 'Nach e4',
        languageTag: 'de-DE',
        noteScope: { kind: 'global' },
      },
    ],
    [
      'update',
      '21',
      {
        scope: { kind: 'free' },
        expectedContributionVersion: 1,
        body: 'Nach e4!',
      },
    ],
    [
      'delete',
      '21',
      { scope: { kind: 'free' }, expectedContributionVersion: 2 },
    ],
  ]);
  store.close();
});

test('a lost scratch write response is not retried', async () => {
  let writes = 0;
  let reads = 0;
  let currentScratch: AnalysisWorkspaceDto['scratch'];
  const client = createClient({
    getAnalysisWorkspace: async () => {
      reads += 1;
      return {
        ...analysis(),
        ...(currentScratch === undefined ? {} : { scratch: currentScratch }),
      };
    },
    updateAnalysisScratch: async () => {
      writes += 1;
      currentScratch = {
        scratchId: 'accepted-before-response-loss',
        scratchRevision: 1,
        intent: { kind: 'exploration' },
        origin: { kind: 'initial_position' },
        root: initialState,
        steps: [],
        cursor: 0,
      };
      throw new Error('response lost');
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.startScratchAtInitialPosition();

  assert.equal(writes, 1);
  assert.equal(reads, 2);
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.errorCode : undefined,
    'host.unavailable',
  );
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.analysis.scratch?.scratchId
      : undefined,
    'accepted-before-response-loss',
  );
  store.close();
});

test('analysis setup validation is read-only and does not refresh the workspace', async () => {
  let reads = 0;
  let validationRequest:
    | Parameters<PlysmithApplicationClient['validateAnalysisSetup']>[0]
    | undefined;
  const client = createClient({
    getAnalysisWorkspace: async () => {
      reads += 1;
      return analysis();
    },
    validateAnalysisSetup: async (request) => {
      validationRequest = request;
      return {
        valid: false,
        issues: [{ code: 'black_king_required', field: 'pieces' }],
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  const result = await store.validateAnalysisSetup({
    input: {
      kind: 'position_setup',
      setup: {
        pieces: [{ square: 'e1', color: 'white', role: 'king' }],
        sideToMove: 'white',
        castlingRights: {
          whiteKingSide: false,
          whiteQueenSide: false,
          blackKingSide: false,
          blackQueenSide: false,
        },
        halfmoveClock: 0,
        fullmoveNumber: 1,
      },
    },
  });

  assert.equal(result?.valid, false);
  assert.equal(reads, 1);
  assert.deepEqual(validationRequest, {
    input: {
      kind: 'position_setup',
      setup: {
        pieces: [{ square: 'e1', color: 'white', role: 'king' }],
        sideToMove: 'white',
        castlingRights: {
          whiteKingSide: false,
          whiteQueenSide: false,
          blackKingSide: false,
          blackQueenSide: false,
        },
        halfmoveClock: 0,
        fullmoveNumber: 1,
      },
    },
  });
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.busyCommand : undefined,
    undefined,
  );
  store.close();
});

test('a custom position starts one new analysis and opens the analysis activity', async () => {
  let current = analysis();
  let request:
    | Parameters<PlysmithApplicationClient['updateAnalysisScratch']>[0]
    | undefined;
  const setup = {
    pieces: [
      { square: 'e1', color: 'white', role: 'king' },
      { square: 'a1', color: 'white', role: 'rook' },
      { square: 'e8', color: 'black', role: 'king' },
    ],
    sideToMove: 'black',
    castlingRights: {
      whiteKingSide: false,
      whiteQueenSide: false,
      blackKingSide: false,
      blackQueenSide: false,
    },
    halfmoveClock: 0,
    fullmoveNumber: 12,
  } as const;
  const client = createClient({
    getAnalysisWorkspace: async () => current,
    updateAnalysisScratch: async (input) => {
      request = input;
      const scratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
        scratchId: 'setup-scratch',
        scratchRevision: 1,
        intent: { kind: 'exploration' },
        origin: { kind: 'position_setup' },
        root: {
          ...initialState,
          fen: '4k3/8/8/8/8/8/8/R3K3 b - - 0 12',
          playState: {
            halfmoveClock: 0,
            fullmoveNumber: 12,
            historyKnowledge: 'unknown',
          },
        },
        steps: [],
        cursor: 0,
      };
      current = { ...analysis(), scratch };
      return { scratch, discarded: false, dataRevision: 0 };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  assert.equal(await store.startScratchAtSetup(setup), true);
  assert.deepEqual(request, {
    scope: { kind: 'free' },
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: { kind: 'start', origin: { kind: 'position_setup', setup } },
  });
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'analyze',
  );
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.analysis.scratch?.scratchId
      : undefined,
    'setup-scratch',
  );
  store.close();
});

test('starting from the initial position clears a previous item focus before refreshing', async () => {
  const item: SearchInventoryResultDto['items'][number] = {
    lifecycle: 'active' as const,
    itemId: '11',
    currentRevisionId: '12',
    rootAnchorId: '13',
    itemType: 'analysis',
    originKind: 'manual',
    displayName: 'Previous analysis',
    languageTag: 'en-GB',
    contextIds: [],
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
  let scratch: AnalysisWorkspaceDto['scratch'];
  const requests: GetAnalysisWorkspaceRequestDto[] = [];
  const client = createClient({
    searchInventory: async () => ({
      ancestors: [],
      provenanceEdges: [],
      items: [item],
      dataRevision: 0,
    }),
    getAnalysisWorkspace: async (request) => {
      requests.push(request);
      if (scratch !== undefined) {
        return {
          ...analysis(),
          scratch,
          legalMoves: [{ from: 'e2', to: 'e4', san: 'e4' }],
          allowedActions: ['apply_move', 'discard_scratch'],
        };
      }
      return request.itemId === undefined ? analysis() : savedAnalysis();
    },
    updateAnalysisScratch: async () => {
      scratch = {
        scratchId: 'initial-position-scratch',
        scratchRevision: 1,
        intent: { kind: 'exploration' },
        origin: { kind: 'initial_position' },
        root: initialState,
        steps: [],
        cursor: 0,
      };
      return { scratch, discarded: false, dataRevision: 0 };
    },
  });
  const store = createReadyStore(client);
  await store.start();
  await store.openInventoryItem(item);
  store.setActivity('manage');

  assert.equal(await store.startScratchAtInitialPosition(), true);

  const snapshot = store.getSnapshot();
  assert.equal(requests.at(-1)?.itemId, undefined);
  assert.equal(snapshot.phase, 'ready');
  if (snapshot.phase === 'ready') {
    assert.equal(snapshot.activity, 'analyze');
    assert.equal(snapshot.refreshing, false);
    assert.equal(snapshot.busyCommand, undefined);
    assert.deepEqual(snapshot.analysis.legalMoves, [
      { from: 'e2', to: 'e4', san: 'e4' },
    ]);
  }
  store.close();
});

test('the first board move in an empty analysis starts one atomic analysis path', async () => {
  let current: AnalysisWorkspaceDto = {
    ...analysis(),
    legalMoves: [{ from: 'e2', to: 'e4', san: 'e4' }],
  };
  let request:
    | Parameters<PlysmithApplicationClient['updateAnalysisScratch']>[0]
    | undefined;
  const client = createClient({
    getAnalysisWorkspace: async () => current,
    updateAnalysisScratch: async (input) => {
      request = input;
      const scratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
        scratchId: 'first-move-scratch',
        scratchRevision: 1,
        intent: { kind: 'exploration' },
        origin: { kind: 'initial_position' },
        root: initialState,
        steps: [
          {
            before: initialState,
            move: { from: 'e2', to: 'e4', san: 'e4' },
            after: {
              ...initialState,
              fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
            },
          },
        ],
        cursor: 1,
      };
      current = {
        ...analysis(),
        scratch,
        currentState: scratch.steps[0]!.after,
        allowedActions: [
          'apply_move',
          'move_cursor',
          'discard_scratch',
          'remove_last_move',
          'prepare_note',
          'create_analysis_record',
        ],
      };
      return { scratch, discarded: false, dataRevision: 0 };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.applyBoardMove('e2', 'e4');

  assert.deepEqual(request, {
    scope: { kind: 'free' },
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: { kind: 'initial_position' },
      firstMove: { kind: 'coordinates', value: 'e2e4' },
    },
  });
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.analysis.scratch?.steps[0]?.move.san
      : undefined,
    'e4',
  );
  store.close();
});

test('starting a new analysis never overwrites an existing draft', async () => {
  const scratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
    scratchId: 'existing-scratch',
    scratchRevision: 1,
    intent: { kind: 'exploration' },
    origin: { kind: 'initial_position' },
    root: initialState,
    steps: [],
    cursor: 0,
  };
  let writes = 0;
  const client = createClient({
    getAnalysisWorkspace: async () => ({ ...analysis(), scratch }),
    updateAnalysisScratch: async () => {
      writes += 1;
      return assert.fail('existing scratch must not be replaced');
    },
  });
  const store = createReadyStore(client);
  await store.start();

  assert.equal(await store.startScratchAtInitialPosition(), false);
  assert.equal(writes, 0);
  store.close();
});

test('failed saves report failure without consuming visible drafts', async () => {
  const currentScratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
    scratchId: 'scratch-1',
    scratchRevision: 1,
    intent: { kind: 'exploration' },
    origin: { kind: 'initial_position' },
    root: initialState,
    steps: [],
    cursor: 0,
  };
  const client = createClient({
    getAnalysisWorkspace: async () => ({
      ...analysis(),
      scratch: currentScratch,
    }),
    createAnalysisRecord: async () => {
      throw new Error('save failed');
    },
    createWorkingContext: async () => {
      throw new Error('save failed');
    },
  });
  const store = createReadyStore(client);
  await store.start();

  assert.equal(
    await store.createAnalysisRecord(
      'Sichtbarer Entwurf',
      'inventory',
      'global',
      '',
    ),
    false,
  );
  assert.equal(
    await store.createWorkingContext({ displayName: 'Sichtbarer Context' }),
    false,
  );
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.analysis.scratch?.scratchId
      : undefined,
    'scratch-1',
  );
  store.close();
});

test('rename from manage previews and saves one metadata revision in place', async () => {
  const item: SearchInventoryResultDto['items'][number] = {
    lifecycle: 'active' as const,
    itemId: '11',
    currentRevisionId: '12',
    rootAnchorId: '13',
    itemType: 'analysis',
    originKind: 'manual',
    displayName: 'Französisch',
    languageTag: 'de-DE',
    contextIds: [],
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-15T10:00:00.000Z',
  };
  let startRequest:
    | Parameters<PlysmithApplicationClient['startInventoryRevision']>[1]
    | undefined;
  let saveRequest:
    | Parameters<PlysmithApplicationClient['saveInventoryRevision']>[0]
    | undefined;
  let discardRequest:
    | Parameters<PlysmithApplicationClient['updateAnalysisScratch']>[0]
    | undefined;
  const previousRevision = savedAnalysis().record!;
  const preview = {
    itemId: '11',
    baseRevisionId: '12',
    mode: 'metadata' as const,
    displayName: 'Französische Verteidigung',
    preservedMoveCount: 0,
    addedSteps: [],
    removedSteps: [],
    historicalGlobalContributionCount: 0,
    affectedContexts: [],
    followingContexts: [],
    noOp: false,
    previewFingerprint: 'sha256:rename-preview',
    dataRevision: 0,
  };
  const client = createClient({
    searchInventory: async () => ({
      ancestors: [],
      provenanceEdges: [],
      items: [item],
      dataRevision: 0,
    }),
    getInventoryRevision: async () => previousRevision,
    startInventoryRevision: async (_itemId, request) => {
      startRequest = request;
      const scratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
        scratchId: 'rename-scratch',
        scratchRevision: 1,
        intent: {
          kind: 'inventory_revision',
          mode: 'metadata',
          itemId: '11',
          baseRevisionId: '12',
          cutAnchorId: '13',
          returnAnchorId: '13',
          displayName: 'Französische Verteidigung',
        },
        origin: {
          kind: 'inventory_anchor',
          itemId: '11',
          revisionId: '12',
          anchorId: '13',
        },
        root: initialState,
        steps: [],
        cursor: 0,
      };
      return { scratch, dataRevision: 0 };
    },
    previewInventoryRevision: async () => preview,
    saveInventoryRevision: async (request) => {
      saveRequest = request;
      return {
        itemId: '11',
        revisionId: '14',
        revisionNumber: 2,
        currentAnchorId: '13',
        impacts: [],
        noOp: false,
        dataRevision: 0,
      };
    },
    updateAnalysisScratch: async (request) => {
      discardRequest = request;
      return { discarded: true, dataRevision: 0 };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.prepareInventoryItemRename(
    item,
    'Französische Verteidigung',
    null,
  );

  assert.deepEqual(startRequest, {
    scope: { kind: 'free' },
    baseRevisionId: '12',
    anchorId: '13',
    mode: 'metadata',
    expectedScratchId: null,
    expectedScratchRevision: null,
    displayName: 'Französische Verteidigung',
    summary: null,
  });
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.activity : undefined,
    'manage',
  );
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.manageInventoryRevisionDraft?.preview.displayName
      : undefined,
    'Französische Verteidigung',
  );
  assert.equal(await store.saveManagedInventoryRevision(), true);
  assert.deepEqual(saveRequest, {
    scope: { kind: 'free' },
    expectedScratchId: 'rename-scratch',
    expectedScratchRevision: 1,
    previewFingerprint: 'sha256:rename-preview',
  });
  const savedSnapshot = store.getSnapshot();
  assert.equal(
    savedSnapshot.phase === 'ready'
      ? savedSnapshot.manageInventoryRevisionDraft
      : undefined,
    undefined,
  );
  assert.equal(
    savedSnapshot.phase === 'ready' ? savedSnapshot.activity : undefined,
    'manage',
  );

  await store.prepareInventoryItemRename(item, 'Französisch kompakt', null);
  assert.equal(await store.discardManagedInventoryRevision(), true);
  assert.deepEqual(discardRequest, {
    scope: { kind: 'free' },
    expectedScratchId: 'rename-scratch',
    expectedScratchRevision: 1,
    action: { kind: 'discard' },
  });
  startRequest = undefined;
  await store.prepareInventoryItemRename(
    { ...item, itemType: 'game' },
    'Gespielte Partie',
    null,
  );
  assert.deepEqual(startRequest, {
    scope: { kind: 'free' },
    baseRevisionId: '12',
    anchorId: '13',
    mode: 'metadata',
    expectedScratchId: null,
    expectedScratchRevision: null,
    displayName: 'Gespielte Partie',
    summary: null,
  });
  store.close();
});

for (const scopeKind of ['free', 'context'] as const) {
  for (const atLineEnd of [false, true]) {
    test(`new moves from a saved ${atLineEnd ? 'line end' : 'root-only analysis'} remain neutral in ${scopeKind} scope`, async () => {
      const scope =
        scopeKind === 'free'
          ? { kind: 'free' as const }
          : { kind: 'context' as const, contextId: '7' };
      const anchorId = atLineEnd ? '14' : '13';
      const base = atLineEnd ? savedLineAnalysis('14') : savedAnalysis();
      let current: AnalysisWorkspaceDto = { ...base, scope };
      const requests: Parameters<
        PlysmithApplicationClient['updateAnalysisScratch']
      >[0][] = [];
      let revisionStarts = 0;
      let previews = 0;
      const client = createClient({
        getWorkingContextWorkspace: async () => ({
          context: {
            contextId: '7',
            displayName: 'Repertoire',
            lifecycle: 'active',
            contextVersion: 1,
            referenceCount: 1,
            pendingRevisionImpactCount: 0,
            createdAt: '2026-09-11T18:00:00.000Z',
            updatedAt: '2026-09-11T18:00:00.000Z',
          },
          references: [],
          pendingRevisionImpacts: [],
          dataRevision: 0,
        }),
        getAnalysisWorkspace: async (request) =>
          scopeKind === 'context' && request.scopeKind !== 'context'
            ? analysis()
            : current,
        startInventoryRevision: async () => {
          revisionStarts += 1;
          throw new Error(
            'A board move must not prepare an inventory revision',
          );
        },
        previewInventoryRevision: async () => {
          previews += 1;
          return revisionPreview();
        },
        updateAnalysisScratch: async (request) => {
          requests.push(request);
          const steps = [
            ...(current.scratch?.steps ?? []),
            {
              before: initialState,
              move: { from: 'd2', to: 'd4', san: 'd4' },
              after: initialState,
            },
          ];
          const scratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
            scratchId: 'neutral-path',
            scratchRevision: requests.length,
            intent: { kind: 'exploration' },
            origin: {
              kind: 'inventory_anchor',
              itemId: '11',
              revisionId: '12',
              anchorId,
            },
            root: initialState,
            steps,
            cursor: steps.length,
          };
          current = {
            ...current,
            scratch,
            allowedActions: ['apply_move', 'discard_scratch'],
          };
          return { scratch, discarded: false, dataRevision: 0 };
        },
      });
      const store = createReadyStore(client);
      await store.start();
      if (scopeKind === 'context') await store.setScope(scope);
      await store.applyBoardMove('d2', 'd4');
      assert.deepEqual(requests[0], {
        scope,
        expectedScratchId: null,
        expectedScratchRevision: null,
        action: {
          kind: 'start',
          origin: {
            kind: 'inventory_anchor',
            itemId: '11',
            revisionId: '12',
            anchorId,
          },
          firstMove: { kind: 'coordinates', value: 'd2d4' },
        },
      });
      await store.applyBoardMove('g1', 'f3');
      assert.deepEqual(requests[1], {
        scope,
        expectedScratchId: 'neutral-path',
        expectedScratchRevision: 1,
        action: {
          kind: 'apply_move',
          move: { kind: 'coordinates', value: 'g1f3' },
        },
      });
      const snapshot = store.getSnapshot();
      assert.equal(snapshot.phase, 'ready');
      if (snapshot.phase !== 'ready') throw new Error('Expected ready');
      assert.equal(snapshot.analysis.scratch?.intent.kind, 'exploration');
      assert.equal(snapshot.analysis.scratch?.steps.length, 2);
      assert.equal(snapshot.analysis.record?.revisionId, '12');
      assert.equal(snapshot.inventoryRevisionPreview, undefined);
      assert.equal(await store.saveInventoryRevision(), false);
      assert.equal(revisionStarts, 0);
      assert.equal(previews, 0);
      store.close();
    });
  }
}

test('continuing a saved game starts exploration instead of an analysis revision', async () => {
  let current: AnalysisWorkspaceDto = savedGameLineAnalysis();
  let request:
    | Parameters<PlysmithApplicationClient['updateAnalysisScratch']>[0]
    | undefined;
  const client = createClient({
    getAnalysisWorkspace: async () => current,
    updateAnalysisScratch: async (input) => {
      request = input;
      const scratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
        scratchId: 'game-exploration',
        scratchRevision: 1,
        intent: { kind: 'exploration' },
        origin: {
          kind: 'inventory_anchor',
          itemId: '11',
          revisionId: '12',
          anchorId: '14',
        },
        root: initialState,
        steps: [
          {
            before: initialState,
            move: { from: 'd7', to: 'd5', san: 'd5' },
            after: initialState,
          },
        ],
        cursor: 1,
      };
      current = { ...current, scratch };
      return { scratch, discarded: false, dataRevision: 0 };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.applyBoardMove('d7', 'd5');
  assert.deepEqual(request, {
    scope: { kind: 'free' },
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: '11',
        revisionId: '12',
        anchorId: '14',
      },
      firstMove: { kind: 'coordinates', value: 'd7d5' },
    },
  });
  await store.promoteAnalysisToInventoryRevision();
  store.close();
});

test('discarding a resumed inventory exploration returns to its source anchor', async () => {
  const source = savedGameLineAnalysis();
  let scratch: AnalysisWorkspaceDto['scratch'] = {
    scratchId: 'resumed-game-exploration',
    scratchRevision: 1,
    intent: { kind: 'exploration' },
    origin: {
      kind: 'inventory_anchor',
      itemId: '11',
      revisionId: '12',
      anchorId: '14',
    },
    root: initialState,
    steps: [
      {
        before: initialState,
        move: { from: 'd7', to: 'd5', san: 'd5' },
        after: initialState,
      },
    ],
    cursor: 1,
  };
  const requests: GetAnalysisWorkspaceRequestDto[] = [];
  const client = createClient({
    getAnalysisWorkspace: async (request) => {
      requests.push(request);
      return scratch === undefined
        ? request.itemId === '11'
          ? source
          : analysis()
        : { ...source, scratch };
    },
    updateAnalysisScratch: async (request) => {
      assert.equal(request.action.kind, 'discard');
      scratch = undefined;
      return { discarded: true, dataRevision: 0 };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  assert.equal(await store.discardAnalysisScratch(), true);
  assert.deepEqual(requests.at(-1), {
    scopeKind: 'free',
    itemId: '11',
    revisionId: '12',
    anchorId: '14',
  });
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.analysis.record?.itemId : undefined,
    '11',
  );
  store.close();
});

test('a saved game move cannot be taken back as an analysis revision', async () => {
  const client = createClient({
    getAnalysisWorkspace: async () => savedGameLineAnalysis(),
  });
  const store = createReadyStore(client);
  await store.start();

  await store.takeBackLastMove();
  assert.equal(store.getSnapshot().phase, 'ready');
  store.close();
});

test('a resumed inventory revision reloads its preview after cursor navigation', async () => {
  const step = savedLineAnalysis('14').record!.steps[0]!;
  let scratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
    scratchId: 'resumed-revision-scratch',
    scratchRevision: 1,
    intent: {
      kind: 'inventory_revision',
      mode: 'extend',
      itemId: '11',
      baseRevisionId: '12',
      cutAnchorId: '14',
      returnAnchorId: '14',
      displayName: 'Französisch',
    },
    origin: {
      kind: 'inventory_anchor',
      itemId: '11',
      revisionId: '12',
      anchorId: '14',
    },
    root: initialState,
    steps: [step],
    cursor: 1,
  };
  let current: AnalysisWorkspaceDto = {
    ...savedLineAnalysis('14'),
    scratch,
    allowedActions: ['apply_move', 'move_cursor', 'discard_scratch'],
  };
  const previewedScratchRevisions: number[] = [];
  const client = createClient({
    getAnalysisWorkspace: async () => current,
    updateAnalysisScratch: async (request) => {
      scratch = {
        ...scratch,
        scratchRevision: scratch.scratchRevision + 1,
        cursor:
          request.action.kind === 'move_cursor'
            ? request.action.cursor
            : scratch.cursor,
      };
      current = { ...current, scratch };
      return { scratch, discarded: false, dataRevision: 0 };
    },
    previewInventoryRevision: async (request) => {
      previewedScratchRevisions.push(request.expectedScratchRevision);
      return revisionPreview({
        mode: 'extend',
        preservedMoveCount: request.expectedScratchRevision,
      });
    },
  });
  const store = createReadyStore(client);

  await store.start();
  assert.deepEqual(previewedScratchRevisions, [1]);
  const resumed = store.getSnapshot();
  assert.equal(
    resumed.phase === 'ready'
      ? resumed.inventoryRevisionPreview?.preservedMoveCount
      : undefined,
    1,
  );

  await store.moveAnalysisCursor(0);

  assert.deepEqual(previewedScratchRevisions, [1, 2]);
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.inventoryRevisionPreview?.preservedMoveCount
      : undefined,
    2,
  );
  store.close();
});

test('playing the saved next move navigates without creating a scratch', async () => {
  const analysisRequests: GetAnalysisWorkspaceRequestDto[] = [];
  const client = createClient({
    getAnalysisWorkspace: async (request) => {
      analysisRequests.push(request);
      return savedLineAnalysis(request.anchorId === '14' ? '14' : '13');
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.applyBoardMove('e2', 'e4');

  assert.equal(analysisRequests.at(-1)?.anchorId, '14');
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.analysis.record?.currentAnchorId
      : undefined,
    '14',
  );
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.analysis.scratch : undefined,
    undefined,
  );
  store.close();
});

test('a different move at an earlier saved position starts one atomic exploration', async () => {
  let current = savedLineAnalysis('13');
  let updateRequest:
    | Parameters<PlysmithApplicationClient['updateAnalysisScratch']>[0]
    | undefined;
  const client = createClient({
    getAnalysisWorkspace: async () => current,
    updateAnalysisScratch: async (request) => {
      updateRequest = request;
      const scratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
        scratchId: 'exploration-scratch',
        scratchRevision: 1,
        intent: { kind: 'exploration' },
        origin: {
          kind: 'inventory_anchor',
          itemId: '11',
          revisionId: '12',
          anchorId: '13',
        },
        root: initialState,
        steps: [
          {
            before: initialState,
            move: { from: 'd2', to: 'd4', san: 'd4' },
            after: initialState,
          },
        ],
        cursor: 1,
      };
      current = {
        ...current,
        scratch,
        allowedActions: [
          'apply_move',
          'move_cursor',
          'remove_last_move',
          'discard_scratch',
        ],
      };
      return { scratch, discarded: false, dataRevision: 0 };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.applyBoardMove('d2', 'd4');

  assert.deepEqual(updateRequest, {
    scope: { kind: 'free' },
    expectedScratchId: null,
    expectedScratchRevision: null,
    action: {
      kind: 'start',
      origin: {
        kind: 'inventory_anchor',
        itemId: '11',
        revisionId: '12',
        anchorId: '13',
      },
      firstMove: { kind: 'coordinates', value: 'd2d4' },
    },
  });
  store.close();
});

test('taking back the last exploration move uses the dedicated scratch action', async () => {
  const oneMoveScratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
    scratchId: 'exploration-scratch',
    scratchRevision: 1,
    intent: { kind: 'exploration' },
    origin: { kind: 'initial_position' },
    root: initialState,
    steps: [
      {
        before: initialState,
        move: { from: 'e2', to: 'e4', san: 'e4' },
        after: initialState,
      },
    ],
    cursor: 1,
  };
  let current: AnalysisWorkspaceDto = {
    ...analysis(),
    scratch: oneMoveScratch,
    allowedActions: [
      'apply_move',
      'move_cursor',
      'remove_last_move',
      'discard_scratch',
    ],
  };
  let updateRequest:
    | Parameters<PlysmithApplicationClient['updateAnalysisScratch']>[0]
    | undefined;
  const client = createClient({
    getAnalysisWorkspace: async () => current,
    updateAnalysisScratch: async (request) => {
      updateRequest = request;
      const scratch = {
        ...oneMoveScratch,
        scratchRevision: 2,
        steps: [],
        cursor: 0,
      };
      current = { ...current, scratch };
      return { scratch, discarded: false, dataRevision: 0 };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.takeBackLastMove();

  assert.deepEqual(updateRequest?.action, { kind: 'remove_last_move' });
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.analysis.scratch?.steps.length
      : undefined,
    0,
  );
  store.close();
});

test('taking back the only anchored exploration move returns to the saved analysis', async () => {
  const source = savedGameLineAnalysis();
  let scratch: AnalysisWorkspaceDto['scratch'] = {
    scratchId: 'anchored-exploration',
    scratchRevision: 2,
    intent: { kind: 'exploration' },
    origin: {
      kind: 'inventory_anchor',
      itemId: '11',
      revisionId: '12',
      anchorId: '14',
    },
    root: initialState,
    steps: [
      {
        before: initialState,
        move: { from: 'd7', to: 'd5', san: 'd5' },
        after: initialState,
      },
    ],
    cursor: 1,
  };
  const requests: GetAnalysisWorkspaceRequestDto[] = [];
  const actions: string[] = [];
  const client = createClient({
    getAnalysisWorkspace: async (request) => {
      requests.push(request);
      return scratch === undefined ? source : { ...source, scratch };
    },
    updateAnalysisScratch: async (request) => {
      actions.push(request.action.kind);
      scratch = undefined;
      return { discarded: true, dataRevision: 0 };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.takeBackLastMove();

  assert.deepEqual(actions, ['discard']);
  assert.deepEqual(requests.at(-1), {
    scopeKind: 'free',
    itemId: '11',
    revisionId: '12',
    anchorId: '14',
  });
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready' ? snapshot.analysis.scratch : undefined,
    undefined,
  );
  store.close();
});

test('taking back a stored last move creates and previews a truncation draft', async () => {
  let current = savedLineAnalysis('14');
  let startRequest:
    | Parameters<PlysmithApplicationClient['startInventoryRevision']>[1]
    | undefined;
  let previewCount = 0;
  const client = createClient({
    getAnalysisWorkspace: async (request) => {
      if (current.scratch === undefined && request.anchorId !== undefined)
        return savedLineAnalysis(request.anchorId === '14' ? '14' : '13');
      return current;
    },
    startInventoryRevision: async (_itemId, request) => {
      startRequest = request;
      const record = savedLineAnalysis('13').record!;
      const scratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
        scratchId: 'truncate-scratch',
        scratchRevision: 1,
        intent: {
          kind: 'inventory_revision',
          mode: 'truncate_after',
          itemId: '11',
          baseRevisionId: '12',
          cutAnchorId: '13',
          returnAnchorId: '13',
          displayName: 'Französisch',
        },
        origin: {
          kind: 'inventory_anchor',
          itemId: '11',
          revisionId: '12',
          anchorId: '13',
        },
        root: initialState,
        steps: [],
        cursor: 0,
      };
      current = {
        ...savedLineAnalysis('13'),
        record,
        scratch,
        allowedActions: ['apply_move', 'discard_scratch'],
      };
      return { scratch, dataRevision: 0 };
    },
    previewInventoryRevision: async () => {
      previewCount += 1;
      return revisionPreview({
        removedSteps: [savedLineAnalysis('14').record!.steps[0]!],
      });
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.takeBackLastMove();

  assert.deepEqual(startRequest, {
    scope: { kind: 'free' },
    baseRevisionId: '12',
    anchorId: '13',
    mode: 'truncate_after',
    expectedScratchId: null,
    expectedScratchRevision: null,
  });
  assert.equal(previewCount, 1);
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.inventoryRevisionPreview?.removedSteps.length
      : undefined,
    1,
  );
  store.close();
});

test('repeated takeback moves an existing truncation draft to the previous anchor', async () => {
  const first = savedLineAnalysis('14').record!.steps[0]!;
  const second = {
    anchorId: '15',
    before: initialState,
    move: { from: 'e7', to: 'e5', san: 'e5' },
    after: initialState,
  };
  const withTwoMoves = (currentAnchorId: '13' | '14' | '15') => ({
    ...savedLineAnalysis(currentAnchorId === '13' ? '13' : '14'),
    record: {
      ...savedLineAnalysis('14').record!,
      currentAnchorId,
      cursor: currentAnchorId === '13' ? 0 : currentAnchorId === '14' ? 1 : 2,
      steps: [first, second],
    },
  });
  let current: AnalysisWorkspaceDto = withTwoMoves('15');
  const startRequests: StartInventoryRevisionRequestDto[] = [];
  const client = createClient({
    getAnalysisWorkspace: async () => current,
    startInventoryRevision: async (_itemId, request) => {
      startRequests.push(request);
      const atRoot = request.anchorId === '13';
      const scratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
        scratchId: 'truncate-scratch',
        scratchRevision: atRoot ? 2 : 1,
        intent: {
          kind: 'inventory_revision',
          mode: 'truncate_after',
          itemId: '11',
          baseRevisionId: '12',
          cutAnchorId: request.anchorId,
          returnAnchorId: request.anchorId,
          displayName: 'Französisch',
        },
        origin: {
          kind: 'inventory_anchor',
          itemId: '11',
          revisionId: '12',
          anchorId: request.anchorId,
        },
        root: initialState,
        steps: [],
        cursor: 0,
      };
      current = {
        ...withTwoMoves(atRoot ? '13' : '14'),
        scratch,
        allowedActions: ['apply_move', 'discard_scratch'],
      };
      return { scratch, dataRevision: 0 };
    },
    previewInventoryRevision: async () =>
      revisionPreview({
        preservedMoveCount:
          current.scratch?.origin.kind === 'inventory_anchor' &&
          current.scratch.origin.anchorId === '14'
            ? 1
            : 0,
      }),
  });
  const store = createReadyStore(client);
  await store.start();

  await store.takeBackLastMove();
  await store.takeBackLastMove();

  assert.deepEqual(
    startRequests.map((request) => ({
      anchorId: request.anchorId,
      expectedScratchId: request.expectedScratchId,
      expectedScratchRevision: request.expectedScratchRevision,
    })),
    [
      {
        anchorId: '14',
        expectedScratchId: null,
        expectedScratchRevision: null,
      },
      {
        anchorId: '13',
        expectedScratchId: 'truncate-scratch',
        expectedScratchRevision: 1,
      },
    ],
  );
  store.close();
});

for (const succeeds of [true, false]) {
  test(`continuing a prepared revision preserves the path and clears only its preview (success: ${succeeds})`, async () => {
    const scratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
      scratchId: 'prepared-path',
      scratchRevision: 7,
      intent: {
        kind: 'inventory_revision',
        mode: 'extend',
        itemId: '11',
        baseRevisionId: '12',
        cutAnchorId: '14',
        returnAnchorId: '14',
        displayName: 'Dragon',
      },
      origin: {
        kind: 'inventory_anchor',
        itemId: '11',
        revisionId: '12',
        anchorId: '14',
      },
      root: initialState,
      steps: [
        {
          before: initialState,
          move: { from: 'g7', to: 'g6', san: 'g6' },
          after: initialState,
        },
      ],
      cursor: 1,
    };
    let current: AnalysisWorkspaceDto = {
      ...savedLineAnalysis('14'),
      scratch,
      allowedActions: ['continue_exploration', 'discard_scratch'],
    };
    let request:
      | Parameters<PlysmithApplicationClient['updateAnalysisScratch']>[0]
      | undefined;
    const client = createClient({
      getAnalysisWorkspace: async () => current,
      previewInventoryRevision: async () =>
        revisionPreview({ mode: 'extend', addedSteps: scratch.steps }),
      updateAnalysisScratch: async (input) => {
        request = input;
        if (!succeeds)
          throw new HostClientProblem({
            type: 'urn:plysmith:test:stale',
            title: 'Stale scratch',
            status: 409,
            detail: 'Stale scratch',
            instance: 'urn:plysmith:test:request',
            code: 'analysis.scratch_revision_conflict',
            correlationId: 'test',
            retryable: false,
            parameters: {},
          });
        current = {
          ...current,
          scratch: {
            ...scratch,
            scratchRevision: 8,
            intent: { kind: 'exploration' },
          },
          allowedActions: ['apply_move', 'discard_scratch'],
        };
        return { scratch: current.scratch!, discarded: false, dataRevision: 0 };
      },
    });
    const store = createReadyStore(client);
    await store.start();
    await store.continueAnalysisExploration();
    assert.deepEqual(request, {
      scope: { kind: 'free' },
      expectedScratchId: 'prepared-path',
      expectedScratchRevision: 7,
      action: { kind: 'continue_exploration' },
    });
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.phase, 'ready');
    if (snapshot.phase !== 'ready') throw new Error('Expected ready');
    assert.deepEqual(snapshot.analysis.scratch?.steps, scratch.steps);
    assert.deepEqual(snapshot.analysis.scratch?.root, scratch.root);
    assert.deepEqual(snapshot.analysis.scratch?.origin, scratch.origin);
    assert.equal(snapshot.analysis.scratch?.scratchId, scratch.scratchId);
    assert.equal(
      snapshot.analysis.scratch?.intent.kind,
      succeeds ? 'exploration' : 'inventory_revision',
    );
    assert.equal(snapshot.analysis.scratch?.scratchRevision, succeeds ? 8 : 7);
    assert.equal(snapshot.analysis.record?.revisionId, '12');
    if (succeeds) assert.equal(snapshot.inventoryRevisionPreview, undefined);
    store.close();
  });
}

test('promoting an exploration keeps its moves and opens an automatic revision preview', async () => {
  const exploration: NonNullable<AnalysisWorkspaceDto['scratch']> = {
    scratchId: 'exploration-scratch',
    scratchRevision: 2,
    intent: { kind: 'exploration' },
    origin: {
      kind: 'inventory_anchor',
      itemId: '11',
      revisionId: '12',
      anchorId: '13',
    },
    root: initialState,
    steps: [
      {
        before: initialState,
        move: { from: 'd2', to: 'd4', san: 'd4' },
        after: initialState,
      },
    ],
    cursor: 1,
  };
  let current: AnalysisWorkspaceDto = {
    ...savedLineAnalysis('13'),
    scratch: exploration,
  };
  let promoteRequest:
    | Parameters<
        PlysmithApplicationClient['promoteAnalysisToInventoryRevision']
      >[1]
    | undefined;
  const client = createClient({
    getAnalysisWorkspace: async () => current,
    promoteAnalysisToInventoryRevision: async (_itemId, request) => {
      promoteRequest = request;
      const scratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
        ...exploration,
        scratchRevision: 3,
        intent: {
          kind: 'inventory_revision',
          mode: 'truncate_after',
          itemId: '11',
          baseRevisionId: '12',
          cutAnchorId: '13',
          returnAnchorId: '13',
          displayName: 'Französisch',
        },
      };
      current = { ...current, scratch };
      return { scratch, dataRevision: 0 };
    },
    previewInventoryRevision: async () =>
      revisionPreview({
        addedSteps: exploration.steps,
        removedSteps: savedLineAnalysis('14').record!.steps,
      }),
  });
  const store = createReadyStore(client);
  await store.start();

  await store.promoteAnalysisToInventoryRevision();

  assert.deepEqual(promoteRequest, {
    scope: { kind: 'free' },
    baseRevisionId: '12',
    anchorId: '13',
    expectedScratchId: 'exploration-scratch',
    expectedScratchRevision: 2,
  });
  const snapshot = store.getSnapshot();
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.analysis.scratch?.intent.kind
      : undefined,
    'inventory_revision',
  );
  assert.equal(
    snapshot.phase === 'ready'
      ? snapshot.inventoryRevisionPreview?.addedSteps[0]?.move.san
      : undefined,
    'd4',
  );
  store.close();
});

test('an open context impact is discoverable, loaded with both revisions and resolved once', async () => {
  const context = {
    contextId: '7',
    displayName: 'Repertoire',
    lifecycle: 'active' as const,
    contextVersion: 1,
    referenceCount: 1,
    pendingRevisionImpactCount: 1,
    createdAt: '2026-09-14T12:00:00.000Z',
    updatedAt: '2026-09-14T12:00:00.000Z',
  };
  let pending = true;
  let resolution:
    | Parameters<PlysmithApplicationClient['resolvePendingRevisionImpact']>[1]
    | undefined;
  const client = createClient({
    listWorkingContexts: async () => ({ contexts: [context], dataRevision: 0 }),
    getWorkingContextWorkspace: async () => ({
      context: {
        ...context,
        pendingRevisionImpactCount: pending ? 1 : 0,
      },
      references: [],
      pendingRevisionImpacts: pending
        ? [
            {
              impactId: '21',
              itemId: '11',
              pinnedRevisionId: '12',
              targetRevisionId: '14',
              impactVersion: 1,
              entryCount: 1,
              updatedAt: '2026-09-14T12:00:00.000Z',
            },
          ]
        : [],
      dataRevision: 0,
    }),
    getPendingRevisionImpact: async () => ({
      dataRevision: 0,
      useTargetLoss: emptyUsage(),
      removeFromContextLoss: { ...emptyUsage(), referenceCount: 1 },
      impactId: '21',
      contextId: '7',
      contextName: 'Repertoire',
      itemId: '11',
      pinnedRevisionId: '12',
      targetRevisionId: '14',
      targetAnchorId: '15',
      impactVersion: 1,
      referenceCount: 1,
      contributionCount: 0,
      managementResumeAffected: false,
      analysisResumeAffected: false,
      createdAt: '2026-09-14T12:00:00.000Z',
      updatedAt: '2026-09-14T12:00:00.000Z',
    }),
    getInventoryRevision: async (_itemId, revisionId) => ({
      ...savedAnalysis().record!,
      revisionId,
      currentRevisionId: '14',
      revisionNumber: revisionId === '12' ? 1 : 2,
      historical: revisionId === '12',
    }),
    resolvePendingRevisionImpact: async (_impactId, request) => {
      resolution = request;
      pending = false;
      return {
        impactId: '21',
        contextId: '7',
        itemId: '11',
        resolution: request.resolution.kind,
        contextItemId: '11',
        contextRevisionId: '14',
        dataRevision: 0,
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();
  await store.setScope({ kind: 'context', contextId: '7' });
  await store.openRevisionImpact('21');
  const opened = store.getSnapshot();
  assert.equal(
    opened.phase === 'ready'
      ? opened.revisionImpact?.impact.impactId
      : undefined,
    '21',
  );

  assert.equal(
    await store.resolveRevisionImpact({
      expectedDataRevision: 0,
      expectedImpactVersion: 1,
      resolution: { kind: 'use_target' },
    }),
    true,
  );
  assert.deepEqual(resolution, {
    expectedDataRevision: 0,
    expectedImpactVersion: 1,
    resolution: { kind: 'use_target' },
  });
  const resolved = store.getSnapshot();
  assert.equal(
    resolved.phase === 'ready' ? resolved.revisionImpact : undefined,
    undefined,
  );
  store.close();
});

test('explicit management deselection survives stale refresh and a repeated context click', async () => {
  const item: SearchInventoryResultDto['items'][number] = {
    lifecycle: 'active' as const,
    itemId: '11',
    currentRevisionId: '12',
    rootAnchorId: '13',
    itemType: 'analysis',
    originKind: 'manual',
    displayName: 'Repertoire',
    languageTag: 'de-DE',
    contextIds: ['7'],
    createdAt: '2026-09-27T01:00:00Z',
    updatedAt: '2026-09-27T01:00:00Z',
  };
  const workspace: WorkingContextWorkspaceDto = {
    context: {
      contextId: '7',
      displayName: 'Training',
      lifecycle: 'active' as const,
      contextVersion: 1,
      referenceCount: 1,
      pendingRevisionImpactCount: 0,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    },
    references: [],
    pendingRevisionImpacts: [],
    dataRevision: 0,
    managementResume: {
      resumeVersion: 1,
      presentation: 'list',
      selectedItemId: item.itemId,
      selectedAnchorId: item.rootAnchorId,
      updatedAt: item.updatedAt,
    },
  };
  const writes: SetWorkScopeResumeRequestDto[] = [];
  let deferredRead: (() => void) | undefined;
  let deferNextRead = false;
  const client = createClient({
    listWorkingContexts: async () => ({
      contexts: [workspace.context],
      dataRevision: 0,
    }),
    searchInventory: async () => ({
      items: [item],
      ancestors: [],
      provenanceEdges: [],
      dataRevision: 0,
    }),
    getWorkingContextWorkspace: async () => {
      if (deferNextRead) {
        deferNextRead = false;
        await new Promise<void>((resolve) => {
          deferredRead = resolve;
        });
      }
      return workspace;
    },
    setWorkScopeResume: async (request) => {
      writes.push(request);
      assert.equal(request.area, 'manage');
      return {
        area: 'manage',
        dataRevision: 0,
        resume: {
          resumeVersion: 2,
          presentation: 'list',
          updatedAt: item.updatedAt,
        },
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();
  await store.setScope({ kind: 'context', contextId: '7' });
  const selected = store.getSnapshot();
  assert.equal(
    selected.phase === 'ready' ? selected.selectedInventoryItemId : undefined,
    item.itemId,
  );
  deferNextRead = true;
  const read = store.refresh();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const deselect = store.selectInventoryItem(item);
  deferredRead?.();
  await Promise.all([read, deselect]);
  const empty = store.getSnapshot();
  assert.equal(
    empty.phase === 'ready' ? empty.selectedInventoryItemId : undefined,
    undefined,
  );
  assert.deepEqual(writes[0], {
    scope: { kind: 'context', contextId: '7' },
    area: 'manage',
    expectedResumeVersion: 1,
    presentation: 'list',
  });
  await store.selectManagementScope({ kind: 'context', contextId: '7' });
  const repeated = store.getSnapshot();
  assert.equal(
    repeated.phase === 'ready' ? repeated.selectedInventoryItemId : undefined,
    undefined,
  );
  assert.equal(writes.length, 2);
  assert.equal(
    repeated.phase === 'ready' ? repeated.analysis.record : undefined,
    undefined,
  );
  store.close();
});

test('inventory pagination promotes matching ancestors without duplicate family nodes or edges', async () => {
  const source: SearchInventoryResultDto['items'][number] = {
    lifecycle: 'active' as const,
    itemId: '11',
    currentRevisionId: '12',
    rootAnchorId: '13',
    itemType: 'analysis',
    originKind: 'manual',
    displayName: 'Source',
    languageTag: 'de-DE',
    contextIds: [],
    createdAt: '2026-09-27T01:00:00Z',
    updatedAt: '2026-09-27T01:00:00Z',
  };
  const child = {
    ...source,
    lifecycle: 'active' as const,
    itemId: '21',
    currentRevisionId: '22',
    rootAnchorId: '23',
    displayName: 'Child',
  };
  const edge = {
    itemId: child.itemId,
    sourceItemId: source.itemId,
    sourceRevisionId: source.currentRevisionId,
    sourceAnchorId: source.rootAnchorId,
  };
  const store = createReadyStore(
    createClient({
      searchInventory: async (request) =>
        request.cursor === undefined
          ? {
              items: [child],
              ancestors: [source],
              provenanceEdges: [edge],
              nextCursor: 'second',
              dataRevision: 0,
            }
          : {
              items: [source],
              ancestors: [],
              provenanceEdges: [edge],
              dataRevision: 0,
            },
    }),
  );
  await store.start();
  await store.loadMoreInventory();
  const loaded = store.getSnapshot();
  assert.equal(loaded.phase, 'ready');
  if (loaded.phase === 'ready') {
    assert.deepEqual(
      loaded.inventory.items.map((item) => item.itemId),
      ['21', '11'],
    );
    assert.deepEqual(loaded.inventory.ancestors, []);
    assert.deepEqual(loaded.inventory.provenanceEdges, [edge]);
  }
  store.close();
});

test('engine analysis binds the displayed ancestor and blocks outsiders before querying a provider', async (t) => {
  const requests: AnalyzePositionRequestDto[] = [];
  const store = createReadyStore(
    contextWorkClient(
      () => 0,
      () => ['31'],
      {
        analyzePosition: async (request) => {
          requests.push(request);
          return {
            kind: 'objective',
            focusKey: request.focus.focusKey,
            providerInstanceId: request.providerInstanceId,
            providerDisplayName: 'Engine',
            historyCompleteness: 'complete',
            budget: 'fast',
            perspective: 'white',
            candidates: [],
            search: { limiter: { kind: 'movetime', value: 300 } },
          };
        },
      },
    ),
  );
  t.after(() => store.close());
  await store.start();
  await store.setScope({ kind: 'context', contextId: '7' });
  const ancestor = engineWorkRequest('11');
  assert.deepEqual(await store.analyzePosition(ancestor), {
    kind: 'failed',
    errorCode: 'workspace.inventory_work_not_allowed',
  });
  assert.equal(requests.length, 0);
  assert.equal(
    (await store.analyzePosition(engineWorkRequest('31'))).kind,
    'completed',
  );
  assert.deepEqual(requests[0]?.work, {
    scope: { kind: 'context', contextId: '7' },
    subject: { kind: 'inventory_item', itemId: '31' },
  });
  await store.setScope({ kind: 'free' });
  assert.equal(
    (
      await store.analyzePosition({
        ...ancestor,
        work: { ...ancestor.work, scope: { kind: 'free' } },
      })
    ).kind,
    'completed',
  );
  assert.deepEqual(requests[1]?.work.subject, {
    kind: 'inventory_item',
    itemId: '11',
  });
});

test('engine analysis rejects an obsolete scope without issuing a provider request', async (t) => {
  let queries = 0;
  const store = createReadyStore(
    contextWorkClient(
      () => 0,
      () => ['31'],
      {
        analyzePosition: async () => {
          queries += 1;
          assert.fail('No engine request expected');
        },
      },
    ),
  );
  t.after(() => store.close());
  await store.start();
  assert.equal(
    (await store.analyzePosition(engineWorkRequest('31'))).kind,
    'cancelled',
  );
  assert.equal(queries, 0);
});

test('unbound position analysis in a context retains its position subject', async (t) => {
  const requests: AnalyzePositionRequestDto[] = [];
  const store = createReadyStore(
    contextWorkClient(
      () => 0,
      () => [],
      {
        getAnalysisWorkspace: async (request) => ({
          ...analysis(),
          scope:
            request.scopeKind === 'context'
              ? { kind: 'context', contextId: request.contextId! }
              : { kind: 'free' },
        }),
        analyzePosition: async (request) => {
          requests.push(request);
          return {
            kind: 'objective',
            focusKey: request.focus.focusKey,
            providerInstanceId: request.providerInstanceId,
            providerDisplayName: 'Engine',
            historyCompleteness: 'complete',
            budget: 'fast',
            perspective: 'white',
            candidates: [],
            search: { limiter: { kind: 'movetime', value: 300 } },
          };
        },
      },
    ),
  );
  t.after(() => store.close());
  await store.start();
  await store.setScope({ kind: 'context', contextId: '7' });
  const work = {
    scope: { kind: 'context' as const, contextId: '7' },
    subject: { kind: 'position' as const },
  };
  assert.equal(
    (await store.analyzePosition({ ...engineWorkRequest('11'), work })).kind,
    'completed',
  );
  assert.deepEqual(requests[0]?.work, work);
});

test('a remotely removed explicit context focus retries the current resume once and accepts fresh snapshots', async (t) => {
  let revision = 0;
  const requests: GetAnalysisWorkspaceRequestDto[] = [];
  const store = createReadyStore(
    contextWorkClient(
      () => revision,
      () => (revision === 0 ? ['11', '31'] : ['31']),
      {
        getAnalysisWorkspace: async (request) => {
          requests.push(request);
          if (revision > 0 && request.itemId === '11')
            throw workAccessProblem();
          return contextWorkAnalysis(request, revision);
        },
      },
    ),
  );
  t.after(() => store.close());
  await store.start();
  await store.setScope({ kind: 'context', contextId: '7' });
  await store.openAnalysisTarget({
    itemId: '11',
    revisionId: '12',
    anchorId: '13',
  });
  revision = 1;
  requests.length = 0;
  await store.refresh();
  assert.deepEqual(
    requests.map((request) => request.itemId),
    ['11', undefined],
  );
  const state = store.getSnapshot();
  assert.ok(state.phase === 'ready');
  assert.equal(state.status.persistence.dataRevision, 1);
  assert.equal(state.analysis.record?.itemId, '31');
  assert.deepEqual(
    state.contextWorkspace?.references.map((reference) => reference.itemId),
    ['31'],
  );
  assert.equal(state.errorCode, undefined);
  assert.equal(state.analysisUnavailable, undefined);
  await store.refresh();
  assert.equal(requests.at(-1)?.itemId, undefined);
});

test(
  'a late denied read for ancestor A does not clear a newer explicit focus C',
  { timeout: 5_000 },
  async (t) => {
    let revision = 0;
    let denyAncestor = false;
    const delayed = Promise.withResolvers<AnalysisWorkspaceDto>();
    const entered = Promise.withResolvers<void>();
    const requests: GetAnalysisWorkspaceRequestDto[] = [];
    const store = createReadyStore(
      contextWorkClient(
        () => revision,
        () => (revision === 0 ? ['11', '31', '41'] : ['31', '41']),
        {
          getAnalysisWorkspace: async (request) => {
            requests.push(request);
            if (denyAncestor && request.itemId === '11') {
              entered.resolve();
              return delayed.promise;
            }
            return contextWorkAnalysis(request, revision);
          },
        },
      ),
    );
    t.after(() => store.close());
    await store.start();
    await store.setScope({ kind: 'context', contextId: '7' });
    await store.openAnalysisTarget({
      itemId: '11',
      revisionId: '12',
      anchorId: '13',
    });
    revision = 1;
    denyAncestor = true;
    const refreshing = store.refresh();
    await entered.promise;
    const navigation = store.openAnalysisTarget({
      itemId: '41',
      revisionId: '42',
      anchorId: '43',
    });
    delayed.reject(workAccessProblem());
    await Promise.all([refreshing, navigation]);
    const state = store.getSnapshot();
    assert.ok(state.phase === 'ready');
    assert.equal(state.analysis.record?.itemId, '41');
    assert.equal(state.errorCode, undefined);
    assert.equal(state.analysisUnavailable, undefined);
    assert.equal(requests.at(-1)?.itemId, '41');
  },
);

for (const failure of [
  'resume-denied',
  'still-assigned',
  'unrelated',
] as const) {
  test(`context focus recovery keeps ${failure} failures visible without repeated retries`, async (t) => {
    let revision = 0;
    const requests: GetAnalysisWorkspaceRequestDto[] = [];
    const errorCode =
      failure === 'unrelated'
        ? 'host.unavailable'
        : 'workspace.inventory_work_not_allowed';
    const store = createReadyStore(
      contextWorkClient(
        () => revision,
        () =>
          revision === 0 || failure === 'still-assigned'
            ? ['11', '31']
            : ['31'],
        {
          getAnalysisWorkspace: async (request) => {
            requests.push(request);
            if (revision > 0) throw workAccessProblem(errorCode);
            return contextWorkAnalysis(request, revision);
          },
        },
      ),
    );
    t.after(() => store.close());
    await store.start();
    await store.setScope({ kind: 'context', contextId: '7' });
    await store.openAnalysisTarget({
      itemId: '11',
      revisionId: '12',
      anchorId: '13',
    });
    revision = 1;
    requests.length = 0;
    await store.refresh();
    assert.equal(requests.length, failure === 'resume-denied' ? 2 : 1);
    const state = store.getSnapshot();
    assert.ok(state.phase === 'ready');
    assert.equal(state.errorCode, errorCode);
    assert.equal(state.analysisUnavailable, undefined);
  });
}

function engineWorkRequest(
  itemId: string,
): Omit<AnalyzePositionRequestDto, 'consumerId'> {
  return {
    laneId: 'objective',
    providerInstanceId: 'stockfish-main',
    candidateCount: 1,
    work: {
      scope: { kind: 'context', contextId: '7' },
      subject: { kind: 'inventory_item', itemId },
    },
    focus: {
      focusKey: `item-${itemId}`,
      root: initialState,
      moves: [],
      current: initialState,
    },
    mode: { kind: 'objective', budget: 'fast' },
  };
}

function workAccessProblem(
  code = 'workspace.inventory_work_not_allowed',
): HostClientProblem {
  return new HostClientProblem({
    type: `urn:problem:${code}`,
    title: 'Analysis unavailable',
    detail: 'Analysis unavailable',
    status: 409,
    instance: 'urn:test:work-access',
    code,
    correlationId: 'work-access-test',
    retryable: false,
    parameters: {},
  });
}

function contextWorkAnalysis(
  request: GetAnalysisWorkspaceRequestDto,
  revision: number,
): AnalysisWorkspaceDto {
  const itemId = request.itemId ?? '31';
  return {
    ...savedAnalysis(revision),
    scope:
      request.scopeKind === 'context'
        ? { kind: 'context', contextId: request.contextId! }
        : { kind: 'free' },
    record: {
      ...savedAnalysis(revision).record!,
      itemId,
      revisionId: String(Number(itemId) + 1),
      currentRevisionId: String(Number(itemId) + 1),
      rootAnchorId: String(Number(itemId) + 2),
      currentAnchorId: String(Number(itemId) + 2),
      contextMember: true,
      ...(itemId === '31'
        ? {
            origin: {
              kind: 'inventory_anchor' as const,
              itemId: '11',
              revisionId: '12',
              anchorId: '13',
            },
            sourceLine: {
              sourceItemId: '11',
              sourceItemType: 'analysis' as const,
              sourceRevisionId: '12',
              sourceAnchorId: '13',
              sourceDisplayName: 'Ancestor',
              root: initialState,
              rootTarget: { itemId: '11', revisionId: '12', anchorId: '13' },
              steps: [],
              contributions: [],
            },
          }
        : {}),
    },
  };
}

function contextWorkClient(
  revision: () => number,
  members: () => readonly string[],
  overrides: Partial<PlysmithApplicationClient> = {},
): PlysmithApplicationClient {
  const context = () => ({
    contextId: '7',
    displayName: 'Context',
    lifecycle: 'active' as const,
    contextVersion: revision() + 1,
    referenceCount: members().length,
    pendingRevisionImpactCount: 0,
    createdAt: '2026-09-27T12:00:00.000Z',
    updatedAt: '2026-09-27T12:00:00.000Z',
  });
  return createClient({
    getSystemStatus: async () => status(revision()),
    getUserPreferences: async () => preferences(revision()),
    searchInventory: async () => inventory(revision()),
    listWorkingContexts: async () => ({
      contexts: [context()],
      dataRevision: revision(),
    }),
    getWorkingContextWorkspace: async () => ({
      context: context(),
      references: members().map((itemId) => ({
        referenceId: itemId,
        itemId,
        currentRevisionId: String(Number(itemId) + 1),
        itemType: 'analysis' as const,
        displayName: `Item ${itemId}`,
        anchorId: String(Number(itemId) + 2),
        anchorKind: 'occurrence' as const,
        createdAt: '2026-09-27T12:00:00.000Z',
      })),
      pendingRevisionImpacts: [],
      dataRevision: revision(),
    }),
    getAnalysisWorkspace: async (request) =>
      contextWorkAnalysis(request, revision()),
    ...overrides,
  });
}

function createReadyStore(client: PlysmithApplicationClient) {
  return new PlysmithApplicationStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: () => ({
      ready: Promise.resolve(),
      close: () => undefined,
    }),
  });
}

test('management content reads a requested historical revision without opening analysis or writing', async () => {
  const record = savedAnalysis().record!;
  const requests: unknown[] = [];
  const store = createReadyStore(
    createClient({
      getInventoryRevision: async (itemId, revisionId, request) => {
        requests.push({ itemId, revisionId, request });
        return { ...record, revisionId };
      },
    }),
  );
  await store.start();
  const before = store.getSnapshot();
  const read = await store.readInventoryDetails({
    itemId: '11',
    currentRevisionId: 'older',
  });
  assert.equal(read.kind, 'completed');
  if (read.kind === 'completed') assert.equal(read.record.revisionId, 'older');
  assert.deepEqual(requests, [
    { itemId: '11', revisionId: 'older', request: { scopeKind: 'free' } },
  ]);
  assert.equal(store.getSnapshot(), before);
  store.close();
});

test('management content failure is local and does not replace the ready workspace', async () => {
  const store = createReadyStore(
    createClient({
      getInventoryRevision: async () => {
        throw new Error('read failed');
      },
    }),
  );
  await store.start();
  const before = store.getSnapshot();
  const read = await store.readInventoryDetails({
    itemId: '11',
    currentRevisionId: '12',
  });
  assert.equal(read.kind, 'failed');
  assert.equal(store.getSnapshot(), before);
  store.close();
});

test('management content ignores an old client response after the store is stopped', async () => {
  let finish!: (record: NonNullable<AnalysisWorkspaceDto['record']>) => void;
  const store = createReadyStore(
    createClient({
      getInventoryRevision: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    }),
  );
  await store.start();
  const pending = store.readInventoryDetails({
    itemId: '11',
    currentRevisionId: '12',
  });
  store.close();
  finish(savedAnalysis().record!);
  assert.deepEqual(await pending, { kind: 'cancelled' });
});

function analysisRemovalFixture(
  overrides: Partial<PlysmithApplicationClient> = {},
) {
  const backend: {
    revision: number;
    assigned: boolean;
    recordId: string | undefined;
    scratch: AnalysisWorkspaceDto['scratch'];
    errorCode: string | undefined;
  } = {
    revision: 0,
    assigned: true,
    recordId: '11',
    scratch: undefined,
    errorCode: undefined,
  };
  const item: SearchInventoryResultDto['items'][number] = {
    lifecycle: 'active' as const,
    itemId: '11',
    currentRevisionId: '12',
    rootAnchorId: '13',
    itemType: 'analysis',
    originKind: 'manual',
    displayName: 'Inventory title',
    languageTag: 'en-GB',
    contextIds: ['7'],
    createdAt: '2026-09-27T12:00:00.000Z',
    updatedAt: '2026-09-27T12:00:00.000Z',
  };
  const remove = () => {
    backend.revision += 1;
    backend.assigned = false;
    backend.recordId = undefined;
  };
  const base = contextWorkClient(
    () => backend.revision,
    () => (backend.assigned ? ['11', '31'] : ['31']),
  );
  const client = {
    ...base,
    getWorkScopeWorkspace: async (
      request: Parameters<
        PlysmithApplicationClient['getWorkScopeWorkspace']
      >[0],
    ) => ({
      scope:
        request.scopeKind === 'free'
          ? { kind: 'free' as const }
          : { kind: 'context' as const, contextId: request.contextId! },
      dataRevision: backend.revision,
    }),
    getWorkingContextWorkspace: async (contextId: string) => {
      const workspace = await base.getWorkingContextWorkspace(contextId);
      return {
        ...workspace,
        context: { ...workspace.context, contextId },
        references: contextId === '7' ? workspace.references : [],
      };
    },
    getAnalysisWorkspace: async (request: GetAnalysisWorkspaceRequestDto) => {
      if (backend.errorCode !== undefined)
        throw workAccessProblem(backend.errorCode);
      if (!backend.assigned && request.itemId === '11')
        throw workAccessProblem();
      const scope =
        request.scopeKind === 'context'
          ? { kind: 'context' as const, contextId: request.contextId! }
          : { kind: 'free' as const };
      if (request.contextId !== '7')
        return { ...analysis(backend.revision), scope };
      if (backend.recordId !== undefined)
        return contextWorkAnalysis(
          { ...request, itemId: backend.recordId },
          backend.revision,
        );
      return {
        ...analysis(backend.revision),
        scope,
        ...(backend.scratch === undefined ? {} : { scratch: backend.scratch }),
      };
    },
    removeContextItem: async (contextId: string, itemId: string) => {
      remove();
      return { contextId, itemId, dataRevision: backend.revision };
    },
    updateAnalysisScratch: async () => {
      backend.revision += 1;
      backend.scratch = {
        scratchId: 'new-analysis',
        scratchRevision: 1,
        intent: { kind: 'exploration' },
        origin: { kind: 'initial_position' },
        root: initialState,
        steps: [],
        cursor: 0,
      };
      return {
        dataRevision: backend.revision,
        scratch: backend.scratch,
        discarded: false,
      };
    },
    ...overrides,
  } satisfies PlysmithApplicationClient;
  let onChange: ((event: HostEvent) => void) | undefined;
  const store = new PlysmithApplicationStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: (_connection, change) => {
      onChange = change;
      return { ready: Promise.resolve(), close: () => undefined };
    },
  });
  return {
    store,
    backend,
    item,
    remove,
    emitEvent(event: HostEvent) {
      assert.ok(onChange, 'The store must subscribe before receiving events');
      onChange(event);
    },
    async start() {
      await store.start();
      await store.setScope({ kind: 'context', contextId: '7' });
    },
    snapshot() {
      const state = store.getSnapshot();
      assert.ok(state.phase === 'ready');
      return state;
    },
  };
}

const removedAnalysisNotice = {
  reason: 'removed_from_context',
  itemId: '11',
  displayName: savedAnalysis().record!.displayName,
};

test('context item confirmation retains concrete losses and sends exactly the preview versions', async (t) => {
  const preview: ContextRemovalPreviewDto = {
    ...removalPreview(),
    contextVersion: 9,
    losses: {
      notes: [
        {
          contributionId: '71',
          body: 'Context annotation',
          moveCount: 2,
          itemId: '11',
        },
      ],
      scratch: {
        scratchId: 'scratch-loss',
        scratchRevision: 3,
        stepCount: 4,
        noteBody: 'Draft annotation',
        intent: 'exploration',
        itemId: '11',
      },
      managementResume: {
        resumeVersion: 2,
        presentation: 'list',
        selectedItemId: '11',
        updatedAt: '2026-09-27T12:00:00.000Z',
      },
      analysisResume: {
        resumeVersion: 5,
        mode: 'analyze',
        itemId: '11',
        revisionId: '12',
        anchorId: '13',
        currentPositionId: '21',
        updatedAt: '2026-09-27T12:00:00.000Z',
      },
    },
    retainedPlayout: {
      draftId: '41',
      draftRevision: 3,
      moveCount: 8,
      status: 'paused',
      sourceItemId: '11',
    },
  };
  const confirmations: unknown[] = [];
  const release = Promise.withResolvers<void>();
  const fixture = analysisRemovalFixture({
    previewContextItemRemoval: async (contextId, itemId) => {
      assert.equal(contextId, '7');
      assert.equal(itemId, '11');
      return preview;
    },
    removeContextItem: async (contextId, itemId, confirmation) => {
      confirmations.push({ contextId, itemId, confirmation });
      await release.promise;
      fixture.remove();
      return { contextId, itemId, dataRevision: fixture.backend.revision };
    },
  });
  t.after(() => {
    release.resolve();
    fixture.store.close();
  });
  await fixture.start();
  await fixture.store.prepareContextItemRemoval(fixture.item);
  assert.deepEqual(fixture.snapshot().destructiveAction?.preview, preview);
  const confirming = fixture.store.confirmDestructiveAction();
  assert.equal(fixture.snapshot().destructiveAction?.status, 'submitting');
  fixture.store.cancelDestructiveAction();
  assert.equal(fixture.snapshot().destructiveAction?.status, 'submitting');
  assert.equal(await fixture.store.confirmDestructiveAction(), false);
  release.resolve();
  assert.equal(await confirming, true);
  assert.deepEqual(confirmations, [
    {
      contextId: '7',
      itemId: '11',
      confirmation: { expectedDataRevision: 0, expectedContextVersion: 9 },
    },
  ]);
  assert.equal(
    fixture.snapshot().analysisUnavailable?.reason,
    'removed_from_context',
  );
  assert.equal(fixture.snapshot().destructiveAction, undefined);
});

test('local removal retains the previously open analysis name through command refresh', async (t) => {
  const fixture = analysisRemovalFixture();
  t.after(() => fixture.store.close());
  await fixture.start();
  assert.equal(
    await fixture.store.removeInventoryItemFromCurrentContext(
      fixture.item,
      removalPreview(fixture.backend.revision),
    ),
    true,
  );
  assert.equal(fixture.snapshot().analysis.record, undefined);
  assert.deepEqual(
    fixture.snapshot().analysisUnavailable,
    removedAnalysisNotice,
  );
  await fixture.store.refresh();
  assert.deepEqual(
    fixture.snapshot().analysisUnavailable,
    removedAnalysisNotice,
  );
});

test('remote removal needs prior open content and fresh missing references, not inventory hits', async (t) => {
  const fixture = analysisRemovalFixture();
  t.after(() => fixture.store.close());
  await fixture.start();
  assert.equal(fixture.snapshot().inventory.items.length, 0);
  assert.equal(fixture.snapshot().analysisUnavailable, undefined);
  fixture.remove();
  await fixture.store.refresh();
  assert.deepEqual(
    fixture.snapshot().analysisUnavailable,
    removedAnalysisNotice,
  );
});

for (const deletedItemId of ['11', '99']) {
  test(`a late inventory deletion for ${deletedItemId} reclassifies only a matching known removal after an empty read`, async (t) => {
    const fixture = analysisRemovalFixture();
    t.after(() => fixture.store.close());
    await fixture.start();
    assert.equal(fixture.snapshot().analysis.record?.itemId, '11');

    fixture.remove();
    await fixture.store.refresh();
    assert.deepEqual(
      fixture.snapshot().analysisUnavailable,
      removedAnalysisNotice,
    );
    assert.equal(fixture.snapshot().analysis.record, undefined);
    assert.equal(fixture.snapshot().analysis.scratch, undefined);
    assert.equal(fixture.snapshot().inventory.items.length, 0);
    assert.equal(
      fixture
        .snapshot()
        .contextWorkspace?.references.some(
          (reference) => reference.itemId === '11',
        ),
      false,
    );

    let notifications = 0;
    const unsubscribe = fixture.store.subscribe(() => {
      notifications += 1;
    });
    t.after(unsubscribe);
    fixture.emitEvent({
      ...changedEvent(fixture.backend.revision),
      kind: 'inventory.item-deleted',
      eventId: `inventory-deleted-${deletedItemId}`,
      payload: { itemId: deletedItemId },
    });
    const expected = {
      ...removedAnalysisNotice,
      reason:
        deletedItemId === '11'
          ? 'deleted_from_inventory'
          : 'removed_from_context',
    };
    assert.deepEqual(fixture.snapshot().analysisUnavailable, expected);
    assert.equal(notifications, deletedItemId === '11' ? 1 : 0);
    assert.equal(
      fixture.snapshot().status.persistence.dataRevision,
      fixture.backend.revision,
    );
    await fixture.store.refresh();
    assert.deepEqual(fixture.snapshot().analysisUnavailable, expected);
  });
}

test('denied explicit focus retains its known name when recovery returns an empty workspace', async (t) => {
  const fixture = analysisRemovalFixture();
  t.after(() => fixture.store.close());
  await fixture.start();
  await fixture.store.openAnalysisTarget({
    itemId: '11',
    revisionId: '12',
    anchorId: '13',
  });
  fixture.remove();
  await fixture.store.refresh();
  assert.equal(fixture.snapshot().errorCode, undefined);
  assert.deepEqual(
    fixture.snapshot().analysisUnavailable,
    removedAnalysisNotice,
  );
});

for (const entry of ['manage', 'analysis-target'] as const) {
  test(
    `removal during ${entry} navigation retains the last accepted item identity`,
    { timeout: 5_000 },
    async (t) => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const fixture = analysisRemovalFixture({
        setWorkScopeResume: async () => {
          entered.resolve();
          await release.promise;
          fixture.remove();
          throw workAccessProblem();
        },
      });
      t.after(() => {
        release.resolve();
        fixture.store.close();
      });
      await fixture.start();
      const opening =
        entry === 'manage'
          ? fixture.store.openInventoryItem(fixture.item)
          : fixture.store.openAnalysisTarget({
              itemId: '11',
              revisionId: '12',
              anchorId: '13',
            });
      await entered.promise;
      assert.equal(fixture.snapshot().analysis.record?.itemId, '11');
      release.resolve();
      await opening;
      assert.equal(fixture.snapshot().analysis.record, undefined);
      assert.deepEqual(
        fixture.snapshot().analysisUnavailable,
        removedAnalysisNotice,
      );
      await fixture.store.refresh();
      assert.deepEqual(
        fixture.snapshot().analysisUnavailable,
        removedAnalysisNotice,
      );
    },
  );
}

test('a failed replacement read retains the previously confirmed removal cause', async (t) => {
  const fixture = analysisRemovalFixture({
    setWorkScopeResume: async () => {
      fixture.backend.errorCode = 'host.unavailable';
      throw workAccessProblem('host.unavailable');
    },
  });
  t.after(() => fixture.store.close());
  await fixture.start();
  fixture.remove();
  await fixture.store.refresh();
  assert.deepEqual(
    fixture.snapshot().analysisUnavailable,
    removedAnalysisNotice,
  );
  assert.equal(
    await fixture.store.openInventoryItem({
      ...fixture.item,
      lifecycle: 'active' as const,
      itemId: '31',
      currentRevisionId: '32',
      rootAnchorId: '33',
    }),
    false,
  );
  assert.equal(fixture.snapshot().analysis.record, undefined);
  assert.deepEqual(
    fixture.snapshot().analysisUnavailable,
    removedAnalysisNotice,
  );
});

test('removal causes stay in their named scope and survive returning from another empty scope', async (t) => {
  const fixture = analysisRemovalFixture();
  t.after(() => fixture.store.close());
  await fixture.start();
  fixture.remove();
  await fixture.store.refresh();
  for (const scope of [
    { kind: 'context' as const, contextId: '8' },
    { kind: 'free' as const },
  ]) {
    await fixture.store.setScope(scope);
    assert.equal(fixture.snapshot().analysisUnavailable, undefined);
  }
  await fixture.store.setScope({ kind: 'context', contextId: '7' });
  assert.deepEqual(
    fixture.snapshot().analysisUnavailable,
    removedAnalysisNotice,
  );
});

test('restoring assignment clears the cause even without opening content again', async (t) => {
  const fixture = analysisRemovalFixture();
  t.after(() => fixture.store.close());
  await fixture.start();
  fixture.remove();
  await fixture.store.refresh();
  fixture.backend.assigned = true;
  fixture.backend.revision += 1;
  await fixture.store.refresh();
  assert.equal(fixture.snapshot().analysisUnavailable, undefined);
  fixture.remove();
  await fixture.store.refresh();
  assert.equal(fixture.snapshot().analysisUnavailable, undefined);
});

test('new analysis clears removal cause permanently even when the new scratch later disappears', async (t) => {
  const fixture = analysisRemovalFixture();
  t.after(() => fixture.store.close());
  await fixture.start();
  fixture.remove();
  await fixture.store.refresh();
  assert.equal(await fixture.store.startScratchAtInitialPosition(), true);
  assert.equal(fixture.snapshot().analysis.scratch?.scratchId, 'new-analysis');
  assert.equal(fixture.snapshot().analysisUnavailable, undefined);
  fixture.backend.scratch = undefined;
  fixture.backend.revision += 1;
  await fixture.store.refresh();
  assert.equal(fixture.snapshot().analysisUnavailable, undefined);
});

test('opening another assigned analysis clears the previous removal cause', async (t) => {
  const fixture = analysisRemovalFixture({
    setWorkScopeResume: async (request) => {
      assert.equal(request.area, 'analyze');
      fixture.backend.recordId = '31';
      fixture.backend.revision += 1;
      return {
        dataRevision: fixture.backend.revision,
        area: 'analyze',
        resume: {
          resumeVersion: 1,
          mode: 'analyze',
          currentPositionId: '1',
          itemId: '31',
          revisionId: '32',
          anchorId: '33',
          updatedAt: '2026-09-27T12:00:00.000Z',
        },
      };
    },
  });
  t.after(() => fixture.store.close());
  await fixture.start();
  fixture.remove();
  await fixture.store.refresh();
  assert.equal(
    await fixture.store.openInventoryItem({
      ...fixture.item,
      lifecycle: 'active' as const,
      itemId: '31',
      currentRevisionId: '32',
      rootAnchorId: '33',
    }),
    true,
  );
  assert.equal(fixture.snapshot().analysis.record?.itemId, '31');
  assert.equal(fixture.snapshot().analysisUnavailable, undefined);
  fixture.backend.recordId = undefined;
  fixture.backend.revision += 1;
  await fixture.store.refresh();
  assert.equal(fixture.snapshot().analysisUnavailable, undefined);
});

for (const scenario of [
  'first-use',
  'still-assigned',
  'unrelated-error',
  'failed-removal',
] as const) {
  test(`no removal cause is invented for ${scenario}`, async (t) => {
    const fixture = analysisRemovalFixture(
      scenario === 'failed-removal'
        ? {
            removeContextItem: async () => {
              throw workAccessProblem('host.unavailable');
            },
          }
        : {},
    );
    t.after(() => fixture.store.close());
    if (scenario === 'first-use') {
      fixture.backend.recordId = undefined;
      fixture.backend.assigned = false;
    }
    await fixture.start();
    if (scenario === 'still-assigned') {
      fixture.backend.recordId = undefined;
      fixture.backend.revision += 1;
    }
    if (scenario === 'unrelated-error') {
      fixture.remove();
      fixture.backend.errorCode = 'host.unavailable';
    }
    if (scenario === 'failed-removal')
      assert.equal(
        await fixture.store.removeInventoryItemFromCurrentContext(
          fixture.item,
          removalPreview(fixture.backend.revision),
        ),
        false,
      );
    await fixture.store.refresh();
    assert.equal(fixture.snapshot().analysisUnavailable, undefined);
  });
}

test('removal while another scope is active is detected on return from the last accepted assignment', async (t) => {
  const fixture = analysisRemovalFixture();
  t.after(() => fixture.store.close());
  await fixture.start();
  await fixture.store.setScope({ kind: 'context', contextId: '8' });
  fixture.remove();
  await fixture.store.refresh();
  assert.equal(fixture.snapshot().analysisUnavailable, undefined);
  await fixture.store.setScope({ kind: 'context', contextId: '7' });
  assert.deepEqual(
    fixture.snapshot().analysisUnavailable,
    removedAnalysisNotice,
  );
});

test('successful local removal proves the cause even if the prior view lacked reference proof', async (t) => {
  const fixture = analysisRemovalFixture();
  t.after(() => fixture.store.close());
  fixture.backend.assigned = false;
  await fixture.start();
  assert.equal(
    await fixture.store.removeInventoryItemFromCurrentContext(
      fixture.item,
      removalPreview(fixture.backend.revision),
    ),
    true,
  );
  assert.deepEqual(
    fixture.snapshot().analysisUnavailable,
    removedAnalysisNotice,
  );
});

test('an older consistent read cannot create a removal cause', async (t) => {
  const fixture = analysisRemovalFixture();
  t.after(() => fixture.store.close());
  fixture.backend.revision = 5;
  await fixture.start();
  fixture.remove();
  fixture.backend.revision = 4;
  await fixture.store.refresh();
  assert.equal(fixture.snapshot().status.persistence.dataRevision, 5);
  assert.equal(fixture.snapshot().analysis.record?.itemId, '11');
  assert.equal(fixture.snapshot().analysisUnavailable, undefined);
});

test(
  'inconsistent removal reads are retried without publishing a cause before a consistent snapshot',
  { timeout: 5_000 },
  async (t) => {
    let mismatch = false;
    let waitForRetry = false;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const fixture = analysisRemovalFixture({
      getSystemStatus: async () => {
        if (mismatch) {
          mismatch = false;
          waitForRetry = true;
          return status(fixture.backend.revision + 1);
        }
        if (waitForRetry) {
          waitForRetry = false;
          entered.resolve();
          await release.promise;
        }
        return status(fixture.backend.revision);
      },
    });
    t.after(() => fixture.store.close());
    await fixture.start();
    fixture.remove();
    mismatch = true;
    const refreshing = fixture.store.refresh();
    await entered.promise;
    assert.equal(fixture.snapshot().analysisUnavailable, undefined);
    assert.equal(fixture.snapshot().analysis.record?.itemId, '11');
    release.resolve();
    await refreshing;
    assert.deepEqual(
      fixture.snapshot().analysisUnavailable,
      removedAnalysisNotice,
    );
  },
);

test('a new scratch from another client replaces the cause without restoring the removed assignment', async (t) => {
  const fixture = analysisRemovalFixture();
  t.after(() => fixture.store.close());
  await fixture.start();
  fixture.remove();
  await fixture.store.refresh();
  fixture.backend.scratch = {
    scratchId: 'remote-scratch',
    scratchRevision: 1,
    intent: { kind: 'exploration' },
    origin: { kind: 'initial_position' },
    root: initialState,
    steps: [],
    cursor: 0,
  };
  fixture.backend.revision += 1;
  await fixture.store.refresh();
  assert.equal(fixture.snapshot().analysisUnavailable, undefined);
  fixture.backend.scratch = undefined;
  fixture.backend.revision += 1;
  await fixture.store.refresh();
  assert.equal(fixture.snapshot().analysisUnavailable, undefined);
});
