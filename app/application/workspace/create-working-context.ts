import { createWorkingContextDraft } from '../../domain/workspace/index.ts';
import type {
  CreateWorkingContextRequest,
  CreateWorkingContextResult,
  WorkspaceChanged,
} from './workspace-models.ts';
import type {
  WorkspaceChangedPublisher,
  WorkspaceClock,
  WorkingContextWriter,
} from './workspace-ports.ts';
import { invalidWorkingContext } from './workspace-problems.ts';

export interface CreateWorkingContextUseCase {
  execute(
    request: CreateWorkingContextRequest,
  ): Promise<CreateWorkingContextResult>;
}

export class CreateWorkingContext implements CreateWorkingContextUseCase {
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
    request: CreateWorkingContextRequest,
  ): Promise<CreateWorkingContextResult> {
    let draft;
    try {
      draft = createWorkingContextDraft(request);
    } catch {
      throw invalidWorkingContext();
    }
    const occurredAt = this.#clock.now();
    const result = await this.#writer.createWorkingContext(draft, occurredAt);
    const event: WorkspaceChanged = Object.freeze({
      kind: 'workspace.context-created',
      occurredAt,
      dataRevision: result.dataRevision,
      contextId: result.context.contextId,
      contextVersion: result.context.contextVersion,
    });
    this.#events.publish(event);
    return result;
  }
}
