import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import * as apiWorkspace from '../../../app/infrastructure/channels/api/schemas.ts';
import * as mcpWorkspace from '../../../app/infrastructure/channels/mcp/schemas.ts';
import * as api from '../../../app/infrastructure/channels/api/import-schemas.ts';
import * as mcp from '../../../app/infrastructure/channels/mcp/import-schemas.ts';
import {
  AnalysisRecordSchema as ApiRecordSchema,
  apiSchemas,
} from '../../../app/infrastructure/channels/api/schemas.ts';
import { AnalysisRecordSchema as McpRecordSchema } from '../../../app/infrastructure/channels/mcp/schemas.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { PgnContentFormatAdapter } from '../../../app/infrastructure/adapters/content/pgn/index.ts';
import type { ChessTreeCandidate } from '../../../app/domain/inventory/chess-tree-candidate.ts';
import { buildRouteFixture, headers } from './fixtures.ts';
import { assertToolData, connectMcp } from '../mcp/helpers.ts';
import { localId } from '../../../app/domain/identity/index.ts';

const previewId = '12345678-1234-1234-1234-123456789abc';
test('every inventory item creation name remains editable in both channels', () => {
  for (const schema of [
    apiWorkspace.CreateAnalysisRecordBodySchema.properties.displayName,
    mcpWorkspace.CreateAnalysisRecordArgumentsSchema.properties.displayName,
    apiWorkspace.CompletePlayoutBodySchema.properties.displayName,
    mcpWorkspace.CompletePlayoutArgumentsSchema.properties.displayName,
    apiWorkspace.ResolvePendingRevisionImpactBodySchema.properties.resolution
      .anyOf[1].properties.displayName,
    mcpWorkspace.ResolvePendingRevisionImpactArgumentsSchema.properties
      .resolution.anyOf[1].properties.displayName,
  ]) {
    assert.equal(Value.Check(schema, 'x'.repeat(160)), true);
    assert.equal(Value.Check(schema, 'x'.repeat(161)), false);
  }
});
test('accumulated chess projections retain long paths in both channels', () => {
  const state = new ChessJsRulesAdapter().initialState();
  const move = { from: 'e2', to: 'e4', san: 'e4' };
  const step = { before: state, move, after: state };
  const steps = Array.from({ length: 1001 }, () => step);
  for (const [scratch, record, preview] of [
    [
      apiWorkspace.AnalysisScratchSchema.properties,
      apiWorkspace.AnalysisRecordSchema.properties,
      apiWorkspace.InventoryRevisionPreviewSchema.properties,
    ],
    [
      mcpWorkspace.AnalysisWorkspaceSchema.properties.scratch.properties,
      mcpWorkspace.AnalysisRecordSchema.properties,
      mcpWorkspace.InventoryRevisionPreviewSchema.properties,
    ],
  ] as const) {
    for (const schema of [
      scratch.steps,
      record.steps,
      preview.addedSteps,
      preview.removedSteps,
    ]) {
      const values =
        schema === record.steps
          ? steps.map((entry, index) => ({
              ...entry,
              anchorId: String(index + 1),
            }))
          : steps;
      assert.equal(Value.Check(schema, [...apiSchemas], values), true);
    }
    for (const cursor of [scratch.cursor, record.cursor]) {
      assert.equal(Value.Check(cursor, 1001), true);
      assert.equal(Value.Check(cursor, -1), false);
    }
  }
  for (const schema of [
    apiWorkspace.AnalysisSourceLineSchema.properties.steps,
    apiWorkspace.PlayoutSourcePathSchema.properties.steps,
    mcpWorkspace.AnalysisRecordSchema.properties.sourceLine.properties.steps,
    mcpWorkspace.AnalysisRecordSchema.properties.sourcePath.properties.steps,
    mcpWorkspace.PlayoutResultSchema.properties.draft.properties.sourcePath
      .properties.steps,
  ]) {
    assert.equal(Value.Check(schema, [...apiSchemas], steps), true);
  }
});
test('API and MCP records share the closed source-neutral chess tree', () => {
  const node = {
    nodeIndex: 0,
    parentNodeIndex: null,
    siblingOrder: 0,
    anchorId: '1',
    move: { from: 'e2', to: 'e4', san: 'e4' },
    after: new ChessJsRulesAdapter().initialState(),
  };
  for (const record of [ApiRecordSchema, McpRecordSchema]) {
    const tree = record.properties.tree;
    assert.deepEqual(Object.keys(tree.properties), ['nodes']);
    assert.deepEqual(
      Object.keys(tree.properties.nodes.items.properties).sort(),
      Object.keys(node).sort(),
    );
    assert.equal(Value.Check(tree, [...apiSchemas], { nodes: [node] }), true);
    assert.equal(
      Value.Check(tree, [...apiSchemas], {
        nodes: Array.from({ length: 1513 }, (_, nodeIndex) => ({
          ...node,
          nodeIndex,
          siblingOrder: nodeIndex,
          anchorId: String(nodeIndex + 1),
        })),
      }),
      true,
      'A saved native tree is not limited to one bounded import plus one scratch.',
    );
    assert.equal(
      Value.Check(tree, [...apiSchemas], { nodes: [node], extra: [] }),
      false,
    );
    assert.equal(
      Value.Check(tree, [...apiSchemas], { nodes: [{ ...node, extra: [] }] }),
      false,
    );
  }
});
const selection = {
  sourceOrder: 0,
  itemType: 'analysis',
  displayName: 'study.pgn - Chapter',
};
const prepare = { inputHandle: previewId, languageTag: 'de-DE' };
test('source basenames retain the extension through the 255-character boundary', () => {
  for (const schemas of [api, mcp]) {
    for (const [length, valid] of [
      [255, true],
      [256, false],
    ] as const) {
      const displayName = 'x'.repeat(length - 4) + '.pgn';
      assert.equal(
        Value.Check(schemas.ImportInputDescriptorSchema, {
          inputHandle: previewId,
          displayName,
          inputSize: 1,
        }),
        valid,
      );
      assert.equal(
        Value.Check(schemas.ImportPreviewSchema, {
          previewId,
          sourceDisplayName: displayName,
          inputSize: 1,
          formatId: 'standard-chess-pgn-v1',
          encoding: 'utf-8',
          candidates: [],
        }),
        valid,
      );
    }
  }
});
const publish = {
  previewId,
  candidates: [selection],
  folder: { kind: 'unfiled' },
  confirmWarnings: false,
};

