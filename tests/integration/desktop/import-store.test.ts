import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PlysmithHostClient,
  HostClientProblem,
  type AnalysisRecordDto,
  type HostEvent,
} from '../../../app/infrastructure/channels/host_client/index.ts';
import {
  PlysmithApplicationStore,
  type ImportPreview,
  type PlysmithApplicationClient,
  type WorkScope,
} from '../../../app/infrastructure/channels/ui/renderer/plysmith-application-store.ts';
import { chessTreePath } from '../../../app/infrastructure/channels/ui/renderer/chess-tree-presentation.ts';

const time = '2026-10-01T10:00:00.000Z';
const previewId = '00000000-0000-4000-8000-000000000001';
const input = {
  inputHandle: '00000000-0000-4000-8000-000000000002',
  displayName: 'Italienisch.pgn',
  inputSize: 50,
};
const root: AnalysisRecordDto['root'] = {
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
    positionKey: 'initial',
  },
  playState: {
    halfmoveClock: 0,
    fullmoveNumber: 1,
    historyKnowledge: 'complete',
  },
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
};

function preview(): ImportPreview {
  return {
    previewId,
    sourceDisplayName: input.displayName,
    inputSize: input.inputSize,
    encoding: 'utf-8',
    formatId: 'standard-chess-pgn-v1',
    candidates: [
      {
        sourceOrder: 0,
        suggestedName: 'Italienisch',
        status: 'ready',
        moveCount: 3,
        variationCount: 1,
        findings: [],
      },
    ],
  };
}
function problem(code: string) {
  return new HostClientProblem({
    type: 'urn:test',
    title: code,
    status: 409,
    detail: code,
    instance: 'urn:test:import',
    code,
    correlationId: 'test',
    retryable: false,
    parameters: {},
  });
}
async function fixture(
  overrides: Partial<PlysmithApplicationClient> = {},
  picker: () => Promise<string | undefined> = async () => 'C:/input.pgn',
  scope: WorkScope = { kind: 'free' },
) {
  let refreshes = 0;
  let dataRevision = 0;
  const diagnostics: { eventCode: string; problemCode?: string }[] = [];
  let emit: (event: HostEvent) => void = () =>
    assert.fail('subscription missing');
  const connection = {
    endpoint: 'http://127.0.0.1:43121/',
    productRelease: '0.0.0',
    contractFingerprint: 'sha256:import-test',
    token: 'import-test-token-000000000000000',
  };
  const reads = {
    getSystemStatus: async () => {
      ++refreshes;
      return {
        state: 'ready' as const,
        persistence: { schemaVersion: 9, dataRevision },
        productRelease: '0.0.0',
        contractFingerprint: 'sha256:import-test',
      };
    },
    getUserPreferences: async () => ({
      uiLocale: 'de-DE' as const,
      preferenceRevision: 1,
      dataRevision,
      updatedAt: time,
    }),
    getDiagnosticSettings: async () => ({
      configuredLevel: 'off' as const,
      activeLevel: 'off' as const,
      restartRequired: false,
      configurationRevision: 'sha256:test',
    }),
    getDiagnosticReportManifest: async () => ({
      manifestVersion: 1 as const,
      format: 'plysmith-diagnostics-json-gzip-v1' as const,
      suggestedFileName: 'test.json.gz',
      maximumBytes: 100,
      includedCategories: [],
      excludedCategories: [],
    }),
    getAnalysisWorkspace: async () => ({
      scope,
      dataRevision,
      currentState: root,
      scratchHasChanges: false,
      legalMoves: [],
      allowedActions: [],
    }),
    getInventoryOrganization: async () => ({
      folders: [],
      linkedFolderIds: [],
      dataRevision,
    }),
    searchInventory: async () => ({
      ancestors: [],
      provenanceEdges: [],
      items: [],
      dataRevision,
    }),
    listWorkingContexts: async () => ({ contexts: [], dataRevision }),
    getWorkingContextWorkspace: async (contextId: string) => ({
      context: {
        contextId,
        contextVersion: 1,
        displayName: 'Repertoire',
        lifecycle: 'active' as const,
        itemCount: 0,
        referenceCount: 0,
        pendingRevisionImpactCount: 0,
        createdAt: time,
        updatedAt: time,
      },
      members: [],
      references: [],
      pendingRevisionImpacts: [],
      dataRevision,
    }),
    getStartupResume: async () => ({
      scope,
      area: 'manage' as const,
      startupVersion: null,
      dataRevision,
    }),
    getWorkScopeWorkspace: async () => ({
      scope,
      dataRevision,
    }),
    listPositionAnalysisProviders: async () => ({ providers: [] }),
    listMovePolicyProviders: async () => ({ providers: [] }),
    getPlayout: async () => null,
    getEngineProviderConfigurations: async () => ({ providers: [] }),
    registerImportInput: async () => input,
    prepareImport: async () => preview(),
    cancelImportPreparation: async () => ({ cancelled: true }),
    checkImportNames: async (request) => ({
      candidates: request.candidates.map((candidate) => ({
        ...candidate,
        available: true,
        suggestedDisplayName: candidate.displayName,
      })),
      dataRevision,
    }),
    discardImport: async () => ({ discarded: true }),
    publishImport: async () => ({
      items: [{ itemId: '11', revisionId: '12', sourceOrder: 0 }],
      folderId: '3',
      dataRevision,
    }),
    ...overrides,
  } satisfies Partial<PlysmithApplicationClient>;
  let client = Object.assign(new PlysmithHostClient(connection), reads);
  const store = new PlysmithApplicationStore({
    getBootstrap: async () => ({ kind: 'ready', generation: 1, connection }),
    chooseImportFile: picker,
    recordDiagnostic: (event) => diagnostics.push(event),
    createClient: () => client,
    createEventSubscription: (_connection, onEvent) => {
      emit = onEvent;
      return { ready: Promise.resolve(), close() {} };
    },
  });
  await store.start();
  assert.equal(store.getSnapshot().phase, 'ready');
  return {
    store,
    diagnostics,
    replaceClient: (replacement: Partial<PlysmithApplicationClient>) => {
      client = Object.assign(
        new PlysmithHostClient(connection),
        reads,
        replacement,
      );
    },
    refreshes: () => refreshes,
    setDataRevision: (revision: number) => {
      dataRevision = revision;
    },
    emit: (revision: number) =>
      emit({
        kind: 'inventory.organization-changed',
        eventId: 'inventory-' + revision,
        sequence: revision,
        dataRevision: revision,
        occurredAt: time,
        subscriptionRevision: 1,
        correlationId: 'import-test',
        payload: { itemIds: ['11'] },
      }),
  };
}
function session(store: PlysmithApplicationStore) {
  const state = store.getSnapshot();
  assert.equal(state.phase, 'ready');
  assert.ok(state.importSession);
  return state.importSession;
}
const publication = {
  candidates: [
    {
      sourceOrder: 0,
      itemType: 'analysis' as const,
      displayName: 'Italienisch.pgn - Italienisch',
    },
  ],
  folder: { kind: 'new' as const, displayName: 'Italienisch.pgn' },
  confirmWarnings: true,
};

