import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { parseApplicationHome } from '../../../app/bootstrap/mcp/main.ts';
import type { PlayoutDto } from '../../../app/infrastructure/channels/host_client/index.ts';
import {
  assertToolData,
  preferences,
  revisionConflict,
  systemStatus,
} from '../../contract/mcp/helpers.ts';
import { createHttpHostFixture } from './http-host-fixture.ts';
import { createApplicationHostFixture } from './application-host-fixture.ts';

const entryPoint = fileURLToPath(
  new URL('../../../app/bootstrap/mcp/main.ts', import.meta.url),
);
const startupFailure =
  'Plysmith MCP could not attach. Start the matching Application Host and check application-home.';

async function attach(t: TestContext, applicationHome: string) {
  const client = new Client({ name: 'plysmith-stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entryPoint, '--application-home', applicationHome],
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  t.after(async () => {
    await client.close();
    await transport.close();
  });
  await client.connect(transport);
  await client.listTools();
  return { client, stderr: () => stderr };
}

function expectedPlayoutTool(name: string, expectedDraftRevision: number) {
  return {
    name,
    arguments: {
      scope: { kind: 'free' as const },
      draftId: '1',
      expectedDraftRevision,
    },
  };
}

test('MCP paths support source defaults and an explicit application-home only', () => {
  assert.equal(parseApplicationHome([]), path.resolve('.'));
  assert.equal(
    parseApplicationHome(['--application-home', 'test home']),
    path.resolve('test home'),
  );
  for (const args of [
    ['--application-home'],
    ['--application-home', ''],
    ['--application-home', '--host'],
    ['--install-root', 'somewhere'],
    ['--application-home', 'one', '--application-home', 'two'],
    ['unexpected-secret-canary'],
  ]) {
    assert.throws(
      () => parseApplicationHome(args),
      (error: unknown) =>
        error instanceof Error && !error.message.includes('secret-canary'),
    );
  }
});

test(
  'stdio bootstrap attaches using discovery and the shared host client',
  { timeout: 30000 },
  async (t) => {
    const fixture = await createHttpHostFixture(t);
    const discoveryBefore = await readFile(fixture.discoveryPath, 'utf8');
    const { client, stderr } = await attach(t, fixture.applicationHome);

    assertToolData(
      await client.callTool({ name: 'get_system_status' }),
      systemStatus,
    );
    assertToolData(
      await client.callTool({ name: 'get_user_preferences' }),
      preferences,
    );
    const writeRequest = { uiLocale: 'en-GB', expectedRevision: 1 };
    assertToolData(
      await client.callTool({
        name: 'set_ui_language',
        arguments: writeRequest,
      }),
      fixture.writeResult,
    );
    for (const [uri, value] of [
      ['plysmith://system/status', systemStatus],
      ['plysmith://user/preferences', preferences],
    ] as const) {
      const resource = await client.readResource({ uri });
      assert.deepEqual(resource.contents, [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(value, null, 2),
        },
      ]);
    }
    assert.deepEqual(
      fixture.requests.map(({ method, url }) => ({ method, url })),
      [
        { method: 'GET', url: '/status' },
        { method: 'GET', url: '/status' },
        { method: 'GET', url: '/preferences' },
        { method: 'PUT', url: '/preferences/ui-language' },
        { method: 'GET', url: '/status' },
        { method: 'GET', url: '/preferences' },
      ],
    );
    assert.deepEqual(fixture.requests[3]?.body, writeRequest);
    assert.ok(
      fixture.requests.every(
        ({ authorization }) => authorization === `Bearer ${fixture.token}`,
      ),
    );

    await client.close();
    assert.equal(stderr(), '');
    assert.equal(
      await readFile(fixture.discoveryPath, 'utf8'),
      discoveryBefore,
    );
    assert.deepEqual(await readdir(fixture.applicationHome), ['runtime']);
    assert.deepEqual(
      await readdir(path.join(fixture.applicationHome, 'runtime')),
      ['host.json'],
    );
    assert.equal((await fetch(`${fixture.endpoint}status`)).status, 200);
  },
);

test(
  'stdio carries the complete non-sensitive playout lifecycle through the host contract',
  { timeout: 60000 },
  async (t) => {
    const root = {
      position: {
        ruleSetId: 'standardChess',
        boardKey:
          'rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR',
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
    let draftRevision = 1;
    let status:
      | { readonly kind: 'active' }
      | { readonly kind: 'paused' }
      | {
          readonly kind: 'stopped';
          readonly outcome: { readonly kind: 'unfinished' };
        } = { kind: 'active' };
    const playout = () => ({
      draft: {
        draftId: '1',
        draftRevision,
        decisionGeneration: 0,
        origin: { kind: 'initial_position' as const },
        root,
        playerSide: 'white' as const,
        policy: {
          capability: 'best_move' as const,
          providerInstanceId: 'engine-main',
          providerFingerprint: 'sha256:engine-main',
          providerType: 'stockfish-uci',
          providerDisplayName: 'Stockfish',
        },
        steps: [],
        status,
      },
      legalMoves: [{ from: 'e2', to: 'e4', san: 'e4' }],
      dataRevision: draftRevision,
    });
    const fixture = await createHttpHostFixture(t, {
      routeResponse: ({ method, url }) => {
        if (method === 'GET' && url === '/playout/providers') {
          return {
            body: {
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
            },
          };
        }
        if (method === 'GET' && url?.startsWith('/playout?'))
          return { body: playout() };
        if (method === 'POST' && url === '/playout') {
          draftRevision = 1;
          status = { kind: 'active' };
          return { body: playout() };
        }
        if (method === 'POST' && url === '/playout/moves') {
          draftRevision = 2;
          return { body: playout() };
        }
        if (method === 'POST' && url === '/playout/pause') {
          draftRevision = 3;
          status = { kind: 'paused' };
          return { body: playout() };
        }
        if (method === 'POST' && url === '/playout/resume') {
          draftRevision = 4;
          status = { kind: 'active' };
          return { body: playout() };
        }
        if (method === 'POST' && url === '/playout/retry') {
          draftRevision = 5;
          return { body: playout() };
        }
        if (method === 'POST' && url === '/playout/stop') {
          draftRevision = 6;
          status = { kind: 'stopped', outcome: { kind: 'unfinished' } };
          return { body: playout() };
        }
        if (method === 'POST' && url === '/playout/complete') {
          return {
            body: {
              itemId: '1',
              revisionId: '1',
              rootAnchorId: '1',
              outcome: { kind: 'unfinished' },
              outcomeSource: 'manual',
              dataRevision: 7,
            },
          };
        }
        if (method === 'DELETE' && url === '/playout')
          return { body: { dataRevision: 9 } };
        return undefined;
      },
    });
    const { client } = await attach(t, fixture.applicationHome);
    const scope = { kind: 'free' as const };
    const start = {
      scope,
      start: { kind: 'initial_position' as const },
      providerInstanceId: 'engine-main',
      capability: 'best_move' as const,
      opening: { kind: 'provider_move' as const },
    };

    const providers = await client.callTool({
      name: 'list_move_policy_providers',
    });
    assert.equal(providers.isError, undefined);
    assert.doesNotMatch(
      JSON.stringify(providers),
      /executable|arguments|hashMb/,
    );
    for (const request of [
      { name: 'start_playout', arguments: start },
      { name: 'get_playout', arguments: { scope } },
      {
        name: 'submit_playout_move',
        arguments: {
          scope,
          draftId: '1',
          expectedDraftRevision: 1,
          move: { kind: 'coordinates', value: 'e2e4' },
        },
      },
      expectedPlayoutTool('pause_playout', 2),
      expectedPlayoutTool('resume_playout', 3),
      expectedPlayoutTool('retry_playout', 4),
      expectedPlayoutTool('stop_playout', 5),
      {
        name: 'complete_playout',
        arguments: {
          scope,
          draftId: '1',
          expectedDraftRevision: 6,
          completionId: 'completion-1',
          manualResult: 'unfinished',
          displayName: 'MCP practice game',
          languageTag: 'en-GB',
        },
      },
      { name: 'start_playout', arguments: start },
      expectedPlayoutTool('discard_playout', 1),
    ]) {
      const result = await client.callTool(request);
      assert.notEqual(result.isError, true, request.name);
    }

    assert.deepEqual(
      fixture.requests.slice(1).map(({ method, url }) => ({ method, url })),
      [
        { method: 'GET', url: '/playout/providers' },
        { method: 'POST', url: '/playout' },
        { method: 'GET', url: '/playout?scopeKind=free' },
        { method: 'POST', url: '/playout/moves' },
        { method: 'POST', url: '/playout/pause' },
        { method: 'POST', url: '/playout/resume' },
        { method: 'POST', url: '/playout/retry' },
        { method: 'POST', url: '/playout/stop' },
        { method: 'POST', url: '/playout/complete' },
        { method: 'POST', url: '/playout' },
        { method: 'DELETE', url: '/playout' },
      ],
    );
  },
);

test(
  'stdio cancels real playout completion through HTTP and Application without resuming or changing moves',
  { timeout: 60000 },
  async (t) => {
    const fixture = await createApplicationHostFixture(t);
    const { client, stderr } = await attach(t, fixture.applicationHome);
    const scope = { kind: 'free' as const };
    const callPlayout = async (
      name: string,
      args: Record<string, unknown>,
    ): Promise<PlayoutDto> => {
      const result = await client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      assert.ok(result.structuredContent);
      return result.structuredContent as PlayoutDto;
    };
    const expected = (playout: PlayoutDto) => ({
      scope,
      draftId: playout.draft.draftId,
      expectedDraftRevision: playout.draft.draftRevision,
    });
    const started = await callPlayout('start_playout', {
      scope,
      start: { kind: 'initial_position' },
      providerInstanceId: 'uci-test',
      capability: 'best_move',
      opening: {
        kind: 'user_move',
        move: { kind: 'coordinates', value: 'e2e4' },
      },
    });
    assert.equal(started.draft.status.kind, 'active');
    assert.deepEqual(
      started.draft.steps.map(({ actor, move }) => [actor, move.san]),
      [
        ['user', 'e4'],
        ['provider', 'e5'],
      ],
    );
    const providerTrace = await readFile(fixture.providerTracePath, 'utf8');
    assert.equal(providerTrace.match(/^go /gm)?.length, 1);

    const stopped = await callPlayout('stop_playout', expected(started));
    assert.deepEqual(stopped, {
      ...started,
      dataRevision: started.dataRevision + 1,
      draft: {
        ...started.draft,
        draftRevision: started.draft.draftRevision + 1,
        status: { kind: 'stopped', outcome: { kind: 'unfinished' } },
      },
    });
    const cancelled = await callPlayout(
      'cancel_playout_completion',
      expected(stopped),
    );
    assert.deepEqual(cancelled, {
      ...stopped,
      dataRevision: stopped.dataRevision + 1,
      draft: {
        ...stopped.draft,
        draftRevision: stopped.draft.draftRevision + 1,
        status: { kind: 'paused' },
      },
    });
    assertToolData(
      await client.callTool({ name: 'get_playout', arguments: { scope } }),
      { playout: cancelled },
    );
    assert.equal(
      await readFile(fixture.providerTracePath, 'utf8'),
      providerTrace,
    );

    const stale = await client.callTool({
      name: 'cancel_playout_completion',
      arguments: expected(stopped),
    });
    assert.equal(stale.isError, true);
    assert.ok(
      stale.structuredContent && typeof stale.structuredContent === 'object',
    );
    assert.ok('code' in stale.structuredContent);
    assert.equal(stale.structuredContent.code, 'playout.revision_conflict');
    assert.ok('status' in stale.structuredContent);
    assert.equal(stale.structuredContent.status, 409);
    assertToolData(
      await client.callTool({ name: 'get_playout', arguments: { scope } }),
      { playout: cancelled },
    );
    assert.equal(
      await readFile(fixture.providerTracePath, 'utf8'),
      providerTrace,
    );

    const resumed = await callPlayout('resume_playout', expected(cancelled));
    assert.deepEqual(resumed, {
      ...cancelled,
      dataRevision: cancelled.dataRevision + 1,
      draft: {
        ...cancelled.draft,
        draftRevision: cancelled.draft.draftRevision + 1,
        status: { kind: 'active' },
      },
    });
    assertToolData(
      await client.callTool({ name: 'get_playout', arguments: { scope } }),
      { playout: resumed },
    );
    assert.equal(
      await readFile(fixture.providerTracePath, 'utf8'),
      providerTrace,
    );
    assert.equal(stderr(), '');
  },
);

test(
  'a host revision conflict survives HTTP and stdio without a second write',
  { timeout: 20000 },
  async (t) => {
    const fixture = await createHttpHostFixture(t, {
      writeResponse: { status: 409, body: revisionConflict },
    });
    const { client } = await attach(t, fixture.applicationHome);
    const result = await client.callTool({
      name: 'set_ui_language',
      arguments: { uiLocale: 'en-GB', expectedRevision: 1 },
    });
    assert.equal(result.isError, true);
    assertToolData(result, revisionConflict);
    assert.equal(fixture.requests.length, 2);
  },
);

test(
  'an attached MCP client discovers a restarted host before its next read',
  { timeout: 20000 },
  async (t) => {
    const first = await createHttpHostFixture(t);
    const second = await createHttpHostFixture(t);
    const { client } = await attach(t, first.applicationHome);

    await first.stopHost();
    await writeFile(
      first.discoveryPath,
      await readFile(second.discoveryPath, 'utf8'),
      'utf8',
    );

    assertToolData(
      await client.callTool({ name: 'get_user_preferences' }),
      preferences,
    );
    assert.deepEqual(
      first.requests.map(({ method, url }) => ({ method, url })),
      [{ method: 'GET', url: '/status' }],
    );
    assert.deepEqual(
      second.requests.map(({ method, url }) => ({ method, url })),
      [
        { method: 'GET', url: '/status' },
        { method: 'GET', url: '/preferences' },
      ],
    );
  },
);

test(
  'an attached MCP client discovers a replacement host before one write',
  { timeout: 20000 },
  async (t) => {
    const first = await createHttpHostFixture(t);
    const second = await createHttpHostFixture(t);
    const { client } = await attach(t, first.applicationHome);
    const writeRequest = { uiLocale: 'en-GB' as const, expectedRevision: 1 };

    await writeFile(
      first.discoveryPath,
      await readFile(second.discoveryPath, 'utf8'),
      'utf8',
    );

    assertToolData(
      await client.callTool({
        name: 'set_ui_language',
        arguments: writeRequest,
      }),
      second.writeResult,
    );
    assert.deepEqual(
      first.requests.map(({ method, url }) => ({ method, url })),
      [{ method: 'GET', url: '/status' }],
    );
    assert.deepEqual(
      second.requests.map(({ method, url }) => ({ method, url })),
      [
        { method: 'GET', url: '/status' },
        { method: 'PUT', url: '/preferences/ui-language' },
      ],
    );
    assert.deepEqual(second.requests[1]?.body, writeRequest);
  },
);

test(
  'an attached MCP client retries an unavailable read exactly once',
  { timeout: 20000 },
  async (t) => {
    const fixture = await createHttpHostFixture(t, {
      preferenceDisconnects: 2,
    });
    const { client } = await attach(t, fixture.applicationHome);

    const result = await client.callTool({ name: 'get_user_preferences' });

    assert.equal(result.isError, true);
    assert.equal(
      (result.structuredContent as { code: string }).code,
      'host.unavailable',
    );
    assert.deepEqual(
      fixture.requests.map(({ method, url }) => ({ method, url })),
      [
        { method: 'GET', url: '/status' },
        { method: 'GET', url: '/preferences' },
        { method: 'GET', url: '/status' },
        { method: 'GET', url: '/preferences' },
      ],
    );
  },
);

test(
  'loss of an HTTP write response never causes replay or preference reads',
  { timeout: 20000 },
  async (t) => {
    const fixture = await createHttpHostFixture(t, {
      writeResponse: 'disconnect',
    });
    const { client } = await attach(t, fixture.applicationHome);
    const result = await client.callTool({
      name: 'set_ui_language',
      arguments: { uiLocale: 'en-GB', expectedRevision: 1 },
    });
    assert.equal(result.isError, true);
    assert.equal(
      (result.structuredContent as { code: string }).code,
      'host.unavailable',
    );
    assert.doesNotMatch(JSON.stringify(result), /canary|stack|ECONNRESET/);
    assert.deepEqual(
      fixture.requests.map(({ method }) => method),
      ['GET', 'PUT'],
    );
  },
);

async function expectStartupFailure(applicationHome: string): Promise<void> {
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [entryPoint, '--application-home', applicationHome],
      { timeout: 15000, windowsHide: true },
    ),
    (error: unknown) => {
      assert.ok(error !== null && typeof error === 'object');
      assert.ok('code' in error && 'stdout' in error && 'stderr' in error);
      assert.equal(error.code, 1);
      assert.equal(error.stdout, '');
      assert.equal(String(error.stderr).trim(), startupFailure);
      return true;
    },
  );
}

test(
  'missing discovery exits neutrally without initializing an application-home',
  { timeout: 20000 },
  async (t) => {
    const applicationHome = await mkdtemp(
      path.join(os.tmpdir(), 'plysmith-mcp-missing-'),
    );
    t.after(() => rm(applicationHome, { force: true, recursive: true }));
    await expectStartupFailure(applicationHome);
    assert.deepEqual(await readdir(applicationHome), []);
  },
);

test(
  'invalid discovery is neither disclosed nor repaired',
  { timeout: 20000 },
  async (t) => {
    const fixture = await createHttpHostFixture(t);
    await writeFile(fixture.discoveryPath, '{invalid-secret-canary', 'utf8');
    await expectStartupFailure(fixture.applicationHome);
    assert.equal(
      await readFile(fixture.discoveryPath, 'utf8'),
      '{invalid-secret-canary',
    );
    assert.equal(fixture.requests.length, 0);
  },
);

for (const source of ['discovery', 'status'] as const) {
  test(
    `a mismatched ${source} fingerprint blocks MCP before tool execution`,
    { timeout: 20000 },
    async (t) => {
      const fixture = await createHttpHostFixture(t, {
        ...(source === 'discovery'
          ? { discoveryFingerprint: 'mismatched' }
          : { statusFingerprint: 'mismatched' }),
      });
      await expectStartupFailure(fixture.applicationHome);
      assert.equal(fixture.requests.length, source === 'discovery' ? 0 : 1);
    },
  );
}
