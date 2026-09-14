import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApplicationProblem } from '../../../app/application/problems/application-problem.ts';
import { localId } from '../../../app/domain/identity/index.ts';
import { problemUriBase } from '../../../app/infrastructure/channels/api/problems.ts';
import {
  buildFixture,
  createFixture,
  headers,
  occurredAt,
} from './fixtures.ts';

test('status includes the application read model and release handshake only', async (t) => {
  const { host } = await buildFixture(t);
  const response = await host.inject({ url: '/status', headers });
  assert.deepEqual(response.json(), {
    state: 'ready',
    persistence: { schemaVersion: 1, dataRevision: 0 },
    productRelease: '0.0.0-test',
    contractFingerprint: 'test-contract-fingerprint',
  });
});

test('real application use cases preserve success, no-op and stale-write semantics', async (t) => {
  const { host, published } = await buildFixture(t);
  const initial = await host.inject({ url: '/preferences', headers });
  assert.equal(initial.json().uiLocale, 'de-DE');
  const noOp = await host.inject({
    method: 'PUT',
    url: '/preferences/ui-language',
    headers,
    payload: { uiLocale: 'de-DE', expectedRevision: 1 },
  });
  assert.deepEqual(noOp.json(), {
    changed: false,
    preferences: initial.json(),
  });
  assert.equal(published.length, 0);

  const changed = await host.inject({
    method: 'PUT',
    url: '/preferences/ui-language',
    headers,
    payload: { uiLocale: 'en-GB', expectedRevision: 1 },
  });
  assert.equal(changed.statusCode, 200);
  assert.deepEqual(changed.json(), {
    changed: true,
    preferences: {
      uiLocale: 'en-GB',
      preferenceRevision: 2,
      dataRevision: 1,
      updatedAt: occurredAt,
    },
  });
  assert.equal(published.length, 1);
  const stale = await host.inject({
    method: 'PUT',
    url: '/preferences/ui-language',
    headers,
    payload: { uiLocale: 'en-GB', expectedRevision: 1 },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, 'preference.revision_conflict');
  assert.deepEqual(stale.json().parameters, {
    expectedRevision: 1,
    currentRevision: 2,
  });
  assert.equal(published.length, 1);
});

test('concurrent writes invoke the application once per request without retry', async (t) => {
  const { host, published } = await buildFixture(t);
  const results = await Promise.all(
    [1, 2].map(() =>
      host.inject({
        method: 'PUT',
        url: '/preferences/ui-language',
        headers,
        payload: { uiLocale: 'en-GB', expectedRevision: 1 },
      }),
    ),
  );
  assert.deepEqual(
    results.map((result) => result.statusCode).sort(),
    [200, 409],
  );
  assert.equal(published.length, 1);
});

test('request schema rejects extras, coercion, invalid languages and invalid revisions before application', async (t) => {
  let calls = 0;
  const fixture = createFixture();
  const { host } = await buildFixture(t, {
    setUiLanguage: {
      execute: (request) => {
        calls++;
        return fixture.dependencies.setUiLanguage.execute(request);
      },
    },
  });
  for (const payload of [
    {},
    { uiLocale: 'en-GB' },
    { uiLocale: 'fr-FR', expectedRevision: 1 },
    { uiLocale: 'en-GB', expectedRevision: '1' },
    { uiLocale: 'en-GB', expectedRevision: 0 },
    { uiLocale: 'en-GB', expectedRevision: 1.5 },
    { uiLocale: 'en-GB', expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { uiLocale: 'en-GB', expectedRevision: 1, secret: 'CANARY' },
    { uiLocale: ['en-GB'], expectedRevision: 1 },
    [],
  ]) {
    const response = await host.inject({
      method: 'PUT',
      url: '/preferences/ui-language',
      headers,
      payload,
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'request.invalid');
    assert.ok(!response.body.includes('CANARY'));
    assert.ok(!response.body.includes('schemaPath'));
  }
  assert.equal(calls, 0);
  const query = await host.inject({
    url: '/preferences?unexpected=CANARY',
    headers,
  });
  assert.equal(query.statusCode, 400);
});

test('malformed JSON, missing routes, media type and oversized body use neutral problem details', async (t) => {
  const { host } = await buildFixture(t);
  const scenarios = [
    {
      url: '/preferences/ui-language',
      payload: '{CANARY',
      contentType: 'application/json',
      status: 400,
    },
    {
      url: '/preferences/ui-language',
      payload: 'CANARY',
      contentType: 'application/xml',
      status: 415,
    },
    {
      url: '/preferences/ui-language',
      payload: JSON.stringify({ data: 'CANARY'.repeat(4000) }),
      contentType: 'application/json',
      status: 413,
    },
  ];
  for (const scenario of scenarios) {
    const response = await host.inject({
      method: 'PUT',
      url: scenario.url,
      payload: scenario.payload,
      headers: { ...headers, 'content-type': scenario.contentType },
    });
    assert.equal(response.statusCode, scenario.status);
    assert.match(
      String(response.headers['content-type']),
      /^application\/problem\+json/,
    );
    assert.ok(!response.body.includes('CANARY'));
  }
  const missing = await host.inject({ url: '/CANARY?secret=CANARY', headers });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().code, 'request.not_found');
  assert.ok(!missing.body.includes('CANARY'));
});

for (const [code, status] of [
  ['preference.invalid_ui_language', 400],
  ['preference.invalid_revision', 400],
  ['preference.revision_conflict', 409],
  ['unknown.CANARY', 500],
] as const) {
  test(`application problem ${code} maps without exposing its message or arbitrary parameters`, async (t) => {
    const { host } = await buildFixture(t, {
      setUiLanguage: {
        execute: async () => {
          throw new ApplicationProblem(code, 'C:/secret/CANARY', {
            secret: 'CANARY',
            expectedRevision: 1,
            currentRevision: 3,
          });
        },
      },
    });
    const response = await host.inject({
      method: 'PUT',
      url: '/preferences/ui-language',
      headers,
      payload: { uiLocale: 'en-GB', expectedRevision: 1 },
    });
    assert.equal(response.statusCode, status);
    const body = response.json();
    assert.equal(body.code, status === 500 ? 'host.failure' : code);
    assert.equal(body.type, `${problemUriBase}${body.code}.md`);
    assert.equal(body.correlationId, 'test-correlation');
    assert.equal(body.instance, 'urn:plysmith:problem:test-correlation');
    assert.equal(body.retryable, false);
    assert.ok(!response.body.includes('CANARY'));
    assert.deepEqual(
      body.parameters,
      status === 409 ? { expectedRevision: 1, currentRevision: 3 } : {},
    );
  });
}

test('unexpected exceptions receive one injected correlation and no internal detail', async (t) => {
  let correlations = 0;
  const { host } = await buildFixture(t, {
    getSystemStatus: {
      execute: async () => {
        throw new Error('CANARY secret stack path');
      },
    },
    correlationIdFactory: () => `correlation-${++correlations}`,
  });
  const response = await host.inject({ url: '/status', headers });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().code, 'host.failure');
  assert.equal(response.json().correlationId, 'correlation-1');
  assert.equal(correlations, 1);
  assert.ok(!response.body.includes('CANARY'));
});

test('host problems and request diagnostics preserve the client correlation', async (t) => {
  const diagnostics: unknown[] = [];
  const { host } = await buildFixture(t, {
    getSystemStatus: {
      execute: async () => {
        throw new Error('CANARY request content');
      },
    },
    diagnostics: { write: (event) => diagnostics.push(event) },
  });

  const response = await host.inject({
    url: '/status',
    headers: {
      ...headers,
      'x-plysmith-correlation-id': 'client-correlation-7',
    },
  });

  assert.equal(response.json().correlationId, 'client-correlation-7');
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0], {
    level: 'error',
    eventCode: 'host.request.completed',
    correlationId: 'client-correlation-7',
    operation: 'GetSystemStatus',
    status: 'failed',
    problemCode: 'host.failure',
    statusCode: 500,
    durationMilliseconds: (diagnostics[0] as { durationMilliseconds: number })
      .durationMilliseconds,
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /CANARY/);
});

