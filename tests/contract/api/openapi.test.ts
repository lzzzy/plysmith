import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildFixture, buildReadOnlyFixture } from './fixtures.ts';

type ApiDocument = Extract<
  ReturnType<FastifyInstance['swagger']>,
  { openapi: string }
>;
type ApiResponse = NonNullable<
  NonNullable<
    NonNullable<NonNullable<ApiDocument['paths']>[string]>['get']
  >['responses']
>[string];

test('OpenAPI 3.0.3 exposes only the explicit unversioned operations and bearer security', async () => {
  const { host } = await buildReadOnlyFixture();
  const api = host.swagger();
  assert.ok('openapi' in api);
  assert.equal(api.openapi, '3.0.3');
  assert.deepEqual(Object.keys(api.paths ?? {}).sort(), [
    '/analysis/notes',
    '/analysis/notes/{contributionId}',
    '/analysis/position',
    '/analysis/position-notes',
    '/analysis/providers',
    '/analysis/scratch',
    '/analysis/setup-validation',
    '/analysis/workspace',
    '/diagnostics/report-manifest',
    '/diagnostics/reports',
    '/diagnostics/settings',
    '/diagnostics/settings/log-level',
    '/engine-providers/configuration-preview',
    '/engine-providers/configurations',
    '/engine-providers/configurations/{instanceId}',
    '/events',
    '/inventory',
    '/inventory/analysis-records',
    '/inventory/import-inputs',
    '/inventory/imports/discard',
    '/inventory/imports/names',
    '/inventory/imports/preview',
    '/inventory/imports/publish',
    '/inventory/items/{itemId}',
    '/inventory/items/{itemId}/deletion-preview',
    '/inventory/items/{itemId}/revision-edits',
    '/inventory/items/{itemId}/revision-edits/promote-analysis',
    '/inventory/items/{itemId}/revisions',
    '/inventory/items/{itemId}/revisions/{revisionId}',
    '/inventory/name-availability',
    '/inventory/organization',
    '/inventory/organization/removal-preview',
    '/inventory/revision-edits/preview',
    '/inventory/revision-edits/save',
    '/playout',
    '/playout/cancel-completion',
    '/playout/complete',
    '/playout/moves',
    '/playout/pause',
    '/playout/providers',
    '/playout/resume',
    '/playout/retry',
    '/playout/stop',
    '/preferences',
    '/preferences/ui-language',
    '/status',
    '/working-contexts',
    '/working-contexts/{contextId}',
    '/working-contexts/{contextId}/deletion-preview',
    '/working-contexts/{contextId}/items/{itemId}',
    '/working-contexts/{contextId}/items/{itemId}/removal-preview',
    '/working-contexts/{contextId}/metadata',
    '/working-contexts/{contextId}/references',
    '/workspace/management-presentation',
    '/workspace/resume',
    '/workspace/revision-impacts/{impactId}',
    '/workspace/revision-impacts/{impactId}/resolution',
    '/workspace/scope',
    '/workspace/startup',
  ]);
  const expected = [
    ['/inventory/import-inputs', 'post', 'RegisterImportInput'],
    ['/inventory/imports/preview', 'post', 'PrepareImport'],
    ['/inventory/imports/names', 'post', 'CheckImportNames'],
    ['/inventory/imports/publish', 'post', 'PublishImport'],
    ['/inventory/imports/discard', 'post', 'DiscardImport'],
    ['/inventory/organization', 'get', 'GetInventoryOrganization'],
    ['/inventory/organization', 'post', 'ChangeInventoryOrganization'],
    [
      '/inventory/organization/removal-preview',
      'get',
      'PreviewContextFolderRemoval',
    ],
    ['/inventory/name-availability', 'get', 'CheckInventoryNameAvailability'],
    ['/status', 'get', 'GetSystemStatus'],
    ['/preferences', 'get', 'GetUserPreferences'],
    ['/preferences/ui-language', 'put', 'SetUiLanguage'],
    ['/diagnostics/settings', 'get', 'GetDiagnosticSettings'],
    ['/diagnostics/settings/log-level', 'put', 'SetDiagnosticLogLevel'],
    ['/diagnostics/report-manifest', 'get', 'GetDiagnosticReportManifest'],
    ['/diagnostics/reports', 'post', 'CreateDiagnosticReport'],
    [
      '/engine-providers/configurations',
      'get',
      'GetEngineProviderConfigurations',
    ],
    [
      '/engine-providers/configuration-preview',
      'post',
      'PreviewEngineProviderConfiguration',
    ],
    [
      '/engine-providers/configurations/{instanceId}',
      'put',
      'SaveEngineProviderConfiguration',
    ],
    [
      '/engine-providers/configurations/{instanceId}',
      'delete',
      'RemoveEngineProviderConfiguration',
    ],
    ['/events', 'get', 'SubscribeHostEvents'],
    ['/analysis/workspace', 'get', 'GetAnalysisWorkspace'],
    ['/analysis/providers', 'get', 'ListPositionAnalysisProviders'],
    ['/analysis/position', 'post', 'AnalyzePosition'],
    ['/analysis/setup-validation', 'post', 'ValidateAnalysisSetup'],
    ['/analysis/scratch', 'put', 'UpdateAnalysisScratch'],
    ['/analysis/notes', 'post', 'CreateAnalysisNote'],
    ['/analysis/position-notes', 'post', 'CreatePositionNote'],
    ['/analysis/notes/{contributionId}', 'patch', 'UpdateAnalysisNote'],
    ['/analysis/notes/{contributionId}', 'delete', 'DeleteAnalysisNote'],
    ['/inventory/analysis-records', 'post', 'CreateAnalysisRecord'],
    ['/inventory', 'get', 'SearchInventory'],
    [
      '/inventory/items/{itemId}/revision-edits',
      'post',
      'StartInventoryRevision',
    ],
    [
      '/inventory/items/{itemId}/revision-edits/promote-analysis',
      'post',
      'PromoteAnalysisToInventoryRevision',
    ],
    ['/inventory/revision-edits/preview', 'post', 'PreviewInventoryRevision'],
    ['/inventory/revision-edits/save', 'post', 'SaveInventoryRevision'],
    [
      '/inventory/items/{itemId}/revisions/{revisionId}',
      'get',
      'GetInventoryRevision',
    ],
    ['/inventory/items/{itemId}/revisions', 'get', 'ListInventoryRevisions'],
    ['/playout/providers', 'get', 'ListMovePolicyProviders'],
    ['/playout', 'get', 'GetPlayout'],
    ['/playout', 'post', 'StartPlayout'],
    ['/playout', 'delete', 'DiscardPlayout'],
    ['/playout/moves', 'post', 'SubmitPlayoutMove'],
    ['/playout/retry', 'post', 'RetryPlayoutPolicyMove'],
    ['/playout/pause', 'post', 'PausePlayout'],
    ['/playout/resume', 'post', 'ResumePlayout'],
    ['/playout/stop', 'post', 'StopPlayout'],
    ['/playout/cancel-completion', 'post', 'CancelPlayoutCompletion'],
    ['/playout/complete', 'post', 'CompletePlayout'],
    ['/working-contexts', 'get', 'ListWorkingContexts'],
    ['/working-contexts', 'post', 'CreateWorkingContext'],
    ['/working-contexts/{contextId}', 'get', 'GetWorkingContextWorkspace'],
    [
      '/working-contexts/{contextId}/metadata',
      'put',
      'UpdateWorkingContextMetadata',
    ],
    [
      '/working-contexts/{contextId}/items/{itemId}',
      'delete',
      'RemoveContextItem',
    ],
    ['/working-contexts/{contextId}/references', 'post', 'AddContextReference'],
    ['/workspace/resume', 'put', 'SetWorkScopeResume'],
    ['/workspace/management-presentation', 'put', 'SetManagementPresentation'],
    ['/workspace/scope', 'get', 'GetWorkScopeWorkspace'],
    ['/workspace/startup', 'get', 'GetStartupResume'],
    ['/workspace/startup', 'put', 'SetStartupResume'],
    [
      '/working-contexts/{contextId}/items/{itemId}/removal-preview',
      'get',
      'PreviewContextItemRemoval',
    ],
    [
      '/working-contexts/{contextId}/deletion-preview',
      'get',
      'PreviewWorkingContextDeletion',
    ],
    ['/working-contexts/{contextId}', 'delete', 'DeleteWorkingContext'],
    [
      '/inventory/items/{itemId}/deletion-preview',
      'get',
      'PreviewInventoryItemDeletion',
    ],
    ['/inventory/items/{itemId}', 'delete', 'DeleteInventoryItem'],
    [
      '/workspace/revision-impacts/{impactId}',
      'get',
      'GetPendingRevisionImpact',
    ],
    [
      '/workspace/revision-impacts/{impactId}/resolution',
      'post',
      'ResolvePendingRevisionImpact',
    ],
  ] as const;
  for (const [path, method, operationId] of expected) {
    const item: NonNullable<ApiDocument['paths']>[string] | undefined =
      api.paths?.[path];
    assert.ok(item?.[method]);
    assert.equal(item?.[method]?.operationId, operationId);
    const response: ApiResponse | undefined =
      item?.[method]?.responses?.['500'];
    assert.ok(response && 'content' in response);
    assert.deepEqual(response.content?.['application/problem+json']?.schema, {
      $ref: '#/components/schemas/ProblemDetails',
    });
  }
  assert.deepEqual(api.security, [{ hostBearer: [] }]);
  assert.deepEqual(api.components?.securitySchemes?.hostBearer, {
    type: 'http',
    scheme: 'bearer',
  });
});

