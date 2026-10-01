import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localId } from '../../../app/domain/identity/index.ts';
import {
  inventoryFolderSubtree,
  validateInventoryFolderPlacement,
  type InventoryFolder,
} from '../../../app/domain/inventory/index.ts';

const root = localId('inventory-folder', 1);
const child = localId('inventory-folder', 2);
const folders: readonly InventoryFolder[] = [
  { folderId: root, displayName: 'Openings' },
  { folderId: child, parentFolderId: root, displayName: 'White' },
];

test('folder names are normalized within siblings, including roots, but reusable elsewhere', () => {
  assert.throws(
    () =>
      validateInventoryFolderPlacement(folders, {
        displayName: '  OPENINGS  ',
      }),
    { reason: 'name_conflict' },
  );
  assert.throws(
    () =>
      validateInventoryFolderPlacement(folders, {
        displayName: '\uff2f\uff50\uff45\uff4e\uff49\uff4e\uff47\uff53',
      }),
    { reason: 'name_conflict' },
  );
  validateInventoryFolderPlacement(folders, {
    displayName: 'Openings',
    parentFolderId: root,
  });
  validateInventoryFolderPlacement(folders, folders[0]!);
  for (const displayName of ['', ' ', 'x'.repeat(201), 'a\nb'])
    assert.throws(
      () => validateInventoryFolderPlacement(folders, { displayName }),
      { reason: 'invalid_name' },
    );
});

test('folder placement prevents self-parenting, descendant cycles and missing parents', () => {
  for (const parentFolderId of [root, child])
    assert.throws(
      () =>
        validateInventoryFolderPlacement(folders, {
          folderId: root,
          displayName: 'Openings',
          parentFolderId,
        }),
      { reason: 'cycle' },
    );
  assert.throws(
    () =>
      validateInventoryFolderPlacement(folders, {
        displayName: 'New',
        parentFolderId: localId('inventory-folder', 999),
      }),
    { reason: 'folder_not_found' },
  );
  assert.deepEqual(inventoryFolderSubtree(folders, root), [root, child]);
  assert.deepEqual(inventoryFolderSubtree(folders, child), [child]);
  assert.throws(
    () => inventoryFolderSubtree(folders, localId('inventory-folder', 999)),
    { reason: 'folder_not_found' },
  );
});
