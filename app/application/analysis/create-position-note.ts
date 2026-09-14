import type {
  AnalysisNoteMutationResult,
  CreatePositionNoteRequest,
} from './analysis-models.ts';
import type {
  AnalysisClock,
  AnalysisContributionCreatedPublisher,
  AnalysisNoteWriter,
} from './analysis-ports.ts';
import { invalidAnalysisNote } from './analysis-problems.ts';

export interface CreatePositionNoteUseCase {
  execute(
    request: CreatePositionNoteRequest,
  ): Promise<AnalysisNoteMutationResult>;
}

export class CreatePositionNote implements CreatePositionNoteUseCase {
  readonly #writer: AnalysisNoteWriter;
  readonly #clock: AnalysisClock;
  readonly #events: AnalysisContributionCreatedPublisher;

  constructor(dependencies: {
    readonly writer: AnalysisNoteWriter;
    readonly clock: AnalysisClock;
    readonly events: AnalysisContributionCreatedPublisher;
  }) {
    this.#writer = dependencies.writer;
    this.#clock = dependencies.clock;
    this.#events = dependencies.events;
  }

  async execute(
    request: CreatePositionNoteRequest,
  ): Promise<AnalysisNoteMutationResult> {
    validateRequest(request);
    const occurredAt = this.#clock.now();
    const result = await this.#writer.createPositionNote({
      scope: request.scope,
      itemId: request.itemId,
      revisionId: request.revisionId,
      anchorId: request.anchorId,
      note: Object.freeze({
        body: request.body.trim(),
        moves: Object.freeze([]),
      }),
      noteScope: request.noteScope,
      languageTag: request.languageTag,
      occurredAt,
    });
    this.#events.publish(
      Object.freeze({
        kind: 'analysis.contribution-created',
        occurredAt,
        dataRevision: result.dataRevision,
        itemId: result.itemId,
        contributionId: result.contributionId,
      }),
    );
    return result;
  }
}

function validateRequest(request: CreatePositionNoteRequest): void {
  if (
    request.body.trim().length === 0 ||
    request.body.trim().length > 8_000 ||
    !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(request.languageTag) ||
    (request.scope.kind === 'free' && request.noteScope.kind !== 'global') ||
    (request.noteScope.kind === 'context' &&
      (request.scope.kind !== 'context' ||
        request.noteScope.contextId.value !== request.scope.contextId.value))
  ) {
    throw invalidAnalysisNote();
  }
}
