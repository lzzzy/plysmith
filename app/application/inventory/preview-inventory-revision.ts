import type { ContextAnalysisReader } from '../analysis/analysis-ports.ts';
import type { FreeAnalysisSession } from '../analysis/free-analysis-session.ts';
import type {
  InventoryRevisionPreview,
  PreviewInventoryRevisionRequest,
} from './inventory-models.ts';
import type { InventoryRevisionReader } from './inventory-ports.ts';
import { invalidInventoryRevision } from './inventory-problems.ts';
import { readRevisionScratch } from './revision-scratch-access.ts';

export interface PreviewInventoryRevisionUseCase {
  execute(
    request: PreviewInventoryRevisionRequest,
  ): Promise<InventoryRevisionPreview>;
}

export class PreviewInventoryRevision implements PreviewInventoryRevisionUseCase {
  readonly #inventory: InventoryRevisionReader;
  readonly #contextReader: ContextAnalysisReader;
  readonly #freeSession: FreeAnalysisSession;

  constructor(dependencies: {
    readonly inventory: InventoryRevisionReader;
    readonly contextReader: ContextAnalysisReader;
    readonly freeSession: FreeAnalysisSession;
  }) {
    this.#inventory = dependencies.inventory;
    this.#contextReader = dependencies.contextReader;
    this.#freeSession = dependencies.freeSession;
  }

  async execute(
    request: PreviewInventoryRevisionRequest,
  ): Promise<InventoryRevisionPreview> {
    if (
      request.expectedScratchId.trim().length === 0 ||
      !Number.isSafeInteger(request.expectedScratchRevision) ||
      request.expectedScratchRevision < 1
    ) {
      throw invalidInventoryRevision();
    }
    const scratch = await readRevisionScratch({
      ...request,
      contextReader: this.#contextReader,
      freeSession: this.#freeSession,
    });
    return this.#inventory.previewInventoryRevision({
      scope: request.scope,
      scratch,
    });
  }
}
