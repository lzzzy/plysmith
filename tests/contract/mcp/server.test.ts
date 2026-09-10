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
  preferences,
  revisionConflict,
  systemStatus,
} from './helpers.ts';

test('MCP advertises exactly three tools and two fixed resources', async (t) => {
  const { client, calls } = await connectMcp(t);
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['get_system_status', 'get_user_preferences', 'set_ui_language'],
  );
  assert.deepEqual(client.getServerCapabilities(), {
    tools: {},
    resources: {},
  });
  assert.deepEqual(JSON.parse(JSON.stringify(tools[2]?.inputSchema)), {
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
  assert.equal(tools[2]?.annotations?.readOnlyHint, false);
  assert.equal(tools[2]?.annotations?.idempotentHint, false);
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

test('read tools reject undeclared arguments', async (t) => {
  const { client, calls } = await connectMcp(t);
  for (const name of ['get_system_status', 'get_user_preferences']) {
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