test('opening import starts empty and does not fetch an import history', async (t) => {
  const { store } = await fixture({
    prepareImport: async () => assert.fail('opening is not file selection'),
  });
  t.after(() => store.close());
  await store.openImport();
  assert.deepEqual(session(store), { open: true });
});

test('file choice prepares one ephemeral preview, never a context destination or raw path in preparation', async (t) => {
  const requests: Parameters<PlysmithHostClient['prepareImport']>[0][] = [];
  const { store } = await fixture(
    {
      prepareImport: async (request) => {
        requests.push(request);
        return preview();
      },
    },
    undefined,
    { kind: 'context', contextId: '4' },
  );
  t.after(() => store.close());
  await store.openImport();
  await store.chooseImportFile();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    inputHandle: input.inputHandle,
    languageTag: 'de-DE',
  });
  assert.equal(session(store).preview?.previewId, previewId);
  assert.equal(session(store).input, undefined);
});

test('cancelled picker leaves the current preview untouched', async (t) => {
  let picks = 0;
  const { store } = await fixture({}, async () =>
    ++picks === 1 ? 'C:/input.pgn' : undefined,
  );
  t.after(() => store.close());
  await store.chooseImportFile();
  const before = session(store).preview;
  await store.chooseImportFile();
  assert.equal(session(store).preview, before);
});

test('Latin1 retry keeps only the input handle until the preview succeeds', async (t) => {
  const requests: Parameters<PlysmithHostClient['prepareImport']>[0][] = [];
  let registrations = 0;
  const { store } = await fixture({
    registerImportInput: async () => {
      ++registrations;
      return input;
    },
    prepareImport: async (request) => {
      requests.push(request);
      if (request.encoding !== 'iso-8859-1')
        throw problem('import.encoding_choice_required');
      return { ...preview(), encoding: 'iso-8859-1' };
    },
  });
  t.after(() => store.close());
  await store.chooseImportFile();
  assert.equal(session(store).errorCode, 'import.encoding_choice_required');
  assert.equal(session(store).input?.inputHandle, input.inputHandle);
  await store.retryImportAsLatin1();
  assert.equal(registrations, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.encoding, 'iso-8859-1');
  assert.equal(session(store).preview?.encoding, 'iso-8859-1');
  assert.equal(session(store).input, undefined);
});

