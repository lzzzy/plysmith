import type {
  AnalysisScratchChangedPublisher,
  ContextAnalysisReader,
  FreeAnalysisSession,
} from '../analysis/public.ts';
import type {
  InventoryClock,
  InventoryRevisionWriter,
  InventoryRevisionSavedPublisher,
  RevisionImpactChangedPublisher,
} from './inventory-ports.ts';
import type {
  SaveInventoryRevisionRequest,
  SaveInventoryRevisionResult,
} from './inventory-models.ts';
import { invalidInventoryRevision } from './inventory-problems.ts';
import { normalizeInventoryRevisionComment } from './inventory-revision-comment.ts';
import {
  assertRevisionScratch,
  readRevisionScratch,
} from './revision-scratch-access.ts';

export interface SaveInventoryRevisionUseCase {
  execute(
    request: SaveInventoryRevisionRequest,
  ): Promise<SaveInventoryRevisionResult>;
}

export class SaveInventoryRevision implements SaveInventoryRevisionUseCase {
  readonly #reader: ContextAnalysisReader;
  readonly #writer: InventoryRevisionWriter;
  readonly #freeSession: FreeAnalysisSession;
  readonly #clock: InventoryClock;
  readonly #inventoryEvents: InventoryRevisionSavedPublisher;
  readonly #impactEvents: RevisionImpactChangedPublisher;
  readonly #scratchEvents: AnalysisScratchChangedPublisher;

  constructor(dependencies: {
    readonly reader: ContextAnalysisReader;
    readonly writer: InventoryRevisionWriter;
    readonly freeSession: FreeAnalysisSession;
    readonly clock: InventoryClock;
    readonly inventoryEvents: InventoryRevisionSavedPublisher;
    readonly impactEvents: RevisionImpactChangedPublisher;
    readonly scratchEvents: AnalysisScratchChangedPublisher;
  }) {
    this.#reader = dependencies.reader;
    this.#writer = dependencies.writer;
    this.#freeSession = dependencies.freeSession;
    this.#clock = dependencies.clock;
    this.#inventoryEvents = dependencies.inventoryEvents;
    this.#impactEvents = dependencies.impactEvents;
    this.#scratchEvents = dependencies.scratchEvents;
  }

  async execute(
    request: SaveInventoryRevisionRequest,
  ): Promise<SaveInventoryRevisionResult> {
    if (
      request.previewFingerprint.length !== 71 ||
      !request.previewFingerprint.startsWith('sha256:')
    ) {
      throw invalidInventoryRevision();
    }
    const comment = normalizeInventoryRevisionComment(
      request.scope,
      request.comment,
    );
    const normalizedRequest = {
      ...request,
      ...(comment === undefined ? {} : { comment }),
    };
    const occurredAt = this.#clock.now();
    const result =
      request.scope.kind === 'free'
        ? await this.#freeSession.run(async (scratch) => {
            assertRevisionScratch(
              scratch,
              request.expectedScratchId,
              request.expectedScratchRevision,
            );
            const saved = await this.#writer.saveInventoryRevision({
              ...normalizedRequest,
              scratch,
              occurredAt,
            });
            return {
              ...(saved.noOp ? { scratch } : {}),
              result: saved,
              persisted: true,
            };
          })
        : await this.#writer.saveInventoryRevision({
            ...normalizedRequest,
            scratch: await readRevisionScratch({
              ...request,
              contextReader: this.#reader,
              freeSession: this.#freeSession,
            }),
            occurredAt,
          });
    this.#publish(request, result, occurredAt);
    return result;
  }

  #publish(
    request: SaveInventoryRevisionRequest,
    result: SaveInventoryRevisionResult,
    occurredAt: string,
  ): void {
    if (result.noOp) return;
    this.#inventoryEvents.publish({
      kind: 'inventory.revision-saved',
      occurredAt,
      dataRevision: result.dataRevision,
      itemId: result.itemId,
      revisionId: result.revisionId,
    });
    for (const impact of result.impacts) {
      this.#impactEvents.publish({
        kind: 'workspace.revision-impact-changed',
        occurredAt,
        dataRevision: result.dataRevision,
        contextId: impact.contextId,
        itemId: result.itemId,
        impactId: impact.impactId,
        status: 'open',
      });
    }
    this.#scratchEvents.publish({
      kind: 'analysis.scratch-changed',
      occurredAt,
      dataRevision: result.dataRevision,
      scope: request.scope,
    });
  }
}
