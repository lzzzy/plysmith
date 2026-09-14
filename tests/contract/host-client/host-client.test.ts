import assert from 'node:assert/strict';
import test from 'node:test';

import {
  connectHost,
  contractFingerprint,
  createHostFetch,
  HostClientProblem,
  PlysmithHostClient,
  productRelease,
  type HostConnection,
} from '../../../app/infrastructure/channels/host_client/testing.ts';

const connection: HostConnection = {
  endpoint: 'http://127.0.0.1:43121/',
  productRelease,
  contractFingerprint,
  token: 'host-client-test-token',
};

test('host fetch preserves request and init headers while adding credentials', async () => {
  let captured: Request | undefined;
  const diagnostics: unknown[] = [];
  const hostFetch = createHostFetch(connection, {
    origin: 'app://plysmith',
    correlationIdFactory: () => 'correlation-1',
    onDiagnostic: (event) => diagnostics.push(event),
    fetch: async (request) => {
      captured = request instanceof Request ? request : new Request(request);
      return Response.json({});
    },
  });
  const input = new Request(`${connection.endpoint}preferences`, {
    headers: { accept: 'application/json' },
  });

  await hostFetch(input, { headers: { 'x-request-id': 'request-1' } });

  assert.equal(captured?.headers.get('accept'), 'application/json');
  assert.equal(captured?.headers.get('x-request-id'), 'request-1');
  assert.equal(
    captured?.headers.get('authorization'),
    `Bearer ${connection.token}`,
  );
  assert.equal(captured?.headers.get('origin'), 'app://plysmith');
  assert.equal(
    captured?.headers.get('x-plysmith-correlation-id'),
    'correlation-1',
  );
  assert.equal(diagnostics.length, 1);
  assert.deepEqual(diagnostics[0], {
    kind: 'completed',
    correlationId: 'correlation-1',
    statusCode: 200,
    durationMilliseconds: (diagnostics[0] as { durationMilliseconds: number })
      .durationMilliseconds,
  });
  assert.ok(
    (diagnostics[0] as { durationMilliseconds: number }).durationMilliseconds >=
      0,
  );
});

test('host fetch rejects requests outside the discovered origin', async () => {
  const hostFetch = createHostFetch(connection, {
    fetch: async () => assert.fail('external request must not reach fetch'),
  });
  await assert.rejects(hostFetch('http://127.0.0.1:43122/status'));
});

test('generated host client performs each write exactly once', async () => {
  let writes = 0;
  const client = new PlysmithHostClient(connection, {
    fetch: async (request) => {
      const url = new URL(request instanceof Request ? request.url : request);
      if (url.pathname === '/preferences/ui-language') {
        writes += 1;
        return Response.json({
          changed: true,
          preferences: {
            uiLocale: 'en-GB',
            preferenceRevision: 2,
            dataRevision: 1,
            updatedAt: '2026-09-08T11:00:00.000Z',
          },
        });
      }
      return Response.json({}, { status: 404 });
    },
  });

  const result = await client.setUiLanguage({
    uiLocale: 'en-GB',
    expectedRevision: 1,
  });

  assert.equal(result.changed, true);
  assert.equal(writes, 1);
});

test('generated diagnostic client keeps settings, consent and report target explicit', async () => {
  const requests: { path: string; body?: unknown }[] = [];
  const client = new PlysmithHostClient(connection, {
    fetch: async (request) => {
      const input = request instanceof Request ? request : new Request(request);
      const url = new URL(input.url);
      requests.push({
        path: url.pathname,
        ...(input.method === 'GET' ? {} : { body: await input.json() }),
      });
      switch (url.pathname) {
        case '/diagnostics/settings':
          return Response.json({
            configuredLevel: 'off',
            activeLevel: 'off',
            configurationRevision: `sha256:${'a'.repeat(64)}`,
            restartRequired: false,
          });
        case '/diagnostics/settings/log-level':
          return Response.json({
            changed: true,
            settings: {
              configuredLevel: 'debug',
              activeLevel: 'off',
              configurationRevision: `sha256:${'b'.repeat(64)}`,
              restartRequired: true,
            },
          });
        case '/diagnostics/report-manifest':
          return Response.json({
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
          });
        case '/diagnostics/reports':
          return Response.json({
            created: true,
            generatedAt: '2026-09-14T08:00:00.000Z',
            format: 'plysmith-diagnostics-json-gzip-v1',
            bytesWritten: 321,
            eventCount: 4,
            discardedLineCount: 0,
            truncated: false,
          });
        default:
          return Response.json({}, { status: 404 });
      }
    },
  });

  await client.getDiagnosticSettings();
  await client.setDiagnosticLogLevel({
    level: 'debug',
    expectedConfigurationRevision: `sha256:${'a'.repeat(64)}`,
  });
  const manifest = await client.getDiagnosticReportManifest();
  assert.equal(manifest.includedCategories.length, 5);
  await client.createDiagnosticReport({
    acceptedManifestVersion: manifest.manifestVersion,
    destinationPath: 'C:\\reports\\report.json.gz',
  });

  assert.deepEqual(requests, [
    { path: '/diagnostics/settings' },
    {
      path: '/diagnostics/settings/log-level',
      body: {
        level: 'debug',
        expectedConfigurationRevision: `sha256:${'a'.repeat(64)}`,
      },
    },
    { path: '/diagnostics/report-manifest' },
    {
      path: '/diagnostics/reports',
      body: {
        acceptedManifestVersion: 1,
        destinationPath: 'C:\\reports\\report.json.gz',
      },
    },
  ]);
});

test('host problems retain the server taxonomy and safe parameters', async () => {
  const client = new PlysmithHostClient(connection, {
    fetch: async () =>
      Response.json(
        {
          type: 'https://github.com/lzzzy/plysmith/blob/main/docs/problems/preference.revision_conflict.md',
          title: 'Preference revision conflict',
          status: 409,
          detail:
            'Read the current preferences before submitting another change.',
          instance: 'urn:plysmith:problem:correlation-1',
          code: 'preference.revision_conflict',
          correlationId: 'correlation-1',
          retryable: false,
          parameters: { expectedRevision: 1, currentRevision: 2 },
        },
        {
          status: 409,
          headers: { 'content-type': 'application/problem+json' },
        },
      ),
  });

  await assert.rejects(
    client.setUiLanguage({ uiLocale: 'en-GB', expectedRevision: 1 }),
    (error: unknown) =>
      error instanceof HostClientProblem &&
      error.problem.code === 'preference.revision_conflict' &&
      error.problem.parameters.currentRevision === 2,
  );
});

test('connection handshake rejects mismatched discovery before a request', async () => {
  let requests = 0;
  await assert.rejects(
    connectHost(
      { ...connection, contractFingerprint: 'sha256:another-contract' },
      {
        fetch: async () => {
          requests += 1;
          return Response.json({});
        },
      },
    ),
    (error: unknown) =>
      error instanceof HostClientProblem &&
      error.problem.code === 'host.contract_mismatch',
  );
  assert.equal(requests, 0);
});