test('closing discards the ephemeral preview and reopening cannot resume it', async (t) => {
  const discarded: string[] = [];
  const { store } = await fixture({
    discardImport: async (request) => {
      discarded.push(request.previewId);
      return { discarded: true };
    },
  });
  t.after(() => store.close());
  await store.chooseImportFile();
  await store.closeImport();
  assert.deepEqual(discarded, [previewId]);
  assert.deepEqual(session(store), { open: false });
  await store.openImport();
  assert.deepEqual(session(store), { open: true });
});

test('closing preparation cancels its input and suppresses late errors without clearing a newer command', async (t) => {
  const first = Promise.withResolvers<ImportPreview>();
  const second = Promise.withResolvers<ImportPreview>();
  const started = Promise.withResolvers<void>();
  const cancelled: string[] = [];
  let prepares = 0;
  const { store, diagnostics } = await fixture({
    prepareImport: async () => {
      if (++prepares === 1) {
        started.resolve();
        return first.promise;
      }
      return second.promise;
    },
    cancelImportPreparation: async ({ inputHandle }) => {
      cancelled.push(inputHandle);
      return { cancelled: true };
    },
  });
  t.after(() => store.close());
  const choosing = store.chooseImportFile();
  await started.promise;
  await store.closeImport();
  assert.deepEqual(cancelled, [input.inputHandle]);
  assert.deepEqual(session(store), { open: false });
  await store.openImport();
  const next = store.chooseImportFile();
  await new Promise((resolve) => setImmediate(resolve));
  first.reject(problem('import.interrupted'));
  await choosing;
  const current = store.getSnapshot();
  assert.ok(current.phase === 'ready');
  assert.equal(current.busyCommand, 'import_command');
  assert.equal(current.errorCode, undefined);
  assert.equal(session(store).errorCode, undefined);
  assert.equal(
    diagnostics.some((event) => event.problemCode === 'import.interrupted'),
    false,
  );
  second.resolve(preview());
  await next;
  assert.equal(session(store).preview?.previewId, previewId);
});

test('a late successful preparation is discarded after cancellation or lifecycle replacement', async (t) => {
  for (const restart of [false, true]) {
    const response = Promise.withResolvers<ImportPreview>();
    const started = Promise.withResolvers<void>();
    const discarded: string[] = [];
    const cancelled: string[] = [];
    const { store, replaceClient } = await fixture({
      prepareImport: async () => {
        started.resolve();
        return response.promise;
      },
      cancelImportPreparation: async ({ inputHandle }) => {
        cancelled.push(inputHandle);
        return { cancelled: false };
      },
      discardImport: async ({ previewId }) => {
        discarded.push(previewId);
        return { discarded: true };
      },
    });
    t.after(() => store.close());
    const choosing = store.chooseImportFile();
    await started.promise;
    if (restart) {
      replaceClient({
        discardImport: async () =>
          assert.fail('late preview belongs to the original client'),
      });
      await store.start();
    } else await store.closeImport();
    await store.openImport();
    response.resolve(preview());
    await choosing;
    assert.deepEqual(cancelled, [input.inputHandle]);
    assert.deepEqual(discarded, [previewId]);
    assert.deepEqual(session(store), { open: true });
  }
});

test('publication cannot be cancelled by closing the dialog', async (t) => {
  const response =
    Promise.withResolvers<
      Awaited<ReturnType<PlysmithHostClient['publishImport']>>
    >();
  const { store } = await fixture({
    publishImport: async () => response.promise,
    cancelImportPreparation: async () =>
      assert.fail('publication must remain atomic'),
  });
  t.after(() => store.close());
  await store.chooseImportFile();
  const publishing = store.publishImport(publication);
  await store.closeImport();
  assert.equal(session(store).open, true);
  assert.equal(session(store).preview?.previewId, previewId);
  response.resolve({ items: [], dataRevision: 0 });
  await publishing;
});

