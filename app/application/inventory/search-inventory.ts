import type {
  SearchInventoryRequest,
  SearchInventoryResult,
} from './inventory-models.ts';
import type { InventoryReader } from './inventory-ports.ts';
import { invalidInventorySearch } from './inventory-problems.ts';

export interface SearchInventoryUseCase {
  execute(request: SearchInventoryRequest): Promise<SearchInventoryResult>;
}

export class SearchInventory implements SearchInventoryUseCase {
  readonly #reader: InventoryReader;

  constructor(reader: InventoryReader) {
    this.#reader = reader;
  }

  execute(request: SearchInventoryRequest): Promise<SearchInventoryResult> {
    const pageSize = request.pageSize ?? 50;
    if (
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      (request.query !== undefined &&
        (request.query.trim() !== request.query ||
          request.query.length === 0 ||
          request.query.length > 200)) ||
      (request.cursor !== undefined && request.cursor.length === 0)
    ) {
      return Promise.reject(invalidInventorySearch());
    }
    return this.#reader.searchInventory({
      ...request,
      pageSize,
    });
  }
}