test('OpenAPI retains closed DTOs, explicit responses and the shared SSE union', async () => {
  const { host } = await buildReadOnlyFixture();
  const api = host.swagger();
  assert.ok('openapi' in api);
  for (const name of [
    'ImportInputDescriptor',
    'RegisterImportInputBody',
    'ImportFidelityFinding',
    'ImportCandidatePreview',
    'ImportPreview',
    'ImportNameChecks',
    'PrepareImportBody',
    'CheckImportNamesBody',
    'PublishImportBody',
    'DiscardImportBody',
    'DiscardImportResult',
    'ImportPublished',
    'SystemStatus',
    'UserPreferences',
    'SetUiLanguageBody',
    'SetUiLanguageResult',
    'DiagnosticSettings',
    'SetDiagnosticLogLevelBody',
    'SetDiagnosticLogLevelResult',
    'DiagnosticReportManifest',
    'CreateDiagnosticReportBody',
    'CreateDiagnosticReportResult',
    'ProblemDetails',
    'UiLanguageChangedEvent',
    'ReplayGapEvent',
    'AnalysisWorkspace',
    'PositionAnalysisProvider',
    'ListPositionAnalysisProvidersResult',
    'AnalyzePositionBody',
    'AnalysisWdl',
    'UpdateAnalysisScratchBody',
    'UpdateAnalysisScratchResult',
    'CreateAnalysisRecordBody',
    'CreateAnalysisRecordResult',
    'CreateAnalysisNoteBody',
    'CreateAnalysisNoteResult',
    'CreatePositionNoteBody',
    'UpdateAnalysisNoteBody',
    'DeleteAnalysisNoteBody',
    'AnalysisNoteMutationResult',
    'SearchInventoryResult',
    'StartInventoryRevisionBody',
    'StartInventoryRevisionResult',
    'PromoteAnalysisToInventoryRevisionBody',
    'InventoryRevisionPreview',
    'SaveInventoryRevisionBody',
    'SaveInventoryRevisionResult',
    'ListInventoryRevisionsResult',
    'PendingRevisionImpact',
    'ResolvePendingRevisionImpactBody',
    'ResolvePendingRevisionImpactResult',
    'ListWorkingContextsResult',
    'WorkingContextWorkspace',
    'CreateWorkingContextBody',
    'CreateWorkingContextResult',
    'AddContextReferenceBody',
    'AddContextReferenceResult',
    'RemoveContextItemResult',
    'WorkspaceItemRemovedEvent',
    'ContextRemovalPreview',
    'InventoryItemDeletionPreview',
    'WorkScopeWorkspace',
    'StartupResume',
    'SetStartupResumeBody',
    'SetManagementPresentationBody',
    'SetManagementPresentationResult',
    'RemoveContextItemBody',
    'DeleteWorkingContextBody',
    'DeleteInventoryItemBody',
  ]) {
    const schema:
      | NonNullable<NonNullable<ApiDocument['components']>['schemas']>[string]
      | undefined = api.components?.schemas?.[name];
    assert.ok(schema && 'properties' in schema, name);
    assert.equal(schema.additionalProperties, false, name);
  }
  const positionAnalysisSnapshot = api.components?.schemas
    ?.PositionAnalysisSnapshot as
    { anyOf?: { additionalProperties?: boolean }[] } | undefined;
  assert.equal(positionAnalysisSnapshot?.anyOf?.length, 2);
  assert.ok(
    positionAnalysisSnapshot?.anyOf?.every(
      (schema) => schema.additionalProperties === false,
    ),
  );
  assert.deepEqual(api.components?.schemas?.HostEvent, {
    anyOf: [
      { $ref: '#/components/schemas/InventoryItemDeletedEvent' },
      { $ref: '#/components/schemas/WorkspaceContextDeletedEvent' },
      { $ref: '#/components/schemas/WorkspaceStartupUpdatedEvent' },
      { $ref: '#/components/schemas/UiLanguageChangedEvent' },
      { $ref: '#/components/schemas/InventoryOrganizationChangedEvent' },
      { $ref: '#/components/schemas/AnalysisScratchChangedEvent' },
      { $ref: '#/components/schemas/AnalysisContributionCreatedEvent' },
      { $ref: '#/components/schemas/AnalysisContributionChangedEvent' },
      { $ref: '#/components/schemas/InventoryItemCreatedEvent' },
      { $ref: '#/components/schemas/InventoryRevisionSavedEvent' },
      { $ref: '#/components/schemas/PlayoutChangedEvent' },
      {
        $ref: '#/components/schemas/WorkspaceRevisionImpactChangedEvent',
      },
      { $ref: '#/components/schemas/WorkspaceContextCreatedEvent' },
      { $ref: '#/components/schemas/WorkspaceReferenceAddedEvent' },
      { $ref: '#/components/schemas/WorkspaceItemRemovedEvent' },
      { $ref: '#/components/schemas/WorkspaceResumeUpdatedEvent' },
      { $ref: '#/components/schemas/ReplayGapEvent' },
    ],
  });
  const events = api.paths?.['/events']?.get;
  assert.ok(
    events?.parameters?.some(
      (parameter) =>
        'name' in parameter &&
        parameter.name === 'last-event-id' &&
        parameter.in === 'header' &&
        parameter.required === false,
    ),
  );
  const response = events?.responses?.['200'];
  assert.ok(response && 'content' in response);
  assert.deepEqual(response.content?.['text/event-stream']?.schema, {
    type: 'string',
    'x-host-event-schema': { $ref: '#/components/schemas/HostEvent' },
  });
  assert.ok(api.paths?.['/preferences/ui-language']?.put?.responses?.['409']);
});

test('the generated contract is deterministic and excludes runtime tokens and fingerprints', async (t) => {
  const first = await buildReadOnlyFixture();
  const second = await buildFixture(t, {
    security: { hostToken: 'another-test-token' },
    contractFingerprint: 'different-runtime-fingerprint',
    correlationIdFactory: () => 'another-correlation',
  });
  const contract = JSON.stringify(first.host.swagger());
  assert.equal(JSON.stringify(second.host.swagger()), contract);
  assert.ok(!contract.includes('test-only-host-token'));
  assert.ok(!contract.includes('test-contract-fingerprint'));
});
