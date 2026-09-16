import type {
  ListInventoryRevisionsRequest,
  ListInventoryRevisionsResult,
} from './inventory-models.ts';
import type { InventoryRevisionReader } from './inventory-ports.ts';
import { invalidInventoryRevision } from './inventory-problems.ts';

export interface ListInventoryRevisionsUseCase {
  execute(
    request: ListInventoryRevisionsRequest,
  ): Promise<ListInventoryRevisionsResult>;
}

export class ListInventoryRevisions implements ListInventoryRevisionsUseCase {
  readonly #reader: InventoryRevisionReader;

  constructor(reader: InventoryRevisionReader) {
    this.#reader = reader;
  }

  execute(
    request: ListInventoryRevisionsRequest,
  ): Promise<ListInventoryRevisionsResult> {
    const pageSize = request.pageSize ?? 20;
    if (
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      request.cursor === ''
    ) {
      return Promise.reject(invalidInventoryRevision());
    }
    return this.#reader.listInventoryRevisions({ ...request, pageSize });
  }
}
