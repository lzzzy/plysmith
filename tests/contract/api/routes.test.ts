import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApplicationProblem } from '../../../app/application/problems/application-problem.ts';
import { localId } from '../../../app/domain/identity/index.ts';
import { problemUriBase } from '../../../app/infrastructure/channels/api/problems.ts';
import {
  buildFixture,
  createFixture,
  headers,
  occurredAt,
} from './fixtures.ts';

const initialPosition = {
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

test('status includes the application read model and release handshake only', async (t) => {
  const diagnostics: unknown[] = [];
  const { host } = await buildFixture(t, {
    diagnostics: { write: (event) => diagnostics.push(event) },
  });
  const response = await host.inject({ url: '/status', headers });
  assert.deepEqual(response.json(), {
    state: 'ready',
    persistence: { schemaVersion: 1, dataRevision: 0 },
    productRelease: '0.0.0-test',
    contractFingerprint: 'test-contract-fingerprint',
  });
  assert.deepEqual(diagnostics, []);
});

test('engine provider mutation routes bind concrete instance id paths', async (t) => {
  const { host } = await buildFixture(t);
  for (const method of ['PUT', 'DELETE'] as const) {
    const response = await host.inject({
      method,
      url: '/engine-providers/configurations/stockfish-main',
      headers,
      payload: {},
    });
    assert.equal(response.statusCode, 400, method);
    assert.notEqual(response.json().code, 'request.not_found', method);
  }
});

test('engine provider configuration read serializes each closed provider variant', async (t) => {
  const providers = [
    {
      instanceId: 'stockfish-main',
      providerType: 'stockfish-uci' as const,
      displayName: 'Stockfish',
      executablePath: 'C:\\engines\\stockfish.exe',
      arguments: [],
      threads: 1,
      hashMb: 64,
      moveTimeMs: 500,
      startupTimeoutMs: 5_000,
      moveTimeoutMs: 10_000,
      stopTimeoutMs: 1_000,
      maxOutputBytes: 1_048_576,
      configurationRevision: `sha256:${'a'.repeat(64)}`,
      effectiveFingerprint: `sha256:${'b'.repeat(64)}`,
      restartRequired: false,
    },
    {
      instanceId: 'maia-1500',
      providerType: 'maia-chess' as const,
      displayName: 'Maia 1500',
      executablePath: 'C:\\engines\\lc0.exe',
      weightsPath: 'C:\\engines\\maia-1500.pb.gz',
      startupTimeoutMs: 30_000,
      moveTimeoutMs: 30_000,
      stopTimeoutMs: 1_000,
      maxOutputBytes: 1_048_576,
      configurationRevision: `sha256:${'c'.repeat(64)}`,
      effectiveFingerprint: `sha256:${'d'.repeat(64)}`,
      restartRequired: true,
    },
  ];
  const { host } = await buildFixture(t, {
    getEngineProviderConfigurations: {
      execute: async () => ({ providers }),
    },
  });

  const response = await host.inject({
    url: '/engine-providers/configurations',
    headers,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { providers });
});

test('Maia timeout validation matches the persisted provider schema', async (t) => {
  const { host } = await buildFixture(t);
  const response = await host.inject({
    method: 'POST',
    url: '/engine-providers/configuration-preview',
    headers,
    payload: {
      instanceId: 'maia-main',
      providerType: 'maia-chess',
      displayName: 'Maia',
      executablePath: 'C:\\engines\\lc0.exe',
      weightsPath: 'C:\\engines\\maia.pb.gz',
      startupTimeoutMs: 30_000,
      moveTimeoutMs: 90_000,
      stopTimeoutMs: 1_000,
      maxOutputBytes: 1_048_576,
    },
  });

  assert.equal(response.statusCode, 400);
});

test('context item removal binds both local ids and returns the removed relationship', async (t) => {
  const received: unknown[] = [];
  const { host } = await buildFixture(t, {
    removeContextItem: {
      execute: async (request) => {
        received.push(request);
        return {
          contextId: request.contextId,
          itemId: request.itemId,
          dataRevision: 6,
        };
      },
    },
  });

  const response = await host.inject({
    method: 'DELETE',
    url: '/working-contexts/2/items/7',
    headers,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    contextId: '2',
    itemId: '7',
    dataRevision: 6,
  });
  assert.deepEqual(received, [
    {
      contextId: localId('working-context', 2),
      itemId: localId('inventory-item', 7),
    },
  ]);
});

test('real application use cases preserve success, no-op and stale-write semantics', async (t) => {
  const { host, published } = await buildFixture(t);
  const initial = await host.inject({ url: '/preferences', headers });
  assert.equal(initial.json().uiLocale, 'de-DE');
  const noOp = await host.inject({
    method: 'PUT',
    url: '/preferences/ui-language',
    headers,
    payload: { uiLocale: 'de-DE', expectedRevision: 1 },
  });
  assert.deepEqual(noOp.json(), {
    changed: false,
    preferences: initial.json(),
  });
  assert.equal(published.length, 0);

  const changed = await host.inject({
    method: 'PUT',
    url: '/preferences/ui-language',
    headers,
    payload: { uiLocale: 'en-GB', expectedRevision: 1 },
  });
  assert.equal(changed.statusCode, 200);
  assert.deepEqual(changed.json(), {
    changed: true,
    preferences: {
      uiLocale: 'en-GB',
      preferenceRevision: 2,
      dataRevision: 1,
      updatedAt: occurredAt,
    },
  });
  assert.equal(published.length, 1);
  const stale = await host.inject({
    method: 'PUT',
    url: '/preferences/ui-language',
    headers,
    payload: { uiLocale: 'en-GB', expectedRevision: 1 },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, 'preference.revision_conflict');
  assert.deepEqual(stale.json().parameters, {
    expectedRevision: 1,
    currentRevision: 2,
  });
  assert.equal(published.length, 1);
});

test('diagnostic routes expose settings and manifest while keeping report targets write-only', async (t) => {
  const received: unknown[] = [];
  const { host } = await buildFixture(t, {
    setDiagnosticLogLevel: {
      execute: async (request) => {
        received.push(request);
        return {
          changed: true,
          settings: {
            configuredLevel: request.level,
            activeLevel: 'off',
            configurationRevision: `sha256:${'b'.repeat(64)}`,
            restartRequired: true,
          },
        };
      },
    },
    createDiagnosticReport: {
      execute: async (request) => {
        received.push(request);
        return {
          created: true,
          generatedAt: occurredAt,
          format: 'plysmith-diagnostics-json-gzip-v1',
          bytesWritten: 321,
          eventCount: 4,
          discardedLineCount: 1,
          truncated: false,
        };
      },
    },
  });

  const settings = await host.inject({ url: '/diagnostics/settings', headers });
  assert.equal(settings.statusCode, 200);
  assert.equal(settings.json().configuredLevel, 'off');
  const manifest = await host.inject({
    url: '/diagnostics/report-manifest',
    headers,
  });
  assert.equal(manifest.statusCode, 200);
  assert.equal(manifest.json().manifestVersion, 1);

  const changed = await host.inject({
    method: 'PUT',
    url: '/diagnostics/settings/log-level',
    headers,
    payload: {
      level: 'debug',
      expectedConfigurationRevision: `sha256:${'a'.repeat(64)}`,
    },
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.json().settings.restartRequired, true);

  const destinationPath = 'C:\\reports\\private-canary.json.gz';
  const created = await host.inject({
    method: 'POST',
    url: '/diagnostics/reports',
    headers,
    payload: { acceptedManifestVersion: 1, destinationPath },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.json().bytesWritten, 321);
  assert.ok(!created.body.includes('private-canary'));
  assert.deepEqual(received, [
    {
      level: 'debug',
      expectedConfigurationRevision: `sha256:${'a'.repeat(64)}`,
    },
    { acceptedManifestVersion: 1, destinationPath },
  ]);
});

test('diagnostic write schemas reject invalid and additional fields before application', async (t) => {
  let calls = 0;
  const unavailable = {
    execute: async () => {
      calls += 1;
      throw new Error('must not be called');
    },
  };
  const { host } = await buildFixture(t, {
    setDiagnosticLogLevel: unavailable,
    createDiagnosticReport: unavailable,
  });
  for (const scenario of [
    {
      url: '/diagnostics/settings/log-level',
      method: 'PUT',
      payload: {
        level: 'trace',
        expectedConfigurationRevision: `sha256:${'a'.repeat(64)}`,
      },
    },
    {
      url: '/diagnostics/settings/log-level',
      method: 'PUT',
      payload: {
        level: 'debug',
        expectedConfigurationRevision: 'CANARY',
      },
    },
    {
      url: '/diagnostics/reports',
      method: 'POST',
      payload: {
        acceptedManifestVersion: 2,
        destinationPath: 'C:\\CANARY.json.gz',
      },
    },
    {
      url: '/diagnostics/reports',
      method: 'POST',
      payload: {
        acceptedManifestVersion: 1,
        destinationPath: 'C:\\report.json.gz',
        extra: 'CANARY',
      },
    },
  ] as const) {
    const response = await host.inject({
      method: scenario.method,
      url: scenario.url,
      headers,
      payload: scenario.payload,
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'request.invalid');
    assert.ok(!response.body.includes('CANARY'));
  }
  assert.equal(calls, 0);
});

test('concurrent writes invoke the application once per request without retry', async (t) => {
  const { host, published } = await buildFixture(t);
  const results = await Promise.all(
    [1, 2].map(() =>
      host.inject({
        method: 'PUT',
        url: '/preferences/ui-language',
        headers,
        payload: { uiLocale: 'en-GB', expectedRevision: 1 },
      }),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.statusCode).sort(),
    [200, 409],
  );
  assert.equal(published.length, 1);
});

test('request schema rejects extras, coercion, invalid languages and invalid revisions before application', async (t) => {
  let calls = 0;
  const fixture = createFixture();
  const { host } = await buildFixture(t, {
    setUiLanguage: {
      execute: (request) => {
        calls++;
        return fixture.dependencies.setUiLanguage.execute(request);
      },
    },
  });
  for (const payload of [
    {},
    { uiLocale: 'en-GB' },
    { uiLocale: 'fr-FR', expectedRevision: 1 },
    { uiLocale: 'en-GB', expectedRevision: '1' },
    { uiLocale: 'en-GB', expectedRevision: 0 },
    { uiLocale: 'en-GB', expectedRevision: 1.5 },
    { uiLocale: 'en-GB', expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { uiLocale: 'en-GB', expectedRevision: 1, secret: 'CANARY' },
    { uiLocale: ['en-GB'], expectedRevision: 1 },
    [],
  ]) {
    const response = await host.inject({
      method: 'PUT',
      url: '/preferences/ui-language',
      headers,
      payload,
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'request.invalid');
    assert.ok(!response.body.includes('CANARY'));
    assert.ok(!response.body.includes('schemaPath'));
  }
  assert.equal(calls, 0);
  const query = await host.inject({
    url: '/preferences?unexpected=CANARY',
    headers,
  });
  assert.equal(query.statusCode, 400);
});

test('malformed JSON, missing routes, media type and oversized body use neutral problem details', async (t) => {
  const { host } = await buildFixture(t);
  const scenarios = [
    {
      url: '/preferences/ui-language',
      payload: '{CANARY',
      contentType: 'application/json',
      status: 400,
    },
    {
      url: '/preferences/ui-language',
      payload: 'CANARY',
      contentType: 'application/xml',
      status: 415,
    },
    {
      url: '/preferences/ui-language',
      payload: JSON.stringify({ data: 'CANARY'.repeat(4000) }),
      contentType: 'application/json',
      status: 413,
    },
  ];
  for (const scenario of scenarios) {
    const response = await host.inject({
      method: 'PUT',
      url: scenario.url,
      payload: scenario.payload,
      headers: { ...headers, 'content-type': scenario.contentType },
    });
    assert.equal(response.statusCode, scenario.status);
    assert.match(
      String(response.headers['content-type']),
      /^application\/problem\+json/,
    );
    assert.ok(!response.body.includes('CANARY'));
  }
  const missing = await host.inject({ url: '/CANARY?secret=CANARY', headers });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().code, 'request.not_found');
  assert.ok(!missing.body.includes('CANARY'));
});

for (const [code, status] of [
  ['preference.invalid_ui_language', 400],
  ['preference.invalid_revision', 400],
  ['preference.revision_conflict', 409],
  ['diagnostics.invalid_log_level', 400],
  ['diagnostics.invalid_configuration_revision', 400],
  ['diagnostics.configuration_conflict', 409],
  ['diagnostics.invalid_report_request', 400],
  ['diagnostics.invalid_report_target', 400],
  ['diagnostics.report_target_exists', 409],
  ['playout.invalid', 400],
  ['playout.not_found', 404],
  ['playout.revision_conflict', 409],
  ['playout.move_policy_unavailable', 409],
  ['playout.provider_unavailable', 503],
  ['playout.provider_protocol_error', 502],
  ['playout.provider_timeout', 504],
  ['playout.provider_resource_exhausted', 503],
  ['playout.capability_missing', 409],
  ['playout.illegal_engine_move', 502],
  ['playout.interrupted', 409],
  ['analysis.position_invalid_request', 400],
  ['analysis.position_invalid_focus', 409],
  ['analysis.position_provider_unavailable', 503],
  ['analysis.position_provider_protocol_error', 502],
  ['analysis.position_provider_timeout', 504],
  ['analysis.position_provider_resource_exhausted', 503],
  ['analysis.position_capability_missing', 409],
  ['analysis.position_illegal_engine_move', 502],
  ['analysis.position_interrupted', 409],
  ['analysis.invalid_setup', 400],
  ['inventory.invalid_revision', 400],
  ['inventory.revision_conflict', 409],
  ['inventory.preview_conflict', 409],
  ['workspace.impact_not_found', 404],
  ['workspace.impact_conflict', 409],
  ['workspace.invalid_impact_resolution', 400],
  ['unknown.CANARY', 500],
] as const) {
  test(`application problem ${code} maps without exposing its message or arbitrary parameters`, async (t) => {
    const { host } = await buildFixture(t, {
      setUiLanguage: {
        execute: async () => {
          throw new ApplicationProblem(code, 'C:/secret/CANARY', {
            secret: 'CANARY',
            expectedRevision: 1,
            currentRevision: 3,
          });
        },
      },
    });
    const response = await host.inject({
      method: 'PUT',
      url: '/preferences/ui-language',
      headers,
      payload: { uiLocale: 'en-GB', expectedRevision: 1 },
    });
    assert.equal(response.statusCode, status);
    const body = response.json();
    assert.equal(body.code, status === 500 ? 'host.failure' : code);
    assert.equal(body.type, `${problemUriBase}${body.code}.md`);
    assert.equal(body.correlationId, 'test-correlation');
    assert.equal(body.instance, 'urn:plysmith:problem:test-correlation');
    assert.equal(body.retryable, false);
    assert.ok(!response.body.includes('CANARY'));
    assert.deepEqual(
      body.parameters,
      code === 'preference.revision_conflict'
        ? { expectedRevision: 1, currentRevision: 3 }
        : {},
    );
  });
}

test('unexpected exceptions receive one injected correlation and no internal detail', async (t) => {
  let correlations = 0;
  const { host } = await buildFixture(t, {
    getSystemStatus: {
      execute: async () => {
        throw new Error('CANARY secret stack path');
      },
    },
    correlationIdFactory: () => `correlation-${++correlations}`,
  });
  const response = await host.inject({ url: '/status', headers });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().code, 'host.failure');
  assert.equal(response.json().correlationId, 'correlation-1');
  assert.equal(correlations, 1);
  assert.ok(!response.body.includes('CANARY'));
});

test('host problems and request diagnostics preserve the client correlation', async (t) => {
  const diagnostics: unknown[] = [];
  const { host } = await buildFixture(t, {
    getSystemStatus: {
      execute: async () => {
        throw new Error('CANARY request content');
      },
    },
    diagnostics: { write: (event) => diagnostics.push(event) },
  });

  const response = await host.inject({
    url: '/status',
    headers: {
      ...headers,
      'x-plysmith-correlation-id': 'client-correlation-7',
    },
  });

  assert.equal(response.json().correlationId, 'client-correlation-7');
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0], {
    level: 'error',
    eventCode: 'host.request.completed',
    correlationId: 'client-correlation-7',
    operation: 'GetSystemStatus',
    status: 'failed',
    problemCode: 'host.failure',
    statusCode: 500,
    durationMilliseconds: (diagnostics[0] as { durationMilliseconds: number })
      .durationMilliseconds,
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /CANARY/);
});

test('analysis query rejects inconsistent scopes and incomplete previews before application', async (t) => {
  let calls = 0;
  const { host } = await buildFixture(t, {
    getAnalysisWorkspace: {
      execute: async () => {
        calls += 1;
        throw new Error('must not be called');
      },
    },
  });
  for (const url of [
    '/analysis/workspace?scopeKind=context',
    '/analysis/workspace?scopeKind=free&contextId=1',
    '/analysis/workspace?scopeKind=free&itemId=1',
    '/analysis/workspace?scopeKind=free&itemId=1&revisionId=1',
    '/analysis/workspace?scopeKind=context&contextId=9999999999999999',
  ]) {
    const response = await host.inject({ url, headers });
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json().code, 'request.invalid');
  }
  assert.equal(calls, 0);
});

test('analysis setup validation is read-only and returns stable issues', async (t) => {
  let received: unknown;
  const { host } = await buildFixture(t, {
    validateAnalysisSetup: {
      execute: async (request) => {
        received = request;
        return {
          valid: false as const,
          issues: [{ code: 'invalid_fen' as const, field: 'fen' as const }],
        };
      },
    },
  });
  const response = await host.inject({
    method: 'POST',
    url: '/analysis/setup-validation',
    headers,
    payload: { input: { kind: 'fen', fen: 'invalid' } },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, { input: { kind: 'fen', fen: 'invalid' } });
  assert.deepEqual(response.json(), {
    valid: false,
    issues: [{ code: 'invalid_fen', field: 'fen' }],
  });
});

test('position analysis routes preserve provider capabilities and the exact focus', async (t) => {
  let received: unknown;
  const provider = {
    instanceId: 'stockfish-main',
    providerType: 'stockfish-uci',
    displayName: 'Stockfish',
    capability: 'objective_position_analysis' as const,
    readiness: 'ready' as const,
    status: 'available' as const,
  };
  const { host } = await buildFixture(t, {
    listPositionAnalysisProviders: { execute: () => [provider] },
    analyzePosition: {
      execute: async (request) => {
        received = request;
        return {
          kind: 'objective' as const,
          perspective: 'white' as const,
          focusKey: request.focus.focusKey,
          providerInstanceId: provider.instanceId,
          providerDisplayName: provider.displayName,
          historyCompleteness: 'complete' as const,
          budget: 'fast' as const,
          rootWdl: {
            wins: 430,
            draws: 400,
            losses: 170,
            perspective: 'white' as const,
            semantics: 'stockfish_selfplay' as const,
          },
          candidates: [],
          search: {
            limiter: { kind: 'movetime' as const, value: 300 },
            depth: 12,
          },
        };
      },
    },
  });
  const listed = await host.inject({ url: '/analysis/providers', headers });
  const request = {
    consumerId: 'desktop-test',
    laneId: 'objective',
    providerInstanceId: provider.instanceId,
    candidateCount: 5,
    focus: {
      focusKey: 'initial',
      root: initialPosition,
      moves: [],
      current: initialPosition,
    },
    mode: {
      kind: 'objective' as const,
      budget: 'fast' as const,
      rootMoves: [{ from: 'e2' as const, to: 'e4' as const, san: 'e4' }],
    },
  };
  const analyzed = await host.inject({
    method: 'POST',
    url: '/analysis/position',
    headers,
    payload: request,
  });

  assert.deepEqual(listed.json(), { providers: [provider] });
  assert.equal(analyzed.statusCode, 200);
  assert.deepEqual(received, request);
  assert.deepEqual(analyzed.json(), {
    kind: 'objective',
    perspective: 'white',
    focusKey: 'initial',
    providerInstanceId: 'stockfish-main',
    providerDisplayName: 'Stockfish',
    historyCompleteness: 'complete',
    budget: 'fast',
    rootWdl: {
      wins: 430,
      draws: 400,
      losses: 170,
      perspective: 'white',
      semantics: 'stockfish_selfplay',
    },
    candidates: [],
    search: { limiter: { kind: 'movetime', value: 300 }, depth: 12 },
  });
  for (const rootMoves of [
    [],
    Array.from({ length: 9 }, () => request.mode.rootMoves[0]),
  ]) {
    const rejected = await host.inject({
      method: 'POST',
      url: '/analysis/position',
      headers,
      payload: { ...request, mode: { ...request.mode, rootMoves } },
    });
    assert.equal(rejected.statusCode, 400);
  }
});

test('terminal Maia analysis needs no model WDL', async (t) => {
  const { host } = await buildFixture(t, {
    analyzePosition: {
      execute: async () => ({
        kind: 'human_policy' as const,
        focusKey: 'terminal',
        providerInstanceId: 'maia-1800',
        providerDisplayName: 'Maia 1800',
        historyCompleteness: 'unknown' as const,
        profileName: 'Maia 1800',
        modelName: 'maia-1800.pb.gz',
        candidates: [],
      }),
    },
  });
  const response = await host.inject({
    method: 'POST',
    url: '/analysis/position',
    headers,
    payload: {
      consumerId: 'desktop-test',
      laneId: 'human-maia-1800',
      providerInstanceId: 'maia-1800',
      candidateCount: 5,
      focus: {
        focusKey: 'terminal',
        root: initialPosition,
        moves: [],
        current: initialPosition,
      },
      mode: { kind: 'human_policy' },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    kind: 'human_policy',
    focusKey: 'terminal',
    providerInstanceId: 'maia-1800',
    providerDisplayName: 'Maia 1800',
    historyCompleteness: 'unknown',
    profileName: 'Maia 1800',
    modelName: 'maia-1800.pb.gz',
    candidates: [],
  });
});

test('analysis note route maps explicit source and visibility ids without transport leakage', async (t) => {
  let received: unknown;
  const { host } = await buildFixture(t, {
    createAnalysisNote: {
      execute: async (request) => {
        received = request;
        return {
          contributionId: localId('contribution', 4),
          itemId: localId('inventory-item', 2),
          revisionId: localId('item-revision', 3),
          anchorId: localId('anchor', 5),
          scopeKind: 'context',
          contextId: localId('working-context', 1),
          resumeUpdate: {
            contextId: localId('working-context', 1),
            resumeVersion: 7,
          },
          dataRevision: 9,
        };
      },
    },
  });
  const response = await host.inject({
    method: 'POST',
    url: '/analysis/notes',
    headers,
    payload: {
      scope: { kind: 'context', contextId: '1' },
      expectedScratchId: 'scratch-6',
      expectedScratchRevision: 6,
      languageTag: 'de-DE',
      noteScope: { kind: 'context', contextId: '1' },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, {
    scope: { kind: 'context', contextId: localId('working-context', 1) },
    expectedScratchId: 'scratch-6',
    expectedScratchRevision: 6,
    languageTag: 'de-DE',
    noteScope: {
      kind: 'context',
      contextId: localId('working-context', 1),
    },
  });
  assert.deepEqual(response.json(), {
    contributionId: '4',
    itemId: '2',
    revisionId: '3',
    anchorId: '5',
    scopeKind: 'context',
    contextId: '1',
    resumeUpdate: { contextId: '1', resumeVersion: 7 },
    dataRevision: 9,
  });
});

test('position note routes map exact anchors and optimistic note revisions', async (t) => {
  const received: unknown[] = [];
  const result = {
    contributionId: localId('contribution', 4),
    itemId: localId('inventory-item', 2),
    anchorId: localId('anchor', 5),
    contributionVersion: 2,
    dataRevision: 9,
  };
  const { host } = await buildFixture(t, {
    createPositionNote: {
      execute: async (request) => {
        received.push(request);
        return { ...result, contributionVersion: 1 };
      },
    },
    updateAnalysisNote: {
      execute: async (request) => {
        received.push(request);
        return result;
      },
    },
    deleteAnalysisNote: {
      execute: async (request) => {
        received.push(request);
        return { ...result, contributionVersion: 3 };
      },
    },
  });
  const scope = { kind: 'context', contextId: '1' } as const;
  const created = await host.inject({
    method: 'POST',
    url: '/analysis/position-notes',
    headers,
    payload: {
      scope,
      itemId: '2',
      revisionId: '3',
      anchorId: '5',
      body: 'Nach e4',
      languageTag: 'de-DE',
      noteScope: { kind: 'context', contextId: '1' },
    },
  });
  const updated = await host.inject({
    method: 'PATCH',
    url: '/analysis/notes/4',
    headers,
    payload: { scope, expectedContributionVersion: 1, body: 'Nach e4!' },
  });
  const deleted = await host.inject({
    method: 'DELETE',
    url: '/analysis/notes/4',
    headers,
    payload: { scope, expectedContributionVersion: 2 },
  });

  assert.deepEqual(received, [
    {
      scope: { kind: 'context', contextId: localId('working-context', 1) },
      itemId: localId('inventory-item', 2),
      revisionId: localId('item-revision', 3),
      anchorId: localId('anchor', 5),
      body: 'Nach e4',
      languageTag: 'de-DE',
      noteScope: {
        kind: 'context',
        contextId: localId('working-context', 1),
      },
    },
    {
      scope: { kind: 'context', contextId: localId('working-context', 1) },
      contributionId: localId('contribution', 4),
      expectedContributionVersion: 1,
      body: 'Nach e4!',
    },
    {
      scope: { kind: 'context', contextId: localId('working-context', 1) },
      contributionId: localId('contribution', 4),
      expectedContributionVersion: 2,
    },
  ]);
  assert.deepEqual(created.json(), {
    contributionId: '4',
    itemId: '2',
    anchorId: '5',
    contributionVersion: 1,
    dataRevision: 9,
  });
  assert.equal(updated.json().contributionVersion, 2);
  assert.equal(deleted.json().contributionVersion, 3);
});

test('inventory revision write routes preserve scope, identity and preview binding', async (t) => {
  const received: unknown[] = [];
  const scratch = {
    scratchId: 'revision-scratch-1',
    scratchRevision: 2,
    origin: {
      kind: 'inventory_anchor' as const,
      itemId: localId('inventory-item', 2),
      revisionId: localId('item-revision', 3),
      anchorId: localId('anchor', 5),
    },
    intent: {
      kind: 'inventory_revision' as const,
      mode: 'replace_move' as const,
      itemId: localId('inventory-item', 2),
      baseRevisionId: localId('item-revision', 3),
      cutAnchorId: localId('anchor', 5),
      returnAnchorId: localId('anchor', 6),
      displayName: 'French Defence',
      summary: 'Replace the second move.',
    },
    root: initialPosition,
    steps: [],
    cursor: 0,
  };
  const fingerprint = `sha256:${'a'.repeat(64)}`;
  const { host } = await buildFixture(t, {
    startInventoryRevision: {
      execute: async (request) => {
        received.push(['start', request]);
        return { scratch, dataRevision: 7, resumeVersion: 4 };
      },
    },
    promoteAnalysisToInventoryRevision: {
      execute: async (request) => {
        received.push(['promote', request]);
        return { scratch, dataRevision: 7, resumeVersion: 4 };
      },
    },
    previewInventoryRevision: {
      execute: async (request) => {
        received.push(['preview', request]);
        return {
          itemId: localId('inventory-item', 2),
          baseRevisionId: localId('item-revision', 3),
          mode: 'replace_move',
          displayName: 'French Defence',
          summary: 'Replace the second move.',
          preservedMoveCount: 1,
          addedSteps: [],
          removedSteps: [],
          historicalGlobalContributionCount: 1,
          affectedContexts: [
            {
              contextId: localId('working-context', 1),
              contextName: 'Black repertoire',
              referenceCount: 1,
              contributionCount: 2,
              managementResumeCount: 0,
              analysisResumeCount: 1,
            },
          ],
          followingContexts: [],
          noOp: false,
          previewFingerprint: fingerprint,
          dataRevision: 7,
        };
      },
    },
    saveInventoryRevision: {
      execute: async (request) => {
        received.push(['save', request]);
        return {
          itemId: localId('inventory-item', 2),
          revisionId: localId('item-revision', 8),
          revisionNumber: 2,
          currentAnchorId: localId('anchor', 9),
          impacts: [
            {
              impactId: localId('revision-impact', 10),
              contextId: localId('working-context', 1),
            },
          ],
          noOp: false,
          dataRevision: 8,
        };
      },
    },
  });

  const started = await host.inject({
    method: 'POST',
    url: '/inventory/items/2/revision-edits',
    headers,
    payload: {
      scope: { kind: 'context', contextId: '1' },
      baseRevisionId: '3',
      anchorId: '5',
      mode: 'replace_move',
      expectedScratchId: null,
      expectedScratchRevision: null,
      displayName: 'French Defence',
      summary: 'Replace the second move.',
      firstMove: { kind: 'notation', value: 'd4', locale: 'de-DE' },
    },
  });
  const previewed = await host.inject({
    method: 'POST',
    url: '/inventory/revision-edits/preview',
    headers,
    payload: {
      scope: { kind: 'context', contextId: '1' },
      expectedScratchId: 'revision-scratch-1',
      expectedScratchRevision: 2,
    },
  });
  const promoted = await host.inject({
    method: 'POST',
    url: '/inventory/items/2/revision-edits/promote-analysis',
    headers,
    payload: {
      scope: { kind: 'context', contextId: '1' },
      baseRevisionId: '3',
      anchorId: '5',
      expectedScratchId: 'exploration-scratch-1',
      expectedScratchRevision: 3,
    },
  });
  const saved = await host.inject({
    method: 'POST',
    url: '/inventory/revision-edits/save',
    headers,
    payload: {
      scope: { kind: 'context', contextId: '1' },
      expectedScratchId: 'revision-scratch-1',
      expectedScratchRevision: 2,
      previewFingerprint: fingerprint,
    },
  });

  assert.equal(started.statusCode, 200);
  assert.equal(started.json().scratch.intent.itemId, '2');
  assert.equal(started.json().resumeVersion, 4);
  assert.equal(previewed.statusCode, 200);
  assert.equal(previewed.json().affectedContexts[0].contextId, '1');
  assert.equal(promoted.statusCode, 200);
  assert.equal(promoted.json().scratch.intent.kind, 'inventory_revision');
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().impacts, [{ impactId: '10', contextId: '1' }]);
  assert.deepEqual(received, [
    [
      'start',
      {
        scope: {
          kind: 'context',
          contextId: localId('working-context', 1),
        },
        itemId: localId('inventory-item', 2),
        baseRevisionId: localId('item-revision', 3),
        anchorId: localId('anchor', 5),
        mode: 'replace_move',
        expectedScratchId: null,
        expectedScratchRevision: null,
        displayName: 'French Defence',
        summary: 'Replace the second move.',
        firstMove: { kind: 'notation', value: 'd4', locale: 'de-DE' },
      },
    ],
    [
      'preview',
      {
        scope: {
          kind: 'context',
          contextId: localId('working-context', 1),
        },
        expectedScratchId: 'revision-scratch-1',
        expectedScratchRevision: 2,
      },
    ],
    [
      'promote',
      {
        scope: {
          kind: 'context',
          contextId: localId('working-context', 1),
        },
        itemId: localId('inventory-item', 2),
        baseRevisionId: localId('item-revision', 3),
        anchorId: localId('anchor', 5),
        expectedScratchId: 'exploration-scratch-1',
        expectedScratchRevision: 3,
      },
    ],
    [
      'save',
      {
        scope: {
          kind: 'context',
          contextId: localId('working-context', 1),
        },
        expectedScratchId: 'revision-scratch-1',
        expectedScratchRevision: 2,
        previewFingerprint: fingerprint,
      },
    ],
  ]);
});

test('inventory revision reads and impact routes preserve historical and resolution semantics', async (t) => {
  const received: unknown[] = [];
  const { host } = await buildFixture(t, {
    getInventoryRevision: {
      execute: async (request) => {
        received.push(['get-revision', request]);
        return {
          itemType: 'analysis' as const,
          itemId: localId('inventory-item', 2),
          revisionId: localId('item-revision', 3),
          currentRevisionId: localId('item-revision', 8),
          revisionNumber: 1,
          rootAnchorId: localId('anchor', 4),
          currentAnchorId: localId('anchor', 5),
          displayName: 'French Defence',
          summary: 'Historical line.',
          languageTag: 'de-DE',
          origin: { kind: 'initial_position' },
          root: initialPosition,
          steps: [],
          cursor: 0,
          contributions: [],
          contextMember: true,
          readOnlyPreview: true,
          historical: true,
        };
      },
    },
    listInventoryRevisions: {
      execute: async (request) => {
        received.push(['list-revisions', request]);
        return {
          revisions: [
            {
              itemId: localId('inventory-item', 2),
              revisionId: localId('item-revision', 8),
              revisionNumber: 2,
              baseRevisionId: localId('item-revision', 3),
              displayName: 'French Defence',
              changeKind: 'replace_move',
              createdAt: occurredAt,
              current: true,
            },
          ],
          nextCursor: 'revision-page-2',
          dataRevision: 8,
        };
      },
    },
    getPendingRevisionImpact: {
      execute: async (request) => {
        received.push(['get-impact', request]);
        return {
          impactId: localId('revision-impact', 10),
          contextId: localId('working-context', 1),
          contextName: 'Black repertoire',
          itemId: localId('inventory-item', 2),
          pinnedRevisionId: localId('item-revision', 3),
          targetRevisionId: localId('item-revision', 8),
          targetAnchorId: localId('anchor', 9),
          impactVersion: 1,
          referenceCount: 1,
          contributionCount: 0,
          managementResumeAffected: false,
          analysisResumeAffected: false,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        };
      },
    },
    resolvePendingRevisionImpact: {
      execute: async (request) => {
        received.push(['resolve-impact', request]);
        return {
          impactId: localId('revision-impact', 10),
          contextId: localId('working-context', 1),
          itemId: localId('inventory-item', 2),
          resolution: 'use_target',
          contextItemId: localId('inventory-item', 2),
          contextRevisionId: localId('item-revision', 8),
          dataRevision: 9,
        };
      },
    },
  });

  const revision = await host.inject({
    url: '/inventory/items/2/revisions/3?scopeKind=context&contextId=1&anchorId=5',
    headers,
  });
  const revisions = await host.inject({
    url: '/inventory/items/2/revisions?pageSize=20&cursor=revision-page-1',
    headers,
  });
  const impact = await host.inject({
    url: '/workspace/revision-impacts/10',
    headers,
  });
  const resolved = await host.inject({
    method: 'POST',
    url: '/workspace/revision-impacts/10/resolution',
    headers,
    payload: {
      expectedImpactVersion: 1,
      resolution: { kind: 'use_target' },
    },
  });

  assert.equal(revision.statusCode, 200);
  assert.equal(revision.json().historical, true);
  assert.equal(revision.json().currentRevisionId, '8');
  assert.equal(revisions.statusCode, 200);
  assert.equal(revisions.json().nextCursor, 'revision-page-2');
  assert.equal(impact.statusCode, 200);
  assert.equal(impact.json().targetAnchorId, '9');
  assert.equal(resolved.statusCode, 200);
  assert.deepEqual(received, [
    [
      'get-revision',
      {
        scope: {
          kind: 'context',
          contextId: localId('working-context', 1),
        },
        itemId: localId('inventory-item', 2),
        revisionId: localId('item-revision', 3),
        anchorId: localId('anchor', 5),
      },
    ],
    [
      'list-revisions',
      {
        itemId: localId('inventory-item', 2),
        pageSize: 20,
        cursor: 'revision-page-1',
      },
    ],
    ['get-impact', { impactId: localId('revision-impact', 10) }],
    [
      'resolve-impact',
      {
        impactId: localId('revision-impact', 10),
        expectedImpactVersion: 1,
        resolution: { kind: 'use_target' },
      },
    ],
  ]);
});

test('iteration-two application problems keep stable status and zero revision sentinels', async (t) => {
  const { host } = await buildFixture(t, {
    updateAnalysisScratch: {
      execute: async () => {
        throw new ApplicationProblem(
          'analysis.scratch_revision_conflict',
          'CANARY private detail',
          { expectedRevision: 0, currentRevision: 3, secret: 'CANARY' },
        );
      },
    },
  });
  const response = await host.inject({
    method: 'PUT',
    url: '/analysis/scratch',
    headers,
    payload: {
      scope: { kind: 'free' },
      expectedScratchId: 'scratch-1',
      expectedScratchRevision: 1,
      action: { kind: 'discard' },
    },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, 'analysis.scratch_revision_conflict');
  assert.deepEqual(response.json().parameters, {
    expectedRevision: 0,
    currentRevision: 3,
  });
  assert.ok(!response.body.includes('CANARY'));
});

test('explicit DTOs and response schemas prevent nested and top-level response leakage', async (t) => {
  const preferences = {
    uiLocale: 'de-DE' as const,
    preferenceRevision: 1,
    dataRevision: 0,
    updatedAt: occurredAt,
    secret: 'CANARY',
  };
  const { host } = await buildFixture(t, {
    getSystemStatus: {
      execute: async () => ({
        state: 'ready',
        secret: 'CANARY',
        persistence: {
          schemaVersion: 1,
          dataRevision: 0,
          databasePath: 'CANARY',
        },
      }),
    },
    getUserPreferences: { execute: async () => preferences },
    setUiLanguage: {
      execute: async () => ({ changed: false, preferences, token: 'CANARY' }),
    },
  });
  for (const [method, url] of [
    ['GET', '/status'],
    ['GET', '/preferences'],
    ['PUT', '/preferences/ui-language'],
  ] as const) {
    const response = await host.inject({
      method,
      url,
      headers,
      ...(method === 'PUT'
        ? { payload: { uiLocale: 'de-DE', expectedRevision: 1 } }
        : {}),
    });
    assert.equal(response.statusCode, 200);
    assert.ok(!response.body.includes('CANARY'));
  }
});
