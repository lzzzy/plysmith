import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HostClientProblem,
  type AnalysisWorkspaceDto,
  type EngineProviderConfigurationDto,
  type EngineProviderConfigurationPreviewDto,
  type HostConnection,
  type StartupResumeDto,
} from '../../../app/infrastructure/channels/host_client/index.ts';
import {
  PlysmithApplicationStore,
  type PlysmithApplicationClient,
} from '../../../app/infrastructure/channels/ui/renderer/plysmith-application-store.ts';

const connection: HostConnection = {
  endpoint: 'http://127.0.0.1:43121/',
  productRelease: '0.0.0',
  contractFingerprint: 'sha256:engine-draft-test',
  token: 'desktop-engine-draft-test-token-000000000000',
};

const stockfish: EngineProviderConfigurationDto = {
  instanceId: 'stockfish',
  providerType: 'stockfish-uci',
  displayName: 'Stockfish',
  executablePath: 'C:/engines/stockfish.exe',
  arguments: [],
  threads: 1,
  hashMb: 64,
  moveTimeMs: 500,
  startupTimeoutMs: 5_000,
  moveTimeoutMs: 10_000,
  stopTimeoutMs: 1_000,
  maxOutputBytes: 1_048_576,
  configurationRevision: 'revision-1',
  effectiveFingerprint: 'fingerprint-1',
  restartRequired: false,
};
const maia: EngineProviderConfigurationDto = {
  instanceId: 'maia',
  providerType: 'maia-chess',
  displayName: 'Maia 1500',
  executablePath: 'C:/engines/lc0.exe',
  weightsPath: 'C:/engines/maia.pb.gz',
  startupTimeoutMs: 30_000,
  moveTimeoutMs: 30_000,
  stopTimeoutMs: 1_000,
  maxOutputBytes: 1_048_576,
  configurationRevision: 'revision-2',
  effectiveFingerprint: 'fingerprint-2',
  restartRequired: false,
};

test('two dirty engine drafts survive configuration and area switches and refresh', async (t) => {
  const store = createStore();
  t.after(() => store.close());
  await store.start();
  store.setActivity('settings');
  store.updateEngineConfigurationDraft('stockfish', {
    displayName: 'My Stockfish',
  });
  store.selectEngineConfiguration('maia');
  store.updateEngineConfigurationDraft('maia', { displayName: 'My Maia' });
  store.setActivity('manage');
  await store.refresh();
  store.setActivity('settings');
  assert.equal(ready(store).engineConfigurationDrafts.selectedKey, 'maia');
  assert.deepEqual(
    ready(store).engineConfigurationDrafts.entries.map((entry) => entry.dirty),
    [true, true],
  );
  store.selectEngineConfiguration('stockfish');
  assert.equal(draft(store, 'stockfish').form.displayName, 'My Stockfish');
  assert.equal(draft(store, 'maia').form.displayName, 'My Maia');

  store.updateEngineConfigurationDraft('stockfish', {
    displayName: stockfish.displayName,
  });
  assert.equal(draft(store, 'stockfish').dirty, false);
  assert.equal(draft(store, 'maia').dirty, true);
  store.updateEngineConfigurationDraft('stockfish', { threads: '8' });
  store.discardEngineConfigurationDraft('stockfish');
  assert.equal(draft(store, 'stockfish').dirty, false);
  assert.equal(draft(store, 'maia').form.displayName, 'My Maia');
  assert.equal(draft(store, 'maia').dirty, true);
});

