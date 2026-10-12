import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationProblem } from '../../../app/application/problems/application-problem.ts';
import {
  buildRouteFixture,
  buildReadOnlyFixture,
  headers,
} from './fixtures.ts';
import { PlysmithHostClient } from '../../../app/infrastructure/channels/host_client/index.ts';
import {
  contractFingerprint,
  productRelease,
} from '../../../contracts/host/index.ts';

const restoreId = 'dddebc91-561d-4f1c-a5ab-920249ce49e9';
const counts = {
  analyses: 2,
  games: 1,
  folders: 1,
  provenanceRecords: 3,
  contributions: 4,
};
const fingerprint = 'a'.repeat(64);
const status = {
  canRestore: true,
  blockerCodes: [],
  suggestedFileName: 'plysmith-backup-20261012-120000.pgn',
};

test('transfer routes and typed client send only paths, identifiers and small results', async (t) => {
  const calls: unknown[] = [];
  const { host } = await buildRouteFixture(t, {
    inventoryTransfer: {
      getStatus: async () => status,
      createBackup: async (request) => {
        calls.push(request);
        return {
          fileName: 'backup.pgn',
          counts,
          bytes: 512,
          snapshotDataRevision: 5,
        };
      },
      prepareRestore: async (request) => {
        calls.push(request);
        return {
          restoreId,
          fingerprint,
          counts,
          expiresAt: '2026-10-12T12:10:00.000Z',
        };
      },
      restore: async (request) => {
        calls.push(request);
        return { counts, dataRevision: 6, noOp: false };
      },
      cancelRestore: async (id) => {
        calls.push(id);
        return { cancelled: true };
      },
    },
  });
  const client = new PlysmithHostClient(
    {
      endpoint: 'http://127.0.0.1:43210',
      productRelease,
      contractFingerprint,
      token: 'test-only-host-token',
    },
    {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const response = await host.inject({
          method: request.method as 'GET' | 'POST' | 'DELETE',
          url: new URL(request.url).pathname,
          headers: {
            ...headers,
            ...(request.method === 'POST'
              ? { 'content-type': 'application/json' }
              : {}),
          },
          ...(request.method === 'POST'
            ? { payload: await request.text() }
            : {}),
        });
        return new Response(response.body, {
          status: response.statusCode,
          headers: { 'content-type': String(response.headers['content-type']) },
        });
      },
    },
  );
  assert.deepEqual(await client.getInventoryBackupStatus(), status);
  assert.equal(
    (
      await client.createInventoryBackup({
        destinationPath: 'C:/backup.pgn',
        formatVersion: 1,
      })
    ).bytes,
    512,
  );
  assert.equal(
    (
      await client.prepareInventoryRestore({
        restoreId,
        inputLocator: 'C:/backup.pgn',
      })
    ).fingerprint,
    fingerprint,
  );
  assert.equal(
    (
      await client.restoreInventory({
        restoreId,
        acceptedFingerprint: fingerprint,
      })
    ).dataRevision,
    6,
  );
  assert.deepEqual(await client.cancelInventoryRestore(restoreId), {
    cancelled: true,
  });
  assert.deepEqual(calls, [
    { destinationPath: 'C:/backup.pgn', formatVersion: 1 },
    { restoreId, inputLocator: 'C:/backup.pgn' },
    { restoreId, acceptedFingerprint: fingerprint },
    restoreId,
  ]);
});

test('transfer schemas reject extra payloads, invalid IDs and versions before use cases', async () => {
  const { host } = await buildReadOnlyFixture();
  for (const [url, payload] of [
    ['/inventory/backups', { destinationPath: 'C:/x.pgn', formatVersion: 2 }],
    [
      '/inventory/backups',
      { destinationPath: 'C:/x.pgn', formatVersion: 1, bytes: 'private' },
    ],
    [
      '/inventory/restores/preview',
      { restoreId: '../x', inputLocator: 'C:/x.pgn' },
    ],
    [
      '/inventory/restores/preview',
      { restoreId, inputLocator: 'C:/x.pgn', manifest: {} },
    ],
    [
      '/inventory/restores/publish',
      { restoreId, acceptedFingerprint: 'wrong' },
    ],
  ] as const)
    assert.equal(
      (await host.inject({ method: 'POST', url, headers, payload })).statusCode,
      400,
    );
  assert.equal(
    (
      await host.inject({
        method: 'DELETE',
        url: '/inventory/restores/nope',
        headers,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await host.inject({ url: '/inventory/backup-status?manifest=x', headers }))
      .statusCode,
    400,
  );
});

test('transfer preflight permits only exact methods and validated dynamic paths', async () => {
  const { host } = await buildReadOnlyFixture();
  for (const [url, method, expected] of [
    ['/inventory/backup-status', 'GET', 204],
    ['/inventory/backups', 'POST', 204],
    ['/inventory/restores/preview', 'POST', 204],
    ['/inventory/restores/publish', 'POST', 204],
    [`/inventory/restores/${restoreId}`, 'DELETE', 204],
    ['/inventory/restores/preview', 'DELETE', 403],
    ['/inventory/restores/publish', 'DELETE', 403],
    ['/inventory/restores/nope', 'DELETE', 403],
    [`/inventory/restores/${restoreId}/extra`, 'DELETE', 403],
    [`/inventory/restores/${restoreId}`, 'POST', 403],
    ['/inventory/backups', 'GET', 403],
  ] as const) {
    const result = await host.inject({
      method: 'OPTIONS',
      url,
      headers: {
        host: headers.host,
        origin: 'app://plysmith',
        'access-control-request-method': method,
      },
    });
    assert.equal(result.statusCode, expected, `${method} ${url}`);
  }
});

test('closed transfer problems are sanitized and mapped without paths', async (t) => {
  let code = 'invalid_backup';
  const fail = async (): Promise<never> => {
    throw new ApplicationProblem(
      `inventory_transfer.${code}`,
      'C:/private/secret.pgn',
    );
  };
  const { host } = await buildRouteFixture(t, {
    inventoryTransfer: {
      getStatus: fail,
      createBackup: fail,
      prepareRestore: fail,
      restore: fail,
      cancelRestore: fail,
    },
  });
  for (const item of [
    'invalid_backup',
    'unsupported_version',
    'restore_required',
    'target_not_empty',
    'transfer_busy',
    'stale_preview',
    'resource_exhausted',
    'destination_exists',
    'file_write_failed',
    'file_read_failed',
    'interrupted',
    'invalid_request',
  ]) {
    code = item;
    const response = await host.inject({
      url: '/inventory/backup-status',
      headers,
    });
    assert.notEqual(response.statusCode, 500, item);
    assert.equal(response.json().code, `inventory_transfer.${item}`);
    assert.doesNotMatch(response.body, /private|secret/);
  }
});
