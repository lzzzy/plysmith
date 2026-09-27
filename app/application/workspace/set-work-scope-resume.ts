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
import {
  requireInventoryWorkAccess,
  type InventoryWorkAccessReader,
} from './inventory-work-access.ts';

export interface SetWorkScopeResumeUseCase {
  execute(
    request: SetWorkScopeResumeRequest,
  ): Promise<SetWorkScopeResumeResult>;
}

export class SetWorkScopeResume implements SetWorkScopeResumeUseCase {
  readonly #writer: WorkingContextWriter & InventoryWorkAccessReader;
  readonly #clock: WorkspaceClock;
  readonly #events: WorkspaceChangedPublisher;

  constructor(dependencies: {
    readonly writer: WorkingContextWriter & InventoryWorkAccessReader;
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
    if (request.area === 'analyze') {
      await requireInventoryWorkAccess(
        this.#writer,
        request.scope,
        request.itemId,
      );
    }
    const occurredAt = this.#clock.now();
    const result = await this.#writer.setWorkScopeResume(request, occurredAt);
    const event: WorkspaceChanged = Object.freeze({
      kind: 'workspace.resume-updated',
      occurredAt,
      dataRevision: result.dataRevision,
      ...(request.scope.kind === 'context'
        ? { contextId: request.scope.contextId }
        : {}),
      area: result.area,
      resumeVersion: result.resume.resumeVersion,
    });
    this.#events.publish(event);
    return result;
  }
}

function validateResume(request: SetWorkScopeResumeRequest): void {
  const expected = request.expectedResumeVersion;
  if (
    request.scope.kind === 'free' &&
    request.area === 'analyze' &&
    request.mode === 'edit_overlay'
  ) {
    throw invalidResume();
  }
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