test('preview titles allow 200 characters while import names still require 160', () => {
  for (const schemas of [api, mcp]) {
    for (const [length, previewValid, nameValid] of [
      [160, true, true],
      [161, true, false],
      [200, true, false],
      [201, false, false],
    ] as const) {
      const displayName = 'x'.repeat(length);
      assert.equal(
        Value.Check(schemas.ImportCandidatePreviewSchema, {
          sourceOrder: 0,
          status: 'ready',
          suggestedName: displayName,
          moveCount: 1,
          variationCount: 0,
          findings: [],
        }),
        previewValid,
      );
      assert.equal(
        Value.Check(schemas.CheckImportNamesBodySchema, {
          candidates: [{ sourceOrder: 0, displayName }],
        }),
        nameValid,
      );
      assert.equal(
        Value.Check(schemas.PublishImportBodySchema, {
          ...publish,
          candidates: [{ ...selection, displayName }],
        }),
        nameValid,
      );
    }
  }
});

test('long decoder titles survive HTTP and MCP previews without silent shortening', async (t) => {
  const titles = ['x'.repeat(161), 'y'.repeat(198) + '\u{1F600}'];
  const source = titles.map((title) => `[Event "${title}"] 1.e4 *`).join('\n');
  const candidates: ChessTreeCandidate[] = [];
  await new PgnContentFormatAdapter(new ChessJsRulesAdapter()).decode(
    (async function* () {
      yield source;
    })(),
    {
      signal: new AbortController().signal,
      onCandidate: async (candidate) => {
        candidates.push(candidate);
      },
    },
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.suggestedName),
    titles,
  );
  const preview = {
    previewId,
    sourceDisplayName: 'long-titles.pgn',
    inputSize: Buffer.byteLength(source),
    encoding: 'utf-8' as const,
    formatId: 'standard-chess-pgn-v1',
    candidates: candidates.map((candidate) => ({
      sourceOrder: candidate.sourceOrder,
      status: candidate.status,
      suggestedName: candidate.suggestedName,
      moveCount: candidate.nodes.length,
      variationCount: 0,
      findings: [...candidate.findings],
    })),
  };
  const { host } = await buildRouteFixture(t, {
    prepareImport: { execute: async () => preview },
  });
  const { client, calls } = await connectMcp(t, {
    prepareImport: async (request) => {
      const response = await host.inject({
        method: 'POST',
        url: '/inventory/imports/preview',
        headers,
        payload: request,
      });
      assert.equal(response.statusCode, 200, response.body);
      const data = response.json<typeof preview>();
      assert.deepEqual(data, preview);
      return data;
    },
  });
  const result = await client.callTool({
    name: 'prepare_import',
    arguments: prepare,
  });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assertToolData(result, preview);
  assert.deepEqual(calls, [{ method: 'prepareImport', request: prepare }]);
});

