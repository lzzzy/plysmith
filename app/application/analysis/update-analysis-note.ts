import type {
  AnalysisNoteMutationResult,
  UpdateAnalysisNoteRequest,
} from './analysis-models.ts';
import type {
  AnalysisClock,
  AnalysisContributionChangedPublisher,
  AnalysisNoteWriter,
} from './analysis-ports.ts';
import { invalidAnalysisNote } from './analysis-problems.ts';

export interface UpdateAnalysisNoteUseCase {
  execute(
    request: UpdateAnalysisNoteRequest,
  ): Promise<AnalysisNoteMutationResult>;
}

export class UpdateAnalysisNote implements UpdateAnalysisNoteUseCase {
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
    request: UpdateAnalysisNoteRequest,
  ): Promise<AnalysisNoteMutationResult> {
    validateRequest(request);
    const occurredAt = this.#clock.now();
    const result = await this.#writer.updateAnalysisNote({
      ...request,
      body: request.body.trim(),
      occurredAt,
    });
    this.#events.publish(
      Object.freeze({
        kind: 'analysis.contribution-changed',
        changeKind: 'updated',
        occurredAt,
        dataRevision: result.dataRevision,
        itemId: result.itemId,
        contributionId: result.contributionId,
      }),
    );
    return result;
  }
}

function validateRequest(request: UpdateAnalysisNoteRequest): void {
  if (
    !Number.isSafeInteger(request.expectedContributionVersion) ||
    request.expectedContributionVersion < 1 ||
    request.body.trim().length === 0 ||
    request.body.trim().length > 8_000
  ) {
    throw invalidAnalysisNote();
  }
}
