import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AnalysisWorkspaceDto,
  DiagnosticReportManifestDto,
  DiagnosticSettingsDto,
  GetAnalysisWorkspaceRequestDto,
  HostConnection,
  HostEvent,
  ListWorkingContextsResultDto,
  SearchInventoryResultDto,
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
    updateAnalysisScratch: async () => assert.fail('no scratch write expected'),
    createAnalysisRecord: async () => assert.fail('no record write expected'),
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
    setWorkScopeResume: async () => assert.fail('no resume write expected'),
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
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
  const client = createClient({
    listWorkingContexts: async () => ({ contexts: [context], dataRevision: 0 }),
    getWorkingContextWorkspace: async () => ({
      context,
      references: [],
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
      itemId: '31',
      revisionId: '32',
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

test('starts a scratch at the locally selected path position', async () => {
  let scratchRequest:
    | Parameters<PlysmithApplicationClient['updateAnalysisScratch']>[0]
    | undefined;
  const currentAnalysis: AnalysisWorkspaceDto = {
    ...analysis(),
    record: {
      itemId: '31',
      revisionId: '32',
      rootAnchorId: '33',
      currentAnchorId: '34',
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
    getAnalysisWorkspace: async () => currentAnalysis,
    updateAnalysisScratch: async (request) => {
      scratchRequest = request;
      return {
        scratch: {
          scratchId: 'scratch-local-selection',
          scratchRevision: 1,
          origin:
            request.action.kind === 'start'
              ? request.action.origin
              : {
                  kind: 'initial_position' as const,
                },
          root: initialState,
          steps: [],
          cursor: 0,
        },
        discarded: false,
        dataRevision: 0,
      };
    },
  });
  const store = createReadyStore(client);
  await store.start();

  await store.startScratchAtTarget({
    itemId: '11',
    revisionId: '12',
    anchorId: '13',
  });

  assert.deepEqual(scratchRequest, {
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
    },
  });
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
      createdAt: '2026-09-11T18:00:00.000Z',
      updatedAt: '2026-09-11T18:00:00.000Z',
    },
    references: [],
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

test('saving an analysis note sends its explicit context visibility once', async () => {
  let noteRequest: unknown;
  let scratchRequest: unknown;
  const context = {
    contextId: '7',
    displayName: 'Repertoire',
    lifecycle: 'active' as const,
    contextVersion: 1,
    referenceCount: 1,
    createdAt: '2026-09-11T18:00:00.000Z',
    updatedAt: '2026-09-11T18:00:00.000Z',
  };
  const client = createClient({
    listWorkingContexts: async () => ({ contexts: [context], dataRevision: 0 }),
    getWorkingContextWorkspace: async () => ({
      context,
      references: [],
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

test('failed saves report failure without consuming visible drafts', async () => {
  const currentScratch: NonNullable<AnalysisWorkspaceDto['scratch']> = {
    scratchId: 'scratch-1',
    scratchRevision: 1,
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
