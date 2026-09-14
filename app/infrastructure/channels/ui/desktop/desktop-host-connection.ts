import { connectHost, type HostConnection } from '../../host_client/index.ts';
import type { DiagnosticSink } from '../../../../../contracts/diagnostics/index.ts';
import type { DesktopBootstrap } from './contract.ts';

export type DiscoverDesktopHost = () => Promise<HostConnection>;
export type ValidateDesktopHost = (
  connection: HostConnection,
  signal: AbortSignal,
) => Promise<void>;

export interface DesktopHostConnectionMonitorOptions {
  readonly discover: DiscoverDesktopHost;
  readonly validate?: ValidateDesktopHost;
  readonly pollIntervalMilliseconds?: number;
  readonly validationTimeoutMilliseconds?: number;
  readonly unavailableAfterConsecutiveFailures?: number;
  readonly diagnostics?: DiagnosticSink;
}

export class DesktopHostConnectionMonitor {
  readonly #discover: DiscoverDesktopHost;
  readonly #validate: ValidateDesktopHost;
  readonly #pollIntervalMilliseconds: number;
  readonly #validationTimeoutMilliseconds: number;
  readonly #unavailableAfterConsecutiveFailures: number;
  readonly #diagnostics: DiagnosticSink | undefined;
  readonly #listeners = new Set<(snapshot: DesktopBootstrap) => void>();
  #snapshot: DesktopBootstrap = Object.freeze({
    kind: 'unavailable',
    generation: 0,
  });
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #refresh: Promise<void> | undefined;
  #validationAbortController: AbortController | undefined;
  #closed = false;
  #consecutiveFailures = 0;
  #reportedAvailability: boolean | undefined;

  constructor(options: DesktopHostConnectionMonitorOptions) {
    this.#discover = options.discover;
    this.#validate =
      options.validate ??
      (async (connection, signal) => {
        const abortableFetch: typeof fetch = (input, init) =>
          fetch(input, { ...init, signal });
        await connectHost(connection, {
          origin: 'app://plysmith',
          fetch: abortableFetch,
        });
      });
    this.#pollIntervalMilliseconds = options.pollIntervalMilliseconds ?? 1_000;
    this.#validationTimeoutMilliseconds =
      options.validationTimeoutMilliseconds ?? 5_000;
    this.#unavailableAfterConsecutiveFailures =
      options.unavailableAfterConsecutiveFailures ?? 2;
    this.#diagnostics = options.diagnostics;
    if (
      !Number.isSafeInteger(this.#unavailableAfterConsecutiveFailures) ||
      this.#unavailableAfterConsecutiveFailures < 1
    ) {
      throw new TypeError(
        'unavailableAfterConsecutiveFailures must be a positive integer.',
      );
    }
    if (
      !Number.isSafeInteger(this.#validationTimeoutMilliseconds) ||
      this.#validationTimeoutMilliseconds < 1
    ) {
      throw new TypeError(
        'validationTimeoutMilliseconds must be a positive integer.',
      );
    }
  }

  async start(): Promise<void> {
    await this.refresh();
    if (this.#closed || this.#pollTimer !== undefined) {
      return;
    }
    this.#pollTimer = setInterval(() => {
      void this.refresh();
    }, this.#pollIntervalMilliseconds);
    this.#pollTimer.unref?.();
  }

  getSnapshot(): DesktopBootstrap {
    return this.#snapshot;
  }

  subscribe(listener: (snapshot: DesktopBootstrap) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async refresh(): Promise<void> {
    if (this.#closed) {
      return;
    }
    if (this.#refresh !== undefined) {
      return this.#refresh;
    }
    this.#refresh = this.#refreshConnection().finally(() => {
      this.#refresh = undefined;
    });
    return this.#refresh;
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#validationAbortController?.abort();
    if (this.#pollTimer !== undefined) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = undefined;
    }
    this.#listeners.clear();
  }

  async #refreshConnection(): Promise<void> {
    let connection: HostConnection;
    try {
      connection = await this.#discover();
    } catch {
      this.#recordFailure();
      return;
    }

    try {
      await this.#validateWithinTimeout(connection);
    } catch {
      this.#recordFailure();
      return;
    }

    if (this.#closed) {
      return;
    }
    this.#consecutiveFailures = 0;
    this.#reportAvailability(true);
    if (
      this.#snapshot.kind === 'ready' &&
      sameConnection(this.#snapshot.connection, connection)
    ) {
      return;
    }

    const snapshot: DesktopBootstrap = Object.freeze({
      kind: 'ready',
      generation: this.#snapshot.generation + 1,
      connection: Object.freeze({ ...connection }),
    });
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) {
      listener(snapshot);
    }
  }

  #recordFailure(): void {
    if (this.#closed) {
      return;
    }
    this.#consecutiveFailures += 1;
    this.#reportAvailability(false);
    if (
      this.#snapshot.kind !== 'ready' ||
      this.#consecutiveFailures < this.#unavailableAfterConsecutiveFailures
    ) {
      return;
    }

    const snapshot: DesktopBootstrap = Object.freeze({
      kind: 'unavailable',
      generation: this.#snapshot.generation + 1,
    });
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) {
      listener(snapshot);
    }
  }

  #reportAvailability(available: boolean): void {
    if (this.#reportedAvailability === available) return;
    this.#reportedAvailability = available;
    this.#diagnostics?.write({
      level: available ? 'info' : 'error',
      eventCode: available
        ? 'desktop.host_connection.available'
        : 'desktop.host_connection.unavailable',
      status: available ? 'available' : 'unavailable',
      generation: this.#snapshot.generation,
    });
  }

  async #validateWithinTimeout(connection: HostConnection): Promise<void> {
    const controller = new AbortController();
    this.#validationAbortController = controller;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('Host validation was aborted.'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(
        () => controller.abort(),
        this.#validationTimeoutMilliseconds,
      );
      timeout.unref?.();
    });

    try {
      await Promise.race([
        this.#validate(connection, controller.signal),
        aborted,
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (onAbort !== undefined) {
        controller.signal.removeEventListener('abort', onAbort);
      }
      if (this.#validationAbortController === controller) {
        this.#validationAbortController = undefined;
      }
    }
  }
}

function sameConnection(left: HostConnection, right: HostConnection): boolean {
  return (
    left.endpoint === right.endpoint &&
    left.productRelease === right.productRelease &&
    left.contractFingerprint === right.contractFingerprint &&
    left.token === right.token
  );
}
