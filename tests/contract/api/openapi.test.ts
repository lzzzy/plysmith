import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildFixture } from './fixtures.ts';

type ApiDocument = Extract<
  ReturnType<FastifyInstance['swagger']>,
  { openapi: string }
>;
type ApiResponse = NonNullable<
  NonNullable<
    NonNullable<NonNullable<ApiDocument['paths']>[string]>['get']
  >['responses']
>[string];

test('OpenAPI 3.0.3 exposes only the explicit unversioned operations and bearer security', async (t) => {
  const { host } = await buildFixture(t);
  const api = host.swagger();
  assert.ok('openapi' in api);
  assert.equal(api.openapi, '3.0.3');
  assert.deepEqual(Object.keys(api.paths ?? {}).sort(), [
    '/events',
    '/preferences',
    '/preferences/ui-language',
    '/status',
  ]);
  const expected = [
    ['/status', 'get', 'GetSystemStatus'],
    ['/preferences', 'get', 'GetUserPreferences'],
    ['/preferences/ui-language', 'put', 'SetUiLanguage'],
    ['/events', 'get', 'SubscribeHostEvents'],
  ] as const;
  for (const [path, method, operationId] of expected) {
    const item: NonNullable<ApiDocument['paths']>[string] | undefined =
      api.paths?.[path];
    assert.deepEqual(Object.keys(item ?? {}), [method]);
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

test('OpenAPI retains closed DTOs, explicit responses and the shared SSE union', async (t) => {
  const { host } = await buildFixture(t);
  const api = host.swagger();
  assert.ok('openapi' in api);
  for (const name of [
    'SystemStatus',
    'UserPreferences',
    'SetUiLanguageBody',
    'SetUiLanguageResult',
    'ProblemDetails',
    'UiLanguageChangedEvent',
    'ReplayGapEvent',
  ]) {
    const schema:
      | NonNullable<NonNullable<ApiDocument['components']>['schemas']>[string]
      | undefined = api.components?.schemas?.[name];
    assert.ok(schema && 'properties' in schema, name);
    assert.equal(schema.additionalProperties, false, name);
  }
  assert.deepEqual(api.components?.schemas?.HostEvent, {
    anyOf: [
      { $ref: '#/components/schemas/UiLanguageChangedEvent' },
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
  const first = await buildFixture(t);
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
