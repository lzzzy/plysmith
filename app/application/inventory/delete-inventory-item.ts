import type {
  DeleteInventoryItemRequest,
  DeleteInventoryItemResult,
} from './inventory-models.ts';
import type {
  InventoryClock,
  InventoryItemDeletedPublisher,
  InventoryLifecycleWriter,
} from './inventory-ports.ts';
import { invalidInventoryDeletion } from './inventory-problems.ts';

export interface DeleteInventoryItemUseCase {
  execute(
    request: DeleteInventoryItemRequest,
  ): Promise<DeleteInventoryItemResult>;
}

export class DeleteInventoryItem implements DeleteInventoryItemUseCase {
  readonly #writer: InventoryLifecycleWriter;
  readonly #clock: InventoryClock;
  readonly #events: InventoryItemDeletedPublisher;

  constructor(dependencies: {
    readonly writer: InventoryLifecycleWriter;
    readonly clock: InventoryClock;
    readonly events: InventoryItemDeletedPublisher;
  }) {
    this.#writer = dependencies.writer;
    this.#clock = dependencies.clock;
    this.#events = dependencies.events;
  }

  async execute(
    request: DeleteInventoryItemRequest,
  ): Promise<DeleteInventoryItemResult> {
    if (
      !Number.isSafeInteger(request.expectedDataRevision) ||
      request.expectedDataRevision < 0
    ) {
      throw invalidInventoryDeletion();
    }
    const occurredAt = this.#clock.now();
    const result = await this.#writer.deleteInventoryItem(request, occurredAt);
    this.#events.publish({
      kind: 'inventory.item-deleted',
      occurredAt,
      ...result,
    });
    return result;
  }
}
