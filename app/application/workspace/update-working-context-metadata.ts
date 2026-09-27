import { createWorkingContextDraft } from '../../domain/workspace/index.ts';
import type {
  CreateWorkingContextResult,
  UpdateWorkingContextMetadataRequest,
} from './workspace-models.ts';
import type {
  WorkingContextWriter,
  WorkspaceClock,
  WorkspaceChangedPublisher,
} from './workspace-ports.ts';
import { invalidWorkingContext } from './workspace-problems.ts';

export interface UpdateWorkingContextMetadataUseCase {
  execute(
    request: UpdateWorkingContextMetadataRequest,
  ): Promise<CreateWorkingContextResult>;
}

export class UpdateWorkingContextMetadata implements UpdateWorkingContextMetadataUseCase {
  readonly #dependencies: {
    readonly writer: WorkingContextWriter;
    readonly clock: WorkspaceClock;
    readonly events: WorkspaceChangedPublisher;
  };

  constructor(dependencies: {
    readonly writer: WorkingContextWriter;
    readonly clock: WorkspaceClock;
    readonly events: WorkspaceChangedPublisher;
  }) {
    this.#dependencies = dependencies;
  }

  async execute(
    request: UpdateWorkingContextMetadataRequest,
  ): Promise<CreateWorkingContextResult> {
    try {
      createWorkingContextDraft({
        displayName: request.displayName,
        ...(request.purpose == null ? {} : { purpose: request.purpose }),
      });
      if (
        !Number.isSafeInteger(request.expectedContextVersion) ||
        request.expectedContextVersion < 1
      ) {
        throw invalidWorkingContext();
      }
    } catch {
      throw invalidWorkingContext();
    }
    const occurredAt = this.#dependencies.clock.now();
    const result = await this.#dependencies.writer.updateWorkingContextMetadata(
      request,
      occurredAt,
    );
    this.#dependencies.events.publish({
      kind: 'workspace.context-updated',
      occurredAt,
      contextId: result.context.contextId,
      contextVersion: result.context.contextVersion,
      dataRevision: result.dataRevision,
    });
    return result;
  }
}
