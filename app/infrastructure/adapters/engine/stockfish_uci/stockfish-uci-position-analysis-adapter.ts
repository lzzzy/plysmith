import type {
  ObjectiveAnalysisBudget,
  ObjectiveAnalysisCandidate,
  ObjectiveAnalysisSnapshot,
  ObjectiveEvaluation,
  PositionAnalysisProvider,
  PositionAnalysisProviderDescriptor,
  PositionAnalysisProviderRequest,
} from '../../../../application/analysis/index.ts';
import type { ChessRulesPort } from '../../../../application/chess_graph/index.ts';
import type { LineProcessSession } from '../../process/index.ts';
import {
  beginUciGame,
  parseUciMove,
  readUciSearch,
  requireUciOptions,
  setUciOption,
  type UciEngineRuntime,
  type UciHandshake,
  waitUntilUciReady,
  writeUciPosition,
} from '../uci/index.ts';
import { canonicalAnalysisLine } from '../analysis-move-runtime.ts';
import {
  analysisWdl,
  mapPositionAnalysisRuntimeError,
} from '../position-analysis-runtime.ts';
import { type StockfishUciConfiguration } from './stockfish-uci-move-policy-adapter.ts';

interface ParsedStockfishLine {
  readonly rank: number;
  readonly evaluation: ObjectiveEvaluation;
  readonly wdl?: readonly [number, number, number];
  readonly pv: readonly string[];
  readonly depth?: number;
  readonly selectiveDepth?: number;
  readonly nodes?: number;
  readonly elapsedMilliseconds?: number;
  readonly nodesPerSecond?: number;
  readonly hashfullPermille?: number;
  readonly tablebaseHits?: number;
}

const budgetMilliseconds: Record<ObjectiveAnalysisBudget, number> = {
  fast: 300,
  thorough: 1_500,
  very_deep: 4_000,
};

export class StockfishUciPositionAnalysisAdapter implements PositionAnalysisProvider {
  readonly #configuration: StockfishUciConfiguration;
  readonly #runtime: UciEngineRuntime;
  readonly #rules: ChessRulesPort;
  readonly #descriptor: Omit<PositionAnalysisProviderDescriptor, 'readiness'>;

