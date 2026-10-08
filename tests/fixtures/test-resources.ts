import type { TestContext } from 'node:test';

type Cleanup = () => void | Promise<void>;

const scopes = new WeakMap<TestContext, TestResources>();

export function testResources(t: TestContext): TestResources {
  let resources = scopes.get(t);
  if (resources === undefined) {
    const created = new TestResources(t.signal);
    resources = created;
    scopes.set(t, created);
    t.after(() => created.close());
  }
  return resources;
}

export class TestResources {
  readonly #signal: AbortSignal;
  readonly #pending = new Set<Promise<unknown>>();
  readonly #cleanup: Cleanup[] = [];
  #closing = false;
  #closePromise: Promise<void> | undefined;
  readonly #abort = () => {
    // The after hook observes the same promise, including cleanup failures.
    void this.close().catch(() => undefined);
  };

  constructor(signal: AbortSignal) {
    this.#signal = signal;
    signal.addEventListener('abort', this.#abort, { once: true });
  }

  defer(cleanup: Cleanup): void {
    this.#assertOpen();
    this.#cleanup.push(cleanup);
  }

  acquire<T>(
    create: () => T | Promise<T>,
    dispose: (resource: T) => void | Promise<void>,
  ): Promise<T> {
    return this.run(async () => {
      const resource = await create();
      // Register even when acquisition finishes after cancellation.
      this.#cleanup.push(() => dispose(resource));
      return resource;
    });
  }

  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    this.#assertOpen();
    const pending = Promise.resolve().then(() => {
      this.#assertOpen();
      return operation();
    });
    this.#pending.add(pending);
    try {
      const result = await pending;
      this.#assertOpen();
      return result;
    } finally {
      this.#pending.delete(pending);
    }
  }

  close(): Promise<void> {
    this.#closing = true;
    this.#signal.removeEventListener('abort', this.#abort);
    this.#closePromise ??= this.#close();
    return this.#closePromise;
  }

  async #close(): Promise<void> {
    await Promise.allSettled([...this.#pending]);
    const failures: unknown[] = [];
    for (const cleanup of this.#cleanup.reverse()) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Test resource cleanup failed.');
    }
  }

  #assertOpen(): void {
    this.#signal.throwIfAborted();
    if (this.#closing) throw new Error('Test resources are already closing.');
  }
}
