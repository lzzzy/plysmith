import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inventoryFamilyPresentation,
  type InventoryFamilyNode,
} from '../../../app/infrastructure/channels/ui/renderer/inventory-family-presentation.ts';
import type { SearchInventoryResultDto } from '../../../app/infrastructure/channels/host_client/index.ts';

function item(
  itemId: string,
  itemType: 'game' | 'analysis' = 'analysis',
  contextIds: readonly string[] = [],
): SearchInventoryResultDto['items'][number] {
  return {
    lifecycle: 'active',
    itemId,
    currentRevisionId: `revision-${itemId}`,
    rootAnchorId: `anchor-${itemId}`,
    itemType,
    originKind: 'manual',
    displayName: 'Same name',
    languageTag: 'de-DE',
    contextIds,
    createdAt: '2026-09-27T10:00:00Z',
    updatedAt: '2026-09-27T10:00:00Z',
  };
}

function edge(itemId: string, sourceItemId: string) {
  return {
    itemId,
    sourceItemId,
    sourceRevisionId: `older-revision-${sourceItemId}`,
    sourceAnchorId: `source-anchor-${sourceItemId}`,
  };
}

function shape(nodes: readonly InventoryFamilyNode[]): unknown {
  return nodes.map((node) => ({
    id: node.item.itemId,
    selectable: node.isMatch,
    children: shape(node.children),
  }));
}

test('builds mixed multilevel game and analysis ancestry independently of search order', () => {
  const result = inventoryFamilyPresentation({
    items: [
      item('copy'),
      item('child', 'game'),
      item('game', 'game'),
      item('independent'),
    ],
    ancestors: [],
    provenanceEdges: [edge('copy', 'child'), edge('child', 'game')],
  });
  assert.deepEqual(shape(result), [
    {
      id: 'game',
      selectable: true,
      children: [
        {
          id: 'child',
          selectable: true,
          children: [{ id: 'copy', selectable: true, children: [] }],
        },
      ],
    },
    { id: 'independent', selectable: true, children: [] },
  ]);
});

test('retains full off-page ancestors as inert source rows without creating membership', () => {
  const root = item('root', 'analysis', ['another-context']);
  const parent = item('parent', 'game', ['current-context']);
  const child = item('child', 'analysis', ['current-context']);
  const result = inventoryFamilyPresentation({
    items: [child],
    ancestors: [root, parent],
    provenanceEdges: [edge('child', 'parent'), edge('parent', 'root')],
  });
  assert.deepEqual(shape(result), [
    {
      id: 'root',
      selectable: false,
      children: [
        {
          id: 'parent',
          selectable: false,
          children: [
            {
              id: 'child',
              selectable: true,
              children: [],
            },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(result[0]?.item.contextIds, ['another-context']);
  assert.deepEqual(result[0]?.children[0]?.item.contextIds, [
    'current-context',
  ]);
});

test('a previously inert ancestor becomes selectable only when it is a loaded result', () => {
  const ancestor = item('root', 'game');
  const match = {
    ...ancestor,
    displayName: 'Effective context name',
    currentRevisionId: 'pinned-revision',
  };
  const result = inventoryFamilyPresentation({
    items: [item('child'), match],
    ancestors: [ancestor],
    provenanceEdges: [edge('child', 'root'), edge('child', 'root')],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.isMatch, true);
  assert.equal(result[0]?.item, match);
  assert.equal(result[0]?.children.length, 1);
});

test('does not group independent records by identical names, dates, or record type', () => {
  const result = inventoryFamilyPresentation({
    items: [item('first'), item('second'), item('third', 'game')],
    ancestors: [],
    provenanceEdges: [],
  });
  assert.deepEqual(
    result.map((node) => node.item.itemId),
    ['first', 'second', 'third'],
  );
  assert.ok(result.every((node) => node.children.length === 0));
});

test('terminates cycles without losing records or unrelated descendant relations', () => {
  const result = inventoryFamilyPresentation({
    items: [
      item('a'),
      item('b'),
      item('child'),
      item('self'),
      item('independent'),
    ],
    ancestors: [],
    provenanceEdges: [
      edge('a', 'b'),
      edge('b', 'a'),
      edge('child', 'a'),
      edge('self', 'self'),
    ],
  });
  assert.deepEqual(shape(result), [
    {
      id: 'a',
      selectable: true,
      children: [{ id: 'child', selectable: true, children: [] }],
    },
    { id: 'b', selectable: true, children: [] },
    { id: 'self', selectable: true, children: [] },
    { id: 'independent', selectable: true, children: [] },
  ]);
});

test('never substitutes a missing source with another visible record', () => {
  const result = inventoryFamilyPresentation({
    items: [item('child'), item('unrelated')],
    ancestors: [],
    provenanceEdges: [edge('child', 'missing'), edge('off-page', 'unrelated')],
  });
  assert.equal(result.length, 2);
  assert.ok(result.every((node) => node.children.length === 0));
});
