import type {
  ResolvePendingRevisionImpactRequest,
  ResolvePendingRevisionImpactResult,
} from './inventory-models.ts';
import type {
  InventoryClock,
  InventoryRevisionWriter,
  RevisionImpactChangedPublisher,
} from './inventory-ports.ts';
import { invalidRevisionImpactResolution } from './inventory-problems.ts';

export interface ResolvePendingRevisionImpactUseCase {
  execute(
    request: ResolvePendingRevisionImpactRequest,
  ): Promise<ResolvePendingRevisionImpactResult>;
}

export class ResolvePendingRevisionImpact implements ResolvePendingRevisionImpactUseCase {
  readonly #writer: InventoryRevisionWriter;
  readonly #clock: InventoryClock;
  readonly #events: RevisionImpactChangedPublisher;

  constructor(dependencies: {
    readonly writer: InventoryRevisionWriter;
    readonly clock: InventoryClock;
    readonly events: RevisionImpactChangedPublisher;
  }) {
    this.#writer = dependencies.writer;
    this.#clock = dependencies.clock;
    this.#events = dependencies.events;
  }

  async execute(
    request: ResolvePendingRevisionImpactRequest,
  ): Promise<ResolvePendingRevisionImpactResult> {
    if (
      !Number.isSafeInteger(request.expectedDataRevision) ||
      request.expectedDataRevision < 0 ||
      !Number.isSafeInteger(request.expectedImpactVersion) ||
      request.expectedImpactVersion < 1 ||
      (request.resolution.kind === 'keep_copy' &&
        (request.resolution.displayName.trim().length < 1 ||
          request.resolution.displayName.trim().length > 200))
    ) {
      throw invalidRevisionImpactResolution();
    }
    const normalizedRequest: ResolvePendingRevisionImpactRequest =
      request.resolution.kind === 'keep_copy'
        ? Object.freeze({
            ...request,
            resolution: Object.freeze({
              kind: 'keep_copy' as const,
              displayName: request.resolution.displayName.trim(),
            }),
          })
        : request;
    const occurredAt = this.#clock.now();
    const result = await this.#writer.resolvePendingRevisionImpact(
      normalizedRequest,
      occurredAt,
    );
    this.#events.publish({
      kind: 'workspace.revision-impact-changed',
      occurredAt,
      dataRevision: result.dataRevision,
      contextId: result.contextId,
      itemId: result.itemId,
      impactId: result.impactId,
      status: 'resolved',
    });
    return result;
  }
}