test('publication sends complete prefixed names and a folder, refreshes once, and creates no context association', async (t) => {
  const requests: Parameters<PlysmithHostClient['publishImport']>[0][] = [];
  const { store, refreshes } = await fixture(
    {
      publishImport: async (request) => {
        requests.push(request);
        return {
          items: [{ itemId: '11', revisionId: '12', sourceOrder: 0 }],
          folderId: '3',
          dataRevision: 0,
        };
      },
    },
    undefined,
    { kind: 'context', contextId: '4' },
  );
  t.after(() => store.close());
  await store.chooseImportFile();
  const before = refreshes();
  await store.publishImport(publication);
  assert.deepEqual(requests, [{ ...publication, previewId }]);
  assert.equal(refreshes(), before + 1);
  assert.equal(session(store).preview, undefined);
  assert.equal(session(store).completedCount, 1);
  const state = store.getSnapshot();
  assert.ok(state.phase === 'ready');
  assert.deepEqual(state.scope, { kind: 'context', contextId: '4' });
  assert.equal(state.inventoryContextOnly, false);
  assert.equal(state.busyCommand, undefined);
});

test('a current inventory name conflict retains the preview for correction without reporting completion', async (t) => {
  const { store } = await fixture({
    publishImport: async () => {
      throw problem('import.name_conflict');
    },
  });
  t.after(() => store.close());
  await store.chooseImportFile();
  await store.publishImport(publication);
  assert.equal(session(store).preview?.previewId, previewId);
  assert.equal(session(store).errorCode, 'import.name_conflict');
  assert.equal(session(store).completedCount, undefined);
});

test('late import publication cannot reopen or unlock a restarted store', async (t) => {
  const response =
    Promise.withResolvers<
      Awaited<ReturnType<PlysmithApplicationClient['publishImport']>>
    >();
  const started = Promise.withResolvers<void>();
  const later = Promise.withResolvers<ImportPreview>();
  let prepares = 0;
  const { store } = await fixture({
    publishImport: async () => {
      started.resolve();
      return response.promise;
    },
    prepareImport: async () => (++prepares === 1 ? preview() : later.promise),
  });
  t.after(() => store.close());
  await store.openImport();
  await store.chooseImportFile();
  const publishing = store.publishImport(publication);
  await started.promise;
  store.close();
  await store.start();
  await store.openImport();
  const choosing = store.chooseImportFile();
  await new Promise((resolve) => setImmediate(resolve));
  response.resolve({ items: [], dataRevision: 2 });
  await publishing;
  const current = store.getSnapshot();
  assert.equal(current.phase, 'ready');
  assert.equal(current.busyCommand, 'import_command');
  assert.equal(session(store).completedCount, undefined);
  later.resolve(preview());
  await choosing;
  assert.equal(session(store).preview?.previewId, previewId);
});

test('an old failed import refresh cannot report an error in the restarted lifecycle', async (t) => {
  const status = {
    state: 'ready' as const,
    persistence: { schemaVersion: 9, dataRevision: 0 },
    productRelease: '0.0.0',
    contractFingerprint: 'sha256:import-test',
  };
  const delayed = Promise.withResolvers<typeof status>();
  const refreshing = Promise.withResolvers<void>();
  let armed = false;
  const { store, diagnostics } = await fixture({
    getSystemStatus: async () => {
      if (!armed) return status;
      armed = false;
      refreshing.resolve();
      return delayed.promise;
    },
    prepareImport: async () => {
      throw problem('import.invalid_selection');
    },
  });
  t.after(() => store.close());
  armed = true;
  const failed = store.chooseImportFile();
  await refreshing.promise;
  store.close();
  const restarting = store.start();
  await new Promise((resolve) => setImmediate(resolve));
  delayed.resolve(status);
  await Promise.all([failed, restarting]);
  assert.equal(
    diagnostics.some(
      (event) =>
        event.eventCode === 'renderer.command.failed' &&
        event.problemCode === 'import.invalid_selection',
    ),
    false,
  );
  await store.refresh();
  const current = store.getSnapshot();
  assert.ok(current.phase === 'ready');
  assert.equal(current.errorCode, undefined);
});

test('name checking is a current inventory query independent of preview state', async (t) => {
  let checked: unknown;
  const { store } = await fixture({
    checkImportNames: async (request) => {
      checked = request;
      return {
        candidates: [
          {
            ...request.candidates[0]!,
            available: false,
            suggestedDisplayName: 'Italienisch.pgn - Italienisch (2)',
          },
        ],
        dataRevision: 2,
      };
    },
  });
  t.after(() => store.close());
  const result = await store.checkImportNames(publication.candidates);
  assert.deepEqual(checked, { candidates: publication.candidates });
  assert.equal(result.candidates[0]?.available, false);
  assert.equal(session(store).preview, undefined);
});

