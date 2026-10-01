import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ChangeInventoryOrganization,
  CheckInventoryNameAvailability,
  inventoryOrganizationProblem,
} from '../../app/application/inventory/index.ts';
import { localId } from '../../app/domain/identity/index.ts';

const occurredAt = '2026-09-30T12:00:00.000Z';
const folderId = localId('inventory-folder', 1);
const itemIds = [localId('inventory-item', 2)];
const contextId = localId('working-context', 3);

test('organization publishes the committed destination, explicit context and item selection after write', async () => {
  const sequence: string[] = [];
  const request = {
    expectedDataRevision: 4,
    change: { kind: 'move_items' as const, itemIds, folderId, contextId },
  };
  const command = new ChangeInventoryOrganization({
    writer: {
      changeInventoryOrganization: async (actual, timestamp) => {
        assert.deepEqual(actual, request);
        assert.equal(timestamp, occurredAt);
        sequence.push('committed');
        return { folderId, dataRevision: 5 };
      },
    },
    clock: { now: () => occurredAt },
    events: {
      publish: (event) => {
        sequence.push('published');
        assert.deepEqual(event, {
          kind: 'inventory.organization-changed',
          occurredAt,
          dataRevision: 5,
          folderId,
          contextId,
          itemIds,
        });
      },
    },
  });
  await command.execute(request);
  assert.deepEqual(sequence, ['committed', 'published']);
});

test('invalid commands do not write and stale commands do not publish', async () => {
  let writes = 0;
  const command = new ChangeInventoryOrganization({
    writer: {
      changeInventoryOrganization: async () => {
        writes++;
        throw inventoryOrganizationProblem('organization_conflict');
      },
    },
    clock: { now: () => occurredAt },
    events: { publish: () => assert.fail('Unexpected event') },
  });
  for (const expectedDataRevision of [-1, NaN, 1.5])
    await assert.rejects(
      command.execute({
        expectedDataRevision,
        change: { kind: 'delete_folder', folderId },
      }),
      { problemCode: 'inventory.invalid_organization' },
    );
  await assert.rejects(
    command.execute({
      expectedDataRevision: 0,
      change: { kind: 'move_items', itemIds: [] },
    }),
    { problemCode: 'inventory.invalid_organization' },
  );
  await assert.rejects(
    command.execute({
      expectedDataRevision: 0,
      change: { kind: 'create_folder', displayName: ' ' },
    }),
    { problemCode: 'inventory.invalid_name' },
  );
  assert.equal(writes, 0);
  await assert.rejects(
    command.execute({
      expectedDataRevision: 0,
      change: { kind: 'delete_folder', folderId },
    }),
    { problemCode: 'inventory.organization_conflict' },
  );
  assert.equal(writes, 1);
});

test('name comfort forwards exclusions and rejects names the creation path cannot accept', async () => {
  const request = { displayName: 'Opening', excludingItemId: itemIds[0]! };
  const reader = new CheckInventoryNameAvailability({
    checkInventoryNameAvailability: async (actual) => {
      assert.deepEqual(actual, request);
      return {
        displayName: actual.displayName,
        available: true,
        suggestedDisplayName: actual.displayName,
        dataRevision: 1,
      };
    },
  });
  assert.equal((await reader.execute(request)).available, true);
  await assert.rejects(reader.execute({ displayName: ' ' }), {
    problemCode: 'inventory.invalid_name',
  });
});
