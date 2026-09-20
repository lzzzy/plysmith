import { createHash } from 'node:crypto';

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

export interface StockfishUciConfiguration {
  readonly instanceId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly executablePath: string;
  readonly executableSha256: string;
  readonly arguments: readonly string[];
  readonly threads: number;
  readonly hashMb: number;
  readonly moveTimeMs: number;
  readonly startupTimeoutMs: number;
  readonly moveTimeoutMs: number;
  readonly stopTimeoutMs: number;
  readonly maxOutputBytes: number;
}

const adapterVersion = 1;

export class StockfishUciMovePolicyAdapter implements MovePolicyProvider {
  readonly descriptor: MovePolicyProviderDescriptor;
  readonly #configuration: StockfishUciConfiguration;
  readonly #supervisor: LineProcessSupervisor;

  constructor(
    configuration: StockfishUciConfiguration,
    supervisor: LineProcessSupervisor,
  ) {
    this.#configuration = Object.freeze({ ...configuration });
    this.#supervisor = supervisor;
    this.descriptor = Object.freeze({
      instanceId: configuration.instanceId,
      providerType: 'stockfish-uci',
      displayName: configuration.displayName,
      fingerprint: stockfishUciConfigurationFingerprint(configuration),
      capabilities: configuration.enabled
        ? (Object.freeze(['best_move']) as readonly ['best_move'])
        : (Object.freeze([]) as readonly []),
      status: configuration.enabled ? 'available' : 'disabled',
      ...(configuration.enabled ? {} : { problemCode: 'provider_disabled' }),
    });
  }

  async chooseMove(request: MovePolicyRequest): Promise<MovePolicyDecision> {
    if (!this.#configuration.enabled) {
      throw new MovePolicyProviderError('provider_unavailable');
    }
    try {
      const move = await this.#supervisor.run(
        {
          executablePath: this.#configuration.executablePath,
          arguments: this.#configuration.arguments,
          startupTimeoutMs: this.#configuration.startupTimeoutMs,
          stopTimeoutMs: this.#configuration.stopTimeoutMs,
          maxOutputBytes: this.#configuration.maxOutputBytes,
        },
        async (session) => chooseUciMove(session, this.#configuration, request),
      );
      return Object.freeze({
        move,
        providerInstanceId: this.descriptor.instanceId,
        providerFingerprint: this.descriptor.fingerprint,
        reproducibility: 'unknown' as const,
      });
    } catch (error) {
      if (error instanceof MovePolicyProviderError) throw error;
      if (error instanceof LineProcessProblem) {
        throw new MovePolicyProviderError(mapProcessProblem(error), error);
      }
      throw new MovePolicyProviderError('provider_protocol_error', error);
    }
  }
}

async function chooseUciMove(
  session: LineProcessSession,
  configuration: StockfishUciConfiguration,
  request: MovePolicyRequest,
): Promise<MovePolicyDecision['move']> {
  const startupDeadline = performance.now() + configuration.startupTimeoutMs;
  session.writeLine('uci');
  const options = new Set<string>();
  for (;;) {
    const line = await readLineBefore(session, startupDeadline);
    if (line === 'uciok') break;
    const option = /^option name (.+?) type /.exec(line)?.[1];
    if (option !== undefined) options.add(option);
  }
  if (!options.has('Threads') || !options.has('Hash')) {
    throw new MovePolicyProviderError('capability_missing');
  }
  session.writeLine(`setoption name Threads value ${configuration.threads}`);
  session.writeLine(`setoption name Hash value ${configuration.hashMb}`);
  session.writeLine('isready');
  await readUntil(session, 'readyok', startupDeadline);
  session.writeLine('ucinewgame');
  session.writeLine('isready');
  await readUntil(session, 'readyok', startupDeadline);
  const suffix =
    request.moves.length === 0
      ? ''
      : ` moves ${request.moves.map(uciMove).join(' ')}`;
  session.writeLine(`position fen ${request.root.fen}${suffix}`);
  session.writeLine(`go movetime ${configuration.moveTimeMs}`);
  const moveDeadline = performance.now() + configuration.moveTimeoutMs;
  for (;;) {
    const line = await readLineBefore(session, moveDeadline);
    const match = /^bestmove ([a-h][1-8])([a-h][1-8])([qrbn])?(?:\s|$)/.exec(
      line,
    );
    if (match === null) continue;
    const from = match[1];
    const to = match[2];
    if (from === undefined || to === undefined) {
      throw new MovePolicyProviderError('provider_protocol_error');
    }
    return Object.freeze({
      from,
      to,
      ...(match[3] === undefined ? {} : { promotion: promotion(match[3]) }),
      san: `${from}${to}${match[3] ?? ''}`,
    });
  }
}

async function readUntil(
  session: LineProcessSession,
  expected: string,
  deadline: number,
): Promise<void> {
  for (;;) {
    if ((await readLineBefore(session, deadline)) === expected) return;
  }
}

function readLineBefore(
  session: LineProcessSession,
  deadline: number,
): Promise<string> {
  const remainingMs = Math.ceil(deadline - performance.now());
  if (remainingMs <= 0) {
    throw new LineProcessProblem('process_timeout');
  }
  return session.readLine(remainingMs);
}

function uciMove(move: MovePolicyRequest['moves'][number]): string {
  return `${move.from}${move.to}${
    move.promotion === undefined
      ? ''
      : { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }[move.promotion]
  }`;
}

function promotion(value: string): 'queen' | 'rook' | 'bishop' | 'knight' {
  const result = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[value];
  if (result === undefined) {
    throw new MovePolicyProviderError('provider_protocol_error');
  }
  return result as 'queen' | 'rook' | 'bishop' | 'knight';
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
        executableSha256: configuration.executableSha256,
        arguments: configuration.arguments,
        threads: configuration.threads,
        hashMb: configuration.hashMb,
        moveTimeMs: configuration.moveTimeMs,
      }),
    )
    .digest('hex');
}

function mapProcessProblem(
  problem: LineProcessProblem,
):
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'provider_resource_exhausted'
  | 'provider_protocol_error' {
  if (problem.code === 'process_start_failed') return 'provider_unavailable';
  if (problem.code === 'process_timeout') return 'provider_timeout';
  if (problem.code === 'process_output_limit')
    return 'provider_resource_exhausted';
  return 'provider_protocol_error';
}
