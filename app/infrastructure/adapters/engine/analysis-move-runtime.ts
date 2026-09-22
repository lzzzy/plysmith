import type {
  CanonicalMove,
  ChessState,
} from '../../../domain/chess_graph/index.ts';
import type { ChessRulesPort } from '../../../application/chess_graph/index.ts';
import { PositionAnalysisProviderError } from '../../../application/analysis/index.ts';
import type { UciMove } from './uci/index.ts';
import { uciMoveText } from './uci/index.ts';

export function canonicalAnalysisLine(
  rules: ChessRulesPort,
  root: ChessState,
  moves: readonly UciMove[],
): readonly CanonicalMove[] {
  const result: CanonicalMove[] = [];
  for (const move of moves) {
    const applied = rules.applyMove(root, result, {
      kind: 'coordinates',
      value: uciMoveText(move),
    });
    if (!applied.ok) {
      throw new PositionAnalysisProviderError('illegal_engine_move');
    }
    result.push(applied.value.move);
  }
  return Object.freeze(result);
}
