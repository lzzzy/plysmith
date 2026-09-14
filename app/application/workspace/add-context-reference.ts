import type {
  AddContextReferenceRequest,
  AddContextReferenceResult,
  WorkspaceChanged,
} from './workspace-models.ts';
import type {
  WorkspaceChangedPublisher,
  WorkspaceClock,
  WorkingContextWriter,
} from './workspace-ports.ts';

export interface AddContextReferenceUseCase {
  execute(
    request: AddContextReferenceRequest,
  ): Promise<AddContextReferenceResult>;
}

export class AddContextReference implements AddContextReferenceUseCase {
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
    request: AddContextReferenceRequest,
  ): Promise<AddContextReferenceResult> {
    const occurredAt = this.#clock.now();
    const result = await this.#writer.addContextReference(request, occurredAt);
    const event: WorkspaceChanged = Object.freeze({
      kind: 'workspace.reference-added',
      occurredAt,
      dataRevision: result.dataRevision,
      contextId: request.contextId,
      referenceId: result.reference.referenceId,
    });
    this.#events.publish(event);
    return result;
  }
}
