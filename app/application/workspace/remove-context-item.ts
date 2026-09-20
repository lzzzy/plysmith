import type {
  RemoveContextItemRequest,
  RemoveContextItemResult,
  WorkspaceChanged,
} from './workspace-models.ts';
import type {
  WorkspaceChangedPublisher,
  WorkspaceClock,
  WorkingContextWriter,
} from './workspace-ports.ts';

export interface RemoveContextItemUseCase {
  execute(request: RemoveContextItemRequest): Promise<RemoveContextItemResult>;
}

export class RemoveContextItem implements RemoveContextItemUseCase {
  readonly #writer: WorkingContextWriter;
  readonly #clock: WorkspaceClock;
  readonly #events: WorkspaceChangedPublisher;

  constructor(dependencies: {
    readonly writer: WorkingContextWriter;
    readonly clock: WorkspaceClock;
    readonly events: WorkspaceChangedPublisher;
  }) {
    this.#writer = dependencies.writer;
    this.#clock = dependencies.clock;
    this.#events = dependencies.events;
  }

  async execute(
    request: RemoveContextItemRequest,
  ): Promise<RemoveContextItemResult> {
    const occurredAt = this.#clock.now();
    const result = await this.#writer.removeContextItem(request, occurredAt);
    const event: WorkspaceChanged = Object.freeze({
      kind: 'workspace.item-removed',
      occurredAt,
      dataRevision: result.dataRevision,
      contextId: result.contextId,
      itemId: result.itemId,
    });
    this.#events.publish(event);
    return result;
  }
}
