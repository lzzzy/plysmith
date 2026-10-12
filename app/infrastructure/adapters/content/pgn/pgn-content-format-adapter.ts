import type { ChessRulesPort } from '../../../../application/chess_graph/index.ts';
import { PgnGameReader } from './pgn-game-reader.ts';

export { pgnLimits } from './pgn-structure.ts';

export class PgnContentFormatAdapter extends PgnGameReader {
  constructor(rules: ChessRulesPort) {
    super(rules, 'normal');
  }
}
