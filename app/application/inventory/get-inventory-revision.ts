import type {
  AnchorId,
  InventoryItemId,
  ItemRevisionId,
} from '../../domain/identity/index.ts';
import type { WorkScope } from '../../domain/workspace/index.ts';
import type { AnalysisRecordView } from '../analysis/public.ts';
import type { InventoryRevisionReader } from './inventory-ports.ts';
import { inventoryItemNotFound } from './inventory-problems.ts';

export interface GetInventoryRevisionUseCase {
  execute(request: {
    readonly scope: WorkScope;
    readonly itemId: InventoryItemId;
    readonly revisionId: ItemRevisionId;
    readonly anchorId?: AnchorId;
  }): Promise<AnalysisRecordView>;
}

export class GetInventoryRevision implements GetInventoryRevisionUseCase {
  readonly #reader: InventoryRevisionReader;

  constructor(reader: InventoryRevisionReader) {
    this.#reader = reader;
  }

  async execute(
    request: Parameters<GetInventoryRevisionUseCase['execute']>[0],
  ): Promise<AnalysisRecordView> {
    const revision = await this.#reader.readAnalysisRevision(request);
    if (revision === undefined) throw inventoryItemNotFound();
    return revision;
  }
}
