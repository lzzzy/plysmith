import type {
  CanonicalMove,
  ChessState,
  SideToMove,
} from '../../domain/chess_graph/index.ts';
import type { ChessRulesPort } from '../chess_graph/index.ts';
import { ApplicationProblem } from '../problems/application-problem.ts';

export type PositionAnalysisCapability =
  'objective_position_analysis' | 'human_policy_analysis';

export type ObjectiveAnalysisBudget = 'fast' | 'thorough' | 'very_deep';

export interface PositionAnalysisFocus {
  readonly focusKey: string;
  readonly root: ChessState;
  readonly moves: readonly CanonicalMove[];
  readonly current: ChessState;
}

export interface AnalysisWdl {
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly perspective: SideToMove;
  readonly semantics: 'stockfish_selfplay' | 'human_outcome';
}

export type ObjectiveEvaluation =
  | {
      readonly kind: 'centipawns';
      readonly value: number;
      readonly bound: 'exact' | 'lower' | 'upper';
    }
  | {
      readonly kind: 'mate';
      readonly moves: number;
      readonly bound: 'exact' | 'lower' | 'upper';
    }
  | { readonly kind: 'unknown' };

export interface ObjectiveAnalysisCandidate {
  readonly rank: number;
  readonly move: CanonicalMove;
  readonly evaluation: ObjectiveEvaluation;
  readonly wdl?: AnalysisWdl;
  readonly principalVariation: readonly CanonicalMove[];
}

export interface ObjectiveSearchObservation {
  readonly limiter: { readonly kind: 'movetime'; readonly value: number };
  readonly depth?: number;
  readonly selectiveDepth?: number;
  readonly nodes?: number;
  readonly elapsedMilliseconds?: number;
  readonly nodesPerSecond?: number;
  readonly hashfullPermille?: number;
  readonly tablebaseHits?: number;
}

export interface HumanPolicyCandidate {
  readonly rank: number;
  readonly move: CanonicalMove;
  /** Provider probability in percent; visible top candidates are not renormalized. */
  readonly policyPercent: number;
  readonly wdl: AnalysisWdl;
}

interface PositionAnalysisSnapshotBase {
  readonly focusKey: string;
  readonly providerInstanceId: string;
  readonly providerDisplayName: string;
  readonly historyCompleteness: ChessState['playState']['historyKnowledge'];
}

export interface ObjectiveAnalysisSnapshot extends PositionAnalysisSnapshotBase {
  readonly kind: 'objective';
  readonly budget: ObjectiveAnalysisBudget;
  readonly rootWdl?: AnalysisWdl;
  readonly candidates: readonly ObjectiveAnalysisCandidate[];
  readonly search: ObjectiveSearchObservation;
}

export interface HumanPolicyAnalysisSnapshot extends PositionAnalysisSnapshotBase {
  readonly kind: 'human_policy';
  readonly profileName: string;
  readonly modelName: string;
  readonly rootWdl?: AnalysisWdl;
  readonly candidates: readonly HumanPolicyCandidate[];
}

export type PositionAnalysisSnapshot =
  ObjectiveAnalysisSnapshot | HumanPolicyAnalysisSnapshot;

export interface PositionAnalysisProviderDescriptor {
  readonly instanceId: string;
  readonly providerType: string;
  readonly displayName: string;
  readonly capability: PositionAnalysisCapability;
  readonly readiness: 'cold' | 'warming_up' | 'ready';
  readonly status: 'available' | 'unavailable';
  readonly problemCode?: string;
}

export type PositionAnalysisMode =
  | {
      readonly kind: 'objective';
      readonly budget: ObjectiveAnalysisBudget;
    }
  | { readonly kind: 'human_policy' };

export interface PositionAnalysisRequest {
  readonly consumerId: string;
  readonly laneId: string;
  readonly providerInstanceId: string;
  readonly candidateCount: number;
  readonly focus: PositionAnalysisFocus;
  readonly mode: PositionAnalysisMode;
}

export interface PositionAnalysisProviderRequest {
  readonly candidateCount: number;
  readonly focus: PositionAnalysisFocus;
  readonly mode: PositionAnalysisMode;
}

export type PositionAnalysisFailureCode =
  | 'provider_unavailable'
  | 'provider_protocol_error'
  | 'provider_timeout'
  | 'provider_resource_exhausted'
  | 'capability_missing'
  | 'illegal_engine_move'
  | 'interrupted';

export class PositionAnalysisProviderError extends Error {
  readonly code: PositionAnalysisFailureCode;

  constructor(code: PositionAnalysisFailureCode, cause?: unknown) {
    super(code, { cause });
    this.name = 'PositionAnalysisProviderError';
    this.code = code;
  }
}

export interface PositionAnalysisProvider {
  readonly descriptor: PositionAnalysisProviderDescriptor;
  analyze(
    request: PositionAnalysisProviderRequest,
    signal?: AbortSignal,
  ): Promise<PositionAnalysisSnapshot>;
}