test('saving the selected draft converts raw numbers and leaves the other draft dirty', async (t) => {
  let providers = [stockfish, maia];
  let previews = 0;
  let saves = 0;
  const store = createStore({
    getEngineProviderConfigurations: async () => ({ providers }),
    previewEngineProviderConfiguration: async (input) => {
      previews += 1;
      assert.equal(input.providerType === 'stockfish-uci' && input.threads, 4);
      return { valid: true, issues: [] };
    },
    saveEngineProviderConfiguration: async (instanceId, request) => {
      saves += 1;
      assert.equal(instanceId, 'stockfish');
      assert.equal(request.expectedConfigurationRevision, 'revision-1');
      const saved = {
        ...request.input,
        configurationRevision: 'revision-3',
        effectiveFingerprint: 'fingerprint-3',
        restartRequired: true,
      };
      providers = [saved, maia];
      return saved;
    },
  });
  t.after(() => store.close());
  await store.start();
  store.updateEngineConfigurationDraft('stockfish', { threads: '04' });
  store.updateEngineConfigurationDraft('maia', {
    displayName: 'Unrelated edit',
  });
  assert.equal(await store.saveEngineConfigurationDraft('stockfish'), true);
  assert.equal(previews, 1);
  assert.equal(saves, 1);
  assert.equal(draft(store, 'stockfish').dirty, false);
  assert.equal(
    draft(store, 'stockfish').expectedConfigurationRevision,
    'revision-3',
  );
  assert.equal(draft(store, 'maia').dirty, true);
  assert.equal(draft(store, 'maia').form.displayName, 'Unrelated edit');
  assert.equal(ready(store).engineConfigurationDrafts.selectedKey, 'stockfish');
  assert.equal(ready(store).busyCommand, undefined);
});

test('invalid threads remain raw with an inline issue and do not reach preview or save', async (t) => {
  let previews = 0;
  let saves = 0;
  const store = createStore({
    previewEngineProviderConfiguration: async () => {
      previews += 1;
      return { valid: true, issues: [] };
    },
    saveEngineProviderConfiguration: async () => {
      saves += 1;
      return stockfish;
    },
  });
  t.after(() => store.close());
  await store.start();
  store.updateEngineConfigurationDraft('stockfish', { threads: '0' });
  assert.equal(await store.saveEngineConfigurationDraft('stockfish'), false);
  assert.equal(previews, 0);
  assert.equal(saves, 0);
  const invalid = draft(store, 'stockfish');
  assert.equal(
    invalid.form.providerType === 'stockfish-uci' && invalid.form.threads,
    '0',
  );
  assert.deepEqual(invalid.issues, [
    {
      field: 'threads',
      messageId: 'engines.validation.integerRange',
      values: { min: 1, max: 256 },
    },
  ]);
  assert.equal(ready(store).errorCode, undefined);
  assert.equal(ready(store).busyCommand, undefined);
  store.selectEngineConfiguration('maia');
  store.setActivity('manage');
  await store.refresh();
  store.setActivity('settings');
  store.selectEngineConfiguration('stockfish');
  assert.deepEqual(draft(store, 'stockfish'), invalid);
});

test('rejected preview associates file issues and preserves both drafts without saving', async (t) => {
  let previews = 0;
  let saves = 0;
  const store = createStore({
    previewEngineProviderConfiguration: async (input) => {
      previews += 1;
      assert.equal(input.displayName, 'My Maia');
      return { valid: false, issues: ['weights_not_found'] };
    },
    saveEngineProviderConfiguration: async () => {
      saves += 1;
      return maia;
    },
  });
  t.after(() => store.close());
  await store.start();
  store.updateEngineConfigurationDraft('stockfish', { threads: '04' });
  store.selectEngineConfiguration('maia');
  store.updateEngineConfigurationDraft('maia', {
    displayName: 'My Maia',
    weightsPath: 'C:/missing.pb.gz',
  });
  const form = draft(store, 'maia').form;
  assert.equal(await store.saveEngineConfigurationDraft('maia'), false);
  assert.equal(previews, 1);
  assert.equal(saves, 0);
  assert.deepEqual(draft(store, 'maia').form, form);
  assert.deepEqual(draft(store, 'maia').issues, [
    { field: 'weightsPath', messageId: 'engines.issue.weights_not_found' },
  ]);
  assert.equal(draft(store, 'stockfish').dirty, true);
  assert.equal(draft(store, 'maia').dirty, true);
  assert.equal(ready(store).busyCommand, undefined);
});

