import type { AnalysisScratch } from '../../domain/analysis/index.ts';
import type { StoredFreeAnalysisWorkspace } from './analysis-models.ts';
import type { AnalysisClock, ContextAnalysisWriter } from './analysis-ports.ts';

export interface FreeAnalysisPersistence {
  readFreeAnalysisWorkspace(): Promise<StoredFreeAnalysisWorkspace>;
  replaceFreeAnalysisScratch(
    request: Omit<
      Parameters<ContextAnalysisWriter['replaceContextAnalysisScratch']>[0],
      'contextId'
    >,
  ): ReturnType<ContextAnalysisWriter['replaceContextAnalysisScratch']>;
  discardFreeAnalysisScratch(
    request: Omit<
      Parameters<ContextAnalysisWriter['discardContextAnalysisScratch']>[0],
      'contextId'
    >,
  ): ReturnType<ContextAnalysisWriter['discardContextAnalysisScratch']>;
}

export class FreeAnalysisSession {
  readonly #persistence: FreeAnalysisPersistence;
  readonly #clock: AnalysisClock;
  #tail: Promise<void> = Promise.resolve();

  constructor(dependencies: {
    readonly persistence: FreeAnalysisPersistence;
    readonly clock: AnalysisClock;
  }) {
    this.#persistence = dependencies.persistence;
    this.#clock = dependencies.clock;
  }

  readWorkspace(): Promise<StoredFreeAnalysisWorkspace> {
    return this.#persistence.readFreeAnalysisWorkspace();
  }

  async read(): Promise<AnalysisScratch | undefined> {
    return (await this.readWorkspace()).scratch;
  }

  run<T>(
    work: (scratch: AnalysisScratch | undefined) =>
      | Promise<{
          readonly scratch?: AnalysisScratch;
          readonly result: T;
          readonly persisted?: true;
        }>
      | {
          readonly scratch?: AnalysisScratch;
          readonly result: T;
          readonly persisted?: true;
        },
  ): Promise<T> {
    const operation = this.#tail.then(async () => {
      const scratch = await this.read();
      const outcome = await work(scratch);
      if (outcome.persisted || outcome.scratch === scratch)
        return outcome.result;
      const occurredAt = this.#clock.now();
      if (outcome.scratch !== undefined) {
        await this.#persistence.replaceFreeAnalysisScratch({
          expectedScratchId: scratch?.scratchId ?? null,
          expectedScratchRevision: scratch?.scratchRevision ?? null,
          scratch: outcome.scratch,
          occurredAt,
        });
      } else if (scratch !== undefined) {
        await this.#persistence.discardFreeAnalysisScratch({
          expectedScratchId: scratch.scratchId,
          expectedScratchRevision: scratch.scratchRevision,
          occurredAt,
        });
      }
      return outcome.result;
    });
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}
