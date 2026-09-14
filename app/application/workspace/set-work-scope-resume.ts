import type {
  SetWorkScopeResumeRequest,
  SetWorkScopeResumeResult,
  WorkspaceChanged,
} from './workspace-models.ts';
import type {
  WorkspaceChangedPublisher,
  WorkspaceClock,
  WorkingContextWriter,
} from './workspace-ports.ts';
import { invalidResume } from './workspace-problems.ts';

export interface SetWorkScopeResumeUseCase {
  execute(
    request: SetWorkScopeResumeRequest,
  ): Promise<SetWorkScopeResumeResult>;
}

export class SetWorkScopeResume implements SetWorkScopeResumeUseCase {
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
    request: SetWorkScopeResumeRequest,
  ): Promise<SetWorkScopeResumeResult> {
    validateResume(request);
    const occurredAt = this.#clock.now();
    const result = await this.#writer.setWorkScopeResume(request, occurredAt);
    const event: WorkspaceChanged = Object.freeze({
      kind: 'workspace.resume-updated',
      occurredAt,
      dataRevision: result.dataRevision,
      contextId: request.contextId,
      area: result.area,
      resumeVersion: result.resume.resumeVersion,
    });
    this.#events.publish(event);
    return result;
  }
}

function validateResume(request: SetWorkScopeResumeRequest): void {
  const expected = request.expectedResumeVersion;
  if (expected !== null && (!Number.isSafeInteger(expected) || expected < 1)) {
    throw invalidResume();
  }
  if (request.area === 'manage') {
    if (
      (request.selectedItemId === undefined) !==
      (request.selectedAnchorId === undefined)
    ) {
      throw invalidResume();
    }
    return;
  }
  const supplied = [
    request.itemId,
    request.revisionId,
    request.anchorId,
  ].filter((value) => value !== undefined).length;
  if (supplied !== 0 && supplied !== 3) throw invalidResume();
}
