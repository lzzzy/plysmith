import path from 'node:path';

import type {
  HumanPolicyAnalysisSnapshot,
  HumanPolicyCandidate,
  PositionAnalysisProvider,
  PositionAnalysisProviderDescriptor,
  PositionAnalysisProviderRequest,
} from '../../../../application/analysis/index.ts';
import type { ChessRulesPort } from '../../../../application/chess_graph/index.ts';
import type { CanonicalMove } from '../../../../domain/chess_graph/index.ts';
import type { LineProcessSession } from '../../process/index.ts';
import { canonicalAnalysisLine } from '../analysis-move-runtime.ts';
import {
  analysisWdl,
  mapPositionAnalysisRuntimeError,
} from '../position-analysis-runtime.ts';
import {
  beginUciGame,
  parseUciMove,
  readUciSearch,
  requireUciOptions,
  setUciOption,
  uciMoveText,
  type UciEngineRuntime,
  type UciHandshake,
  waitUntilUciReady,
  writeUciPosition,
} from '../uci/index.ts';
import type { MaiaChessConfiguration } from './maia-chess-move-policy-adapter.ts';

interface MaiaRootResult {
  readonly wdl: readonly [number, number, number];
  readonly policy: ReadonlyMap<string, number>;
}

const requiredAnalysisOptions = Object.freeze([
  'VerboseMoveStats',
  'UCI_ShowWDL',
  'PolicyTemperature',
  'ContemptMode',
  'WDLCalibrationElo',
]);

export class MaiaChessPositionAnalysisAdapter implements PositionAnalysisProvider {
  readonly #configuration: MaiaChessConfiguration;
  readonly #runtime: UciEngineRuntime;
  readonly #rules: ChessRulesPort;
  readonly #descriptor: Omit<PositionAnalysisProviderDescriptor, 'readiness'>;

  constructor(
    configuration: MaiaChessConfiguration,
    runtime: UciEngineRuntime,
    rules: ChessRulesPort,
  ) {
    this.#configuration = Object.freeze({ ...configuration });
    this.#runtime = runtime;
    this.#rules = rules;
    this.#descriptor = Object.freeze({
      instanceId: configuration.instanceId,
      providerType: 'maia-chess',
      displayName: configuration.displayName,
      capability: 'human_policy_analysis' as const,
      status: 'available' as const,
    });
  }

  get descriptor(): PositionAnalysisProviderDescriptor {
    return Object.freeze({
      ...this.#descriptor,
      readiness: this.#runtime.readiness,
    });
  }

  async analyze(
    request: PositionAnalysisProviderRequest,
    signal?: AbortSignal,
  ): Promise<HumanPolicyAnalysisSnapshot> {
    try {
      if (request.mode.kind !== 'human_policy') throw new Error('invalid mode');
      const legalMoves = this.#rules.legalMoves(
        request.focus.root,
        request.focus.moves,
      );
      if (!legalMoves.ok) throw new Error('invalid analysis line');
      if (legalMoves.value.length === 0) {
        return Object.freeze({
          kind: 'human_policy',
          focusKey: request.focus.focusKey,
          providerInstanceId: this.#descriptor.instanceId,
          providerDisplayName: this.#descriptor.displayName,
          historyCompleteness: request.focus.current.playState.historyKnowledge,
          profileName: this.#descriptor.displayName,
          modelName: path.basename(this.#configuration.weightsPath),
          candidates: Object.freeze([]),
        });
      }
      return await this.#runtime.use(
        (session, handshake) =>
          analyzeWithMaia(
            session,
            handshake,
            this.#configuration,
            this.#rules,
            request,
            this.descriptor,
            legalMoves.value,
          ),
        {
          waitTimeoutMs: this.#configuration.moveTimeoutMs,
          ...(signal === undefined ? {} : { signal }),
        },
      );
    } catch (error) {
      mapPositionAnalysisRuntimeError(error);
    }
  }
}

