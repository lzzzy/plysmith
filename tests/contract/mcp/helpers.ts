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
    async getAnalysisWorkspace(request) {
      calls.push({ method: 'getAnalysisWorkspace', request });
      if (overrides.getAnalysisWorkspace)
        return overrides.getAnalysisWorkspace(request);
      throw new Error('getAnalysisWorkspace fixture not configured');
    },
    async updateAnalysisScratch(request) {
      calls.push({ method: 'updateAnalysisScratch', request });
      if (overrides.updateAnalysisScratch)
        return overrides.updateAnalysisScratch(request);
      throw new Error('updateAnalysisScratch fixture not configured');
    },
    async createAnalysisRecord(request) {
      calls.push({ method: 'createAnalysisRecord', request });
      if (overrides.createAnalysisRecord)
        return overrides.createAnalysisRecord(request);
      throw new Error('createAnalysisRecord fixture not configured');
    },
    async createAnalysisNote(request) {
      calls.push({ method: 'createAnalysisNote', request });
      if (overrides.createAnalysisNote)
        return overrides.createAnalysisNote(request);
      throw new Error('createAnalysisNote fixture not configured');
    },
    async createPositionNote(request) {
      calls.push({ method: 'createPositionNote', request });
      if (overrides.createPositionNote)
        return overrides.createPositionNote(request);
      throw new Error('createPositionNote fixture not configured');
    },
    async updateAnalysisNote(contributionId, request) {
      calls.push({
        method: 'updateAnalysisNote',
        request: { contributionId, ...request },
      });
      if (overrides.updateAnalysisNote)
        return overrides.updateAnalysisNote(contributionId, request);
      throw new Error('updateAnalysisNote fixture not configured');
    },
    async deleteAnalysisNote(contributionId, request) {
      calls.push({
        method: 'deleteAnalysisNote',
        request: { contributionId, ...request },
      });
      if (overrides.deleteAnalysisNote)
        return overrides.deleteAnalysisNote(contributionId, request);
      throw new Error('deleteAnalysisNote fixture not configured');
    },
    async searchInventory(request) {
      calls.push({ method: 'searchInventory', request });
      if (overrides.searchInventory) return overrides.searchInventory(request);
      throw new Error('searchInventory fixture not configured');
    },
    async listWorkingContexts(request) {
      calls.push({ method: 'listWorkingContexts', request });
      if (overrides.listWorkingContexts)
        return overrides.listWorkingContexts(request);
      throw new Error('listWorkingContexts fixture not configured');
    },
    async getWorkingContextWorkspace(contextId) {
      calls.push({ method: 'getWorkingContextWorkspace', request: contextId });
      if (overrides.getWorkingContextWorkspace)
        return overrides.getWorkingContextWorkspace(contextId);
      throw new Error('getWorkingContextWorkspace fixture not configured');
    },
    async createWorkingContext(request) {
      calls.push({ method: 'createWorkingContext', request });
      if (overrides.createWorkingContext)
        return overrides.createWorkingContext(request);
      throw new Error('createWorkingContext fixture not configured');
    },
    async addContextReference(contextId, request) {
      calls.push({
        method: 'addContextReference',
        request: { contextId, ...request },
      });
      if (overrides.addContextReference)
        return overrides.addContextReference(contextId, request);
      throw new Error('addContextReference fixture not configured');
    },
    async setWorkScopeResume(contextId, request) {
      calls.push({
        method: 'setWorkScopeResume',
        request: { contextId, ...request },
      });
      if (overrides.setWorkScopeResume)
        return overrides.setWorkScopeResume(contextId, request);
      throw new Error('setWorkScopeResume fixture not configured');
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