for (const [channel, schemas] of [
  ['API', api],
  ['MCP', mcp],
] as const) {
  test(`${channel} accepts bounded session previews and rejects obsolete or undeclared fields`, () => {
    assert.equal(
      Value.Check(schemas.PrepareImportBodySchema, {
        ...prepare,
        formatId: 'pgn',
        encoding: 'iso-8859-1',
      }),
      true,
    );
    for (const field of [
      'folderId',
      'targetContextId',
      'contextDestination',
      'planRevision',
      'operationId',
      'offset',
    ]) {
      assert.equal(
        Value.Check(schemas.PrepareImportBodySchema, {
          ...prepare,
          [field]: '1',
        }),
        false,
        field,
      );
      assert.equal(
        Value.Check(schemas.PublishImportBodySchema, {
          ...publish,
          [field]: '1',
        }),
        false,
        field,
      );
    }
    for (const folder of [
      { kind: 'unfiled' },
      { kind: 'existing', folderId: '3' },
      { kind: 'new', displayName: 'study.pgn', parentFolderId: '2' },
    ]) {
      assert.equal(
        Value.Check(schemas.PublishImportBodySchema, { ...publish, folder }),
        true,
      );
    }
    for (const folder of [
      { kind: 'unfiled', folderId: '3' },
      { kind: 'existing' },
      { kind: 'new', displayName: 'x', targetContextId: '2' },
    ]) {
      assert.equal(
        Value.Check(schemas.PublishImportBodySchema, { ...publish, folder }),
        false,
      );
    }
    assert.equal(
      Value.Check(schemas.PublishImportBodySchema, {
        ...publish,
        candidates: [{ ...selection, selected: true }],
      }),
      false,
    );
    assert.equal(
      Value.Check(schemas.DiscardImportBodySchema, { previewId }),
      true,
    );
    assert.equal(
      Value.Check(schemas.CancelImportPreparationBodySchema, {
        inputHandle: previewId,
      }),
      true,
    );
    assert.equal(
      Value.Check(schemas.CancelImportPreparationBodySchema, {
        inputHandle: previewId,
        operationId: previewId,
      }),
      false,
    );
    assert.equal(
      Value.Check(schemas.CancelImportPreparationResultSchema, {
        cancelled: false,
      }),
      true,
    );
    assert.equal(
      Value.Check(schemas.DiscardImportResultSchema, { discarded: false }),
      true,
    );
    assert.equal(
      Value.Check(schemas.DiscardImportResultSchema, {
        discarded: true,
        receipt: {},
      }),
      false,
    );
  });

  test(`${channel} bounds preparation and publication separately`, () => {
    const summary = {
      sourceOrder: 0,
      status: 'ready',
      suggestedName: 'Chapter',
      moveCount: 1,
      variationCount: 0,
      findings: [],
    };
    for (const [count, valid] of [
      [256, true],
      [257, false],
    ] as const) {
      const candidates = Array.from({ length: count }, (_, sourceOrder) => ({
        ...selection,
        sourceOrder,
      }));
      assert.equal(
        Value.Check(schemas.CheckImportNamesBodySchema, {
          candidates: candidates.map(({ sourceOrder, displayName }) => ({
            sourceOrder,
            displayName,
          })),
        }),
        valid,
      );
      assert.equal(
        Value.Check(schemas.ImportPreviewSchema, {
          previewId,
          sourceDisplayName: 'study.pgn',
          inputSize: 100,
          encoding: 'utf-8',
          formatId: 'pgn',
          candidates: candidates.map(({ sourceOrder }) => ({
            ...summary,
            sourceOrder,
          })),
        }),
        valid,
      );
    }
    for (const [count, valid] of [
      [100, true],
      [101, false],
    ] as const) {
      assert.equal(
        Value.Check(schemas.PublishImportBodySchema, {
          ...publish,
          candidates: Array.from({ length: count }, (_, sourceOrder) => ({
            ...selection,
            sourceOrder,
          })),
        }),
        valid,
      );
    }
    assert.equal(
      Value.Check(schemas.PublishImportBodySchema, {
        ...publish,
        candidates: [],
      }),
      false,
    );
    assert.equal(
      Value.Check(schemas.CheckImportNamesBodySchema, { candidates: [] }),
      true,
    );
    assert.equal(
      Value.Check(schemas.CheckImportNamesBodySchema, {
        candidates: [{ sourceOrder: 0, displayName: 'a'.repeat(161) }],
      }),
      false,
    );
    for (const [inputSize, valid] of [
      [1, true],
      [16777216, true],
      [0, false],
      [16777217, false],
    ] as const) {
      assert.equal(
        Value.Check(schemas.ImportInputDescriptorSchema, {
          inputHandle: previewId,
          displayName: 'study.pgn',
          inputSize,
        }),
        valid,
      );
    }
  });
}

