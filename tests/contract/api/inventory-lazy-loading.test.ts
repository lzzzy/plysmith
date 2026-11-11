import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from '@sinclair/typebox/value';
import type { SearchInventoryRequest } from '../../../app/application/inventory/index.ts';
import { localId } from '../../../app/domain/identity/index.ts';
import { InventoryOrganizationSchema as apiOrganizationSchema } from '../../../app/infrastructure/channels/api/schemas.ts';
import { InventoryOrganizationSchema as mcpOrganizationSchema } from '../../../app/infrastructure/channels/mcp/schemas.ts';
import { PlysmithHostClient } from '../../../app/infrastructure/channels/host_client/index.ts';
import {
  contractFingerprint,
  productRelease,
} from '../../../contracts/host/index.ts';
import { assertToolData, connectMcp } from '../mcp/helpers.ts';
import { buildRouteFixture, headers, token } from './fixtures.ts';

test('HTTP, HostClient and MCP preserve exact folder, unfiled and item filters as application IDs', async (t) => {
  const received: SearchInventoryRequest[] = [];
  const result = {
    items: [],
    ancestors: [],
    provenanceEdges: [],
    dataRevision: 12,
  };
  const { host } = await buildRouteFixture(t, {
    searchInventory: {
      execute: async (request) => {
        received.push(request);
        return result;
      },
    },
  });
  const hostClient = new PlysmithHostClient(
    {
      endpoint: 'http://127.0.0.1:43210/',
      productRelease,
      contractFingerprint,
      token,
    },
    {
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        const url = new URL(request.url);
        const response = await host.inject({
          method: 'GET',
          url: url.pathname + url.search,
          headers: {
            ...Object.fromEntries(request.headers),
            host: headers.host,
          },
        });
        return new Response(response.body, {
          status: response.statusCode,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  );
  const { client } = await connectMcp(t, hostClient);
  for (const folderId of [undefined, '3', 'unfiled']) {
    for (const itemId of [undefined, '7']) {
      const args = {
        query: 'Needle',
        contextId: '2',
        ...(folderId === undefined ? {} : { folderId }),
        ...(itemId === undefined ? {} : { itemId }),
        cursor: 'opaque-cursor',
        pageSize: 1,
      };
      assert.deepEqual(
        await hostClient.searchInventory({ ...args, pageSize: '1' }),
        result,
      );
      assertToolData(
        await client.callTool({ name: 'search_inventory', arguments: args }),
        result,
      );
      const expected = {
        query: 'Needle',
        contextId: localId('working-context', 2),
        cursor: 'opaque-cursor',
        pageSize: 1,
        ...(folderId === undefined
          ? {}
          : {
              folderId:
                folderId === 'unfiled'
                  ? 'unfiled'
                  : localId('inventory-folder', 3),
            }),
        ...(itemId === undefined
          ? {}
          : { itemId: localId('inventory-item', 7) }),
      };
      assert.deepEqual(received.slice(-2), [expected, expected]);
    }
  }
  const validCalls = received.length;
  for (const key of ['folderId', 'itemId']) {
    for (const value of [
      '',
      '0',
      '-1',
      '1.5',
      '01',
      'unknown',
      ...(key === 'itemId' ? ['unfiled'] : []),
    ]) {
      const response = await host.inject({
        method: 'GET',
        url: `/inventory?${key}=${encodeURIComponent(value)}`,
        headers,
      });
      assert.equal(response.statusCode, 400, `${key}=${value}`);
      const mcp = await client.callTool({
        name: 'search_inventory',
        arguments: { [key]: value },
      });
      assert.equal(mcp.isError, true, `${key}=${value}`);
    }
    for (const value of [null, 1]) {
      const mcp = await client.callTool({
        name: 'search_inventory',
        arguments: { [key]: value },
      });
      assert.equal(mcp.isError, true);
    }
  }
  assert.equal(
    received.length,
    validCalls,
    'invalid filters must not reach the application',
  );
});

test('unfiled counters are required nonnegative integers in API and MCP organization responses', () => {
  const organization = {
    folders: [],
    linkedFolderIds: [],
    unfiledItemCount: 3,
    unfiledContextItemCount: 1,
    dataRevision: 12,
  };
  for (const schema of [apiOrganizationSchema, mcpOrganizationSchema]) {
    assert.ok(Value.Check(schema, organization));
    assert.ok(
      Value.Check(schema, {
        ...organization,
        unfiledItemCount: 0,
        unfiledContextItemCount: 0,
      }),
    );
    for (const key of ['unfiledItemCount', 'unfiledContextItemCount']) {
      for (const value of [undefined, null, -1, 0.5, '1']) {
        assert.equal(
          Value.Check(schema, { ...organization, [key]: value }),
          false,
        );
      }
    }
  }
});
