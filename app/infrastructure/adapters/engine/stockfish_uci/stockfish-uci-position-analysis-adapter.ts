import type {
  ObjectiveAnalysisCandidate,
  ObjectiveAnalysisSnapshot,
  ObjectiveEvaluation,
  PositionAnalysisProvider,
  PositionAnalysisProviderDescriptor,
  PositionAnalysisProviderRequest,
} from '../../../../application/analysis/index.ts';
import { validatePositionAnalysisProviderRequest } from '../../../../application/analysis/position-analysis.ts';
import type { ChessRulesPort } from '../../../../application/chess_graph/index.ts';
import type { LineProcessSession } from '../../process/index.ts';
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
import { canonicalAnalysisLine } from '../analysis-move-runtime.ts';
import {
  analysisWdl,
  mapPositionAnalysisRuntimeError,
} from '../position-analysis-runtime.ts';
import {
  stockfishQueueTimeoutMilliseconds,
  type StockfishUciConfiguration,
} from './stockfish-uci-move-policy-adapter.ts';

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
    this.#configuration = Object.freeze({
      ...configuration,
      detailLevels: Object.freeze({ ...configuration.detailLevels }),
    });
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
      validatePositionAnalysisProviderRequest(this.#rules, request);
      const legal = this.#rules.legalMoves(
        request.focus.root,
        request.focus.moves,
      );
      if (!legal.ok) throw new Error('invalid analysis line');
      if (legal.value.length === 0) {
        return Object.freeze({
          kind: 'objective',
          perspective: request.focus.current.position.sideToMove,
          focusKey: request.focus.focusKey,
          providerInstanceId: this.#descriptor.instanceId,
          providerDisplayName: this.#descriptor.displayName,
          historyCompleteness: request.focus.current.playState.historyKnowledge,
          budget: request.mode.budget,
          candidates: Object.freeze([]),
          search: Object.freeze({
            limiter: Object.freeze({
              kind: 'movetime',
              value: this.#configuration.detailLevels[request.mode.budget],
            }),
          }),
        });
      }
      const candidateCount = Math.min(
        request.candidateCount,
        request.mode.rootMoves?.length ?? legal.value.length,
      );
      return await this.#runtime.use(
        (session, handshake) =>
          analyzeWithStockfish(
            session,
            handshake,
            this.#configuration,
            this.#rules,
            request,
            this.descriptor,
            candidateCount,
          ),
        {
          waitTimeoutMs: stockfishQueueTimeoutMilliseconds(this.#configuration),
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
  candidateCount: number,
): Promise<ObjectiveAnalysisSnapshot> {
  if (request.mode.kind !== 'objective') throw new Error('invalid mode');
  requireUciOptions(handshake, ['MultiPV', 'UCI_ShowWDL', 'UCI_LimitStrength']);
  const movetime = configuration.detailLevels[request.mode.budget];
  const deadline = performance.now() + movetime + configuration.moveTimeoutMs;
  const rootMoves = request.mode.rootMoves;
  setUciOption(session, 'MultiPV', candidateCount);
  setUciOption(session, 'UCI_ShowWDL', true);
  setUciOption(session, 'UCI_LimitStrength', false);
  await waitUntilUciReady(session, deadline);
  await beginUciGame(session, deadline);
  writeUciPosition(session, {
    rootFen: request.focus.root.fen,
    moves: request.focus.moves,
  });
  session.writeLine(
    `go movetime ${movetime}${rootMoves === undefined ? '' : ` searchmoves ${rootMoves.map(uciMoveText).join(' ')}`}`,
  );
  const search = await readUciSearch(session, deadline);
  await waitUntilUciReady(session, deadline);

  let latest: readonly ParsedStockfishLine[] = [];
  let pass: ParsedStockfishLine[] = [];
  for (const line of search.lines) {
    const parsed = parseStockfishInfo(line);
    if (parsed === undefined) continue;
    if (parsed.rank === 1) pass = [];
    if (
      parsed.depth === undefined ||
      parsed.rank !== pass.length + 1 ||
      (pass.length > 0 && parsed.depth !== pass[0]?.depth) ||
      parsed.pv[0] === undefined ||
      pass.some((previous) => previous.pv[0] === parsed.pv[0])
    ) {
      pass = [];
      continue;
    }
    pass.push(parsed);
    // Publish only a complete pass; later partial output must not mix ranks.
    if (pass.length === candidateCount) latest = [...pass];
  }
  if (latest.length === 0) throw new Error('missing complete MultiPV pass');
  const perspective = request.focus.current.position.sideToMove;
  const candidates: ObjectiveAnalysisCandidate[] = latest.map((candidate) => {
    const pv = candidate.pv.slice(0, 32).map(parseUciMove);
    const canonical = canonicalAnalysisLine(rules, request.focus.current, pv);
    const move = canonical[0];
    if (move === undefined) throw new Error('missing candidate move');
    if (
      rootMoves !== undefined &&
      !rootMoves.some(
        (requested) => uciMoveText(requested) === uciMoveText(move),
      )
    ) {
      throw new Error('unexpected restricted candidate');
    }
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
  const leading = latest[0];
  return Object.freeze({
    kind: 'objective',
    perspective,
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
