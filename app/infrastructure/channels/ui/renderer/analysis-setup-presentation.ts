import type { ValidateAnalysisSetupRequestDto } from '../../host_client/index.ts';

export type PositionSetup = Extract<
  ValidateAnalysisSetupRequestDto['input'],
  { kind: 'position_setup' }
>['setup'];
export type SetupPiece = PositionSetup['pieces'][number];
export type PieceTool = Pick<SetupPiece, 'color' | 'role'>;
export type SetupTool = PieceTool | 'erase';

export interface SetupBoardInteraction {
  readonly setup: PositionSetup;
  readonly tool: SetupTool | undefined;
  readonly moveSource: string | undefined;
}

const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

export function applySetupBoardPress(
  interaction: SetupBoardInteraction,
  square: string,
): SetupBoardInteraction {
  const { setup, tool, moveSource } = interaction;
  const existing = setup.pieces.find((piece) => piece.square === square);
  if (moveSource !== undefined) {
    if (moveSource === square) {
      return { setup, tool, moveSource: undefined };
    }
    const moving = setup.pieces.find((piece) => piece.square === moveSource);
    return {
      setup:
        moving === undefined
          ? setup
          : {
              ...setup,
              pieces: [
                ...setup.pieces.filter(
                  (piece) =>
                    piece.square !== moveSource && piece.square !== square,
                ),
                { ...moving, square },
              ],
            },
      tool,
      moveSource: undefined,
    };
  }
  if (tool === 'erase') {
    return {
      setup: {
        ...setup,
        pieces: setup.pieces.filter((piece) => piece.square !== square),
      },
      tool: undefined,
      moveSource: undefined,
    };
  }
  if (tool !== undefined) {
    return {
      setup: {
        ...setup,
        pieces: [
          ...setup.pieces.filter((piece) => piece.square !== square),
          { ...tool, square },
        ],
      },
      tool: undefined,
      moveSource: undefined,
    };
  }
  return {
    setup,
    tool,
    moveSource: existing === undefined ? undefined : square,
  };
}

export function enPassantCandidates(setup: PositionSetup): readonly string[] {
  const bySquare = new Map(setup.pieces.map((piece) => [piece.square, piece]));
  const pawnRank = setup.sideToMove === 'white' ? 5 : 4;
  const targetRank = setup.sideToMove === 'white' ? 6 : 3;
  const movedPawnColor = setup.sideToMove === 'white' ? 'black' : 'white';
  return files.flatMap((file, index) => {
    const movedPawn = bySquare.get(`${file}${pawnRank}`);
    const target = `${file}${targetRank}`;
    if (
      movedPawn?.color !== movedPawnColor ||
      movedPawn.role !== 'pawn' ||
      bySquare.has(target)
    ) {
      return [];
    }
    const canCapture = [-1, 1].some((offset) => {
      const adjacentFile = files[index + offset];
      const pawn =
        adjacentFile === undefined
          ? undefined
          : bySquare.get(`${adjacentFile}${pawnRank}`);
      return pawn?.color === setup.sideToMove && pawn.role === 'pawn';
    });
    return canCapture ? [target] : [];
  });
}

export function withoutEnPassant(setup: PositionSetup): PositionSetup {
  const { enPassantSquare, ...rest } = setup;
  void enPassantSquare;
  return rest;
}
