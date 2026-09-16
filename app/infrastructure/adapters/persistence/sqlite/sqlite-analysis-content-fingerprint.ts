import { createHash } from 'node:crypto';

import type { AnalysisScratchOrigin } from '../../../../domain/analysis/index.ts';
import type {
  CanonicalMove,
  ChessState,
} from '../../../../domain/chess_graph/index.ts';

export interface AnalysisContentFingerprintInput {
  readonly displayName: string;
  readonly summary?: string;
  readonly languageTag: string;
  readonly originMode: AnalysisScratchOrigin['kind'];
  readonly root: ChessState;
  readonly steps: readonly {
    readonly move: CanonicalMove;
    readonly after: ChessState;
  }[];
}

export function analysisContentFingerprint(
  input: AnalysisContentFingerprintInput,
): Buffer {
  return createHash('sha256')
    .update(
      JSON.stringify({
        displayName: input.displayName,
        summary: input.summary ?? null,
        languageTag: input.languageTag,
        originMode: input.originMode,
        root: stateFingerprintValue(input.root),
        steps: input.steps.map((step) => ({
          move: {
            from: step.move.from,
            to: step.move.to,
            promotion: step.move.promotion ?? null,
            san: step.move.san,
          },
          after: stateFingerprintValue(step.after),
        })),
      }),
      'utf8',
    )
    .digest();
}

function stateFingerprintValue(state: ChessState): unknown {
  return {
    positionKey: state.position.positionKey,
    playState: {
      halfmoveClock: state.playState.halfmoveClock,
      fullmoveNumber: state.playState.fullmoveNumber,
      historyKnowledge: state.playState.historyKnowledge,
    },
  };
}
