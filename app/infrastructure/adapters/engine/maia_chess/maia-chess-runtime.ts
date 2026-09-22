import type { LineProcessSupervisor } from '../../process/index.ts';
import {
  PooledUciEngineRuntime,
  readUciHandshake,
  type UciEngineRuntime,
  waitUntilUciReady,
} from '../uci/index.ts';

export interface MaiaChessRuntimeConfiguration {
  readonly executablePath: string;
  readonly weightsPath: string;
  readonly startupTimeoutMs: number;
  readonly stopTimeoutMs: number;
  readonly maxOutputBytes: number;
}

export function createMaiaChessUciRuntime(
  configuration: MaiaChessRuntimeConfiguration,
  supervisor: LineProcessSupervisor,
): UciEngineRuntime {
  return new PooledUciEngineRuntime({
    supervisor,
    process: {
      executablePath: configuration.executablePath,
      arguments: ['--config=', `--weights=${configuration.weightsPath}`],
      startupTimeoutMs: configuration.startupTimeoutMs,
      stopTimeoutMs: configuration.stopTimeoutMs,
      maxOutputBytes: configuration.maxOutputBytes,
    },
    async prepare(session) {
      const deadline = performance.now() + configuration.startupTimeoutMs;
      const handshake = await readUciHandshake(session, deadline);
      await waitUntilUciReady(session, deadline);
      return handshake;
    },
  });
}
