import type { AnalysisScratchIntent } from '../../domain/analysis/index.ts';
import type {
  ContributionId,
  InventoryItemId,
  PlayoutDraftId,
  WorkingContextId,
} from '../../domain/identity/index.ts';
import {
  startupResumeTarget,
  type StartupResumeTarget,
} from '../../domain/workspace/index.ts';
import type {
  AnalysisResume,
  ManagementResume,
  WorkScopeWorkspace,
} from './workspace-models.ts';
import type {
  WorkspaceChangedPublisher,
  WorkspaceClock,
} from './workspace-ports.ts';
import {
  invalidResume,
  invalidRemovalConfirmation,
  workingContextNotFound,
} from './workspace-problems.ts';

export interface StartupResume extends StartupResumeTarget {
  readonly startupVersion: number | null;
  readonly dataRevision: number;
  readonly unavailableContext?: {
    readonly contextId: WorkingContextId;
    readonly displayName?: string;
    readonly reason: 'deleted' | 'missing';
  };
}

export interface SetStartupResumeRequest extends StartupResumeTarget {
  readonly expectedStartupVersion: number | null;
}

export interface StartupResumePort {
  readStartupResume(): Promise<StartupResume>;
  setStartupResume(
    request: SetStartupResumeRequest,
    occurredAt: string,
  ): Promise<StartupResume>;
}

export interface WorkScopeWorkspaceReader {
  readWorkScopeWorkspace(
    scope: StartupResumeTarget['scope'],
  ): Promise<WorkScopeWorkspace | undefined>;
}

export interface ContextWorkLosses {
  readonly notes: readonly {
    readonly contributionId: ContributionId;
    readonly body: string;
    readonly moveCount: number;
    readonly itemId?: InventoryItemId;
  }[];
  readonly scratch?: {
    readonly scratchId: string;
    readonly scratchRevision: number;
    readonly stepCount: number;
    readonly noteBody?: string;
    readonly intent: AnalysisScratchIntent['kind'];
    readonly itemId?: InventoryItemId;
  };
  readonly managementResume?: ManagementResume;
  readonly analysisResume?: AnalysisResume;
  readonly playout?: ContextPlayoutWork;
}

export interface ContextPlayoutWork {
  readonly draftId: PlayoutDraftId;
  readonly draftRevision: number;
  readonly moveCount: number;
  readonly status:
    'active' | 'awaiting_policy' | 'paused' | 'stopped' | 'terminal';
  readonly sourceItemId?: InventoryItemId;
}

export interface ContextRemovalPreview {
  readonly contextId: WorkingContextId;
  readonly contextName: string;
  readonly contextVersion: number;
  readonly dataRevision: number;
  readonly items: readonly {
    readonly itemId: InventoryItemId;
    readonly displayName: string;
  }[];
  readonly referenceCount: number;
  readonly losses: ContextWorkLosses;
  readonly retainedPlayout?: ContextPlayoutWork;
}

export interface DeleteWorkingContextRequest {
  readonly contextId: WorkingContextId;
  readonly expectedContextVersion: number;
  readonly expectedDataRevision: number;
}

export interface DeleteWorkingContextResult {
  readonly contextId: WorkingContextId;
  readonly dataRevision: number;
}

export interface ContextRemovalPreviewReader {
  previewContextItemRemoval(request: {
    readonly contextId: WorkingContextId;
    readonly itemId: InventoryItemId;
  }): Promise<ContextRemovalPreview>;
  previewWorkingContextDeletion(request: {
    readonly contextId: WorkingContextId;
  }): Promise<ContextRemovalPreview>;
}

export interface WorkingContextDeletionWriter {
  deleteWorkingContext(
    request: DeleteWorkingContextRequest,
    occurredAt: string,
  ): Promise<DeleteWorkingContextCommit>;
}

export interface DeleteWorkingContextCommit extends DeleteWorkingContextResult {
  readonly removedPlayoutDraftId: PlayoutDraftId | null;
}

export interface WorkingContextPlayoutCleanup {
  cancelAndWait(draftId: PlayoutDraftId): Promise<void>;
}

export class GetWorkScopeWorkspace {
  readonly #reader: WorkScopeWorkspaceReader;
  constructor(reader: WorkScopeWorkspaceReader) {
    this.#reader = reader;
  }
  async execute(request: {
    readonly scope: StartupResumeTarget['scope'];
  }): Promise<WorkScopeWorkspace> {
    const workspace = await this.#reader.readWorkScopeWorkspace(request.scope);
    if (workspace === undefined) throw workingContextNotFound();
    return workspace;
  }
}