test('import routes map folder IDs and carry 256 Unicode names within a bounded body', async (t) => {
  const calls: unknown[] = [];
  const { host } = await buildRouteFixture(t, {
    checkImportNames: {
      execute: async (request) => {
        calls.push(request);
        return {
          candidates: request.candidates.map((candidate) => ({
            ...candidate,
            available: true,
            suggestedDisplayName: candidate.displayName,
          })),
          dataRevision: 2,
        };
      },
    },
    publishImport: {
      execute: async (request) => {
        calls.push(request);
        return {
          items: [
            {
              itemId: localId('inventory-item', 7),
              revisionId: localId('item-revision', 8),
              sourceOrder: 0,
            },
          ],
          folderId: localId('inventory-folder', 3),
          dataRevision: 3,
        };
      },
    },
  });
  const candidates = Array.from({ length: 256 }, (_, sourceOrder) => ({
    ...selection,
    sourceOrder,
    displayName: '界'.repeat(150) + String(sourceOrder),
  }));
  const names = {
    candidates: candidates.map(({ sourceOrder, displayName }) => ({
      sourceOrder,
      displayName,
    })),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(names)) > 16 * 1024);
  for (const [url, payload] of [
    ['/inventory/imports/names', names],
    [
      '/inventory/imports/publish',
      {
        ...publish,
        candidates: candidates.slice(0, 100),
        folder: { kind: 'existing', folderId: '3' },
      },
    ],
    [
      '/inventory/imports/publish',
      {
        ...publish,
        folder: { kind: 'new', displayName: 'study.pgn', parentFolderId: '2' },
      },
    ],
  ] as const) {
    const response = await host.inject({
      method: 'POST',
      url,
      headers,
      payload,
    });
    assert.equal(response.statusCode, 200, response.body);
  }
  assert.deepEqual((calls[1] as { folder: unknown }).folder, {
    kind: 'existing',
    folderId: localId('inventory-folder', 3),
  });
  assert.deepEqual((calls[2] as { folder: unknown }).folder, {
    kind: 'new',
    displayName: 'study.pgn',
    parentFolderId: localId('inventory-folder', 2),
  });
  const rejected = await host.inject({
    method: 'POST',
    url: '/inventory/imports/names',
    headers,
    payload: { candidates: [...names.candidates, names.candidates[0]] },
  });
  assert.equal(rejected.statusCode, 400);
  const oversized = await host.inject({
    method: 'POST',
    url: '/inventory/imports/names',
    headers: { ...headers, 'content-type': 'application/json' },
    payload: JSON.stringify({ padding: 'x'.repeat(1048576) }),
  });
  assert.equal(oversized.statusCode, 413);
  assert.equal(calls.length, 3);
});

