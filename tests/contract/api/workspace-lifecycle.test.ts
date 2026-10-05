import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationProblem } from '../../../app/application/problems/application-problem.ts';
import { ChangeInventoryOrganization } from '../../../app/application/inventory/index.ts';
import { localId } from '../../../app/domain/identity/index.ts';
import { PlysmithHostClient } from '../../../app/infrastructure/channels/host_client/index.ts';
import {
  contractFingerprint,
  productRelease,
} from '../../../contracts/host/index.ts';
import { connectMcp, assertToolData } from '../mcp/helpers.ts';
import { buildRouteFixture, headers, occurredAt, token } from './fixtures.ts';

const contextId = localId('working-context', 2);
const itemId = localId('inventory-item', 7);
const revisionId = localId('item-revision', 8);
const usage = {
  referenceCount: 1,
  activeNoteCount: 2,
  noteMoveCount: 3,
  scratchCount: 1,
  changedScratchCount: 1,
  scratchMoveCount: 4,
  scratchNoteCount: 1,
  managementResumeAffected: true,
  analysisResumeAffected: true,
};
const confirmation = { expectedContextVersion: 3, expectedDataRevision: 12 };
const managementResume = {
  resumeVersion: 1,
  presentation: 'folders' as const,
  selectedItemId: itemId,
  updatedAt: occurredAt,
};
const playout = {
  draftId: localId('playout-draft', 9),
  draftRevision: 2,
  moveCount: 5,
  status: 'paused' as const,
  sourceItemId: itemId,
};
const removal = {
  contextId,
  contextName: 'Preparation',
  contextVersion: 3,
  dataRevision: 12,
  items: [{ itemId, displayName: 'Line' }],
  referenceCount: 1,
  losses: {
    notes: [
      {
        contributionId: localId('contribution', 4),
        body: 'Keep this note',
        moveCount: 2,
        itemId,
      },
    ],
    scratch: {
      scratchId: 'scratch-1',
      hasChanges: true,
      scratchRevision: 2,
      stepCount: 4,
      noteBody: 'Unfinished thought',
      intent: 'exploration' as const,
      itemId,
    },
    managementResume,
    analysisResume: {
      resumeVersion: 2,
      mode: 'analyze' as const,
      itemId,
      revisionId,
      anchorId: localId('anchor', 10),
      currentPositionId: localId('position', 11),
      scratchId: 'scratch-1',
      updatedAt: occurredAt,
    },
    playout,
  },
  retainedPlayout: playout,
};

