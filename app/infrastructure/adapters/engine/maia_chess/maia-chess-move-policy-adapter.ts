import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  MovePolicyProviderError,
  type MovePolicyDecision,
  type MovePolicyProvider,
  type MovePolicyProviderDescriptor,
  type MovePolicyRequest,
} from '../../../../application/playout/index.ts';
import {
  LineProcessProblem,
  type LineProcessSession,
  type LineProcessSupervisor,
} from '../../process/index.ts';
import {
  beginUciGame,
  ExclusiveUciExecution,
  mapLineProcessProblem,
  readUciBestMove,
  readUciHandshake,
  waitUntilUciReady,
  writeUciPosition,
} from '../uci/index.ts';

export interface MaiaChessConfiguration {
  readonly instanceId: string;
  readonly displayName: string;
  readonly executablePath: string;
  readonly weightsPath: string;
  readonly startupTimeoutMs: number;
  readonly moveTimeoutMs: number;
  readonly stopTimeoutMs: number;
  readonly maxOutputBytes: number;
}

const adapterVersion = 1;

export class MaiaChessMovePolicyAdapter implements MovePolicyProvider {
  readonly descriptor: MovePolicyProviderDescriptor;
  readonly #configuration: MaiaChessConfiguration;
  readonly #supervisor: LineProcessSupervisor;
  readonly #execution = new ExclusiveUciExecution();

  constructor(
    configuration: MaiaChessConfiguration,
    supervisor: LineProcessSupervisor,
  ) {
    this.#configuration = Object.freeze({ ...configuration });
    this.#supervisor = supervisor;
    this.descriptor = Object.freeze({
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
      readiness: 'cold',
      status: 'available',
    });
  }

  async chooseMove(request: MovePolicyRequest): Promise<MovePolicyDecision> {
    try {
      const move = await this.#execution.run(() =>
        this.#supervisor.run(
          {
            executablePath: this.#configuration.executablePath,
            arguments: [
              '--config=',
              `--weights=${this.#configuration.weightsPath}`,
            ],
            startupTimeoutMs: this.#configuration.startupTimeoutMs,
            stopTimeoutMs: this.#configuration.stopTimeoutMs,
            maxOutputBytes: this.#configuration.maxOutputBytes,
          },
          async (session) =>
            chooseUciMove(session, this.#configuration, request),
        ),
      );
      return Object.freeze({
        move,
        providerInstanceId: this.descriptor.instanceId,
        providerFingerprint: this.descriptor.fingerprint,
        reproducibility: 'deterministic' as const,
      });
    } catch (error) {
      if (error instanceof MovePolicyProviderError) throw error;
      if (error instanceof LineProcessProblem) {
        throw new MovePolicyProviderError(mapLineProcessProblem(error), error);
      }
      throw new MovePolicyProviderError('provider_protocol_error', error);
    }
  }
}

async function chooseUciMove(
  session: LineProcessSession,
  configuration: MaiaChessConfiguration,
  request: MovePolicyRequest,
): Promise<MovePolicyDecision['move']> {
  const startupDeadline = performance.now() + configuration.startupTimeoutMs;
  await readUciHandshake(session, startupDeadline);
  await waitUntilUciReady(session, startupDeadline);
  await beginUciGame(session, startupDeadline);
  writeUciPosition(session, request);
  session.writeLine('go nodes 1');
  return readUciBestMove(
    session,
    performance.now() + configuration.moveTimeoutMs,
  );
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
