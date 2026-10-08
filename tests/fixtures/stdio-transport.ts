import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export class TestStdioTransport extends StdioClientTransport {
  readonly #exited = Promise.withResolvers<void>();
  #spawned = false;
  #closePromise: Promise<void> | undefined;

  override async start(): Promise<void> {
    if (this.#closePromise !== undefined) {
      throw new Error('Cannot start a closed test transport.');
    }
    const onclose = this.onclose;
    this.onclose = () => {
      this.#exited.resolve();
      onclose?.();
    };
    await super.start();
    this.#spawned = true;
  }

  override close(): Promise<void> {
    this.#closePromise ??= this.#closeAndWait();
    return this.#closePromise;
  }

  async #closeAndWait(): Promise<void> {
    // SDK 1.31 may return immediately after its final kill, before child close.
    await super.close();
    if (!this.#spawned) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#exited.promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  'MCP child exit was not observed after transport cleanup.',
                ),
              ),
            5_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
