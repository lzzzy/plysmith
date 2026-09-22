import {
  LineProcessProblem,
  type LineProcessHandle,
  type LineProcessOptions,
  type LineProcessSession,
  type LineProcessSupervisor,
} from './line-process-supervisor.ts';

export type LineProcessReadiness = 'cold' | 'warming_up' | 'ready';

export interface LineProcessPoolOptions extends LineProcessOptions {
  readonly maxQueuedLeases: number;
}

export interface LineProcessLeaseOptions {
  readonly waitTimeoutMs: number;
  readonly signal?: AbortSignal;
}

interface PoolEntry<TPrepared> {
  readonly handle: LineProcessHandle;
  readonly prepared: TPrepared;
}

interface LeaseWaiter {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  readonly signal?: AbortSignal;
  readonly abort: () => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export class LineProcessPool<TPrepared> {
  readonly #supervisor: LineProcessSupervisor;
  readonly #options: LineProcessPoolOptions;
  readonly #prepare: (session: LineProcessSession) => Promise<TPrepared>;
  readonly #shutdown: (session: LineProcessSession) => void;
  readonly #waiters: LeaseWaiter[] = [];
  #entry: PoolEntry<TPrepared> | undefined;
  #starting: Promise<PoolEntry<TPrepared>> | undefined;
  #startingHandle: LineProcessHandle | undefined;
  #generation = 0;
  #leased = false;
  #closed = false;

  constructor(input: {
    readonly supervisor: LineProcessSupervisor;
    readonly options: LineProcessPoolOptions;
    readonly prepare: (session: LineProcessSession) => Promise<TPrepared>;
    readonly shutdown: (session: LineProcessSession) => void;
  }) {
    this.#supervisor = input.supervisor;
    this.#options = input.options;
    this.#prepare = input.prepare;
    this.#shutdown = input.shutdown;
  }

  get readiness(): LineProcessReadiness {
    if (this.#entry !== undefined) return 'ready';
    return this.#starting === undefined ? 'cold' : 'warming_up';
  }

  async use<T>(
    work: (session: LineProcessSession, prepared: TPrepared) => Promise<T>,
    options: LineProcessLeaseOptions,
  ): Promise<T> {
    await this.#acquire(options);
    let reusable = false;
    try {
      const entry = await abortable(() => this.#ensureEntry(), options.signal);
      entry.handle.session.resetOutputBudget();
      const result = await abortable(
        () => work(entry.handle.session, entry.prepared),
        options.signal,
      );
      reusable = true;
      return result;
    } finally {
      if (!reusable) await this.#discardEntry();
      this.#release();
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.signal?.removeEventListener('abort', waiter.abort);
      waiter.reject(new LineProcessProblem('process_interrupted'));
    }
    await this.#discardEntry();
  }

  async #acquire(options: LineProcessLeaseOptions): Promise<void> {
    if (this.#closed || options.signal?.aborted === true) {
      throw new LineProcessProblem('process_interrupted');
    }
    if (!this.#leased) {
      this.#leased = true;
      return;
    }
    if (this.#waiters.length >= this.#options.maxQueuedLeases) {
      throw new LineProcessProblem('process_busy');
    }
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        clearTimeout(waiter.timeout);
        reject(new LineProcessProblem('process_interrupted'));
      };
      const waiter: LeaseWaiter = {
        resolve,
        reject,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        abort,
        timeout: setTimeout(() => {
          const index = this.#waiters.indexOf(waiter);
          if (index >= 0) this.#waiters.splice(index, 1);
          options.signal?.removeEventListener('abort', abort);
          reject(new LineProcessProblem('process_busy'));
        }, options.waitTimeoutMs),
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      this.#waiters.push(waiter);
    });
  }

  #release(): void {
    const waiter = this.#waiters.shift();
    if (waiter === undefined) {
      this.#leased = false;
      return;
    }
    clearTimeout(waiter.timeout);
    waiter.signal?.removeEventListener('abort', waiter.abort);
    waiter.resolve();
  }

  async #ensureEntry(): Promise<PoolEntry<TPrepared>> {
    if (this.#entry !== undefined) return this.#entry;
    if (this.#closed) throw new LineProcessProblem('process_interrupted');
    const generation = this.#generation;
    this.#starting ??= this.#startEntry(generation);
    try {
      const entry = await this.#starting;
      if (this.#closed || generation !== this.#generation) {
        await entry.handle.terminate(this.#options.stopTimeoutMs);
        throw new LineProcessProblem('process_interrupted');
      }
      this.#entry = entry;
      return this.#entry;
    } finally {
      this.#starting = undefined;
    }
  }

  async #startEntry(generation: number): Promise<PoolEntry<TPrepared>> {
    const handle = await this.#supervisor.open(this.#options);
    if (this.#closed || generation !== this.#generation) {
      await handle.terminate(this.#options.stopTimeoutMs);
      throw new LineProcessProblem('process_interrupted');
    }
    this.#startingHandle = handle;
    try {
      const prepared = await this.#prepare(handle.session);
      if (this.#closed) throw new LineProcessProblem('process_interrupted');
      return { handle, prepared };
    } catch (error) {
      await handle.terminate(this.#options.stopTimeoutMs);
      throw error;
    } finally {
      if (this.#startingHandle === handle) this.#startingHandle = undefined;
    }
  }

  async #discardEntry(): Promise<void> {
    this.#generation += 1;
    const entry = this.#entry;
    this.#entry = undefined;
    if (entry === undefined) {
      if (this.#starting !== undefined) {
        const startingHandle = this.#startingHandle;
        if (startingHandle !== undefined) {
          await startingHandle.terminate(this.#options.stopTimeoutMs);
        }
        try {
          const starting = await this.#starting;
          if (startingHandle === undefined) {
            this.#shutdown(starting.handle.session);
          }
          await starting.handle.terminate(this.#options.stopTimeoutMs);
        } catch {
          // The original startup failure remains authoritative.
        }
      }
      return;
    }
    try {
      this.#shutdown(entry.handle.session);
      if (await entry.handle.waitForExit(this.#options.stopTimeoutMs)) return;
    } catch {
      // Forced termination remains authoritative.
    }
    await entry.handle.terminate(this.#options.stopTimeoutMs);
  }
}

async function abortable<T>(
  work: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return work();
  if (signal.aborted) throw new LineProcessProblem('process_interrupted');
  let abort: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new LineProcessProblem('process_interrupted'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    if (signal.aborted) throw new LineProcessProblem('process_interrupted');
    const operation = work();
    return await Promise.race([operation, interrupted]);
  } finally {
    if (abort !== undefined) signal.removeEventListener('abort', abort);
  }
}
