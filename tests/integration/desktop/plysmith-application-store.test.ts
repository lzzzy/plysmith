import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AnalysisWorkspaceDto,
  DiagnosticReportManifestDto,
  DiagnosticSettingsDto,
  GetAnalysisWorkspaceRequestDto,
  HostConnection,
  HostEvent,
  InventoryRevisionPreviewDto,
  ListWorkingContextsResultDto,
  PlayoutDto,
  SearchInventoryResultDto,
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
      readOnlyPreview: false,
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
  return { items: [], dataRevision };
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
  return {
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
    addContextReference: async () => assert.fail('no reference write expected'),
    removeContextItem: async () =>
      assert.fail('no context item removal expected'),
    setWorkScopeResume: async () => assert.fail('no resume write expected'),
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
        candidates: [],
        search: { limiter: { kind: 'movetime', value: 300 } },
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();
  const request = {
    laneId: 'objective',
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

  assert.deepEqual(requests, [{ scopeKind: 'free', mode: 'initial_position' }]);
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

test('restoring Ausspielen after startup prepares the authoritative initial position', async () => {
  const requests: GetAnalysisWorkspaceRequestDto[] = [];
  const client = createClient({
    getAnalysisWorkspace: async (request) => {
      requests.push(request);
      return analysis();
    },
  });
  const store = createReadyStore(client);

  store.setActivity('playout');
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
  store.close();
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
            items: [firstItem],
            nextCursor: 'inventory-page-2',
            dataRevision: 0,
          }
        : { items: [firstItem, secondItem], dataRevision: 0 },
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
    searchInventory: async () => ({ items: [item], dataRevision: 0 }),
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
  await store.openInventoryItem(item);
  assert.equal(requests.at(-1)?.itemId, '11');
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
      readOnlyPreview: false,
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
  };
  const client = createClient({
    listWorkingContexts: async () => ({
      contexts: [contextWorkspace.context],
      dataRevision: 0,
    }),
    searchInventory: async () => ({ items: [item], dataRevision: 0 }),
    getWorkingContextWorkspace: async () => contextWorkspace,
    getAnalysisWorkspace: async (request) => ({
      ...analysis(),
      scope:
        request.scopeKind === 'context'
          ? { kind: 'context', contextId: request.contextId! }
          : { kind: 'free' },
    }),
    setWorkScopeResume: async (contextId, request) => {
      resumeWrites += 1;
      assert.equal(contextId, '7');
      assert.deepEqual(request, {
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
    lifecycle: 'active',
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
    Parameters<PlysmithApplicationClient['setWorkScopeResume']>[1] | undefined;
  const client = createClient({
    listWorkingContexts: async () => ({ contexts: [context], dataRevision: 0 }),
    searchInventory: async () => ({ items: [item], dataRevision: 0 }),
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
          readOnlyPreview: false,
        },
      };
    },
    updateAnalysisScratch: async (request) => {
      calls.push(`scratch:${request.action.kind}`);
      scratch = undefined;
      return { discarded: true, dataRevision: 1 };
    },
    setWorkScopeResume: async (_contextId, request) => {
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
  assert.deepEqual(calls.slice(-4), [
    'scratch:discard',
    'analysis:draft',
    'resume',
    'analysis:draft',
  ]);
  assert.deepEqual(resumeRequest, {
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
    lifecycle: 'active',
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

  assert.equal(await store.removeInventoryItemFromCurrentContext(item), true);

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
    searchInventory: async () => ({ items: [item], dataRevision: 0 }),
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
    searchInventory: async () => ({ items: [item], dataRevision: 0 }),
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
    searchInventory: async () => ({ items: [item], dataRevision: 0 }),
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
  store.close();
});

test('a first move at the saved line end opens and previews an inventory extension', async () => {
  let current = savedAnalysis();
  let startRequest:
    | Parameters<PlysmithApplicationClient['startInventoryRevision']>[1]
    | undefined;
  let saveRequest:
    | Parameters<PlysmithApplicationClient['saveInventoryRevision']>[0]
    | undefined;
  const client = createClient({
    getAnalysisWorkspace: async () => current,
    startInventoryRevision: async (_itemId, request) => {
      startRequest = request;
      const scratch = {
        scratchId: 'revision-scratch',
        scratchRevision: 1,
        intent: {
          kind: 'inventory_revision' as const,
          mode: 'extend' as const,
          itemId: '11',
          baseRevisionId: '12',
          cutAnchorId: '13',
          returnAnchorId: '13',
          displayName: 'Französisch',
        },
        origin: {
          kind: 'inventory_anchor' as const,
          itemId: '11',
          revisionId: '12',
          anchorId: '13',
        },
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
      current = {
        ...current,
        scratch,
        allowedActions: ['apply_move', 'move_cursor', 'discard_scratch'],
      };
      return { scratch, dataRevision: 0 };
    },
    previewInventoryRevision: async () => ({
      itemId: '11',
      baseRevisionId: '12',
      mode: 'extend',
      displayName: 'Französisch',
      preservedMoveCount: 0,
      addedSteps: current.scratch?.steps ?? [],
      removedSteps: [],
      historicalGlobalContributionCount: 0,
      affectedContexts: [],
      followingContexts: [],
      noOp: false,
      previewFingerprint:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      dataRevision: 0,
    }),
    saveInventoryRevision: async (request) => {
      saveRequest = request;
      current = {
        ...savedAnalysis(),
        record: {
          ...savedAnalysis().record!,
          revisionId: '14',
          currentRevisionId: '14',
          revisionNumber: 2,
        },
      };
      return {
        itemId: '11',
        revisionId: '14',
        revisionNumber: 2,
        currentAnchorId: '13',
        impacts: [],
        noOp: false,
        dataRevision: 1,
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.applyMove('e4');
  assert.deepEqual(startRequest, {
    scope: { kind: 'free' },
    baseRevisionId: '12',
    anchorId: '13',
    mode: 'extend',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: 'e4', locale: 'de-DE' },
  });

  const previewed = store.getSnapshot();
  assert.equal(
    previewed.phase === 'ready'
      ? previewed.inventoryRevisionPreview?.previewFingerprint
      : undefined,
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  );
  assert.equal(await store.saveInventoryRevision(), true);
  assert.deepEqual(saveRequest, {
    scope: { kind: 'free' },
    expectedScratchId: 'revision-scratch',
    expectedScratchRevision: 1,
    previewFingerprint:
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
  const saved = store.getSnapshot();
  assert.equal(
    saved.phase === 'ready' ? saved.inventoryRevisionPreview : undefined,
    undefined,
  );
  store.close();
});

test('focusing the saved line end makes the next move an inventory extension', async () => {
  let startRequest:
    | Parameters<PlysmithApplicationClient['startInventoryRevision']>[1]
    | undefined;
  const client = createClient({
    getAnalysisWorkspace: async (request) =>
      savedLineAnalysis(request.anchorId === '14' ? '14' : '13'),
    startInventoryRevision: async (_itemId, request) => {
      startRequest = request;
      return {
        scratch: {
          scratchId: 'revision-scratch',
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
          steps: [
            {
              before: initialState,
              move: { from: 'd7', to: 'd5', san: 'd5' },
              after: initialState,
            },
          ],
          cursor: 1,
        },
        dataRevision: 0,
      };
    },
    previewInventoryRevision: async () => ({
      itemId: '11',
      baseRevisionId: '12',
      mode: 'extend',
      displayName: 'Französisch',
      preservedMoveCount: 1,
      addedSteps: [],
      removedSteps: [],
      historicalGlobalContributionCount: 0,
      affectedContexts: [],
      followingContexts: [],
      noOp: false,
      previewFingerprint:
        'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      dataRevision: 0,
    }),
  });
  const store = createReadyStore(client);
  await store.start();

  await store.openRecordAnchor('14');
  await store.applyMove('d5');

  assert.deepEqual(startRequest, {
    scope: { kind: 'free' },
    baseRevisionId: '12',
    anchorId: '14',
    mode: 'extend',
    expectedScratchId: null,
    expectedScratchRevision: null,
    firstMove: { kind: 'notation', value: 'd5', locale: 'de-DE' },
  });
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
      readOnlyPreview: revisionId === '12',
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
      expectedImpactVersion: 1,
      resolution: { kind: 'use_target' },
    }),
    true,
  );
  assert.deepEqual(resolution, {
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
