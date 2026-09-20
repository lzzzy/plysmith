import type { ChessState, SideToMove } from '../chess_graph/index.ts';
import type {
  MovePolicyBinding,
  PlayoutOrigin,
  PlayoutOutcome,
  PlayoutStep,
} from '../playout/index.ts';

export interface GameProviderProvenance {
  readonly providerType: string;
  readonly providerDisplayName: string;
}

export interface GameRecordDraft {
  readonly displayName: string;
  readonly languageTag: string;
  readonly origin: PlayoutOrigin;
  readonly root: ChessState;
  readonly steps: readonly PlayoutStep[];
  readonly playerSide: SideToMove;
  readonly outcome: PlayoutOutcome;
  readonly policy: MovePolicyBinding;
  readonly provider: GameProviderProvenance;
}

export function createGameRecordDraft(input: GameRecordDraft): GameRecordDraft {
  if (
    input.displayName.trim() !== input.displayName ||
    input.displayName.length < 1 ||
    input.displayName.length > 200 ||
    input.languageTag.length < 2 ||
    input.languageTag.length > 35 ||
    input.provider.providerType.trim().length === 0 ||
    input.provider.providerDisplayName.trim().length === 0
  ) {
    throw new Error('A game record requires valid metadata.');
  }
  return Object.freeze({
    ...input,
    steps: Object.freeze([...input.steps]),
    provider: Object.freeze({ ...input.provider }),
  });
}
