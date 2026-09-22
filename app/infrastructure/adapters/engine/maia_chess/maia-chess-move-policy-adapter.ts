import { createHash } from 'node:crypto';
import path from 'node:path';

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
import type { MaiaChessRuntimeConfiguration } from './maia-chess-runtime.ts';

export interface MaiaChessConfiguration extends MaiaChessRuntimeConfiguration {
  readonly instanceId: string;
  readonly displayName: string;
  readonly moveTimeoutMs: number;
}

const adapterVersion = 1;

export class MaiaChessMovePolicyAdapter implements MovePolicyProvider {
  readonly #configuration: MaiaChessConfiguration;
  readonly #runtime: UciEngineRuntime;
  readonly #descriptor: Omit<MovePolicyProviderDescriptor, 'readiness'>;

  constructor(
    configuration: MaiaChessConfiguration,
    runtime: UciEngineRuntime,
  ) {
    this.#configuration = Object.freeze({ ...configuration });
    this.#runtime = runtime;
    this.#descriptor = Object.freeze({
      instanceId: configuration.instanceId,
      providerType: 'maia-chess',
      displayName: configuration.displayName,
      fingerprint: maiaChessConfigurationFingerprint(configuration),
      capabilities: Object.freeze(['human_profile']) as readonly [
        'human_profile',
      ],
      profile: Object.freeze({
        modelName: path.basename(configuration.weightsPath),
        selectionMode: 'most_likely' as const,
        historyMode: 'known_position_history' as const,
        reproducibility: 'deterministic' as const,
      }),
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
          for (const [name, value] of [
            ['VerboseMoveStats', false],
            ['UCI_ShowWDL', false],
            ['PolicyTemperature', '1.0'],
            ['ContemptMode', 'disable'],
            ['WDLCalibrationElo', '0'],
          ] as const) {
            if (handshake.options.has(name)) setUciOption(session, name, value);
          }
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
        reproducibility: 'deterministic' as const,
      });
    } catch (error) {
      mapMovePolicyRuntimeError(error);
    }
  }
}

async function chooseUciMove(
  session: LineProcessSession,
  configuration: MaiaChessConfiguration,
  request: MovePolicyRequest,
): Promise<MovePolicyDecision['move']> {
  await beginUciGame(
    session,
    performance.now() + configuration.startupTimeoutMs,
  );
  writeUciPosition(session, movePolicyPosition(request));
  session.writeLine('go nodes 1');
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

export function maiaChessConfigurationFingerprint(
  configuration: MaiaChessConfiguration,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        providerType: 'maia-chess',
        adapterVersion,
        executablePath: configuration.executablePath,
        weightsPath: configuration.weightsPath,
        nodes: 1,
      }),
    )
    .digest('hex');
}
