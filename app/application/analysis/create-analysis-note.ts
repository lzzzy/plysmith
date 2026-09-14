import {
  currentAnalysisMoves,
  type AnalysisScratch,
} from '../../domain/analysis/index.ts';
import type { WorkScope } from '../../domain/workspace/index.ts';
import type {
  WorkspaceChanged,
  WorkspaceChangedPublisher,
} from '../workspace/index.ts';
import type {
  CreateAnalysisNoteRequest,
  CreateAnalysisNoteResult,
} from './analysis-models.ts';
import type {
  AnalysisClock,
  AnalysisContributionCreatedPublisher,
  AnalysisNoteWriter,
  ContextAnalysisReader,
} from './analysis-ports.ts';
import {
  analysisScratchNotFound,
  analysisScratchRevisionConflict,
  invalidAnalysisNote,
} from './analysis-problems.ts';
import type { FreeAnalysisSession } from './free-analysis-session.ts';

export interface CreateAnalysisNoteUseCase {
  execute(
    request: CreateAnalysisNoteRequest,
  ): Promise<CreateAnalysisNoteResult>;
}

export class CreateAnalysisNote implements CreateAnalysisNoteUseCase {
  readonly #reader: ContextAnalysisReader;
  readonly #writer: AnalysisNoteWriter;
  readonly #freeSession: FreeAnalysisSession;
  readonly #clock: AnalysisClock;
  readonly #analysisEvents: AnalysisContributionCreatedPublisher;
  readonly #workspaceEvents: WorkspaceChangedPublisher;

  constructor(dependencies: {
    readonly reader: ContextAnalysisReader;
    readonly writer: AnalysisNoteWriter;
    readonly freeSession: FreeAnalysisSession;
    readonly clock: AnalysisClock;
    readonly analysisEvents: AnalysisContributionCreatedPublisher;
    readonly workspaceEvents: WorkspaceChangedPublisher;
  }) {
    this.#reader = dependencies.reader;
    this.#writer = dependencies.writer;
    this.#freeSession = dependencies.freeSession;
    this.#clock = dependencies.clock;
    this.#analysisEvents = dependencies.analysisEvents;
    this.#workspaceEvents = dependencies.workspaceEvents;
  }

  execute(
    request: CreateAnalysisNoteRequest,
  ): Promise<CreateAnalysisNoteResult> {
    validateRequest(request);
    return request.scope.kind === 'free'
      ? this.#createFromFreeScratch(request)
      : this.#createFromContextScratch(request, request.scope);
  }

  #createFromFreeScratch(
    request: CreateAnalysisNoteRequest,
  ): Promise<CreateAnalysisNoteResult> {
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
    request: CreateAnalysisNoteRequest,
    scope: Extract<WorkScope, { readonly kind: 'context' }>,
  ): Promise<CreateAnalysisNoteResult> {
    const workspace = await this.#reader.readContextAnalysisWorkspace(
      scope.contextId,
    );
    const scratch = workspace?.scratch;
    assertExpectedScratch(
      scratch,
      request.expectedScratchId,
      request.expectedScratchRevision,
    );
    return this.#persist(request, scratch, scope.contextId);
  }

  async #persist(
    request: CreateAnalysisNoteRequest,
    scratch: AnalysisScratch,
    sourceContextId?: Extract<
      WorkScope,
      { readonly kind: 'context' }
    >['contextId'],
  ): Promise<CreateAnalysisNoteResult> {
    const origin = scratch.origin;
    const note = scratch.noteDraft;
    if (
      origin.kind !== 'inventory_anchor' ||
      note === undefined ||
      !sameMoves(currentAnalysisMoves(scratch), note.moves)
    ) {
      throw invalidAnalysisNote();
    }
    if (
      request.noteScope.kind === 'context' &&
      (sourceContextId === undefined ||
        request.noteScope.contextId.value !== sourceContextId.value)
    ) {
      throw invalidAnalysisNote();
    }

    const occurredAt = this.#clock.now();
    const result = await this.#writer.createAnalysisNote({
      ...(sourceContextId === undefined
        ? {}
        : {
            sourceContextId,
            expectedScratchId: request.expectedScratchId,
            expectedScratchRevision: request.expectedScratchRevision,
          }),
      origin,
      note,
      noteScope: request.noteScope,
      languageTag: request.languageTag,
      occurredAt,
    });
    this.#analysisEvents.publish(
      Object.freeze({
        kind: 'analysis.contribution-created',
        occurredAt,
        dataRevision: result.dataRevision,
        itemId: result.itemId,
        contributionId: result.contributionId,
      }),
    );
    if (result.resumeUpdate !== undefined) {
      const event: WorkspaceChanged = Object.freeze({
        kind: 'workspace.resume-updated',
        occurredAt,
        dataRevision: result.dataRevision,
        contextId: result.resumeUpdate.contextId,
        area: 'analyze',
        resumeVersion: result.resumeUpdate.resumeVersion,
      });
      this.#workspaceEvents.publish(event);
    }
    return result;
  }
}

function validateRequest(request: CreateAnalysisNoteRequest): void {
  if (
    request.expectedScratchId.trim().length === 0 ||
    !Number.isSafeInteger(request.expectedScratchRevision) ||
    request.expectedScratchRevision < 1 ||
    !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(request.languageTag) ||
    (request.scope.kind === 'free' && request.noteScope.kind !== 'global')
  ) {
    throw invalidAnalysisNote();
  }
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

function sameMoves(
  left: ReturnType<typeof currentAnalysisMoves>,
  right: ReturnType<typeof currentAnalysisMoves>,
): boolean {
  return (
    left.length === right.length &&
    left.every((move, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        move.from === other.from &&
        move.to === other.to &&
        move.promotion === other.promotion &&
        move.san === other.san
      );
    })
  );
}
