import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Value } from '@sinclair/typebox/value';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { createMcpServer } from '../../../app/infrastructure/channels/mcp/index.ts';
import { AnalyzePositionArgumentsSchema } from '../../../app/infrastructure/channels/mcp/schemas.ts';
import {
  PlysmithHostClient,
  contractFingerprint,
  productRelease,
} from '../../../app/infrastructure/channels/host_client/testing.ts';

type LiveState = Awaited<ReturnType<PlysmithHostClient['getLiveState']>>;
const root = new ChessJsRulesAdapter().initialState();
const state: LiveState = {
  revision: 7,
  configured: true,
  online: true,
  connection: 'connected',
  fairPlayBlocked: false,
  accountName: 'Tester',
  games: [
    {
      gameId: 'Game1234',
      displayName: 'Opponent',
      opponentRating: 1650,
      playerSide: 'white',
      boardCompatible: true,
      standard: true,
    },
  ],
  session: {
    analysisRevision: 7,
    gameId: 'Abcd1234',
    role: 'observe',
    white: { id: 'white', name: 'White', rating: 1650 },
    black: { id: 'black', name: 'Black', rating: 1696 },
    root,
    current: root,
    steps: [],
    selectedPly: 0,
    legalMoves: [],
    status: 'ongoing',
    connected: true,
    pendingMove: false,
    outcome: 'unfinished',
    whiteClockMs: 300000,
    blackClockMs: 300000,
    clockUpdatedAt: '2026-10-06T12:00:00.000Z',
    focus: { focusKey: 'live:7:0', root, moves: [], current: root },
  },
};
const configuration = {
  configured: true,
  tokenConfigured: true,
  configurationRevision: 'sha256:configured',
  restartRequired: false,
};
const saved = { itemId: 4, revisionId: 5, dataRevision: 6 };
const liveTools = [
  'get_live_state',
  'get_live_provider_configuration',
  'observe_live_game',
  'play_live_game',
  'select_live_position',
  'submit_live_move',
  'act_live_game',
  'refresh_live_game',
  'disconnect_live_game',
  'discard_live_game',
  'save_live_game',
];
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

