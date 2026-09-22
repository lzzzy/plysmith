import type { PlayoutDraft } from '../../domain/playout/index.ts';
import { MovePolicyProviderError } from './playout-ports.ts';

interface ActiveDecision {
  readonly decisionId: number;
  readonly controller: AbortController;
  readonly finished: Promise<void>;
  readonly finish: () => void;
}

export class ActiveMovePolicyDecisions {
  readonly #active = new Map<number, ActiveDecision>();

  async run<T>(
    draftId: PlayoutDraft['draftId'],
    decisionId: number,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const key = draftId.value;
    if (this.#active.has(key)) {
      throw new MovePolicyProviderError('provider_resource_exhausted');
    }
    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const active = {
      decisionId,
      controller: new AbortController(),
      finished,
      finish,
    };
    this.#active.set(key, active);
    try {
      return await work(active.controller.signal);
    } finally {
      if (this.#active.get(key) === active) this.#active.delete(key);
      active.finish();
    }
  }

  cancel(draftId: PlayoutDraft['draftId'], decisionId?: number): void {
    const active = this.#active.get(draftId.value);
    if (active === undefined) return;
    if (decisionId !== undefined && active.decisionId !== decisionId) return;
    active.controller.abort();
  }

  async cancelAndWait(
    draftId: PlayoutDraft['draftId'],
    decisionId?: number,
  ): Promise<void> {
    const active = this.#active.get(draftId.value);
    if (active === undefined) return;
    if (decisionId !== undefined && active.decisionId !== decisionId) return;
    active.controller.abort();
    await active.finished;
  }
}