test('analysis query rejects inconsistent scopes and incomplete previews before application', async (t) => {
  let calls = 0;
  const { host } = await buildFixture(t, {
    getAnalysisWorkspace: {
      execute: async () => {
        calls += 1;
        throw new Error('must not be called');
      },
    },
  });
  for (const url of [
    '/analysis/workspace?scopeKind=context',
    '/analysis/workspace?scopeKind=free&contextId=1',
    '/analysis/workspace?scopeKind=free&itemId=1',
    '/analysis/workspace?scopeKind=free&itemId=1&revisionId=1',
    '/analysis/workspace?scopeKind=context&contextId=9999999999999999',
  ]) {
    const response = await host.inject({ url, headers });
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json().code, 'request.invalid');
  }
  assert.equal(calls, 0);
});

test('analysis note route maps explicit source and visibility ids without transport leakage', async (t) => {
  let received: unknown;
  const { host } = await buildFixture(t, {
    createAnalysisNote: {
      execute: async (request) => {
        received = request;
        return {
          contributionId: localId('contribution', 4),
          itemId: localId('inventory-item', 2),
          revisionId: localId('item-revision', 3),
          anchorId: localId('anchor', 5),
          scopeKind: 'context',
          contextId: localId('working-context', 1),
          resumeUpdate: {
            contextId: localId('working-context', 1),
            resumeVersion: 7,
          },
          dataRevision: 9,
        };
      },
    },
  });
  const response = await host.inject({
    method: 'POST',
    url: '/analysis/notes',
    headers,
    payload: {
      scope: { kind: 'context', contextId: '1' },
      expectedScratchId: 'scratch-6',
      expectedScratchRevision: 6,
      languageTag: 'de-DE',
      noteScope: { kind: 'context', contextId: '1' },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, {
    scope: { kind: 'context', contextId: localId('working-context', 1) },
    expectedScratchId: 'scratch-6',
    expectedScratchRevision: 6,
    languageTag: 'de-DE',
    noteScope: {
      kind: 'context',
      contextId: localId('working-context', 1),
    },
  });
  assert.deepEqual(response.json(), {
    contributionId: '4',
    itemId: '2',
    revisionId: '3',
    anchorId: '5',
    scopeKind: 'context',
    contextId: '1',
    resumeUpdate: { contextId: '1', resumeVersion: 7 },
    dataRevision: 9,
  });
});

test('position note routes map exact anchors and optimistic note revisions', async (t) => {
  const received: unknown[] = [];
  const result = {
    contributionId: localId('contribution', 4),
    itemId: localId('inventory-item', 2),
    anchorId: localId('anchor', 5),
    contributionVersion: 2,
    dataRevision: 9,
  };
  const { host } = await buildFixture(t, {
    createPositionNote: {
      execute: async (request) => {
        received.push(request);
        return { ...result, contributionVersion: 1 };
      },
    },
    updateAnalysisNote: {
      execute: async (request) => {
        received.push(request);
        return result;
      },
    },
    deleteAnalysisNote: {
      execute: async (request) => {
        received.push(request);
        return { ...result, contributionVersion: 3 };
      },
    },
  });
  const scope = { kind: 'context', contextId: '1' } as const;
  const created = await host.inject({
    method: 'POST',
    url: '/analysis/position-notes',
    headers,
    payload: {
      scope,
      itemId: '2',
      revisionId: '3',
      anchorId: '5',
      body: 'Nach e4',
      languageTag: 'de-DE',
      noteScope: { kind: 'context', contextId: '1' },
    },
  });
  const updated = await host.inject({
    method: 'PATCH',
    url: '/analysis/notes/4',
    headers,
    payload: { scope, expectedContributionVersion: 1, body: 'Nach e4!' },
  });
  const deleted = await host.inject({
    method: 'DELETE',
    url: '/analysis/notes/4',
    headers,
    payload: { scope, expectedContributionVersion: 2 },
  });

  assert.deepEqual(received, [
    {
      scope: { kind: 'context', contextId: localId('working-context', 1) },
      itemId: localId('inventory-item', 2),
      revisionId: localId('item-revision', 3),
      anchorId: localId('anchor', 5),
      body: 'Nach e4',
      languageTag: 'de-DE',
      noteScope: {
        kind: 'context',
        contextId: localId('working-context', 1),
      },
    },
    {
      scope: { kind: 'context', contextId: localId('working-context', 1) },
      contributionId: localId('contribution', 4),
      expectedContributionVersion: 1,
      body: 'Nach e4!',
    },
    {
      scope: { kind: 'context', contextId: localId('working-context', 1) },
      contributionId: localId('contribution', 4),
      expectedContributionVersion: 2,
    },
  ]);
  assert.deepEqual(created.json(), {
    contributionId: '4',
    itemId: '2',
    anchorId: '5',
    contributionVersion: 1,
    dataRevision: 9,
  });
  assert.equal(updated.json().contributionVersion, 2);
  assert.equal(deleted.json().contributionVersion, 3);
});

test('iteration-two application problems keep stable status and zero revision sentinels', async (t) => {
  const { host } = await buildFixture(t, {
    updateAnalysisScratch: {
      execute: async () => {
        throw new ApplicationProblem(
          'analysis.scratch_revision_conflict',
          'CANARY private detail',
          { expectedRevision: 0, currentRevision: 3, secret: 'CANARY' },
        );
      },
    },
  });
  const response = await host.inject({
    method: 'PUT',
    url: '/analysis/scratch',
    headers,
    payload: {
      scope: { kind: 'free' },
      expectedScratchId: 'scratch-1',
      expectedScratchRevision: 1,
      action: { kind: 'discard' },
    },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, 'analysis.scratch_revision_conflict');
  assert.deepEqual(response.json().parameters, {
    expectedRevision: 0,
    currentRevision: 3,
  });
  assert.ok(!response.body.includes('CANARY'));
});

test('explicit DTOs and response schemas prevent nested and top-level response leakage', async (t) => {
  const preferences = {
    uiLocale: 'de-DE' as const,
    preferenceRevision: 1,
    dataRevision: 0,
    updatedAt: occurredAt,
    secret: 'CANARY',
  };
  const { host } = await buildFixture(t, {
    getSystemStatus: {
      execute: async () => ({
        state: 'ready',
        secret: 'CANARY',
        persistence: {
          schemaVersion: 1,
          dataRevision: 0,
          databasePath: 'CANARY',
        },
      }),
    },
    getUserPreferences: { execute: async () => preferences },
    setUiLanguage: {
      execute: async () => ({ changed: false, preferences, token: 'CANARY' }),
    },
  });
  for (const [method, url] of [
    ['GET', '/status'],
    ['GET', '/preferences'],
    ['PUT', '/preferences/ui-language'],
  ] as const) {
    const response = await host.inject({
      method,
      url,
      headers,
      ...(method === 'PUT'
        ? { payload: { uiLocale: 'de-DE', expectedRevision: 1 } }
        : {}),
    });
    assert.equal(response.statusCode, 200);
    assert.ok(!response.body.includes('CANARY'));
  }
});
