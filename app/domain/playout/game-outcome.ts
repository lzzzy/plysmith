import type { SideToMove } from '../chess_graph/index.ts';
import type { PlayoutDraft, PlayoutOutcome } from './playout-draft.ts';

export type ManualGameResult =
  'white_win' | 'black_win' | 'draw' | 'unfinished';
export type GameOutcomeSource = 'manual' | 'automatic';
export type GameOutcome =
  PlayoutOutcome | { readonly kind: 'draw'; readonly reason?: never };

export interface GameResult {
  readonly outcome: GameOutcome;
  readonly outcomeSource: GameOutcomeSource;
}

export function isManualGameResult(value: unknown): value is ManualGameResult {
  return (
    value === 'white_win' ||
    value === 'black_win' ||
    value === 'draw' ||
    value === 'unfinished'
  );
}

export function resolvePlayoutResult(
  draft: PlayoutDraft,
  manualResult?: ManualGameResult,
): GameResult {
  if (draft.status.kind === 'terminal' && manualResult === undefined) {
    if (
      (draft.status.reason === 'checkmate' &&
        draft.status.outcome.kind !== 'win') ||
      (draft.status.reason !== 'checkmate' &&
        (draft.status.outcome.kind !== 'draw' ||
          draft.status.outcome.reason !== draft.status.reason))
    ) {
      throw new Error('A terminal result must match its rules-based reason.');
    }
    return validateGameResult({
      outcome: draft.status.outcome,
      outcomeSource: 'automatic',
    });
  }
  if (draft.status.kind !== 'stopped' || !isManualGameResult(manualResult)) {
    throw new Error(
      'Completion requires either a manual result or an unchanged terminal result.',
    );
  }
  const outcome: GameOutcome =
    manualResult === 'white_win' || manualResult === 'black_win'
      ? {
          kind: 'win',
          winner: manualResult === 'white_win' ? 'white' : 'black',
        }
      : manualResult === 'draw'
        ? { kind: 'draw' }
        : { kind: 'unfinished' };
  return validateGameResult({ outcome, outcomeSource: 'manual' });
}

export function validateGameResult(result: GameResult): GameResult {
  const { outcome, outcomeSource } = result;
  const reason = 'reason' in outcome ? outcome.reason : undefined;
  const winner: SideToMove | undefined =
    'winner' in outcome ? outcome.winner : undefined;
  const validOutcome =
    outcome.kind === 'win'
      ? (winner === 'white' || winner === 'black') && reason === undefined
      : outcome.kind === 'draw'
        ? winner === undefined
        : outcome.kind === 'unfinished' &&
          winner === undefined &&
          reason === undefined;
  const validSource =
    outcomeSource === 'manual'
      ? reason === undefined
      : outcomeSource === 'automatic' &&
        (outcome.kind === 'win' ||
          (outcome.kind === 'draw' &&
            (reason === 'stalemate' ||
              reason === 'insufficient_material' ||
              reason === 'threefold_repetition' ||
              reason === 'seventy_five_move')));
  if (!validOutcome || !validSource)
    throw new Error('A game requires a valid result and result source.');
  return Object.freeze({
    outcome: Object.freeze({ ...outcome }),
    outcomeSource,
  });
}

export function manualGameResult(
  result: GameResult,
): ManualGameResult | undefined {
  if (result.outcomeSource !== 'manual') return undefined;
  if (result.outcome.kind === 'win')
    return result.outcome.winner === 'white' ? 'white_win' : 'black_win';
  return result.outcome.kind;
}

export function gameResultMatchesPlayout(
  result: GameResult,
  draft: PlayoutDraft,
): boolean {
  try {
    validateGameResult(result);
    const expected = resolvePlayoutResult(draft, manualGameResult(result));
    return (
      expected.outcomeSource === result.outcomeSource &&
      expected.outcome.kind === result.outcome.kind &&
      (expected.outcome.kind !== 'win' ||
        (result.outcome.kind === 'win' &&
          expected.outcome.winner === result.outcome.winner)) &&
      (expected.outcome.kind !== 'draw' ||
        (result.outcome.kind === 'draw' &&
          expected.outcome.reason === result.outcome.reason))
    );
  } catch {
    return false;
  }
}
