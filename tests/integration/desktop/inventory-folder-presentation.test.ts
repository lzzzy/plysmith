import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inventoryDefaultFolder,
  inventoryFolderGroups,
  inventoryFolderSubtreeHasItems,
} from '../../../app/infrastructure/channels/ui/renderer/inventory-folder-presentation.ts';
import type {
  InventoryItem,
  InventoryOrganization,
} from '../../../app/infrastructure/channels/ui/renderer/plysmith-application-store.ts';

const organization: InventoryOrganization = {
  folders: [
    {
      folderId: '1',
      displayName: 'Openings',
      itemCount: 0,
      contextItemCount: 0,
      contextLinkCount: 0,
    },
    {
      folderId: '2',
      parentFolderId: '1',
      displayName: 'e4',
      itemCount: 3,
      contextItemCount: 1,
      contextLinkCount: 1,
    },
    {
      folderId: '3',
      parentFolderId: '2',
      displayName: 'Sicilian',
      itemCount: 2,
      contextItemCount: 0,
      contextLinkCount: 0,
    },
    {
      folderId: '4',
      displayName: 'Endgames',
      itemCount: 0,
      contextItemCount: 0,
      contextLinkCount: 0,
    },
  ],
  linkedFolderIds: ['4'],
  dataRevision: 7,
};

test('empty-folder inclusion considers all descendants and authoritative counts', () => {
  assert.equal(inventoryFolderSubtreeHasItems(organization, '1'), true);
  assert.equal(inventoryFolderSubtreeHasItems(organization, '4'), false);
  assert.equal(
    inventoryFolderSubtreeHasItems(
      {
        ...organization,
        folders: organization.folders.map((folder) => ({
          ...folder,
          itemCount: 0,
        })),
      },
      '1',
    ),
    false,
  );
});
function item(id: string, folderId?: string): InventoryItem {
  return {
    itemId: id,
    currentRevisionId: '21',
    rootAnchorId: '31',
    itemType: 'analysis',
    lifecycle: 'active',
    originKind: 'manual',
    displayName: `Analysis ${id}`,
    languageTag: 'en-GB',
    contextIds: ['10'],
    createdAt: '2026-09-30T10:00:00Z',
    updatedAt: '2026-09-30T10:00:00Z',
    ...(folderId === undefined ? {} : { folderId }),
  };
}
test('inventory folders form one nested hierarchy and each object appears exactly once', () => {
  const groups = inventoryFolderGroups(
    organization,
    [item('11', '2'), item('12', '3'), item('13')],
    false,
    'en-GB',
  );
  assert.deepEqual(
    groups.map((group) => [group.folderId, group.depth]),
    [
      ['4', 0],
      ['1', 0],
      ['2', 1],
      ['3', 2],
      [undefined, 0],
    ],
  );
  assert.deepEqual(
    groups.flatMap((group) => group.items.map((entry) => entry.itemId)),
    ['11', '12', '13'],
  );
  assert.equal(
    groups.find((group) => group.folderId === '3')?.path,
    'Openings / e4 / Sicilian',
  );
});
test('context projection keeps empty explicit targets and implicit member locations, not ancestors', () => {
  const groups = inventoryFolderGroups(
    organization,
    [item('11', '2')],
    true,
    'en-GB',
  );
  assert.deepEqual(
    groups.map((group) => group.folderId),
    ['4', '2', undefined],
  );
  assert.ok(groups.every((group) => group.depth === 0));
  assert.equal(
    groups.find((group) => group.folderId === '2')?.path,
    'Openings / e4',
  );
  assert.equal(groups.find((group) => group.folderId === '4')?.items.length, 0);
  assert.equal(organization.linkedFolderIds.length, 1);
});

test('new independent work defaults only to an available destination in its scope', () => {
  assert.equal(inventoryDefaultFolder(organization, '3', false), '3');
  assert.equal(inventoryDefaultFolder(organization, '3', true), null);
  assert.equal(inventoryDefaultFolder(organization, '2', true), '2');
  assert.equal(inventoryDefaultFolder(organization, '4', true), '4');
  assert.equal(inventoryDefaultFolder(organization, 'deleted', false), null);
  assert.equal(inventoryDefaultFolder(organization, undefined, false), null);
});
