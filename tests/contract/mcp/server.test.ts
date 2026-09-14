import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CallToolResultSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import {
  assertNeutralProblem,
  assertToolData,
  connectMcp,
  diagnosticReportManifest,
  diagnosticSettings,
  preferences,
  revisionConflict,
  systemStatus,
} from './helpers.ts';

test('MCP advertises the explicit twenty-tool allowlist and two fixed resources', async (t) => {
  const { client, calls } = await connectMcp(t);
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      'get_system_status',
      'get_user_preferences',
      'get_diagnostic_settings',
      'set_diagnostic_log_level',
      'get_diagnostic_report_manifest',
      'create_diagnostic_report',
      'set_ui_language',
      'get_analysis_workspace',
      'update_analysis_scratch',
      'create_analysis_record',
      'create_analysis_note',
      'create_position_note',
      'update_analysis_note',
      'delete_analysis_note',
      'search_inventory',
      'list_working_contexts',
      'get_working_context_workspace',
      'create_working_context',
      'add_context_reference',
      'set_work_scope_resume',
    ],
  );
  assert.deepEqual(client.getServerCapabilities(), {
    tools: {},
    resources: {},
  });
  const languageTool = tools.find((tool) => tool.name === 'set_ui_language');
  assert.deepEqual(JSON.parse(JSON.stringify(languageTool?.inputSchema)), {
    type: 'object',
    additionalProperties: false,
    required: ['uiLocale', 'expectedRevision'],
    properties: {
      uiLocale: {
        anyOf: [
          { const: 'de-DE', type: 'string' },
          { const: 'en-GB', type: 'string' },
        ],
      },
      expectedRevision: {
        type: 'integer',
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
      },
    },
  });
  assert.equal(tools[0]?.annotations?.readOnlyHint, true);
  assert.equal(tools[1]?.annotations?.readOnlyHint, true);
  assert.equal(languageTool?.annotations?.readOnlyHint, false);
  assert.equal(languageTool?.annotations?.idempotentHint, false);
  assert.equal(
    tools.find((tool) => tool.name === 'get_diagnostic_settings')?.annotations
      ?.readOnlyHint,
    true,
  );
  assert.equal(
    tools.find((tool) => tool.name === 'create_diagnostic_report')?.annotations
      ?.idempotentHint,
    false,
  );
  const { resources } = await client.listResources();
  assert.deepEqual(
    resources.map(({ uri, mimeType }) => ({ uri, mimeType })),
    [
      { uri: 'plysmith://system/status', mimeType: 'application/json' },
      { uri: 'plysmith://user/preferences', mimeType: 'application/json' },
    ],
  );
  assert.deepEqual(calls, []);
});

for (const [name, uri, expected, method] of [
  [
    'get_system_status',
    'plysmith://system/status',
    systemStatus,
    'getSystemStatus',
  ],
  [
    'get_user_preferences',
    'plysmith://user/preferences',
    preferences,
    'getUserPreferences',
  ],
] as const) {
  test(`${name} and its resource read the same host query without caching`, async (t) => {
    const { client, calls } = await connectMcp(t);
    const result = await client.callTool({ name });
    assert.notEqual(result.isError, true);
    assertToolData(result, expected);
    const resource = await client.readResource({ uri });
    assert.deepEqual(resource.contents, [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(expected, null, 2),
      },
    ]);
    await client.callTool({ name, arguments: {} });
    assert.deepEqual(calls, [{ method }, { method }, { method }]);
  });
}

test('set_ui_language forwards both locales and positive safe revisions exactly once', async (t) => {
  const { client, calls } = await connectMcp(t);
  for (const request of [
    { uiLocale: 'en-GB', expectedRevision: 1 },
    { uiLocale: 'de-DE', expectedRevision: 2 },
    { uiLocale: 'en-GB', expectedRevision: Number.MAX_SAFE_INTEGER },
  ]) {
    const result = await client.callTool({
      name: 'set_ui_language',
      arguments: request,
    });
    assert.notEqual(result.isError, true);
    assertToolData(result, {
      changed: true,
      preferences: { ...preferences, uiLocale: request.uiLocale },
    });
    assert.deepEqual(calls.at(-1), { method: 'setUiLanguage', request });
  }
  assert.equal(calls.length, 3);
});