export interface PositionAnalysisRegistry {
  list(): readonly PositionAnalysisProviderDescriptor[];
  resolve(
    instanceId: string,
    capability: PositionAnalysisCapability,
  ): PositionAnalysisProvider | undefined;
}

export interface ListPositionAnalysisProvidersUseCase {
  execute(): readonly PositionAnalysisProviderDescriptor[];
}

export interface AnalyzePositionUseCase {
  execute(request: PositionAnalysisRequest): Promise<PositionAnalysisSnapshot>;
}

export class ListPositionAnalysisProviders implements ListPositionAnalysisProvidersUseCase {
  readonly #providers: PositionAnalysisRegistry;

  constructor(providers: PositionAnalysisRegistry) {
    this.#providers = providers;
  }

  execute(): readonly PositionAnalysisProviderDescriptor[] {
    return Object.freeze(
      this.#providers.list().map((provider) => Object.freeze({ ...provider })),
    );
  }
}

export class ActivePositionAnalysisLanes {
  readonly #active = new Map<string, AbortController>();

  async run<T>(
    consumerId: string,
    laneId: string,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const key = `${consumerId}\u0000${laneId}`;
    const previous = this.#active.get(key);
    previous?.abort();
    const controller = new AbortController();
    this.#active.set(key, controller);
    try {
      return await work(controller.signal);
    } finally {
      if (this.#active.get(key) === controller) this.#active.delete(key);
    }
  }
}

export class AnalyzePosition implements AnalyzePositionUseCase {
  readonly #rules: ChessRulesPort;
  readonly #providers: PositionAnalysisRegistry;
  readonly #lanes: ActivePositionAnalysisLanes;

  constructor(dependencies: {
    readonly rules: ChessRulesPort;
    readonly providers: PositionAnalysisRegistry;
    readonly lanes: ActivePositionAnalysisLanes;
  }) {
    this.#rules = dependencies.rules;
    this.#providers = dependencies.providers;
    this.#lanes = dependencies.lanes;
  }

  async execute(
    request: PositionAnalysisRequest,
  ): Promise<PositionAnalysisSnapshot> {
    validateRequest(request);
    validateFocus(this.#rules, request.focus);
    const capability =
      request.mode.kind === 'objective'
        ? 'objective_position_analysis'
        : 'human_policy_analysis';
    const provider = this.#providers.resolve(
      request.providerInstanceId,
      capability,
    );
    if (provider === undefined || provider.descriptor.status !== 'available') {
      throw positionAnalysisProblem('provider_unavailable');
    }
    try {
      const snapshot = await this.#lanes.run(
        request.consumerId,
        request.laneId,
        (signal) => provider.analyze(request, signal),
      );
      if (
        snapshot.focusKey !== request.focus.focusKey ||
        snapshot.providerInstanceId !== request.providerInstanceId ||
        snapshot.kind !== request.mode.kind
      ) {
        throw new PositionAnalysisProviderError('provider_protocol_error');
      }
      return snapshot;
    } catch (error) {
      if (error instanceof ApplicationProblem) throw error;
      const code =
        error instanceof PositionAnalysisProviderError
          ? error.code
          : 'provider_protocol_error';
      throw positionAnalysisProblem(code);
    }
  }
}

function validateRequest(request: PositionAnalysisRequest): void {
  if (
    request.consumerId.trim().length === 0 ||
    request.consumerId.length > 128 ||
    request.laneId.trim().length === 0 ||
    request.laneId.length > 128 ||
    request.focus.focusKey.trim().length === 0 ||
    request.focus.focusKey.length > 256 ||
    !Number.isSafeInteger(request.candidateCount) ||
    request.candidateCount < 1 ||
    request.candidateCount > 8 ||
    request.focus.moves.length > 1_000
  ) {
    throw positionAnalysisProblem('invalid_request');
  }
}

function validateFocus(
  rules: ChessRulesPort,
  focus: PositionAnalysisFocus,
): void {
  const moves: CanonicalMove[] = [];
  let current = focus.root;
  for (const move of focus.moves) {
    const applied = rules.applyMove(focus.root, moves, {
      kind: 'coordinates',
      value: `${move.from}${move.to}${promotionLetter(move.promotion)}`,
    });
    if (!applied.ok || applied.value.move.san !== move.san) {
      throw positionAnalysisProblem('invalid_focus');
    }
    moves.push(applied.value.move);
    current = applied.value.after;
  }
  if (current.fen !== focus.current.fen) {
    throw positionAnalysisProblem('invalid_focus');
  }
}

function promotionLetter(promotion?: CanonicalMove['promotion']): string {
  return promotion === undefined
    ? ''
    : { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }[promotion];
}

function positionAnalysisProblem(
  code: PositionAnalysisFailureCode | 'invalid_request' | 'invalid_focus',
): ApplicationProblem {
  return new ApplicationProblem(
    `analysis.position_${code}`,
    'The requested position analysis could not be completed.',
  );
}