for (const failureStage of ['preview', 'save'] as const) {
  test(
    `${failureStage} exception preserves raw drafts and blocks competing edits during the request`,
    { timeout: 5_000 },
    async (t) => {
      const entered = Promise.withResolvers<void>();
      const failure = Promise.withResolvers<never>();
      let saves = 0;
      const store = createStore({
        previewEngineProviderConfiguration: async () => {
          if (failureStage === 'preview') {
            entered.resolve();
            return failure.promise;
          }
          return { valid: true, issues: [] };
        },
        saveEngineProviderConfiguration: async () => {
          saves += 1;
          entered.resolve();
          return failure.promise;
        },
      });
      t.after(() => store.close());
      await store.start();
      store.updateEngineConfigurationDraft('stockfish', {
        displayName: 'Keep my input',
        threads: '04',
      });
      store.updateEngineConfigurationDraft('maia', {
        displayName: 'Keep other input',
      });
      const before = ready(store).engineConfigurationDrafts;
      const saving = store.saveEngineConfigurationDraft('stockfish');
      await entered.promise;
      assert.equal(ready(store).busyCommand, 'save_engine_provider');
      store.selectEngineConfiguration('maia');
      store.updateEngineConfigurationDraft('stockfish', { threads: '8' });
      store.discardEngineConfigurationDraft('maia');
      store.createEngineConfigurationDraft('stockfish-uci');
      store.setActivity('manage');
      failure.reject(configurationProblem());
      assert.equal(await saving, false);
      store.setActivity('settings');
      assert.equal(saves, failureStage === 'save' ? 1 : 0);
      assert.deepEqual(ready(store).engineConfigurationDrafts, before);
      assert.equal(ready(store).errorCode, 'configuration.engine_conflict');
      assert.equal(ready(store).busyCommand, undefined);
    },
  );
}

test(
  'closing the store during preview prevents a subsequent save',
  { timeout: 5_000 },
  async (t) => {
    const preview =
      Promise.withResolvers<EngineProviderConfigurationPreviewDto>();
    const entered = Promise.withResolvers<void>();
    let saves = 0;
    const store = createStore({
      previewEngineProviderConfiguration: async () => {
        entered.resolve();
        return preview.promise;
      },
      saveEngineProviderConfiguration: async () => {
        saves += 1;
        return stockfish;
      },
    });
    t.after(() => store.close());
    await store.start();
    store.updateEngineConfigurationDraft('stockfish', {
      displayName: 'Changed',
    });
    const saving = store.saveEngineConfigurationDraft('stockfish');
    await entered.promise;
    store.close();
    preview.resolve({ valid: true, issues: [] });
    assert.equal(await saving, false);
    assert.equal(saves, 0);
  },
);

