import type {
  ContextAnalysisReader,
  FreeAnalysisSession,
} from '../analysis/public.ts';
import type {
  InventoryRevisionPreview,
  PreviewInventoryRevisionRequest,
} from './inventory-models.ts';
import type { InventoryRevisionReader } from './inventory-ports.ts';
import { invalidInventoryRevision } from './inventory-problems.ts';
import { readRevisionScratch } from './revision-scratch-access.ts';
import { normalizeInventoryRevisionComment } from './inventory-revision-comment.ts';

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
    const comment = normalizeInventoryRevisionComment(
      request.scope,
      request.comment,
    );
    const scratch = await readRevisionScratch({
      ...request,
      contextReader: this.#contextReader,
      freeSession: this.#freeSession,
    });
    return this.#inventory.previewInventoryRevision({
      scope: request.scope,
      scratch,
      ...(comment === undefined ? {} : { comment }),
    });
  }
}
