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
  const hostFetch = createHostFetch(connection, {
    origin: 'app://plysmith',
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