function branchedRecord(): AnalysisRecordDto {
  return {
    itemType: 'analysis',
    itemId: '1',
    revisionId: '2',
    currentRevisionId: '2',
    revisionNumber: 1,
    historical: false,
    rootAnchorId: '10',
    currentAnchorId: '10',
    displayName: 'Branches',
    languageTag: 'en-GB',
    origin: { kind: 'initial_position' },
    root,
    steps: [],
    cursor: 0,
    contributions: [],
    contextMember: false,
    tree: {
      nodes: [
        {
          nodeIndex: 0,
          parentNodeIndex: null,
          siblingOrder: 0,
          anchorId: '11',
          move: { from: 'e2', to: 'e4', san: 'e4' },
          after: root,
        },
        {
          nodeIndex: 1,
          parentNodeIndex: 0,
          siblingOrder: 0,
          anchorId: '12',
          move: { from: 'e7', to: 'e5', san: 'e5' },
          after: root,
        },
        {
          nodeIndex: 2,
          parentNodeIndex: 0,
          siblingOrder: 1,
          anchorId: '13',
          move: { from: 'c7', to: 'c5', san: 'c5' },
          after: root,
        },
        {
          nodeIndex: 3,
          parentNodeIndex: 2,
          siblingOrder: 0,
          anchorId: '14',
          move: { from: 'g1', to: 'f3', san: 'Nf3' },
          after: root,
        },
      ],
    },
  };
}

test('imported preview resolves a variation path and follows that branch rather than the main line', () => {
  const record = branchedRecord();
  const branch = chessTreePath(record, '13');
  assert.deepEqual(
    branch.steps.map((step) => step.anchorId),
    ['11', '13', '14'],
  );
  assert.equal(branch.cursor, 2);
  assert.deepEqual(
    chessTreePath(record, '10').steps.map((step) => step.anchorId),
    ['11', '12'],
  );
});

test('analysis retains its chosen imported branch across backward navigation and refresh, but never across another revision', async (t) => {
  let record = branchedRecord();
  let currentAnchorId = record.rootAnchorId;
  let resumeVersion = 1;
  const resume = () => ({
    resumeVersion,
    mode: 'analyze' as const,
    itemId: record.itemId,
    revisionId: record.revisionId,
    anchorId: currentAnchorId,
    currentPositionId: '1',
    updatedAt: time,
  });
  const { store } = await fixture({
    getAnalysisWorkspace: async (request) => {
      const anchorId = request.anchorId ?? currentAnchorId;
      return {
        scope: { kind: 'free' },
        dataRevision: 0,
        currentState: root,
        scratchHasChanges: false,
        legalMoves: [],
        allowedActions: [],
        record: {
          ...record,
          ...chessTreePath(record, anchorId),
          currentAnchorId: anchorId,
        },
      };
    },
    getWorkScopeWorkspace: async () => ({
      scope: { kind: 'free' },
      dataRevision: 0,
      analysisResume: resume(),
    }),
    setWorkScopeResume: async (request) => {
      assert.ok(request.area === 'analyze');
      currentAnchorId = request.anchorId ?? record.rootAnchorId;
      ++resumeVersion;
      return { area: 'analyze', resume: resume(), dataRevision: 0 };
    },
  });
  t.after(() => store.close());
  const selected = () => {
    const state = store.getSnapshot();
    assert.ok(state.phase === 'ready' && state.analysis.record);
    return state.analysis.record;
  };
  await store.openRecordAnchor('13');
  await store.openRecordAnchor('14');
  await store.openRecordAnchor('11', 'sequential');
  await store.refresh();
  assert.equal(selected().steps[selected().cursor]?.anchorId, '13');
  await store.openRecordAnchor('10', 'sequential');
  assert.deepEqual(
    selected().steps.map((step) => step.anchorId),
    ['11', '13', '14'],
  );
  await store.openRecordAnchor('11', 'sequential');
  await store.openRecordAnchor(
    selected().steps[selected().cursor]!.anchorId,
    'sequential',
  );
  assert.equal(selected().currentAnchorId, '13');
  await store.openRecordAnchor('12');
  await store.openRecordAnchor('10', 'sequential');
  assert.deepEqual(
    selected().steps.map((step) => step.anchorId),
    ['11', '12'],
  );
  await store.openRecordAnchor('13');
  await store.openRecordAnchor('10', 'sequential');
  record = {
    ...record,
    revisionId: '3',
    currentRevisionId: '3',
    revisionNumber: 2,
  };
  await store.refresh();
  assert.deepEqual(
    selected().steps.map((step) => step.anchorId),
    ['11', '12'],
  );
});