  constructor(
    configuration: StockfishUciConfiguration,
    runtime: UciEngineRuntime,
    rules: ChessRulesPort,
  ) {
    this.#configuration = Object.freeze({ ...configuration });
    this.#runtime = runtime;
    this.#rules = rules;
    this.#descriptor = Object.freeze({
      instanceId: configuration.instanceId,
      providerType: 'stockfish-uci',
      displayName: configuration.displayName,
      capability: 'objective_position_analysis' as const,
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
  ): Promise<ObjectiveAnalysisSnapshot> {
    if (request.mode.kind !== 'objective') {
      throw mapPositionAnalysisRuntimeError(new Error('invalid mode'));
    }
    try {
      return await this.#runtime.use(
        (session, handshake) =>
          analyzeWithStockfish(
            session,
            handshake,
            this.#configuration,
            this.#rules,
            request,
            this.descriptor,
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

async function analyzeWithStockfish(
  session: LineProcessSession,
  handshake: UciHandshake,
  configuration: StockfishUciConfiguration,
  rules: ChessRulesPort,
  request: PositionAnalysisProviderRequest,
  descriptor: PositionAnalysisProviderDescriptor,
): Promise<ObjectiveAnalysisSnapshot> {
  if (request.mode.kind !== 'objective') throw new Error('invalid mode');
  requireUciOptions(handshake, ['MultiPV', 'UCI_ShowWDL', 'UCI_LimitStrength']);
  const movetime = budgetMilliseconds[request.mode.budget];
  const deadline = performance.now() + configuration.moveTimeoutMs;
  setUciOption(session, 'MultiPV', request.candidateCount);
  setUciOption(session, 'UCI_ShowWDL', true);
  setUciOption(session, 'UCI_LimitStrength', false);
  await waitUntilUciReady(session, deadline);
  await beginUciGame(session, deadline);
  writeUciPosition(session, {
    rootFen: request.focus.root.fen,
    moves: request.focus.moves,
  });
  session.writeLine(`go movetime ${movetime}`);
  const search = await readUciSearch(session, deadline);
  await waitUntilUciReady(session, deadline);

  const latest = new Map<number, ParsedStockfishLine>();
  for (const line of search.lines) {
    const parsed = parseStockfishInfo(line);
    if (parsed !== undefined) latest.set(parsed.rank, parsed);
  }
  const perspective = request.focus.current.position.sideToMove;
  const candidates: ObjectiveAnalysisCandidate[] = [...latest.values()]
    .sort((left, right) => left.rank - right.rank)
    .slice(0, request.candidateCount)
    .map((candidate) => {
      const pv = candidate.pv.slice(0, 32).map(parseUciMove);
      const canonical = canonicalAnalysisLine(rules, request.focus.current, pv);
      const move = canonical[0];
      if (move === undefined) throw new Error('missing candidate move');
      return Object.freeze({
        rank: candidate.rank,
        move,
        evaluation: candidate.evaluation,
        ...(candidate.wdl === undefined
          ? {}
          : {
              wdl: analysisWdl(candidate.wdl, {
                perspective,
                semantics: 'stockfish_selfplay',
              }),
            }),
        principalVariation: canonical,
      });
    });
  const leading = latest.get(1);
  return Object.freeze({
    kind: 'objective',
    focusKey: request.focus.focusKey,
    providerInstanceId: descriptor.instanceId,
    providerDisplayName: descriptor.displayName,
    historyCompleteness: request.focus.current.playState.historyKnowledge,
    budget: request.mode.budget,
    ...(candidates[0]?.wdl === undefined ? {} : { rootWdl: candidates[0].wdl }),
    candidates: Object.freeze(candidates),
    search: Object.freeze({
      limiter: Object.freeze({ kind: 'movetime' as const, value: movetime }),
      ...(leading?.depth === undefined ? {} : { depth: leading.depth }),
      ...(leading?.selectiveDepth === undefined
        ? {}
        : { selectiveDepth: leading.selectiveDepth }),
      ...(leading?.nodes === undefined ? {} : { nodes: leading.nodes }),
      ...(leading?.elapsedMilliseconds === undefined
        ? {}
        : { elapsedMilliseconds: leading.elapsedMilliseconds }),
      ...(leading?.nodesPerSecond === undefined
        ? {}
        : { nodesPerSecond: leading.nodesPerSecond }),
      ...(leading?.hashfullPermille === undefined
        ? {}
        : { hashfullPermille: leading.hashfullPermille }),
      ...(leading?.tablebaseHits === undefined
        ? {}
        : { tablebaseHits: leading.tablebaseHits }),
    }),
  });
}

function parseStockfishInfo(line: string): ParsedStockfishLine | undefined {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return undefined;
  const tokens = line.trim().split(/\s+/);
  const rank = integerAfter(tokens, 'multipv') ?? 1;
  const scoreIndex = tokens.indexOf('score');
  const pvIndex = tokens.indexOf('pv');
  if (scoreIndex < 0 || pvIndex < 0 || pvIndex <= scoreIndex + 2)
    return undefined;
  const scoreKind = tokens[scoreIndex + 1];
  const scoreValue = Number(tokens[scoreIndex + 2]);
  if (
    !Number.isSafeInteger(rank) ||
    rank < 1 ||
    !Number.isSafeInteger(scoreValue)
  ) {
    return undefined;
  }
  const bound = tokens.includes('lowerbound')
    ? 'lower'
    : tokens.includes('upperbound')
      ? 'upper'
      : 'exact';
  const evaluation: ObjectiveEvaluation =
    scoreKind === 'cp'
      ? Object.freeze({ kind: 'centipawns', value: scoreValue, bound })
      : scoreKind === 'mate'
        ? Object.freeze({ kind: 'mate', moves: scoreValue, bound })
        : Object.freeze({ kind: 'unknown' });
  const wdlIndex = tokens.indexOf('wdl');
  const wdl =
    wdlIndex < 0 ? undefined : tuple3(tokens.slice(wdlIndex + 1, wdlIndex + 4));
  return Object.freeze({
    rank,
    evaluation,
    ...(wdl === undefined ? {} : { wdl }),
    pv: Object.freeze(tokens.slice(pvIndex + 1)),
    ...optionalMetric(tokens, 'depth', 'depth'),
    ...optionalMetric(tokens, 'seldepth', 'selectiveDepth'),
    ...optionalMetric(tokens, 'nodes', 'nodes'),
    ...optionalMetric(tokens, 'time', 'elapsedMilliseconds'),
    ...optionalMetric(tokens, 'nps', 'nodesPerSecond'),
    ...optionalMetric(tokens, 'hashfull', 'hashfullPermille'),
    ...optionalMetric(tokens, 'tbhits', 'tablebaseHits'),
  });
}

function integerAfter(
  tokens: readonly string[],
  key: string,
): number | undefined {
  const index = tokens.indexOf(key);
  if (index < 0) return undefined;
  const value = Number(tokens[index + 1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function tuple3(
  values: readonly string[],
): readonly [number, number, number] | undefined {
  if (values.length !== 3) return undefined;
  const tuple = values.map(Number);
  return tuple.every(Number.isSafeInteger)
    ? (tuple as unknown as readonly [number, number, number])
    : undefined;
}

function optionalMetric<K extends string>(
  tokens: readonly string[],
  source: string,
  target: K,
): Partial<Record<K, number>> {
  const value = integerAfter(tokens, source);
  return value === undefined
    ? {}
    : ({ [target]: value } as Partial<Record<K, number>>);
}

export { budgetMilliseconds as stockfishAnalysisBudgetMilliseconds };
