import {
  MovePolicyProviderError,
  type MovePolicyDecision,
  type MovePolicyRequest,
} from '../../../../application/playout/index.ts';
import {
  LineProcessProblem,
  type LineProcessSession,
} from '../../process/index.ts';

export interface UciHandshake {
  readonly engineName?: string;
  readonly options: ReadonlySet<string>;
}

export class ExclusiveUciExecution {
  #active = false;

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#active) {
      throw new MovePolicyProviderError('provider_resource_exhausted');
    }
    this.#active = true;
    try {
      return await work();
    } finally {
      this.#active = false;
    }
  }
}

export async function readUciHandshake(
  session: LineProcessSession,
  deadline: number,
): Promise<UciHandshake> {
  session.writeLine('uci');
  const options = new Set<string>();
  let engineName: string | undefined;
  for (;;) {
    const line = await readLineBefore(session, deadline);
    if (line === 'uciok') break;
    const option = /^option name (.+?) type /.exec(line)?.[1];
    if (option !== undefined) options.add(option);
    const name = /^id name (.+)$/.exec(line)?.[1]?.trim();
    if (name !== undefined && name.length > 0) engineName = name;
  }
  return Object.freeze({
    ...(engineName === undefined ? {} : { engineName }),
    options,
  });
}

export function requireUciOptions(
  handshake: UciHandshake,
  required: readonly string[],
): void {
  if (required.some((option) => !handshake.options.has(option))) {
    throw new MovePolicyProviderError('capability_missing');
  }
}

export async function waitUntilUciReady(
  session: LineProcessSession,
  deadline: number,
): Promise<void> {
  session.writeLine('isready');
  await readUntil(session, 'readyok', deadline);
}

export async function beginUciGame(
  session: LineProcessSession,
  deadline: number,
): Promise<void> {
  session.writeLine('ucinewgame');
  await waitUntilUciReady(session, deadline);
}

export function writeUciPosition(
  session: LineProcessSession,
  request: MovePolicyRequest,
): void {
  const suffix =
    request.moves.length === 0
      ? ''
      : ` moves ${request.moves.map(uciMove).join(' ')}`;
  session.writeLine(`position fen ${request.root.fen}${suffix}`);
}

export async function readUciBestMove(
  session: LineProcessSession,
  deadline: number,
): Promise<MovePolicyDecision['move']> {
  for (;;) {
    const line = await readLineBefore(session, deadline);
    if (/^error(?:\s|$)/i.test(line)) {
      throw new MovePolicyProviderError('provider_protocol_error');
    }
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

export function mapLineProcessProblem(
  problem: LineProcessProblem,
):
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'provider_resource_exhausted'
  | 'provider_protocol_error' {
  if (problem.code === 'process_start_failed') {
    return 'provider_unavailable';
  }
  if (problem.code === 'process_timeout') return 'provider_timeout';
  if (problem.code === 'process_output_limit') {
    return 'provider_resource_exhausted';
  }
  return 'provider_protocol_error';
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
