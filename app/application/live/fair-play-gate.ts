import { ApplicationProblem } from '../problems/application-problem.ts';

/** The account monitor owns this gate; disconnecting a view cannot release it. */
export class FairPlayGate {
  #blocked = false;
  #generation = 0;
  readonly #active = new Set<AbortController>();

  get blocked(): boolean {
    return this.#blocked;
  }

  setBlocked(blocked: boolean): void {
    if (this.#blocked === blocked) return;
    this.#blocked = blocked;
    this.#generation++;
    if (blocked) for (const controller of this.#active) controller.abort();
  }

  assertAllowed(): void {
    if (this.#blocked) throw fairPlayProblem();
  }

  async run<T>(
    work: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    this.assertAllowed();
    const generation = this.#generation;
    const controller = new AbortController();
    this.#active.add(controller);
    const combined =
      signal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, signal]);
    try {
      const result = await work(combined);
      if (generation !== this.#generation) throw fairPlayProblem();
      this.assertAllowed();
      return result;
    } catch (error) {
      if (generation !== this.#generation || this.#blocked)
        throw fairPlayProblem();
      throw error;
    } finally {
      this.#active.delete(controller);
    }
  }
}

function fairPlayProblem(): ApplicationProblem {
  return new ApplicationProblem(
    'live.fair_play_blocked',
    'Engine assistance is unavailable during an ongoing human game.',
  );
}

export function fairPlayUseCase<Args extends readonly unknown[], Result>(
  useCase: { execute(...args: Args): Promise<Result> },
  gate: FairPlayGate,
): { execute(...args: Args): Promise<Result> } {
  return { execute: (...args) => gate.run(() => useCase.execute(...args)) };
}
