import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  createMcpServer,
  type HostProblem,
  type HostClient,
} from '../../../app/infrastructure/channels/mcp/index.ts';
import {
  contractFingerprint,
  productRelease,
} from '../../../contracts/host/index.ts';

export const systemStatus: Awaited<ReturnType<HostClient['getSystemStatus']>> =
  {
    state: 'ready',
    persistence: { schemaVersion: 1, dataRevision: 0 },
    productRelease,
    contractFingerprint,
  };

export const preferences: Awaited<
  ReturnType<HostClient['getUserPreferences']>
> = {
  uiLocale: 'de-DE',
  preferenceRevision: 1,
  dataRevision: 0,
  updatedAt: '2026-09-09T08:00:00.000Z',
};

export const revisionConflict: HostProblem = {
  type: 'https://github.com/lzzzy/plysmith/blob/main/docs/problems/preference.revision_conflict.md',
  title: 'Preference revision conflict',
  status: 409,
  detail: 'Read the current preferences before submitting another change.',
  instance: 'urn:plysmith:problem:conflict-1',
  code: 'preference.revision_conflict',
  correlationId: 'conflict-1',
  retryable: false,
  parameters: { expectedRevision: 1, currentRevision: 2 },
};

export async function connectMcp(
  t: TestContext,
  overrides: Partial<HostClient> = {},
) {
  const calls: { method: string; request?: unknown }[] = [];
  const hostClient: HostClient = {
    async getSystemStatus() {
      calls.push({ method: 'getSystemStatus' });
      return overrides.getSystemStatus
        ? overrides.getSystemStatus()
        : systemStatus;
    },
    async getUserPreferences() {
      calls.push({ method: 'getUserPreferences' });
      return overrides.getUserPreferences
        ? overrides.getUserPreferences()
        : preferences;
    },
    async setUiLanguage(request) {
      calls.push({ method: 'setUiLanguage', request });
      return overrides.setUiLanguage
        ? overrides.setUiLanguage(request)
        : {
            changed: true,
            preferences: { ...preferences, uiLocale: request.uiLocale },
          };
    },
  };
  const server = createMcpServer({ hostClient, productRelease });
  const client = new Client({ name: 'plysmith-mcp-test', version: '1.0.0' });
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

export function assertToolData(
  result: Awaited<ReturnType<Client['callTool']>>,
  data: Record<string, unknown>,
): void {
  assert.deepEqual(result.structuredContent, data);
  const content = result.content as { type: string; text: string }[];
  assert.ok(content.every((item) => item.type === 'text'));
  assert.deepEqual(JSON.parse(content.at(-1)?.text ?? ''), data);
}

export function assertNeutralProblem(value: unknown): void {
  assert.ok(typeof value === 'object' && value !== null);
  const problem = value as HostProblem;
  assert.equal(problem.code, 'host.failure');
  assert.equal(problem.status, 500);
  assert.equal(problem.title, 'Host failure');
  assert.equal(problem.detail, 'The host could not complete the operation.');
  assert.equal(problem.retryable, false);
  assert.deepEqual(problem.parameters, {});
  assert.match(problem.correlationId, /^[a-f0-9-]{36}$/);
  assert.equal(
    problem.instance,
    `urn:plysmith:problem:${problem.correlationId}`,
  );
  assert.equal(
    problem.type,
    'https://github.com/lzzzy/plysmith/blob/main/docs/problems/host.failure.md',
  );
  assert.deepEqual(Object.keys(problem).sort(), [
    'code',
    'correlationId',
    'detail',
    'instance',
    'parameters',
    'retryable',
    'status',
    'title',
    'type',
  ]);
}