async function analyzeWithMaia(
  session: LineProcessSession,
  handshake: UciHandshake,
  configuration: MaiaChessConfiguration,
  rules: ChessRulesPort,
  request: PositionAnalysisProviderRequest,
  descriptor: PositionAnalysisProviderDescriptor,
  legalMoves: readonly CanonicalMove[],
): Promise<HumanPolicyAnalysisSnapshot> {
  requireUciOptions(handshake, requiredAnalysisOptions);
  const deadline = performance.now() + configuration.moveTimeoutMs;
  configureMaiaAnalysis(session, true);
  await waitUntilUciReady(session, deadline);
  await beginUciGame(session, deadline);
  writeUciPosition(session, {
    rootFen: request.focus.root.fen,
    moves: request.focus.moves,
  });
  session.writeLine('go nodes 1');
  const rootSearch = await readUciSearch(session, deadline);
  const root = parseMaiaRoot(rootSearch.lines);
  const policy = normalizeMaiaCastlingPolicy(root.policy, legalMoves);
  validatePolicy(policy, legalMoves);

  const ranked = [...policy.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, request.candidateCount);
  configureMaiaAnalysis(session, false);
  await waitUntilUciReady(session, deadline);
  const perspective = request.focus.current.position.sideToMove;
  const candidates: HumanPolicyCandidate[] = [];
  for (const [moveText, policyPercent] of ranked) {
    const canonical = canonicalAnalysisLine(rules, request.focus.current, [
      parseUciMove(moveText),
    ])[0];
    if (canonical === undefined) throw new Error('missing candidate move');
    const terminal = rules.gameStatus(request.focus.current, [canonical]);
    if (!terminal.ok) throw new Error('invalid candidate');
    const candidateWdl =
      terminal.value.kind === 'terminal'
        ? terminalWdl(terminal.value.winner, perspective)
        : await analyzeChildWdl(session, deadline, request.focus.root.fen, [
            ...request.focus.moves,
            canonical,
          ]);
    candidates.push(
      Object.freeze({
        rank: candidates.length + 1,
        move: canonical,
        policyPercent,
        wdl: analysisWdl(candidateWdl, {
          perspective,
          semantics: 'human_outcome',
        }),
      }),
    );
  }
  configureMaiaAnalysis(session, false);
  setUciOption(session, 'UCI_ShowWDL', false);
  await waitUntilUciReady(session, deadline);
  return Object.freeze({
    kind: 'human_policy',
    focusKey: request.focus.focusKey,
    providerInstanceId: descriptor.instanceId,
    providerDisplayName: descriptor.displayName,
    historyCompleteness: request.focus.current.playState.historyKnowledge,
    profileName: descriptor.displayName,
    modelName: path.basename(configuration.weightsPath),
    rootWdl: analysisWdl(root.wdl, {
      perspective,
      semantics: 'human_outcome',
    }),
    candidates: Object.freeze(candidates),
  });
}

async function analyzeChildWdl(
  session: LineProcessSession,
  deadline: number,
  rootFen: string,
  moves: readonly CanonicalMove[],
): Promise<readonly [number, number, number]> {
  writeUciPosition(session, { rootFen, moves });
  session.writeLine('go nodes 1');
  const result = await readUciSearch(session, deadline);
  const child = parseWdl(result.lines);
  return Object.freeze([child[2], child[1], child[0]]);
}

function configureMaiaAnalysis(
  session: LineProcessSession,
  verbose: boolean,
): void {
  setUciOption(session, 'VerboseMoveStats', verbose);
  setUciOption(session, 'UCI_ShowWDL', true);
  setUciOption(session, 'PolicyTemperature', '1.0');
  setUciOption(session, 'ContemptMode', 'disable');
  setUciOption(session, 'WDLCalibrationElo', '0');
}

function parseMaiaRoot(lines: readonly string[]): MaiaRootResult {
  const policy = new Map<string, number>();
  for (const line of lines) {
    const match =
      /^info string ([a-h][1-8][a-h][1-8][qrbn]?).*\(P:\s*([0-9]+(?:\.[0-9]+)?)%\)/.exec(
        line,
      );
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const value = Number(match[2]);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error('invalid Maia policy');
    }
    policy.set(match[1], value);
  }
  return Object.freeze({ wdl: parseWdl(lines), policy });
}

function parseWdl(lines: readonly string[]): readonly [number, number, number] {
  let result: readonly [number, number, number] | undefined;
  for (const line of lines) {
    const match = /^info .*\bwdl (\d+) (\d+) (\d+)(?:\s|$)/.exec(line);
    if (match === null) continue;
    const values = [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    ] as const;
    if (values[0] + values[1] + values[2] !== 1_000) {
      throw new Error('invalid Maia WDL');
    }
    result = values;
  }
  if (result === undefined) throw new Error('missing Maia WDL');
  return result;
}

function normalizeMaiaCastlingPolicy(
  policy: ReadonlyMap<string, number>,
  legalMoves: readonly CanonicalMove[],
): ReadonlyMap<string, number> {
  const normalized = new Map(policy);
  for (const move of legalMoves) {
    if (!move.san.startsWith('O-O')) continue;
    const rookFile = move.san.startsWith('O-O-O') ? 'a' : 'h';
    const rookSquareMove = `${move.from}${rookFile}${move.from[1]}`;
    const value = normalized.get(rookSquareMove);
    const canonical = uciMoveText(move);
    if (value === undefined || normalized.has(canonical)) continue;
    normalized.delete(rookSquareMove);
    normalized.set(canonical, value);
  }
  return normalized;
}

function validatePolicy(
  policy: ReadonlyMap<string, number>,
  legalMoves: readonly CanonicalMove[],
): void {
  const expected = new Set(
    legalMoves.map(
      (move) =>
        `${move.from}${move.to}${
          move.promotion === undefined
            ? ''
            : { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }[
                move.promotion
              ]
        }`,
    ),
  );
  if (
    policy.size !== expected.size ||
    [...policy.keys()].some((move) => !expected.has(move))
  ) {
    throw new Error('incomplete Maia policy');
  }
  const sum = [...policy.values()].reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 100) > legalMoves.length * 0.011) {
    throw new Error('invalid Maia policy total');
  }
}

function terminalWdl(
  winner: 'white' | 'black' | undefined,
  perspective: 'white' | 'black',
): readonly [number, number, number] {
  if (winner === undefined) return Object.freeze([0, 1_000, 0]);
  return winner === perspective
    ? Object.freeze([1_000, 0, 0])
    : Object.freeze([0, 0, 1_000]);
}
