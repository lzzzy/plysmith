import { createAnalysisRecordDraft } from '../../domain/inventory/index.ts';
import type { AnalysisScratch } from '../../domain/analysis/index.ts';
import type { WorkScope } from '../../domain/workspace/index.ts';
import type {
  AnalysisRecordCreated,
  InventoryChangedPublisher,
} from '../inventory/index.ts';
import type {
  WorkspaceChanged,
  WorkspaceChangedPublisher,
} from '../workspace/index.ts';
import type {
  CreateAnalysisRecordRequest,
  CreateAnalysisRecordResult,
} from './analysis-models.ts';
import type {
  AnalysisClock,
  AnalysisRecordWriter,
  ContextAnalysisReader,
} from './analysis-ports.ts';
import {
  analysisScratchNotFound,
  analysisScratchRevisionConflict,
  invalidAnalysisRecord,
} from './analysis-problems.ts';
import type { FreeAnalysisSession } from './free-analysis-session.ts';

export interface CreateAnalysisRecordUseCase {
  execute(
    request: CreateAnalysisRecordRequest,
  ): Promise<CreateAnalysisRecordResult>;
}

export class CreateAnalysisRecord implements CreateAnalysisRecordUseCase {
  readonly #reader: ContextAnalysisReader;
  readonly #writer: AnalysisRecordWriter;
  readonly #freeSession: FreeAnalysisSession;
  readonly #clock: AnalysisClock;
  readonly #inventoryEvents: InventoryChangedPublisher;
  readonly #workspaceEvents: WorkspaceChangedPublisher;

  constructor(dependencies: {
    readonly reader: ContextAnalysisReader;
    readonly writer: AnalysisRecordWriter;
    readonly freeSession: FreeAnalysisSession;
    readonly clock: AnalysisClock;
    readonly inventoryEvents: InventoryChangedPublisher;
    readonly workspaceEvents: WorkspaceChangedPublisher;
  }) {
    this.#reader = dependencies.reader;
    this.#writer = dependencies.writer;
    this.#freeSession = dependencies.freeSession;
    this.#clock = dependencies.clock;
    this.#inventoryEvents = dependencies.inventoryEvents;
    this.#workspaceEvents = dependencies.workspaceEvents;
  }

  execute(
    request: CreateAnalysisRecordRequest,
  ): Promise<CreateAnalysisRecordResult> {
    if (
      request.expectedScratchId.trim().length === 0 ||
      !Number.isSafeInteger(request.expectedScratchRevision) ||
      request.expectedScratchRevision < 1
    ) {
      return Promise.reject(invalidAnalysisRecord());
    }
    return request.scope.kind === 'free'
      ? this.#createFromFreeScratch(request)
      : this.#createFromContextScratch(request, request.scope);
  }

