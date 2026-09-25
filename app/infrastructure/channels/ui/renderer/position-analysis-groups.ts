import type { PositionAnalysisSnapshotDto } from '../../host_client/index.ts';

export type ObjectiveSnapshot = Extract<
  PositionAnalysisSnapshotDto,
  { kind: 'objective' }
>;
export type HumanSnapshot = Extract<
  PositionAnalysisSnapshotDto,
  { kind: 'human_policy' }
>;
export type ObjectiveCandidate = ObjectiveSnapshot['candidates'][number];
export type HumanCandidate = HumanSnapshot['candidates'][number];
export type AnalysisMove = ObjectiveCandidate['move'];
export type ObjectiveEvaluation = ObjectiveCandidate['evaluation'];

export interface AnalysisMoveGroup {
  readonly key: string;
  readonly move: AnalysisMove;
  readonly objective?: ObjectiveCandidate;
  readonly human: ReadonlyMap<string, HumanCandidate>;
}

export function analysisMoveKey(
  move: Pick<AnalysisMove, 'from' | 'to' | 'promotion'>,
): string {
  return `${move.from}:${move.to}:${move.promotion ?? ''}`;
}

export function groupAnalysisMoves(
  objective: ObjectiveSnapshot | undefined,
  additional: readonly ObjectiveCandidate[],
  human: ReadonlyMap<string, HumanSnapshot>,
  sortBy: string,
): readonly AnalysisMoveGroup[] {
  const groups = new Map<
    string,
    {
      move: AnalysisMove;
      objective?: ObjectiveCandidate;
      human: Map<string, HumanCandidate>;
    }
  >();
  for (const candidate of [...(objective?.candidates ?? []), ...additional]) {
    const key = analysisMoveKey(candidate.move);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        move: candidate.move,
        objective: candidate,
        human: new Map(),
      });
    } else if (existing.objective === undefined) {
      existing.objective = candidate;
      existing.move = candidate.move;
    }
  }
  for (const [providerId, snapshot] of human) {
    for (const candidate of snapshot.candidates) {
      const key = analysisMoveKey(candidate.move);
      let group = groups.get(key);
      if (group === undefined) {
        group = { move: candidate.move, human: new Map() };
        groups.set(key, group);
      }
      group.human.set(providerId, candidate);
    }
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, ...group }))
    .sort((left, right) => {
      if (sortBy !== 'stockfish') {
        const leftPolicy = left.human.get(sortBy)?.policyPercent ?? -1;
        const rightPolicy = right.human.get(sortBy)?.policyPercent ?? -1;
        if (leftPolicy !== rightPolicy) return rightPolicy - leftPolicy;
      }
      const leftScore = objectiveSortValue(left.objective?.evaluation);
      const rightScore = objectiveSortValue(right.objective?.evaluation);
      if (leftScore !== rightScore) return rightScore - leftScore;
      return left.key.localeCompare(right.key);
    });
}

export function whiteEvaluation(
  evaluation: ObjectiveEvaluation,
  sideToMove: 'white' | 'black',
): ObjectiveEvaluation {
  if (sideToMove === 'white' || evaluation.kind === 'unknown')
    return evaluation;
  const bound =
    evaluation.bound === 'lower'
      ? 'upper'
      : evaluation.bound === 'upper'
        ? 'lower'
        : 'exact';
  return evaluation.kind === 'centipawns'
    ? { kind: 'centipawns', value: -evaluation.value, bound }
    : { kind: 'mate', moves: -evaluation.moves, bound };
}

export function whiteWdl(wdl: {
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly perspective: 'white' | 'black';
}): { readonly wins: number; readonly draws: number; readonly losses: number } {
  return wdl.perspective === 'white'
    ? { wins: wdl.wins, draws: wdl.draws, losses: wdl.losses }
    : { wins: wdl.losses, draws: wdl.draws, losses: wdl.wins };
}

function objectiveSortValue(
  evaluation: ObjectiveEvaluation | undefined,
): number {
  if (evaluation === undefined || evaluation.kind === 'unknown')
    return Number.NEGATIVE_INFINITY;
  if (evaluation.kind === 'centipawns') return evaluation.value;
  return evaluation.moves > 0
    ? 100_000 - evaluation.moves
    : -100_000 - evaluation.moves;
}