test('diagnostic tools preserve manifest consent and execute each write once', async (t) => {
  const { client, calls } = await connectMcp(t);

  const settings = await client.callTool({ name: 'get_diagnostic_settings' });
  assertToolData(settings, diagnosticSettings);

  const levelRequest = {
    level: 'info' as const,
    expectedConfigurationRevision: diagnosticSettings.configurationRevision,
  };
  const level = await client.callTool({
    name: 'set_diagnostic_log_level',
    arguments: levelRequest,
  });
  assertToolData(level, {
    changed: true,
    settings: { ...diagnosticSettings, configuredLevel: 'info' },
  });

  const manifest = await client.callTool({
    name: 'get_diagnostic_report_manifest',
  });
  assertToolData(manifest, diagnosticReportManifest);

  const reportRequest = {
    acceptedManifestVersion: 1 as const,
    destinationPath: 'C:\\reports\\private-canary.json.gz',
  };
  const report = await client.callTool({
    name: 'create_diagnostic_report',
    arguments: reportRequest,
  });
  assertToolData(report, {
    created: true,
    generatedAt: '2026-09-14T08:00:00.000Z',
    format: 'plysmith-diagnostics-json-gzip-v1',
    bytesWritten: 321,
    eventCount: 4,
    discardedLineCount: 1,
    truncated: false,
  });
  assert.doesNotMatch(JSON.stringify(report), /private-canary/);
  assert.deepEqual(calls, [
    { method: 'getDiagnosticSettings' },
    { method: 'setDiagnosticLogLevel', request: levelRequest },
    { method: 'getDiagnosticReportManifest' },
    { method: 'createDiagnosticReport', request: reportRequest },
  ]);
});

test('invalid diagnostic writes never reach the host or echo their arguments', async (t) => {
  const { client, calls } = await connectMcp(t);
  for (const [name, arguments_] of [
    [
      'set_diagnostic_log_level',
      {
        level: 'trace',
        expectedConfigurationRevision: diagnosticSettings.configurationRevision,
      },
    ],
    [
      'set_diagnostic_log_level',
      { level: 'debug', expectedConfigurationRevision: 'secret-canary' },
    ],
    [
      'create_diagnostic_report',
      {
        acceptedManifestVersion: 2,
        destinationPath: 'C:\\secret-canary.json.gz',
      },
    ],
    [
      'create_diagnostic_report',
      {
        acceptedManifestVersion: 1,
        destinationPath: 'C:\\report.json.gz',
        extra: 'secret-canary',
      },
    ],
  ] as const) {
    const result = await client.callTool({ name, arguments: arguments_ });
    assert.equal(result.isError, true);
    assert.equal(
      (result.structuredContent as { code: string }).code,
      'request.invalid',
    );
    assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
  }
  assert.deepEqual(calls, []);
});

test('no-op and committed revision metadata are returned without alteration', async (t) => {
  const noOp = { changed: false, preferences };
  const { client, calls } = await connectMcp(t, {
    setUiLanguage: async () => noOp,
  });
  const result = await client.callTool({
    name: 'set_ui_language',
    arguments: { uiLocale: 'de-DE', expectedRevision: 1 },
  });
  assertToolData(result, noOp);
  assert.equal(calls.length, 1);
});

