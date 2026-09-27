import type { PlayoutView } from '../../app/application/playout/index.ts';
import { localId } from '../../app/domain/identity/index.ts';
import type { PlayoutDto } from '../../app/infrastructure/channels/host_client/index.ts';

export const pausedPlayout = {
  draft: {
    draftId: localId('playout-draft', 7),
    draftRevision: 4,
    decisionGeneration: 1,
    origin: { kind: 'initial_position' },
    root: {
      position: {
        ruleSetId: 'standardChess',
        boardKey:
          'RNBQKBNRPPPPPPPP................................pppppppprnbqkbnr',
        sideToMove: 'white',
        castlingRights: {
          whiteKingSide: true,
          whiteQueenSide: true,
          blackKingSide: true,
          blackQueenSide: true,
        },
        effectiveEnPassantSquare: -1,
        positionKey:
          'standardChess|RNBQKBNRPPPPPPPP................................pppppppprnbqkbnr|white|1|1|1|1|-1',
      },
      playState: {
        halfmoveClock: 0,
        fullmoveNumber: 1,
        historyKnowledge: 'complete',
      },
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    },
    playerSide: 'black',
    policy: {
      providerInstanceId: 'engine-main',
      providerFingerprint: 'sha256:engine-main',
      providerType: 'stockfish-uci',
      providerDisplayName: 'Stockfish',
      capability: 'best_move',
    },
    steps: [],
    status: { kind: 'paused' },
  },
  legalMoves: [],
  dataRevision: 5,
} satisfies PlayoutView;

export const pausedPlayoutDto = {
  ...pausedPlayout,
  draft: { ...pausedPlayout.draft, draftId: '7' },
} satisfies PlayoutDto;

export const cancelCompletionRequest = {
  scope: { kind: 'context' as const, contextId: '5' },
  draftId: '7',
  expectedDraftRevision: 3,
};

export const playoutRevisionConflict = {
  type: 'https://github.com/lzzzy/plysmith/blob/main/docs/problems/playout.revision_conflict.md',
  title: 'Playout revision conflict',
  status: 409,
  detail: 'Read the current playout before submitting another change.',
  instance: 'urn:plysmith:problem:conflict-1',
  code: 'playout.revision_conflict',
  correlationId: 'conflict-1',
  retryable: false,
  parameters: { expectedRevision: 3, currentRevision: 4 },
};