test(
  'a provider refresh started before saving cannot remove or reselect a new draft',
  { timeout: 5_000 },
  async (t) => {
    let providers = [stockfish, maia];
    const staleRead = Promise.withResolvers<{
      providers: EngineProviderConfigurationDto[];
    }>();
    const readStarted = Promise.withResolvers<void>();
    const savedOnServer = Promise.withResolvers<void>();
    let delayNextRead = false;
    let reads = 0;
    const store = createStore({
      getEngineProviderConfigurations: async () => {
        reads += 1;
        if (delayNextRead) {
          delayNextRead = false;
          readStarted.resolve();
          return staleRead.promise;
        }
        return { providers: [...providers] };
      },
      previewEngineProviderConfiguration: async () => ({
        valid: true,
        issues: [],
      }),
      saveEngineProviderConfiguration: async (_, request) => {
        assert.equal(request.expectedConfigurationRevision, null);
        const saved = {
          ...request.input,
          configurationRevision: 'revision-new',
          effectiveFingerprint: 'fingerprint-new',
          restartRequired: true,
        };
        providers = [...providers, saved];
        savedOnServer.resolve();
        return saved;
      },
    });
    t.after(() => store.close());
    await store.start();
    store.updateEngineConfigurationDraft('maia', {
      displayName: 'Other unsaved work',
    });
    store.createEngineConfigurationDraft('stockfish-uci');
    const key = ready(store).engineConfigurationDrafts.selectedKey;
    assert.ok(key);
    store.updateEngineConfigurationDraft(key, {
      displayName: 'New engine',
      executablePath: 'C:/engines/new.exe',
    });
    const instanceId = draft(store, key).form.instanceId;
    const observedSelection: (string | undefined)[] = [];
    const unsubscribe = store.subscribe(() =>
      observedSelection.push(
        ready(store).engineConfigurationDrafts.selectedKey,
      ),
    );
    t.after(unsubscribe);
    delayNextRead = true;
    const refreshing = store.refresh();
    await readStarted.promise;
    const saving = store.saveEngineConfigurationDraft(key);
    await savedOnServer.promise;
    // Let the save response reach the store before releasing the older read.
    await new Promise<void>((resolve) => setImmediate(resolve));
    staleRead.resolve({ providers: [stockfish, maia] });
    const [saved] = await Promise.all([saving, refreshing]);
    assert.equal(saved, true);
    assert.equal(reads, 3);
    assert.equal(ready(store).engineConfigurationDrafts.selectedKey, key);
    assert.ok(observedSelection.every((selected) => selected === key));
    assert.equal(draft(store, key).form.instanceId, instanceId);
    assert.equal(
      draft(store, key).expectedConfigurationRevision,
      'revision-new',
    );
    assert.equal(draft(store, key).dirty, false);
    assert.equal(draft(store, 'maia').form.displayName, 'Other unsaved work');
    assert.equal(draft(store, 'maia').dirty, true);
    assert.equal(ready(store).engineConfigurationDrafts.entries.length, 3);
  },
);

function ready(store: PlysmithApplicationStore) {
  const state = store.getSnapshot();
  assert.equal(state.phase, 'ready');
  if (state.phase !== 'ready') assert.fail('Expected a ready store');
  return state;
}

function draft(store: PlysmithApplicationStore, key: string) {
  const entry = ready(store).engineConfigurationDrafts.entries.find(
    (value) => value.key === key,
  );
  assert.ok(entry, `Expected draft ${key}`);
  return entry;
}

function configurationProblem(): HostClientProblem {
  return new HostClientProblem({
    type: 'urn:plysmith:configuration.engine_conflict',
    title: 'Engine configuration conflict',
    status: 409,
    detail: 'The engine configuration has changed.',
    instance: 'urn:plysmith:problem:engine-draft-test',
    code: 'configuration.engine_conflict',
    correlationId: 'engine-draft-test',
    retryable: false,
    parameters: {},
  });
}