test('targeted prepare cancellation crosses MCP and HTTP without inventing an import job', async (t) => {
  const { host } = await buildRouteFixture(t, {
    cancelImportPreparation: {
      execute: async (request) => {
        assert.deepEqual(request, { inputHandle: previewId });
        return { cancelled: true };
      },
    },
  });
  const { client, calls } = await connectMcp(t, {
    cancelImportPreparation: async (request) => {
      const response = await host.inject({
        method: 'POST',
        url: '/inventory/imports/cancel-preparation',
        headers,
        payload: request,
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json<{ cancelled: boolean }>();
    },
  });
  const result = await client.callTool({
    name: 'cancel_import_preparation',
    arguments: { inputHandle: previewId },
  });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assertToolData(result, { cancelled: true });
  assert.deepEqual(calls, [
    { method: 'cancelImportPreparation', request: { inputHandle: previewId } },
  ]);
});

test('removed import operations have no routes or allowed preflights', async (t) => {
  const { host } = await buildRouteFixture(t);
  for (const url of [
    '/inventory/imports',
    '/inventory/imports/plan',
    '/inventory/imports/cancel',
  ]) {
    assert.equal(
      (await host.inject({ method: 'GET', url, headers })).statusCode,
      404,
    );
    assert.equal(
      (
        await host.inject({
          method: 'OPTIONS',
          url,
          headers: {
            ...headers,
            origin: 'app://plysmith',
            'access-control-request-method': 'POST',
          },
        })
      ).statusCode,
      403,
    );
  }
  for (const url of [
    '/inventory/import-inputs',
    '/inventory/imports/preview',
    '/inventory/imports/cancel-preparation',
    '/inventory/imports/names',
    '/inventory/imports/publish',
    '/inventory/imports/discard',
  ]) {
    assert.equal(
      (
        await host.inject({
          method: 'OPTIONS',
          url,
          headers: {
            ...headers,
            origin: 'app://plysmith',
            'access-control-request-method': 'POST',
          },
        })
      ).statusCode,
      204,
    );
  }
});

test('name suggestions remain complete beyond the final-name limit', () => {
  const displayName = 'x'.repeat(159);
  const suggestedDisplayName = displayName + ' (2)';
  for (const schemas of [api, mcp]) {
    assert.equal(
      Value.Check(schemas.ImportNameChecksSchema, {
        candidates: [
          {
            sourceOrder: 0,
            displayName,
            suggestedDisplayName,
            available: false,
          },
        ],
        dataRevision: 1,
      }),
      true,
    );
    assert.equal(
      Value.Check(schemas.PublishImportBodySchema, {
        ...publish,
        candidates: [{ ...selection, displayName: suggestedDisplayName }],
      }),
      false,
    );
  }
});