test('analysis, inventory and workspace tools forward explicit host requests once', async (t) => {
  const timestamp = '2026-09-11T12:00:00.000Z';
  const state = {
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
      positionKey: 'standardChess|initial',
    },
    playState: {
      halfmoveClock: 0,
      fullmoveNumber: 1,
      historyKnowledge: 'complete' as const,
    },
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  };
  const context = {
    contextId: '1',
    displayName: 'Mein Repertoire',
    purpose: 'Eröffnungen ausbauen',
    lifecycle: 'active' as const,
    contextVersion: 1,
    referenceCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const reference = {
    referenceId: '1',
    itemId: '1',
    currentRevisionId: '1',
    itemType: 'analysis' as const,
    displayName: 'Erste Analyse',
    anchorId: '1',
    anchorKind: 'item' as const,
    createdAt: timestamp,
  };
  const { client, calls } = await connectMcp(t, {
    getAnalysisWorkspace: async () => ({
      scope: { kind: 'free' },
      dataRevision: 4,
      currentState: state,
      legalMoves: [],
      allowedActions: ['start_scratch'],
    }),
    updateAnalysisScratch: async () => ({
      discarded: true,
      dataRevision: 4,
    }),
    createAnalysisRecord: async () => ({
      itemId: '1',
      revisionId: '1',
      rootAnchorId: '1',
      contributionId: '1',
      resumeUpdates: [],
      dataRevision: 5,
    }),
    createAnalysisNote: async () => ({
      contributionId: '2',
      itemId: '1',
      revisionId: '1',
      anchorId: '1',
      scopeKind: 'context',
      contextId: '1',
      resumeUpdate: { contextId: '1', resumeVersion: 2 },
      dataRevision: 6,
    }),
    createPositionNote: async () => ({
      contributionId: '3',
      itemId: '1',
      anchorId: '1',
      contributionVersion: 1,
      dataRevision: 7,
    }),
    updateAnalysisNote: async () => ({
      contributionId: '3',
      itemId: '1',
      anchorId: '1',
      contributionVersion: 2,
      dataRevision: 8,
    }),
    deleteAnalysisNote: async () => ({
      contributionId: '3',
      itemId: '1',
      anchorId: '1',
      contributionVersion: 3,
      dataRevision: 9,
    }),
    searchInventory: async () => ({ items: [], dataRevision: 5 }),
    listWorkingContexts: async () => ({
      contexts: [context],
      dataRevision: 5,
    }),
    getWorkingContextWorkspace: async () => ({
      context,
      references: [],
      dataRevision: 5,
    }),
    createWorkingContext: async () => ({ context, dataRevision: 6 }),
    addContextReference: async () => ({ reference, dataRevision: 7 }),
    setWorkScopeResume: async () => ({
      area: 'manage',
      resume: {
        resumeVersion: 1,
        presentation: 'list',
        updatedAt: timestamp,
      },
      dataRevision: 8,
    }),
  });

  const scenarios = [
    ['get_analysis_workspace', { scope: { kind: 'free' } }],
    [
      'update_analysis_scratch',
      {
        scope: { kind: 'free' },
        expectedScratchId: 'scratch-1',
        expectedScratchRevision: 1,
        action: { kind: 'discard' },
      },
    ],
    [
      'create_analysis_record',
      {
        scope: { kind: 'free' },
        expectedScratchId: 'scratch-1',
        expectedScratchRevision: 1,
        displayName: 'Erste Analyse',
        languageTag: 'de-DE',
      },
    ],
    [
      'create_analysis_note',
      {
        scope: { kind: 'context', contextId: '1' },
        expectedScratchId: 'scratch-3',
        expectedScratchRevision: 3,
        languageTag: 'de-DE',
        noteScope: { kind: 'context', contextId: '1' },
      },
    ],
    [
      'create_position_note',
      {
        scope: { kind: 'free' },
        itemId: '1',
        revisionId: '1',
        anchorId: '1',
        body: 'Nach e4',
        languageTag: 'de-DE',
        noteScope: { kind: 'global' },
      },
    ],
    [
      'update_analysis_note',
      {
        scope: { kind: 'free' },
        contributionId: '3',
        expectedContributionVersion: 1,
        body: 'Nach e4!',
      },
    ],
    [
      'delete_analysis_note',
      {
        scope: { kind: 'free' },
        contributionId: '3',
        expectedContributionVersion: 2,
      },
    ],
    ['search_inventory', { query: 'Erste', pageSize: 10 }],
    ['list_working_contexts', { pageSize: 10 }],
    ['get_working_context_workspace', { contextId: '1' }],
    [
      'create_working_context',
      { displayName: 'Mein Repertoire', purpose: 'Eröffnungen ausbauen' },
    ],
    ['add_context_reference', { contextId: '1', itemId: '1', anchorId: '1' }],
    [
      'set_work_scope_resume',
      {
        contextId: '1',
        area: 'manage',
        expectedResumeVersion: null,
        presentation: 'list',
      },
    ],
  ] as const;
  for (const [name, arguments_] of scenarios) {
    const result = await client.callTool({ name, arguments: arguments_ });
    assert.notEqual(result.isError, true, name);
  }

  assert.deepEqual(calls, [
    { method: 'getAnalysisWorkspace', request: { scopeKind: 'free' } },
    {
      method: 'updateAnalysisScratch',
      request: scenarios[1][1],
    },
    { method: 'createAnalysisRecord', request: scenarios[2][1] },
    { method: 'createAnalysisNote', request: scenarios[3][1] },
    { method: 'createPositionNote', request: scenarios[4][1] },
    {
      method: 'updateAnalysisNote',
      request: {
        contributionId: '3',
        scope: { kind: 'free' },
        expectedContributionVersion: 1,
        body: 'Nach e4!',
      },
    },
    {
      method: 'deleteAnalysisNote',
      request: {
        contributionId: '3',
        scope: { kind: 'free' },
        expectedContributionVersion: 2,
      },
    },
    {
      method: 'searchInventory',
      request: { query: 'Erste', pageSize: '10' },
    },
    { method: 'listWorkingContexts', request: { pageSize: '10' } },
    { method: 'getWorkingContextWorkspace', request: '1' },
    { method: 'createWorkingContext', request: scenarios[10][1] },
    {
      method: 'addContextReference',
      request: { contextId: '1', itemId: '1', anchorId: '1' },
    },
    {
      method: 'setWorkScopeResume',
      request: {
        contextId: '1',
        area: 'manage',
        expectedResumeVersion: null,
        presentation: 'list',
      },
    },
  ]);
});