test('folder organization preserves HTTP and MCP parity for reads, all changes, rejected and stale writes', async (t) => {
  const folderId = localId('inventory-folder', 3);
  const received: unknown[] = [];
  const published: unknown[] = [];
  const { host } = await buildRouteFixture(t, {
    searchInventory: {
      execute: async () => ({
        items: [
          {
            itemId,
            currentRevisionId: revisionId,
            rootAnchorId: localId('anchor', 10),
            itemType: 'analysis',
            originKind: 'manual',
            lifecycle: 'active',
            displayName: 'Line',
            languageTag: 'en-GB',
            contextIds: [contextId],
            createdAt: occurredAt,
            updatedAt: occurredAt,
            folderId,
          },
        ],
        ancestors: [],
        provenanceEdges: [],
        dataRevision: 12,
      }),
    },
    createAnalysisRecord: {
      execute: async (request) => {
        received.push(request);
        throw new ApplicationProblem(
          'inventory.organization_conflict',
          'captured',
        );
      },
    },
    completePlayout: {
      execute: async (request) => {
        received.push(request);
        throw new ApplicationProblem(
          'inventory.organization_conflict',
          'captured',
        );
      },
    },
    getInventoryOrganization: {
      execute: async (request) => {
        received.push(request);
        return {
          folders: [
            {
              folderId,
              displayName: 'Openings',
              itemCount: 2,
              contextItemCount: 1,
              contextLinkCount: 1,
            },
          ],
          linkedFolderIds: [folderId],
          dataRevision: 12,
        };
      },
    },
    changeInventoryOrganization: new ChangeInventoryOrganization({
      writer: {
        changeInventoryOrganization: async (request) => {
          received.push(request);
          if (request.expectedDataRevision !== 12)
            throw new ApplicationProblem(
              'inventory.organization_conflict',
              'stale',
            );
          if (
            request.change.kind === 'rename_folder' &&
            request.change.displayName === 'Taken'
          )
            throw new ApplicationProblem('inventory.name_conflict', 'taken');
          return { dataRevision: 13, folderId };
        },
      },
      clock: { now: () => occurredAt },
      events: { publish: (event) => published.push(event) },
    }),
    previewContextFolderRemoval: {
      execute: async (request) => {
        received.push(request);
        return {
          ...request,
          folderIds: [folderId],
          linkedFolderIds: [folderId],
          itemIds: [itemId],
          loss: usage,
          losses: removal.losses,
          dataRevision: 12,
        };
      },
    },
    checkInventoryNameAvailability: {
      execute: async (request) => {
        received.push(request);
        return {
          displayName: request.displayName,
          available: false,
          suggestedDisplayName: request.displayName + ' (2)',
          dataRevision: 12,
        };
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
          method: request.method as 'GET' | 'POST',
          url: url.pathname + url.search,
          headers: {
            ...Object.fromEntries(request.headers),
            host: headers.host,
          },
          ...(request.method === 'GET'
            ? {}
            : { payload: await request.text() }),
        });
        return new Response(response.body, {
          status: response.statusCode,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  );
  const { client } = await connectMcp(t, hostClient);
  const search = await hostClient.searchInventory({});
  assert.equal(search.items[0]?.folderId, '3');
  assertToolData(
    await client.callTool({ name: 'search_inventory', arguments: {} }),
    search,
  );
  for (const folderId of [undefined, null, '3']) {
    const placement = folderId === undefined ? {} : { folderId };
    for (const [name, url, body] of [
      [
        'create_analysis_record',
        '/inventory/analysis-records',
        {
          scope: { kind: 'free' },
          expectedScratchId: 'scratch-1',
          expectedScratchRevision: 1,
          displayName: 'Created',
          languageTag: 'en-GB',
          ...placement,
        },
      ],
      [
        'complete_playout',
        '/playout/complete',
        {
          scope: { kind: 'free' },
          draftId: '9',
          expectedDraftRevision: 2,
          completionId: 'completion-1',
          displayName: 'Created',
          languageTag: 'en-GB',
          ...placement,
        },
      ],
    ] as const) {
      const response = await host.inject({
        method: 'POST',
        url,
        headers,
        payload: body,
      });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, 'inventory.organization_conflict');
      const result = await client.callTool({ name, arguments: body });
      assert.ok(
        result.structuredContent &&
          typeof result.structuredContent === 'object' &&
          'code' in result.structuredContent,
      );
      assert.equal(
        result.structuredContent.code,
        'inventory.organization_conflict',
      );
      assert.deepEqual(received.at(-1), received.at(-2));
      assert.equal(
        Object.hasOwn(received.at(-1) as object, 'folderId'),
        folderId !== undefined,
      );
      assert.deepEqual(
        (received.at(-1) as { folderId?: unknown }).folderId,
        folderId === '3' ? localId('inventory-folder', 3) : folderId,
      );
    }
  }
  for (const [name, args, invoke] of [
    [
      'get_inventory_organization',
      { contextId: '2' },
      () => hostClient.getInventoryOrganization({ contextId: '2' }),
    ],
    [
      'preview_context_folder_removal',
      { folderId: '3', contextId: '2' },
      () =>
        hostClient.previewContextFolderRemoval({
          folderId: '3',
          contextId: '2',
        }),
    ],
    [
      'check_inventory_name_availability',
      { displayName: 'Line & position', excludingItemId: '7' },
      () =>
        hostClient.checkInventoryNameAvailability({
          displayName: 'Line & position',
          excludingItemId: '7',
        }),
    ],
  ] as const) {
    const direct = await invoke();
    assertToolData(await client.callTool({ name, arguments: args }), direct);
    assert.deepEqual(received.at(-1), received.at(-2));
  }
  assert.deepEqual(await hostClient.getInventoryOrganization({}), {
    folders: [
      {
        folderId: '3',
        displayName: 'Openings',
        itemCount: 2,
        contextItemCount: 1,
        contextLinkCount: 1,
      },
    ],
    linkedFolderIds: ['3'],
    dataRevision: 12,
  });
  for (const change of [
    { kind: 'create_folder', displayName: 'New', parentFolderId: '3' },
    { kind: 'rename_folder', folderId: '3', displayName: 'Renamed' },
    { kind: 'move_folder', folderId: '3' },
    { kind: 'delete_folder', folderId: '3' },
    { kind: 'move_items', itemIds: ['7'], folderId: '3', workContextId: '2' },
    { kind: 'move_items', itemIds: ['7'], contextId: '2' },
    {
      kind: 'include_folder',
      folderId: '3',
      contextId: '2',
      includeItems: true,
    },
    { kind: 'remove_context_folder', folderId: '3', contextId: '2' },
  ] as const) {
    const body = { expectedDataRevision: 12, change };
    const direct = await hostClient.changeInventoryOrganization(body);
    assertToolData(
      await client.callTool({
        name: 'change_inventory_organization',
        arguments: body,
      }),
      direct,
    );
    assert.deepEqual(received.at(-1), received.at(-2));
    assert.deepEqual(published.at(-1), published.at(-2));
  }
  assert.equal(published.length, 16);
  for (const body of [
    {
      expectedDataRevision: 11,
      change: { kind: 'delete_folder', folderId: '3' },
    },
    {
      expectedDataRevision: 12,
      change: { kind: 'rename_folder', folderId: '3', displayName: 'Taken' },
    },
    {
      expectedDataRevision: 12,
      change: { kind: 'create_folder', displayName: ' ' },
    },
    { expectedDataRevision: 12, change: { kind: 'move_items', itemIds: [] } },
    {
      expectedDataRevision: 12,
      change: { kind: 'move_items', itemIds: ['7', '7'] },
    },
    {
      expectedDataRevision: 12,
      change: { kind: 'delete_folder', folderId: '03' },
    },
    {
      expectedDataRevision: -1,
      change: { kind: 'delete_folder', folderId: '3' },
    },
    {
      expectedDataRevision: 12,
      change: { kind: 'delete_folder', folderId: '3', recursive: true },
    },
  ]) {
    const response = await host.inject({
      method: 'POST',
      url: '/inventory/organization',
      headers,
      payload: body,
    });
    assert.ok(
      response.statusCode >= 400 && response.statusCode < 500,
      response.body,
    );
    const result = await client.callTool({
      name: 'change_inventory_organization',
      arguments: body,
    });
    assert.equal(result.isError, true);
    assert.ok(
      result.structuredContent &&
        typeof result.structuredContent === 'object' &&
        'code' in result.structuredContent &&
        'status' in result.structuredContent,
    );
    assert.equal(result.structuredContent.code, response.json().code);
    assert.equal(result.structuredContent.status, response.statusCode);
  }
  assert.equal(
    published.length,
    16,
    'Rejected writes never emit organization events',
  );
  for (const [url, method] of [
    ['/inventory/organization', 'GET'],
    ['/inventory/organization', 'POST'],
    ['/inventory/organization/removal-preview', 'GET'],
    ['/inventory/name-availability', 'GET'],
  ] as const) {
    const response = await host.inject({
      method: 'OPTIONS',
      url,
      headers: {
        host: headers.host,
        origin: 'app://plysmith',
        'access-control-request-method': method,
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    assert.equal(response.statusCode, 204);
  }
});

test('workspace lifecycle has identical API, host-client and MCP requests and concrete DTOs', async (t) => {
  const requests: { method: string; request?: unknown }[] = [];
  const { host } = await buildRouteFixture(t, {
    getWorkScopeWorkspace: {
      execute: async (request) => {
        requests.push({ method: 'scope', request });
        return { scope: request.scope, managementResume, dataRevision: 12 };
      },
    },
    getStartupResume: {
      execute: async () => ({
        scope: { kind: 'free' },
        area: 'analyze',
        startupVersion: 2,
        dataRevision: 12,
        unavailableContext: {
          contextId,
          displayName: 'Preparation',
          reason: 'deleted',
        },
      }),
    },
    setStartupResume: {
      execute: async (request) => {
        requests.push({ method: 'startup', request });
        return {
          scope: request.scope,
          area: request.area,
          startupVersion: 3,
          dataRevision: 13,
        };
      },
    },
    setWorkScopeResume: {
      execute: async (request) => {
        requests.push({ method: 'resume', request });
        return { area: 'manage', resume: managementResume, dataRevision: 13 };
      },
    },
    previewContextItemRemoval: {
      execute: async (request) => {
        requests.push({ method: 'removal-preview', request });
        return removal;
      },
    },
    previewWorkingContextDeletion: {
      execute: async (request) => {
        requests.push({ method: 'context-preview', request });
        return removal;
      },
    },
    removeContextItem: {
      execute: async (request) => {
        requests.push({ method: 'remove', request });
        return { contextId, itemId, dataRevision: 13 };
      },
    },
    deleteWorkingContext: {
      execute: async (request) => {
        requests.push({ method: 'delete-context', request });
        return { contextId, dataRevision: 13 };
      },
    },
    previewInventoryItemDeletion: {
      execute: async (request) => {
        requests.push({ method: 'inventory-preview', request });
        return {
          itemId,
          currentRevisionId: revisionId,
          displayName: 'Line',
          itemType: 'analysis',
          contexts: [{ ...usage, contextId, contextName: 'Preparation' }],
          global: usage,
          retainedDerivedItemCount: 2,
          retainedPlayoutCount: 1,
          dataRevision: 12,
        };
      },
    },
    deleteInventoryItem: {
      execute: async (request) => {
        requests.push({ method: 'delete-item', request });
        return { itemId, dataRevision: 13 };
      },
    },
    completePlayout: {
      execute: async (request) => {
        requests.push({ method: 'complete', request });
        return {
          itemId,
          revisionId,
          rootAnchorId: localId('anchor', 10),
          outcome: { kind: 'draw' },
          outcomeSource: 'manual',
          dataRevision: 13,
        };
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
        const response = await host.inject({
          method: request.method as 'GET' | 'PUT' | 'POST' | 'DELETE',
          url: new URL(request.url).pathname + new URL(request.url).search,
          headers: {
            ...Object.fromEntries(request.headers),
            host: headers.host,
          },
          ...(request.method === 'GET'
            ? {}
            : { payload: await request.text() }),
        });
        return new Response(response.body, {
          status: response.statusCode,
          headers: { 'content-type': String(response.headers['content-type']) },
        });
      },
    },
  );
  const { client } = await connectMcp(t, hostClient);
  const startup = {
    scope: { kind: 'context' as const, contextId: '2' },
    area: 'playout' as const,
    expectedStartupVersion: 2,
  };
  const resume = {
    scope: { kind: 'free' as const },
    area: 'manage' as const,
    expectedResumeVersion: null,
    presentation: 'folders' as const,
    selectedItemId: '7',
  };
  const deletion = { expectedCurrentRevisionId: '8', expectedDataRevision: 12 };
  const completion = {
    scope: { kind: 'free' as const },
    draftId: '9',
    expectedDraftRevision: 2,
    completionId: 'completion-1',
    displayName: 'Manual draw',
    languageTag: 'en-GB',
    manualResult: 'draw' as const,
  };
  const cases = [
    [
      'get_work_scope_workspace',
      { scopeKind: 'free' },
      () => hostClient.getWorkScopeWorkspace({ scopeKind: 'free' }),
    ],
    ['get_startup_resume', {}, () => hostClient.getStartupResume()],
    ['set_startup_resume', startup, () => hostClient.setStartupResume(startup)],
    [
      'set_work_scope_resume',
      resume,
      () => hostClient.setWorkScopeResume(resume),
    ],
    [
      'preview_context_item_removal',
      { contextId: '2', itemId: '7' },
      () => hostClient.previewContextItemRemoval('2', '7'),
    ],
    [
      'preview_working_context_deletion',
      { contextId: '2' },
      () => hostClient.previewWorkingContextDeletion('2'),
    ],
    [
      'remove_context_item',
      { contextId: '2', itemId: '7', ...confirmation },
      () => hostClient.removeContextItem('2', '7', confirmation),
    ],
    [
      'delete_working_context',
      { contextId: '2', ...confirmation },
      () => hostClient.deleteWorkingContext('2', confirmation),
    ],
    [
      'preview_inventory_item_deletion',
      { itemId: '7' },
      () => hostClient.previewInventoryItemDeletion('7'),
    ],
    [
      'delete_inventory_item',
      { itemId: '7', ...deletion },
      () => hostClient.deleteInventoryItem('7', deletion),
    ],
    [
      'complete_playout',
      completion,
      () => hostClient.completePlayout(completion),
    ],
  ] as const;
  for (const [name, args, direct] of cases) {
    requests.length = 0;
    const dto = await direct();
    const directRequests = [...requests];
    requests.length = 0;
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, name);
    assertToolData(result, dto);
    assert.deepEqual(requests, directRequests, name);
  }
  const preview = await hostClient.previewContextItemRemoval('2', '7');
  assert.equal(preview.losses.notes[0]?.contributionId, '4');
  assert.equal(preview.losses.scratch?.noteBody, 'Unfinished thought');
  assert.equal(preview.losses.analysisResume?.currentPositionId, '11');
  assert.equal(preview.retainedPlayout?.draftId, '9');
  assert.deepEqual(
    (await hostClient.previewInventoryItemDeletion('7')).global,
    usage,
  );
  assert.deepEqual((await hostClient.getStartupResume()).unavailableContext, {
    contextId: '2',
    displayName: 'Preparation',
    reason: 'deleted',
  });
  assert.equal(
    (await hostClient.completePlayout(completion)).outcomeSource,
    'manual',
  );
});

test('lifecycle rejects missing confirmations and returns concrete stale-preview problems', async (t) => {
  const { host } = await buildRouteFixture(t, {
    deleteInventoryItem: {
      execute: async () => {
        throw new ApplicationProblem(
          'inventory.deletion_conflict',
          'Private state',
        );
      },
    },
    deleteWorkingContext: {
      execute: async () => {
        throw new ApplicationProblem(
          'workspace.removal_preview_conflict',
          'Private state',
        );
      },
    },
    setStartupResume: {
      execute: async () => {
        throw new ApplicationProblem(
          'workspace.startup_revision_conflict',
          'Private state',
        );
      },
    },
  });
  for (const url of [
    '/working-contexts/2',
    '/working-contexts/2/items/7',
    '/inventory/items/7',
  ]) {
    const response = await host.inject({
      method: 'DELETE',
      url,
      headers,
      payload: {},
    });
    assert.equal(response.statusCode, 400, url);
  }
  const unconfirmedImpact = await host.inject({
    method: 'POST',
    url: '/workspace/revision-impacts/1/resolution',
    headers,
    payload: { expectedImpactVersion: 1, resolution: { kind: 'use_target' } },
  });
  assert.equal(unconfirmedImpact.statusCode, 400);
  for (const [url, payload, code] of [
    [
      '/inventory/items/7',
      { expectedCurrentRevisionId: '8', expectedDataRevision: 12 },
      'inventory.deletion_conflict',
    ],
    ['/working-contexts/2', confirmation, 'workspace.removal_preview_conflict'],
  ] as const) {
    const response = await host.inject({
      method: 'DELETE',
      url,
      headers,
      payload,
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, code);
    assert.ok(!response.body.includes('Private state'));
  }
  const startup = await host.inject({
    method: 'PUT',
    url: '/workspace/startup',
    headers,
    payload: {
      scope: { kind: 'free' },
      area: 'manage',
      expectedStartupVersion: 1,
    },
  });
  assert.equal(startup.statusCode, 409);
  assert.equal(startup.json().code, 'workspace.startup_revision_conflict');
});
