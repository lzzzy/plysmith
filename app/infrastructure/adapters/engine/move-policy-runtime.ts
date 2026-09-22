import {
  MovePolicyProviderError,
  type MovePolicyDecision,
  type MovePolicyRequest,
} from '../../../application/playout/index.ts';
import { LineProcessProblem } from '../process/index.ts';
import { UciProtocolProblem, type UciMove } from './uci/index.ts';

export function mapMovePolicyRuntimeError(error: unknown): never {
  if (error instanceof MovePolicyProviderError) throw error;
  if (error instanceof UciProtocolProblem) {
    throw new MovePolicyProviderError(
      error.code === 'capability_missing'
        ? 'capability_missing'
        : 'provider_protocol_error',
      error,
    );
  }
  if (error instanceof LineProcessProblem) {
    const code =
      error.code === 'process_start_failed'
        ? 'provider_unavailable'
        : error.code === 'process_timeout'
          ? 'provider_timeout'
          : error.code === 'process_output_limit' ||
              error.code === 'process_busy'
            ? 'provider_resource_exhausted'
            : error.code === 'process_interrupted'
              ? 'interrupted'
              : 'provider_protocol_error';
    throw new MovePolicyProviderError(code, error);
  }
  throw new MovePolicyProviderError('provider_protocol_error', error);
}

export function movePolicyPosition(request: MovePolicyRequest): {
  readonly rootFen: string;
  readonly moves: readonly UciMove[];
} {
  return Object.freeze({
    rootFen: request.root.fen,
    moves: request.moves,
  });
}

export function movePolicyDecisionMove(
  move: UciMove,
): MovePolicyDecision['move'] {
  return Object.freeze({
    ...move,
    san: `${move.from}${move.to}${promotionLetter(move.promotion)}`,
  });
}

function promotionLetter(promotion: UciMove['promotion']): string {
  if (promotion === undefined) return '';
  return { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }[promotion];
}
