import type {
  InventoryItemDeletionPreview,
  PreviewInventoryItemDeletionRequest,
} from './inventory-models.ts';
import type { InventoryLifecycleReader } from './inventory-ports.ts';
import { inventoryItemNotFound } from './inventory-problems.ts';

export interface PreviewInventoryItemDeletionUseCase {
  execute(
    request: PreviewInventoryItemDeletionRequest,
  ): Promise<InventoryItemDeletionPreview>;
}

export class PreviewInventoryItemDeletion implements PreviewInventoryItemDeletionUseCase {
  readonly #reader: InventoryLifecycleReader;

  constructor(reader: InventoryLifecycleReader) {
    this.#reader = reader;
  }

  async execute(
    request: PreviewInventoryItemDeletionRequest,
  ): Promise<InventoryItemDeletionPreview> {
    const preview = await this.#reader.previewInventoryItemDeletion(request);
    if (preview === undefined) throw inventoryItemNotFound();
    return preview;
  }
}