async function connect(
  t: TestContext,
  respond: (request: Request) => Response | Promise<Response> = (request) =>
    json(
      new URL(request.url).pathname === '/configuration/live'
        ? configuration
        : new URL(request.url).pathname === '/live/games'
          ? saved
          : state,
    ),
) {
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const hostClient = new PlysmithHostClient(
    {
      endpoint: 'http://127.0.0.1:12345',
      token: 'local-test-only',
      productRelease,
      contractFingerprint,
    },
    {
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        const body: unknown =
          request.method === 'GET' ? undefined : await request.clone().json();
        calls.push({
          path: new URL(request.url).pathname,
          method: request.method,
          body,
        });
        return respond(request);
      },
    },
  );
  const server = createMcpServer({ hostClient, productRelease });
  const client = new Client({ name: 'live-contract-test', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await client.listTools();
  return { client, calls };
}

test('MCP exposes the explicit live allowlist and safe configuration status, never a secret writer', async (t) => {
  const { client, calls } = await connect(t);
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.filter((tool) => tool.name.includes('live')).map((tool) => tool.name),
    liveTools,
  );
  assert.equal(
    tools.some((tool) =>
      /save_live_provider_configuration|set.*token|set.*secret/.test(tool.name),
    ),
    false,
  );
  for (const tool of tools.filter((tool) => liveTools.includes(tool.name))) {
    assert.equal(JSON.stringify(tool.inputSchema).includes('"token":'), false);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  const move = tools.find((tool) => tool.name === 'submit_live_move');
  assert.equal(move?.annotations?.readOnlyHint, false);
  assert.equal(move?.annotations?.idempotentHint, false);
  assert.equal(move?.annotations?.openWorldHint, true);
  assert.equal(
    tools.find((tool) => tool.name === 'get_live_state')?.annotations
      ?.readOnlyHint,
    true,
  );
  const status = await client.callTool({
    name: 'get_live_provider_configuration',
    arguments: {},
  });
  assert.deepEqual(status.structuredContent, configuration);
  await assert.rejects(
    client.callTool({
      name: 'save_live_provider_configuration',
      arguments: { token: 'private-marker' },
    }),
  );
  assert.deepEqual(calls, [
    { path: '/configuration/live', method: 'GET', body: undefined },
  ]);
});

test('all live commands forward one typed host request and preserve the complete session or saved IDs', async (t) => {
  const { client, calls } = await connect(t);
  const current = await client.callTool({
    name: 'get_live_state',
    arguments: {},
  });
  assert.deepEqual(current.structuredContent, state);
  const commands = [
    {
      name: 'observe_live_game',
      args: { expectedRevision: 7, url: 'https://lichess.org/Abcd1234' },
      kind: 'observe',
    },
    {
      name: 'play_live_game',
      args: { expectedRevision: 7, gameId: 'Abcd1234' },
      kind: 'play',
    },
    {
      name: 'select_live_position',
      args: { expectedRevision: 7, ply: 0 },
      kind: 'select',
    },
    {
      name: 'submit_live_move',
      args: { expectedRevision: 7, move: 'e2e4' },
      kind: 'move',
    },
    {
      name: 'act_live_game',
      args: { expectedRevision: 7, action: 'offer_draw' },
      kind: 'act',
    },
    {
      name: 'refresh_live_game',
      args: { expectedRevision: 7 },
      kind: 'refresh',
    },
    {
      name: 'discard_live_game',
      args: { expectedRevision: 7 },
      kind: 'discard',
    },
    {
      name: 'disconnect_live_game',
      args: { expectedRevision: 7 },
      kind: 'disconnect',
    },
  ];
  for (const command of commands) {
    const result = await client.callTool({
      name: command.name,
      arguments: command.args,
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(result.structuredContent, state);
    assert.deepEqual(calls.at(-1), {
      path: '/live/commands',
      method: 'POST',
      body: { ...command.args, kind: command.kind },
    });
  }
  const args = {
    expectedRevision: 7,
    displayName: 'Recorded game',
    languageTag: 'en-GB',
    folderId: 2,
    workingContextId: 3,
  };
  const result = await client.callTool({
    name: 'save_live_game',
    arguments: args,
  });
  assert.deepEqual(result.structuredContent, saved);
  assert.deepEqual(calls.at(-1), {
    path: '/live/games',
    method: 'POST',
    body: args,
  });
  assert.equal(calls.length, 10);
});

test('MCP disconnect preserves an offline recording and rejects invalid revisions before host access', async (t) => {
  const offline = {
    ...state,
    revision: 8,
    online: false,
    connection: 'disconnected',
    session: { ...state.session!, connected: false },
  };
  const { client, calls } = await connect(t, () => json(offline));
  const result = await client.callTool({
    name: 'disconnect_live_game',
    arguments: { expectedRevision: 7 },
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, offline);
  assert.deepEqual(calls, [
    {
      path: '/live/commands',
      method: 'POST',
      body: { expectedRevision: 7, kind: 'disconnect' },
    },
  ]);
  for (const args of [
    {},
    { expectedRevision: -1 },
    { expectedRevision: 7, action: 'abort' },
  ]) {
    const invalid = await client.callTool({
      name: 'disconnect_live_game',
      arguments: args,
    });
    assert.equal(invalid.isError, true);
  }
  assert.equal(calls.length, 1);
});

test('MCP rejects missing revisions, foreign properties and malformed live arguments before host access', async (t) => {
  const { client, calls } = await connect(t);
  const invalid = [
    { name: 'get_live_state', arguments: { token: 'private-marker' } },
    {
      name: 'get_live_provider_configuration',
      arguments: { token: 'private-marker' },
    },
    {
      name: 'observe_live_game',
      arguments: { url: 'https://lichess.org/Abcd1234' },
    },
    {
      name: 'observe_live_game',
      arguments: { expectedRevision: 7, url: '', token: 'private-marker' },
    },
    {
      name: 'play_live_game',
      arguments: { expectedRevision: 7, gameId: '../account' },
    },
    {
      name: 'select_live_position',
      arguments: { expectedRevision: 7, ply: -1 },
    },
    {
      name: 'select_live_position',
      arguments: { expectedRevision: 7, ply: 1001 },
    },
    {
      name: 'submit_live_move',
      arguments: { expectedRevision: 7, move: 'e4' },
    },
    {
      name: 'act_live_game',
      arguments: { expectedRevision: 7, action: 'takeback' },
    },
    { name: 'refresh_live_game', arguments: { expectedRevision: -1 } },
    { name: 'discard_live_game', arguments: { expectedRevision: 7.5 } },
    {
      name: 'save_live_game',
      arguments: {
        expectedRevision: 7,
        displayName: 'Game',
        languageTag: 'en-GB',
        folderId: '2',
      },
    },
    {
      name: 'save_live_game',
      arguments: {
        expectedRevision: 7,
        displayName: 'Game',
        languageTag: 'fr-FR',
      },
    },
  ];
  for (const request of invalid) {
    const result = await client.callTool(request);
    assert.equal(result.isError, true, request.name);
    assert.ok(
      result.structuredContent !== null &&
        typeof result.structuredContent === 'object' &&
        'code' in result.structuredContent,
    );
    assert.equal(
      result.structuredContent?.code,
      'request.invalid',
      request.name,
    );
    assert.equal(JSON.stringify(result).includes('private-marker'), false);
  }
  assert.equal(calls.length, 0);
});

test('MCP preserves safe live conflicts and fair-play failures without retrying', async (t) => {
  const problem = {
    type: 'https://example.invalid/live/stale_state',
    title: 'Revision conflict',
    status: 409,
    detail: 'The live session changed.',
    instance: 'urn:plysmith:problem:live-test',
    code: 'live.stale_state',
    correlationId: 'live-test',
    retryable: false,
    parameters: { expectedRevision: 6, currentRevision: 7 },
  };
  let response = problem;
  const { client, calls } = await connect(t, () =>
    json(response, response.status),
  );
  const result = await client.callTool({
    name: 'submit_live_move',
    arguments: { expectedRevision: 6, move: 'e2e4' },
  });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, problem);
  assert.equal(calls.length, 1);
  response = {
    ...problem,
    type: 'https://example.invalid/live/fair_play_blocked',
    code: 'live.fair_play_blocked',
    status: 403,
    title: 'Engine assistance unavailable',
    detail: 'Engine assistance is disabled during an ongoing human game.',
  };
  const blocked = await client.callTool({
    name: 'refresh_live_game',
    arguments: { expectedRevision: 7 },
  });
  assert.equal(blocked.isError, true);
  assert.deepEqual(blocked.structuredContent, response);
  assert.equal(calls.length, 2);
});

test('MCP sanitizes failed transports and refuses a credential-bearing live response', async (t) => {
  const { client, calls } = await connect(t, (request) => {
    if (new URL(request.url).pathname === '/configuration/live')
      return json({ ...configuration, token: 'private-marker' });
    if (new URL(request.url).pathname === '/live')
      return json({ ...state, providerDiagnostics: 'private-marker' });
    throw new Error('private-marker raw provider error', {
      cause: 'private-marker',
    });
  });
  for (const request of [
    { name: 'get_live_provider_configuration', arguments: {} },
    { name: 'get_live_state', arguments: {} },
    {
      name: 'submit_live_move',
      arguments: { expectedRevision: 7, move: 'e2e4' },
    },
  ]) {
    const result = await client.callTool(request);
    assert.equal(result.isError, true);
    assert.equal(JSON.stringify(result).includes('private-marker'), false);
    assert.ok(
      result.structuredContent !== null &&
        typeof result.structuredContent === 'object',
    );
    assert.equal('cause' in result.structuredContent, false);
  }
  assert.equal(calls.length, 3);
});

test('live AnalyzePosition requires exact revision and ply and retains existing inventory-work schema', async (t) => {
  const analysis = {
    work: { kind: 'live', revision: 7, ply: 0 },
    consumerId: 'live-test',
    laneId: 'objective',
    providerInstanceId: 'engine',
    candidateCount: 1,
    focus: { focusKey: 'live:7:0', root, moves: [], current: root },
    mode: { kind: 'objective', budget: 'fast' },
  };
  assert.equal(Value.Check(AnalyzePositionArgumentsSchema, analysis), true);
  for (const work of [
    { kind: 'live', ply: 0 },
    { kind: 'live', revision: 7, ply: -1 },
    { kind: 'live', revision: 7, ply: 0, scope: { kind: 'free' } },
  ])
    assert.equal(
      Value.Check(AnalyzePositionArgumentsSchema, { ...analysis, work }),
      false,
    );
  assert.equal(
    Value.Check(AnalyzePositionArgumentsSchema, {
      ...analysis,
      work: { scope: { kind: 'free' }, subject: { kind: 'position' } },
    }),
    true,
  );
  const result = {
    kind: 'objective',
    perspective: 'white',
    focusKey: 'live:7:0',
    providerInstanceId: 'engine',
    providerDisplayName: 'Engine',
    historyCompleteness: 'complete',
    budget: 'fast',
    candidates: [],
    search: { limiter: { kind: 'movetime', value: 500 } },
  };
  const { client, calls } = await connect(t, () => json(result));
  assert.deepEqual(
    (await client.callTool({ name: 'analyze_position', arguments: analysis }))
      .structuredContent,
    result,
  );
  assert.deepEqual(
    calls.map((call) => call.body),
    [analysis],
  );
});
