import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DeleteInventoryItem,
  PreviewInventoryItemDeletion,
  inventoryDeletionConflict,
} from '../../app/application/inventory/index.ts';
import { localId } from '../../app/domain/identity/index.ts';

const timestamp = '2026-09-27T12:00:00.000Z';
const itemId = localId('inventory-item', 1);
const request = {
  itemId,
  expectedCurrentRevisionId: localId('item-revision', 2),
  expectedDataRevision: 4,
};

test('publishes inventory deletion only after the writer commits', async () => {
  const sequence: string[] = [];
  const command = new DeleteInventoryItem({
    writer: {
      deleteInventoryItem: async (actual, occurredAt) => {
        assert.deepEqual(actual, request);
        assert.equal(occurredAt, timestamp);
        sequence.push('committed');
        return { itemId, dataRevision: 5 };
      },
    },
    clock: { now: () => timestamp },
    events: {
      publish: (event) => {
        sequence.push('published');
        assert.deepEqual(event, {
          kind: 'inventory.item-deleted',
          occurredAt: timestamp,
          itemId,
          dataRevision: 5,
        });
      },
    },
  });
  assert.deepEqual(await command.execute(request), { itemId, dataRevision: 5 });
  assert.deepEqual(sequence, ['committed', 'published']);
});

test('rejects invalid deletion confirmations and never publishes a stale deletion', async () => {
  let writes = 0;
  const command = new DeleteInventoryItem({
    writer: {
      deleteInventoryItem: async () => {
        writes += 1;
        throw inventoryDeletionConflict();
      },
    },
    clock: { now: () => timestamp },
    events: {
      publish: () => assert.fail('A rejected deletion must not publish'),
    },
  });
  for (const expectedDataRevision of [-1, 1.5, Number.NaN]) {
    await assert.rejects(
      command.execute({ ...request, expectedDataRevision }),
      { problemCode: 'inventory.invalid_deletion' },
    );
  }
  assert.equal(writes, 0);
  await assert.rejects(command.execute(request), {
    problemCode: 'inventory.deletion_conflict',
  });
  assert.equal(writes, 1);
});

test('does not offer a deletion preview for an absent or already removed item', async () => {
  const preview = new PreviewInventoryItemDeletion({
    previewInventoryItemDeletion: async () => undefined,
  });
  await assert.rejects(preview.execute({ itemId }), {
    problemCode: 'inventory.item_not_found',
  });
});
