import { createHash } from 'node:crypto';

import {
  type MovePolicyDecision,
  type MovePolicyProvider,
  type MovePolicyProviderDescriptor,
  type MovePolicyRequest,
} from '../../../../application/playout/index.ts';
import type { LineProcessSession } from '../../process/index.ts';
import {
  beginUciGame,
  readUciBestMove,
  setUciOption,
  type UciEngineRuntime,
  waitUntilUciReady,
  writeUciPosition,
} from '../uci/index.ts';
import {
  mapMovePolicyRuntimeError,
  movePolicyDecisionMove,
  movePolicyPosition,
} from '../move-policy-runtime.ts';
import type { StockfishUciRuntimeConfiguration } from './stockfish-uci-runtime.ts';

export interface StockfishUciConfiguration extends StockfishUciRuntimeConfiguration {
  readonly instanceId: string;
  readonly displayName: string;
  readonly moveTimeMs: number;
  readonly moveTimeoutMs: number;
}

const adapterVersion = 1;

export class StockfishUciMovePolicyAdapter implements MovePolicyProvider {
  readonly #configuration: StockfishUciConfiguration;
  readonly #runtime: UciEngineRuntime;
  readonly #descriptor: Omit<MovePolicyProviderDescriptor, 'readiness'>;

  constructor(
    configuration: StockfishUciConfiguration,
    runtime: UciEngineRuntime,
  ) {
    this.#configuration = Object.freeze({ ...configuration });
    this.#runtime = runtime;
    this.#descriptor = Object.freeze({
      instanceId: configuration.instanceId,
      providerType: 'stockfish-uci',
      displayName: configuration.displayName,
      fingerprint: stockfishUciConfigurationFingerprint(configuration),
      capabilities: Object.freeze(['best_move']) as readonly ['best_move'],
      status: 'available',
    });
  }

  get descriptor(): MovePolicyProviderDescriptor {
    return Object.freeze({
      ...this.#descriptor,
      readiness: this.#runtime.readiness,
    });
  }

  async chooseMove(
    request: MovePolicyRequest,
    signal?: AbortSignal,
  ): Promise<MovePolicyDecision> {
    try {
      const move = await this.#runtime.use(
        async (session, handshake) => {
          if (handshake.options.has('MultiPV'))
            setUciOption(session, 'MultiPV', 1);
          if (handshake.options.has('UCI_ShowWDL'))
            setUciOption(session, 'UCI_ShowWDL', false);
          if (handshake.options.has('UCI_LimitStrength'))
            setUciOption(session, 'UCI_LimitStrength', false);
          await waitUntilUciReady(
            session,
            performance.now() + this.#configuration.startupTimeoutMs,
          );
          return chooseUciMove(session, this.#configuration, request);
        },
        {
          waitTimeoutMs: this.#configuration.moveTimeoutMs,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      return Object.freeze({
        move,
        providerInstanceId: this.descriptor.instanceId,
        providerFingerprint: this.descriptor.fingerprint,
        reproducibility: 'unknown' as const,
      });
    } catch (error) {
      mapMovePolicyRuntimeError(error);
    }
  }
}

async function chooseUciMove(
  session: LineProcessSession,
  configuration: StockfishUciConfiguration,
  request: MovePolicyRequest,
): Promise<MovePolicyDecision['move']> {
  await beginUciGame(
    session,
    performance.now() + configuration.startupTimeoutMs,
  );
  writeUciPosition(session, movePolicyPosition(request));
  session.writeLine(`go movetime ${configuration.moveTimeMs}`);
  const move = await readUciBestMove(
    session,
    performance.now() + configuration.moveTimeoutMs,
  );
  await waitUntilUciReady(
    session,
    performance.now() + configuration.startupTimeoutMs,
  );
  return movePolicyDecisionMove(move);
}

export function stockfishUciConfigurationFingerprint(
  configuration: StockfishUciConfiguration,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        providerType: 'stockfish-uci',
        adapterVersion,
        executablePath: configuration.executablePath,
        arguments: configuration.arguments,
        threads: configuration.threads,
        hashMb: configuration.hashMb,
        moveTimeMs: configuration.moveTimeMs,
      }),
    )
    .digest('hex');
}
