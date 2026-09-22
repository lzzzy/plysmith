import type { LineProcessSupervisor } from '../../process/index.ts';
import {
  PooledUciEngineRuntime,
  readUciHandshake,
  requireUciOptions,
  type UciEngineRuntime,
  waitUntilUciReady,
} from '../uci/index.ts';

export interface StockfishUciRuntimeConfiguration {
  readonly executablePath: string;
  readonly arguments: readonly string[];
  readonly threads: number;
  readonly hashMb: number;
  readonly startupTimeoutMs: number;
  readonly stopTimeoutMs: number;
  readonly maxOutputBytes: number;
}

export function createStockfishUciRuntime(
  configuration: StockfishUciRuntimeConfiguration,
  supervisor: LineProcessSupervisor,
): UciEngineRuntime {
  return new PooledUciEngineRuntime({
    supervisor,
    process: {
      executablePath: configuration.executablePath,
      arguments: configuration.arguments,
      startupTimeoutMs: configuration.startupTimeoutMs,
      stopTimeoutMs: configuration.stopTimeoutMs,
      maxOutputBytes: configuration.maxOutputBytes,
    },
    async prepare(session) {
      const deadline = performance.now() + configuration.startupTimeoutMs;
      const handshake = await readUciHandshake(session, deadline);
      requireUciOptions(handshake, ['Threads', 'Hash']);
      session.writeLine(
        `setoption name Threads value ${configuration.threads}`,
      );
      session.writeLine(`setoption name Hash value ${configuration.hashMb}`);
      await waitUntilUciReady(session, deadline);
      return handshake;
    },
  });
}