test('invalid write arguments never reach the host', async (t) => {
  const { client, calls } = await connectMcp(t);
  for (const arguments_ of [
    undefined,
    {},
    { uiLocale: 'en-GB' },
    { expectedRevision: 1 },
    { uiLocale: 'de', expectedRevision: 1 },
    { uiLocale: 'en-US', expectedRevision: 1 },
    { uiLocale: 1, expectedRevision: 1 },
    { uiLocale: 'en-GB', expectedRevision: -1 },
    { uiLocale: 'en-GB', expectedRevision: 0 },
    { uiLocale: 'en-GB', expectedRevision: 1.5 },
    { uiLocale: 'en-GB', expectedRevision: '1' },
    { uiLocale: 'en-GB', expectedRevision: null },
    { uiLocale: 'en-GB', expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { uiLocale: 'en-GB', expectedRevision: 1, token: 'secret-canary' },
  ]) {
    const result = await client.callTool({
      name: 'set_ui_language',
      ...(arguments_ === undefined ? {} : { arguments: arguments_ }),
    });
    assert.equal(result.isError, true);
    assert.equal(
      (result.structuredContent as { code: string }).code,
      'request.invalid',
    );
    assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
  }
  assert.deepEqual(calls, []);
});

test('resume tool rejects mixed manage and analyze shapes before the host', async (t) => {
  const { client, calls } = await connectMcp(t);
  for (const arguments_ of [
    {
      contextId: '1',
      area: 'manage',
      expectedResumeVersion: null,
    },
    {
      contextId: '1',
      area: 'manage',
      expectedResumeVersion: null,
      presentation: 'list',
      mode: 'analyze',
    },
    {
      contextId: '1',
      area: 'analyze',
      expectedResumeVersion: null,
      mode: 'analyze',
      presentation: 'list',
    },
  ]) {
    const result = await client.callTool({
      name: 'set_work_scope_resume',
      arguments: arguments_,
    });
    assert.equal(result.isError, true);
    assert.equal(
      (result.structuredContent as { code: string }).code,
      'request.invalid',
    );
  }
  assert.deepEqual(calls, []);
});

test('read tools reject undeclared arguments', async (t) => {
  const { client, calls } = await connectMcp(t);
  for (const name of [
    'get_system_status',
    'get_user_preferences',
    'get_diagnostic_settings',
    'get_diagnostic_report_manifest',
  ]) {
    const result = await client.callTool({
      name,
      arguments: { path: 'secret-canary' },
    });
    assert.equal(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /secret-canary/);
  }
  assert.deepEqual(calls, []);
});

test('unknown tools and resource variants cannot escape the allowlist', async (t) => {
  const { client, calls } = await connectMcp(t);
  for (const name of [
    'api_request',
    'get_configuration',
    'set_secret',
    'get_system_status/',
  ]) {
    await assert.rejects(
      client.callTool({ name }),
      (error: unknown) =>
        error instanceof McpError && error.code === ErrorCode.InvalidParams,
    );
  }
  for (const uri of [
    'file:///secret-canary',
    'plysmith://system/status/',
    'plysmith://user/preferences?scope=all',
  ]) {
    await assert.rejects(
      client.readResource({ uri }),
      (error: unknown) =>
        error instanceof McpError && error.code === ErrorCode.InvalidParams,
    );
  }
  assert.deepEqual(calls, []);
});

test('task requests are refused before executing a write', async (t) => {
  const { client, calls } = await connectMcp(t);
  await assert.rejects(
    client.request(
      {
        method: 'tools/call',
        params: {
          name: 'set_ui_language',
          arguments: { uiLocale: 'en-GB', expectedRevision: 1 },
          task: {},
        },
      },
      CallToolResultSchema,
    ),
    (error: unknown) =>
      error instanceof McpError && /task/i.test(error.message),
  );
  assert.deepEqual(calls, []);
});

test('a revision conflict retains all RFC problem fields and is not retried', async (t) => {
  const { client, calls } = await connectMcp(t, {
    setUiLanguage: async () => {
      throw { problem: revisionConflict };
    },
  });
  const result = await client.callTool({
    name: 'set_ui_language',
    arguments: { uiLocale: 'en-GB', expectedRevision: 1 },
  });
  assert.equal(result.isError, true);
  assertToolData(result, revisionConflict);
  assert.equal(calls.length, 1);
});

test('resources preserve structured host problems in MCP error data', async (t) => {
  const { client } = await connectMcp(t, {
    getUserPreferences: async () => {
      throw { problem: revisionConflict };
    },
  });
  await assert.rejects(
    client.readResource({ uri: 'plysmith://user/preferences' }),
    (error: unknown) => {
      assert.ok(error instanceof McpError);
      assert.equal(error.code, ErrorCode.InternalError);
      assert.deepEqual(error.data, revisionConflict);
      return true;
    },
  );
});

test('unexpected failures are neutral and never retried, even after a write', async (t) => {
  for (const failure of [
    new Error('secret-canary C:\\private\\state.db', { cause: 'token-canary' }),
    'secret-canary',
    { problem: { code: 'secret-canary' }, stack: 'private-path' },
    {
      problem: {
        ...revisionConflict,
        parameters: { currentRevision: 'secret-canary' },
      },
    },
  ]) {
    const fail = async (): Promise<never> => {
      throw failure;
    };
    const { client, calls } = await connectMcp(t, {
      getSystemStatus: fail,
      getUserPreferences: fail,
      setUiLanguage: fail,
    });
    for (const name of [
      'get_system_status',
      'get_user_preferences',
      'set_ui_language',
    ]) {
      const result = await client.callTool({
        name,
        ...(name === 'set_ui_language'
          ? { arguments: { uiLocale: 'en-GB', expectedRevision: 1 } }
          : {}),
      });
      assert.equal(result.isError, true);
      assertNeutralProblem(result.structuredContent);
      assert.doesNotMatch(JSON.stringify(result), /canary|private|stack/);
    }
    for (const uri of [
      'plysmith://system/status',
      'plysmith://user/preferences',
    ]) {
      await assert.rejects(client.readResource({ uri }), (error: unknown) => {
        assert.ok(error instanceof McpError);
        assertNeutralProblem(error.data);
        assert.doesNotMatch(JSON.stringify(error.data), /canary|private|stack/);
        return true;
      });
    }
    assert.equal(
      calls.filter(({ method }) => method === 'setUiLanguage').length,
      1,
    );
    assert.equal(calls.length, 5);
  }
});

test('error wrappers and fields outside the shared problem contract are not exposed', async (t) => {
  const { client } = await connectMcp(t, {
    getSystemStatus: async () => {
      throw {
        message: 'secret-canary',
        stack: 'private-path',
        problem: {
          ...revisionConflict,
          stack: 'private-path',
          parameters: {
            ...revisionConflict.parameters,
            token: 'secret-canary',
          },
        },
      };
    },
  });
  const result = await client.callTool({ name: 'get_system_status' });
  assertToolData(result, revisionConflict);
});
