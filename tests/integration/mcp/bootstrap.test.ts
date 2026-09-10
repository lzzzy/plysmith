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
import {
  assertToolData,
  preferences,
  revisionConflict,
  systemStatus,
} from '../../contract/mcp/helpers.ts';
import { createHttpHostFixture } from './http-host-fixture.ts';

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
  { timeout: 20000 },
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