  #createFromFreeScratch(
    request: CreateAnalysisRecordRequest,
  ): Promise<CreateAnalysisRecordResult> {
    return this.#freeSession.run(async (scratch) => {
      assertExpectedScratch(
        scratch,
        request.expectedScratchId,
        request.expectedScratchRevision,
      );
      const result = await this.#persist(request, scratch);
      return { result };
    });
  }

  async #createFromContextScratch(
    request: CreateAnalysisRecordRequest,
    scope: Extract<WorkScope, { readonly kind: 'context' }>,
  ): Promise<CreateAnalysisRecordResult> {
    const workspace = await this.#reader.readContextAnalysisWorkspace(
      scope.contextId,
    );
    if (workspace === undefined || workspace.scratch === undefined) {
      throw analysisScratchNotFound();
    }
    assertExpectedScratch(
      workspace.scratch,
      request.expectedScratchId,
      request.expectedScratchRevision,
    );
    return this.#persist(request, workspace.scratch, scope.contextId);
  }

  async #persist(
    request: CreateAnalysisRecordRequest,
    scratch: NonNullable<Parameters<typeof assertExpectedScratch>[0]>,
    sourceContextId?: Extract<
      WorkScope,
      { readonly kind: 'context' }
    >['contextId'],
  ): Promise<CreateAnalysisRecordResult> {
    let draft;
    try {
      draft = createAnalysisRecordDraft({
        displayName: request.displayName,
        languageTag: request.languageTag,
        scratch,
      });
    } catch {
      throw invalidAnalysisRecord();
    }
    const noteScope = resolveNoteScope(
      request,
      draft.note !== undefined,
      sourceContextId,
    );
    const occurredAt = this.#clock.now();
    const result = await this.#writer.createAnalysisRecord({
      ...(sourceContextId === undefined
        ? {}
        : {
            sourceContextId,
            expectedScratchId: request.expectedScratchId,
            expectedScratchRevision: request.expectedScratchRevision,
          }),
      ...(request.targetContextId === undefined
        ? {}
        : { targetContextId: request.targetContextId }),
      displayName: draft.displayName,
      languageTag: draft.languageTag,
      origin: scratch.origin,
      root: draft.root,
      steps: draft.steps,
      ...(draft.note === undefined
        ? {}
        : { note: draft.note, noteScope: noteScope! }),
      occurredAt,
    });
    this.#publish(result, occurredAt, sourceContextId, request.targetContextId);
    return result;
  }

  #publish(
    result: CreateAnalysisRecordResult,
    occurredAt: string,
    sourceContextId:
      Extract<WorkScope, { readonly kind: 'context' }>['contextId'] | undefined,
    targetContextId:
      Extract<WorkScope, { readonly kind: 'context' }>['contextId'] | undefined,
  ): void {
    const inventoryEvent: AnalysisRecordCreated = Object.freeze({
      kind: 'inventory.item-created',
      occurredAt,
      dataRevision: result.dataRevision,
      itemId: result.itemId,
      revisionId: result.revisionId,
    });
    this.#inventoryEvents.publish(inventoryEvent);
    if (
      targetContextId !== undefined &&
      result.contextReferenceId !== undefined
    ) {
      const referenceEvent: WorkspaceChanged = Object.freeze({
        kind: 'workspace.reference-added',
        occurredAt,
        dataRevision: result.dataRevision,
        contextId: targetContextId,
        referenceId: result.contextReferenceId,
      });
      this.#workspaceEvents.publish(referenceEvent);
    }
    for (const resume of result.resumeUpdates) {
      const resumeEvent: WorkspaceChanged = Object.freeze({
        kind: 'workspace.resume-updated',
        occurredAt,
        dataRevision: result.dataRevision,
        contextId: resume.contextId,
        area: 'analyze',
        resumeVersion: resume.resumeVersion,
      });
      this.#workspaceEvents.publish(resumeEvent);
    }
  }
}

function resolveNoteScope(
  request: CreateAnalysisRecordRequest,
  hasNote: boolean,
  sourceContextId:
    Extract<WorkScope, { readonly kind: 'context' }>['contextId'] | undefined,
) {
  if (!hasNote) {
    if (request.noteScope !== undefined) throw invalidAnalysisRecord();
    return undefined;
  }
  const scope =
    request.noteScope ??
    (sourceContextId !== undefined &&
    request.targetContextId?.value === sourceContextId.value
      ? { kind: 'context' as const, contextId: sourceContextId }
      : { kind: 'global' as const });
  if (
    scope.kind === 'context' &&
    (sourceContextId === undefined ||
      scope.contextId.value !== sourceContextId.value ||
      request.targetContextId?.value !== sourceContextId.value)
  ) {
    throw invalidAnalysisRecord();
  }
  return scope;
}

function assertExpectedScratch(
  scratch: AnalysisScratch | undefined,
  expectedScratchId: string,
  expectedRevision: number,
): asserts scratch is AnalysisScratch {
  if (scratch === undefined) throw analysisScratchNotFound();
  if (
    scratch.scratchId !== expectedScratchId ||
    scratch.scratchRevision !== expectedRevision
  ) {
    throw analysisScratchRevisionConflict(
      expectedRevision,
      scratch.scratchRevision,
    );
  }
}
