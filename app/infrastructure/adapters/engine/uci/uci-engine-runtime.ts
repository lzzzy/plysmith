import {
  LineProcessPool,
  type LineProcessLeaseOptions,
  type LineProcessOptions,
  type LineProcessReadiness,
  type LineProcessSession,
  type LineProcessSupervisor,
} from '../../process/index.ts';
import type { UciHandshake } from './uci-session.ts';

export interface UciEngineRuntime {
  readonly readiness: LineProcessReadiness;
  use<T>(
    work: (session: LineProcessSession, handshake: UciHandshake) => Promise<T>,
    options: LineProcessLeaseOptions,
  ): Promise<T>;
  close(): Promise<void>;
}

export class PooledUciEngineRuntime implements UciEngineRuntime {
  readonly #pool: LineProcessPool<UciHandshake>;

  constructor(input: {
    readonly supervisor: LineProcessSupervisor;
    readonly process: LineProcessOptions;
    readonly prepare: (session: LineProcessSession) => Promise<UciHandshake>;
    readonly maxQueuedLeases?: number;
  }) {
    this.#pool = new LineProcessPool({
      supervisor: input.supervisor,
      options: {
        ...input.process,
        maxQueuedLeases: input.maxQueuedLeases ?? 1,
      },
      prepare: input.prepare,
      shutdown(session) {
        session.writeLine('quit');
      },
    });
  }

  get readiness(): LineProcessReadiness {
    return this.#pool.readiness;
  }

  use<T>(
    work: (session: LineProcessSession, handshake: UciHandshake) => Promise<T>,
    options: LineProcessLeaseOptions,
  ): Promise<T> {
    return this.#pool.use(work, options);
  }

  close(): Promise<void> {
    return this.#pool.close();
  }
}