function createStore(
  overrides: Partial<PlysmithApplicationClient> = {},
): PlysmithApplicationStore {
  const unexpected = async (): Promise<never> =>
    assert.fail('Unexpected client operation');
  let startup: StartupResumeDto = {
    scope: { kind: 'free' },
    area: 'manage',
    startupVersion: null,
    dataRevision: 0,
  };
  const client: PlysmithApplicationClient = {
    getInventoryOrganization: async () => ({
      folders: [],
      linkedFolderIds: [],
      dataRevision: 0,
    }),
    changeInventoryOrganization: unexpected,
    previewContextFolderRemoval: unexpected,
    checkInventoryNameAvailability: unexpected,
    getStartupResume: async () => startup,
    setStartupResume: async (request) => {
      assert.equal(request.expectedStartupVersion, startup.startupVersion);
      startup = {
        scope: request.scope,
        area: request.area,
        startupVersion: (startup.startupVersion ?? 0) + 1,
        dataRevision: 0,
      };
      return startup;
    },
    getWorkScopeWorkspace: async (request) => {
      assert.equal(request.scopeKind, 'free');
      return { scope: { kind: 'free' }, dataRevision: 0 };
    },
    previewContextItemRemoval: unexpected,
    previewWorkingContextDeletion: unexpected,
    deleteWorkingContext: unexpected,
    previewInventoryItemDeletion: unexpected,
    deleteInventoryItem: unexpected,
    getSystemStatus: async () => ({
      state: 'ready',
      persistence: { schemaVersion: 4, dataRevision: 0 },
      productRelease: connection.productRelease,
      contractFingerprint: connection.contractFingerprint,
    }),
    getUserPreferences: async () => ({
      uiLocale: 'de-DE',
      preferenceRevision: 1,
      dataRevision: 0,
      updatedAt: '2026-09-27T12:00:00.000Z',
    }),
    getDiagnosticSettings: async () => ({
      configuredLevel: 'off',
      activeLevel: 'off',
      restartRequired: false,
      configurationRevision: 'diagnostic-revision',
    }),
    getDiagnosticReportManifest: async () => ({
      manifestVersion: 1,
      format: 'plysmith-diagnostics-json-gzip-v1',
      suggestedFileName: 'report.json.gz',
      maximumBytes: 1_024,
      includedCategories: [],
      excludedCategories: [],
    }),
    getAnalysisWorkspace: async () => emptyAnalysis(),
    searchInventory: async () => ({
      items: [],
      ancestors: [],
      provenanceEdges: [],
      dataRevision: 0,
    }),
    listWorkingContexts: async () => ({ contexts: [], dataRevision: 0 }),
    listPositionAnalysisProviders: async () => ({ providers: [] }),
    listMovePolicyProviders: async () => ({ providers: [] }),
    getPlayout: async () => null,
    getEngineProviderConfigurations: async () => ({
      providers: [stockfish, maia],
    }),
    setUiLanguage: unexpected,
    setDiagnosticLogLevel: unexpected,
    createDiagnosticReport: unexpected,
    validateAnalysisSetup: unexpected,
    updateAnalysisScratch: unexpected,
    createAnalysisRecord: unexpected,
    startInventoryRevision: unexpected,
    promoteAnalysisToInventoryRevision: unexpected,
    previewInventoryRevision: unexpected,
    saveInventoryRevision: unexpected,
    getInventoryRevision: unexpected,
    getPendingRevisionImpact: unexpected,
    resolvePendingRevisionImpact: unexpected,
    createAnalysisNote: unexpected,
    createPositionNote: unexpected,
    updateAnalysisNote: unexpected,
    deleteAnalysisNote: unexpected,
    getWorkingContextWorkspace: unexpected,
    createWorkingContext: unexpected,
    updateWorkingContextMetadata: unexpected,
    addContextReference: unexpected,
    removeContextItem: unexpected,
    setWorkScopeResume: unexpected,
    setManagementPresentation: unexpected,
    analyzePosition: unexpected,
    startPlayout: unexpected,
    submitPlayoutMove: unexpected,
    retryPlayout: unexpected,
    pausePlayout: unexpected,
    resumePlayout: unexpected,
    cancelPlayoutCompletion: unexpected,
    stopPlayout: unexpected,
    completePlayout: unexpected,
    discardPlayout: unexpected,
    previewEngineProviderConfiguration: unexpected,
    saveEngineProviderConfiguration: unexpected,
    removeEngineProviderConfiguration: unexpected,
    ...overrides,
  };
  return new PlysmithApplicationStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    createClient: () => client,
    createEventSubscription: () => ({
      ready: Promise.resolve(),
      close: () => undefined,
    }),
  });
}

function emptyAnalysis(): AnalysisWorkspaceDto {
  return {
    scratchHasChanges: false,
    scope: { kind: 'free' },
    dataRevision: 0,
    allowedActions: ['start_scratch'],
    legalMoves: [],
    currentState: {
      position: {
        ruleSetId: 'standardChess',
        boardKey:
          'RNBQKBNRPPPPPPPP................................pppppppprnbqkbnr',
        sideToMove: 'white',
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
        historyKnowledge: 'complete',
      },
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    },
  };
}
