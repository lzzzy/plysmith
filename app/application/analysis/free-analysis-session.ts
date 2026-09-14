import type { AnalysisScratch } from '../../domain/analysis/index.ts';

export class FreeAnalysisSession {
  #scratch: AnalysisScratch | undefined;
  #tail: Promise<void> = Promise.resolve();

  read(): AnalysisScratch | undefined {
    return this.#scratch;
  }

  run<T>(
    work: (scratch: AnalysisScratch | undefined) =>
      | Promise<{ readonly scratch?: AnalysisScratch; readonly result: T }>
      | {
          readonly scratch?: AnalysisScratch;
          readonly result: T;
        },
  ): Promise<T> {
    const operation = this.#tail.then(async () => {
      const outcome = await work(this.#scratch);
      this.#scratch = outcome.scratch;
      return outcome.result;
    });
    this.#tail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}
