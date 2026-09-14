import type { AnalysisRecordCreated } from './inventory-models.ts';
import type {
  SearchInventoryRequest,
  SearchInventoryResult,
} from './inventory-models.ts';

export interface InventoryReader {
  searchInventory(
    request: Required<Pick<SearchInventoryRequest, 'pageSize'>> &
      Omit<SearchInventoryRequest, 'pageSize'>,
  ): Promise<SearchInventoryResult>;
}

export interface InventoryChangedPublisher {
  publish(event: AnalysisRecordCreated): void;
}