export class GetStartupResume {
  readonly #reader: Pick<StartupResumePort, 'readStartupResume'>;
  constructor(reader: Pick<StartupResumePort, 'readStartupResume'>) {
    this.#reader = reader;
  }
  execute(): Promise<StartupResume> {
    return this.#reader.readStartupResume();
  }
}

export class SetStartupResume {
  readonly #dependencies: {
    readonly writer: Pick<StartupResumePort, 'setStartupResume'>;
    readonly clock: WorkspaceClock;
    readonly events: WorkspaceChangedPublisher;
  };
  constructor(dependencies: {
    readonly writer: Pick<StartupResumePort, 'setStartupResume'>;
    readonly clock: WorkspaceClock;
    readonly events: WorkspaceChangedPublisher;
  }) {
    this.#dependencies = dependencies;
  }
  async execute(request: SetStartupResumeRequest): Promise<StartupResume> {
    try {
      startupResumeTarget(request);
    } catch {
      throw invalidResume();
    }
    if (
      request.expectedStartupVersion !== null &&
      (!Number.isSafeInteger(request.expectedStartupVersion) ||
        request.expectedStartupVersion < 1)
    )
      throw invalidResume();
    const occurredAt = this.#dependencies.clock.now();
    const result = await this.#dependencies.writer.setStartupResume(
      request,
      occurredAt,
    );
    this.#dependencies.events.publish({
      kind: 'workspace.startup-updated',
      occurredAt,
      startupVersion: result.startupVersion!,
      dataRevision: result.dataRevision,
    });
    return result;
  }
}

export class PreviewContextItemRemoval {
  readonly #reader: ContextRemovalPreviewReader;
  constructor(reader: ContextRemovalPreviewReader) {
    this.#reader = reader;
  }
  execute(request: {
    readonly contextId: WorkingContextId;
    readonly itemId: InventoryItemId;
  }): Promise<ContextRemovalPreview> {
    return this.#reader.previewContextItemRemoval(request);
  }
}

export class PreviewWorkingContextDeletion {
  readonly #reader: ContextRemovalPreviewReader;
  constructor(reader: ContextRemovalPreviewReader) {
    this.#reader = reader;
  }
  execute(request: {
    readonly contextId: WorkingContextId;
  }): Promise<ContextRemovalPreview> {
    return this.#reader.previewWorkingContextDeletion(request);
  }
}

export class DeleteWorkingContext {
  readonly #dependencies: {
    readonly writer: WorkingContextDeletionWriter;
    readonly playout: WorkingContextPlayoutCleanup;
    readonly clock: WorkspaceClock;
    readonly events: WorkspaceChangedPublisher;
  };
  constructor(dependencies: {
    readonly writer: WorkingContextDeletionWriter;
    readonly playout: WorkingContextPlayoutCleanup;
    readonly clock: WorkspaceClock;
    readonly events: WorkspaceChangedPublisher;
  }) {
    this.#dependencies = dependencies;
  }
  async execute(
    request: DeleteWorkingContextRequest,
  ): Promise<DeleteWorkingContextResult> {
    validateRemovalConfirmation(request);
    const occurredAt = this.#dependencies.clock.now();
    const committed = await this.#dependencies.writer.deleteWorkingContext(
      request,
      occurredAt,
    );
    if (committed.removedPlayoutDraftId !== null) {
      await this.#dependencies.playout.cancelAndWait(
        committed.removedPlayoutDraftId,
      );
    }
    const result: DeleteWorkingContextResult = {
      contextId: committed.contextId,
      dataRevision: committed.dataRevision,
    };
    this.#dependencies.events.publish({
      kind: 'workspace.context-deleted',
      contextId: result.contextId,
      dataRevision: result.dataRevision,
      occurredAt,
    });
    return result;
  }
}

export function validateRemovalConfirmation(request: {
  readonly expectedDataRevision: number;
  readonly expectedContextVersion: number;
}): void {
  if (
    !Number.isSafeInteger(request.expectedDataRevision) ||
    request.expectedDataRevision < 0 ||
    !Number.isSafeInteger(request.expectedContextVersion) ||
    request.expectedContextVersion < 1
  )
    throw invalidRemovalConfirmation();
}
