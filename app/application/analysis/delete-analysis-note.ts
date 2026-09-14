import type {
  AnalysisNoteMutationResult,
  DeleteAnalysisNoteRequest,
} from './analysis-models.ts';
import type {
  AnalysisClock,
  AnalysisContributionChangedPublisher,
  AnalysisNoteWriter,
} from './analysis-ports.ts';
import { invalidAnalysisNote } from './analysis-problems.ts';

export interface DeleteAnalysisNoteUseCase {
  execute(
    request: DeleteAnalysisNoteRequest,
  ): Promise<AnalysisNoteMutationResult>;
}

export class DeleteAnalysisNote implements DeleteAnalysisNoteUseCase {
  readonly #writer: AnalysisNoteWriter;
  readonly #clock: AnalysisClock;
  readonly #events: AnalysisContributionChangedPublisher;

  constructor(dependencies: {
    readonly writer: AnalysisNoteWriter;
    readonly clock: AnalysisClock;
    readonly events: AnalysisContributionChangedPublisher;
  }) {
    this.#writer = dependencies.writer;
    this.#clock = dependencies.clock;
    this.#events = dependencies.events;
  }

  async execute(
    request: DeleteAnalysisNoteRequest,
  ): Promise<AnalysisNoteMutationResult> {
    if (
      !Number.isSafeInteger(request.expectedContributionVersion) ||
      request.expectedContributionVersion < 1
    ) {
      throw invalidAnalysisNote();
    }
    const occurredAt = this.#clock.now();
    const result = await this.#writer.deleteAnalysisNote({
      ...request,
      occurredAt,
    });
    this.#events.publish(
      Object.freeze({
        kind: 'analysis.contribution-changed',
        changeKind: 'deleted',
        occurredAt,
        dataRevision: result.dataRevision,
        itemId: result.itemId,
        contributionId: result.contributionId,
      }),
    );
    return result;
  }
}
