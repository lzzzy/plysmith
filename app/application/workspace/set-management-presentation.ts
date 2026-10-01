import type {
  SetManagementPresentationRequest,
  SetManagementPresentationResult,
} from './workspace-models.ts';
import type {
  ManagementPresentationWriter,
  WorkspaceChangedPublisher,
  WorkspaceClock,
} from './workspace-ports.ts';
import { invalidResume } from './workspace-problems.ts';

export interface SetManagementPresentationUseCase {
  execute(
    request: SetManagementPresentationRequest,
  ): Promise<SetManagementPresentationResult>;
}

export class SetManagementPresentation implements SetManagementPresentationUseCase {
  readonly #writer: ManagementPresentationWriter;
  readonly #clock: WorkspaceClock;
  readonly #events: WorkspaceChangedPublisher;

  constructor(dependencies: {
    readonly writer: ManagementPresentationWriter;
    readonly clock: WorkspaceClock;
    readonly events: WorkspaceChangedPublisher;
  }) {
    this.#writer = dependencies.writer;
    this.#clock = dependencies.clock;
    this.#events = dependencies.events;
  }

  async execute(
    request: SetManagementPresentationRequest,
  ): Promise<SetManagementPresentationResult> {
    const expected = request.expectedResumeVersion;
    if (
      (request.presentation !== 'folders' &&
        request.presentation !== 'origins') ||
      (expected !== null && (!Number.isSafeInteger(expected) || expected < 1))
    ) {
      throw invalidResume();
    }
    const occurredAt = this.#clock.now();
    const { changed, ...result } = await this.#writer.setManagementPresentation(
      request,
      occurredAt,
    );
    if (changed) {
      this.#events.publish(
        Object.freeze({
          kind: 'workspace.resume-updated',
          occurredAt,
          dataRevision: result.dataRevision,
          ...(request.scope.kind === 'context'
            ? { contextId: request.scope.contextId }
            : {}),
          area: 'manage',
          resumeVersion: result.resume.resumeVersion,
        }),
      );
    }
    return Object.freeze(result);
  }
}
