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

export const diagnosticSettings: Awaited<
  ReturnType<HostClient['getDiagnosticSettings']>
> = {
  configuredLevel: 'debug',
  activeLevel: 'off',
  configurationRevision: `sha256:${'a'.repeat(64)}`,
  restartRequired: true,
};

export const diagnosticReportManifest: Awaited<
  ReturnType<HostClient['getDiagnosticReportManifest']>
> = {
  manifestVersion: 1,
  format: 'plysmith-diagnostics-json-gzip-v1',
  suggestedFileName: 'plysmith-diagnostics-20260914080000.json.gz',
  maximumBytes: 10_485_760,
  includedCategories: [
    'product_identity',
    'runtime_environment',
    'diagnostic_settings',
    'redacted_diagnostic_events',
    'excluded_data_declaration',
  ],
  excludedCategories: [
    'secrets_and_credentials',
    'active_configuration',
    'database_and_backups',
    'local_paths',
    'chess_and_user_content',
    'external_identities',
    'provider_payloads',
    'memory_and_raw_errors',
  ],
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
    async getDiagnosticSettings() {
      calls.push({ method: 'getDiagnosticSettings' });
      return overrides.getDiagnosticSettings
        ? overrides.getDiagnosticSettings()
        : diagnosticSettings;
    },
    async setDiagnosticLogLevel(request) {
      calls.push({ method: 'setDiagnosticLogLevel', request });
      return overrides.setDiagnosticLogLevel
        ? overrides.setDiagnosticLogLevel(request)
        : {
            changed: true,
            settings: { ...diagnosticSettings, configuredLevel: request.level },
          };
    },
    async getDiagnosticReportManifest() {
      calls.push({ method: 'getDiagnosticReportManifest' });
      return overrides.getDiagnosticReportManifest
        ? overrides.getDiagnosticReportManifest()
        : diagnosticReportManifest;
    },
    async createDiagnosticReport(request) {
      calls.push({ method: 'createDiagnosticReport', request });
      return overrides.createDiagnosticReport
        ? overrides.createDiagnosticReport(request)
        : {
            created: true,
            generatedAt: '2026-09-14T08:00:00.000Z',
            format: 'plysmith-diagnostics-json-gzip-v1',
            bytesWritten: 321,
            eventCount: 4,
            discardedLineCount: 1,
            truncated: false,
          };
    },
    async getAnalysisWorkspace(request) {
      calls.push({ method: 'getAnalysisWorkspace', request });
      if (overrides.getAnalysisWorkspace)
        return overrides.getAnalysisWorkspace(request);
      throw new Error('getAnalysisWorkspace fixture not configured');
    },
    async validateAnalysisSetup(request) {
      calls.push({ method: 'validateAnalysisSetup', request });
      if (overrides.validateAnalysisSetup)
        return overrides.validateAnalysisSetup(request);
      throw new Error('validateAnalysisSetup fixture not configured');
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
    async startInventoryRevision(itemId, request) {
      calls.push({
        method: 'startInventoryRevision',
        request: { itemId, ...request },
      });
      if (overrides.startInventoryRevision)
        return overrides.startInventoryRevision(itemId, request);
      throw new Error('startInventoryRevision fixture not configured');
    },
    async promoteAnalysisToInventoryRevision(itemId, request) {
      calls.push({
        method: 'promoteAnalysisToInventoryRevision',
        request: { itemId, ...request },
      });
      if (overrides.promoteAnalysisToInventoryRevision)
        return overrides.promoteAnalysisToInventoryRevision(itemId, request);
      throw new Error(
        'promoteAnalysisToInventoryRevision fixture not configured',
      );
    },
    async previewInventoryRevision(request) {
      calls.push({ method: 'previewInventoryRevision', request });
      if (overrides.previewInventoryRevision)
        return overrides.previewInventoryRevision(request);
      throw new Error('previewInventoryRevision fixture not configured');
    },
    async saveInventoryRevision(request) {
      calls.push({ method: 'saveInventoryRevision', request });
      if (overrides.saveInventoryRevision)
        return overrides.saveInventoryRevision(request);
      throw new Error('saveInventoryRevision fixture not configured');
    },
    async getInventoryRevision(itemId, revisionId, request) {
      calls.push({
        method: 'getInventoryRevision',
        request: { itemId, revisionId, ...request },
      });
      if (overrides.getInventoryRevision)
        return overrides.getInventoryRevision(itemId, revisionId, request);
      throw new Error('getInventoryRevision fixture not configured');
    },
    async listInventoryRevisions(itemId, request) {
      calls.push({
        method: 'listInventoryRevisions',
        request: { itemId, ...request },
      });
      if (overrides.listInventoryRevisions)
        return overrides.listInventoryRevisions(itemId, request);
      throw new Error('listInventoryRevisions fixture not configured');
    },
    async getPendingRevisionImpact(impactId) {
      calls.push({ method: 'getPendingRevisionImpact', request: impactId });
      if (overrides.getPendingRevisionImpact)
        return overrides.getPendingRevisionImpact(impactId);
      throw new Error('getPendingRevisionImpact fixture not configured');
    },
    async resolvePendingRevisionImpact(impactId, request) {
      calls.push({
        method: 'resolvePendingRevisionImpact',
        request: { impactId, ...request },
      });
      if (overrides.resolvePendingRevisionImpact)
        return overrides.resolvePendingRevisionImpact(impactId, request);
      throw new Error('resolvePendingRevisionImpact fixture not configured');
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
    async removeContextItem(contextId, itemId) {
      calls.push({
        method: 'removeContextItem',
        request: { contextId, itemId },
      });
      if (overrides.removeContextItem)
        return overrides.removeContextItem(contextId, itemId);
      throw new Error('removeContextItem fixture not configured');
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
    async listPositionAnalysisProviders() {
      calls.push({ method: 'listPositionAnalysisProviders' });
      if (overrides.listPositionAnalysisProviders)
        return overrides.listPositionAnalysisProviders();
      return { providers: [] };
    },
    async analyzePosition(request) {
      calls.push({ method: 'analyzePosition', request });
      if (overrides.analyzePosition) return overrides.analyzePosition(request);
      throw new Error('analyzePosition fixture not configured');
    },
    async listMovePolicyProviders() {
      calls.push({ method: 'listMovePolicyProviders' });
      if (overrides.listMovePolicyProviders)
        return overrides.listMovePolicyProviders();
      return { providers: [] };
    },
    async getPlayout(request) {
      calls.push({ method: 'getPlayout', request });
      if (overrides.getPlayout) return overrides.getPlayout(request);
      return null;
    },
    async startPlayout(request) {
      calls.push({ method: 'startPlayout', request });
      if (overrides.startPlayout) return overrides.startPlayout(request);
      throw new Error('startPlayout fixture not configured');
    },
    async submitPlayoutMove(request) {
      calls.push({ method: 'submitPlayoutMove', request });
      if (overrides.submitPlayoutMove)
        return overrides.submitPlayoutMove(request);
      throw new Error('submitPlayoutMove fixture not configured');
    },
    async retryPlayout(request) {
      calls.push({ method: 'retryPlayout', request });
      if (overrides.retryPlayout) return overrides.retryPlayout(request);
      throw new Error('retryPlayout fixture not configured');
    },
    async pausePlayout(request) {
      calls.push({ method: 'pausePlayout', request });
      if (overrides.pausePlayout) return overrides.pausePlayout(request);
      throw new Error('pausePlayout fixture not configured');
    },
    async resumePlayout(request) {
      calls.push({ method: 'resumePlayout', request });
      if (overrides.resumePlayout) return overrides.resumePlayout(request);
      throw new Error('resumePlayout fixture not configured');
    },
    async stopPlayout(request) {
      calls.push({ method: 'stopPlayout', request });
      if (overrides.stopPlayout) return overrides.stopPlayout(request);
      throw new Error('stopPlayout fixture not configured');
    },
    async completePlayout(request) {
      calls.push({ method: 'completePlayout', request });
      if (overrides.completePlayout) return overrides.completePlayout(request);
      throw new Error('completePlayout fixture not configured');
    },
    async discardPlayout(request) {
      calls.push({ method: 'discardPlayout', request });
      if (overrides.discardPlayout) return overrides.discardPlayout(request);
      throw new Error('discardPlayout fixture not configured');
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
