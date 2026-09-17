import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySetupBoardPress,
  enPassantCandidates,
  type PositionSetup,
} from '../../../app/infrastructure/channels/ui/renderer/analysis-setup-presentation.ts';

test('a setup piece tool places exactly one piece before it is cleared', () => {
  const setup = createSetup([]);
  const placed = applySetupBoardPress(
    {
      setup,
      tool: { color: 'white', role: 'queen' },
      moveSource: undefined,
    },
    'd4',
  );

  assert.deepEqual(placed.setup.pieces, [
    { color: 'white', role: 'queen', square: 'd4' },
  ]);
  assert.equal(placed.tool, undefined);

  const secondPress = applySetupBoardPress(placed, 'e4');
  assert.equal(secondPress.setup, placed.setup);
  assert.equal(
    secondPress.setup.pieces.some(({ square }) => square === 'e4'),
    false,
  );
});

test('setup pieces can be selected, moved, and deselected on the board', () => {
  const setup = createSetup([{ color: 'white', role: 'king', square: 'e1' }]);
  const selected = applySetupBoardPress(
    { setup, tool: undefined, moveSource: undefined },
    'e1',
  );
  assert.equal(selected.moveSource, 'e1');

  const moved = applySetupBoardPress(selected, 'e2');
  assert.deepEqual(moved.setup.pieces, [
    { color: 'white', role: 'king', square: 'e2' },
  ]);
  assert.equal(moved.moveSource, undefined);

  const selectedAgain = applySetupBoardPress(moved, 'e2');
  const deselected = applySetupBoardPress(selectedAgain, 'e2');
  assert.equal(deselected.moveSource, undefined);
  assert.equal(deselected.setup, moved.setup);
});

test('the setup eraser removes one piece before it is cleared', () => {
  const setup = createSetup([
    { color: 'black', role: 'rook', square: 'a8' },
    { color: 'black', role: 'rook', square: 'h8' },
  ]);
  const erased = applySetupBoardPress(
    { setup, tool: 'erase', moveSource: undefined },
    'a8',
  );

  assert.deepEqual(erased.setup.pieces, [
    { color: 'black', role: 'rook', square: 'h8' },
  ]);
  assert.equal(erased.tool, undefined);
});

test('en-passant choices are derived from the position and side to move', () => {
  const whiteCanCapture = createSetup(
    [
      { color: 'white', role: 'pawn', square: 'c5' },
      { color: 'black', role: 'pawn', square: 'd5' },
    ],
    'white',
  );
  assert.deepEqual(enPassantCandidates(whiteCanCapture), ['d6']);

  const occupiedTarget = createSetup(
    [
      ...whiteCanCapture.pieces,
      { color: 'white', role: 'knight', square: 'd6' },
    ],
    'white',
  );
  assert.deepEqual(enPassantCandidates(occupiedTarget), []);

  const blackCanCapture = createSetup(
    [
      { color: 'black', role: 'pawn', square: 'e4' },
      { color: 'white', role: 'pawn', square: 'd4' },
    ],
    'black',
  );
  assert.deepEqual(enPassantCandidates(blackCanCapture), ['d3']);
});

function createSetup(
  pieces: PositionSetup['pieces'],
  sideToMove: PositionSetup['sideToMove'] = 'white',
): PositionSetup {
  return {
    pieces,
    sideToMove,
    castlingRights: {
      whiteKingSide: false,
      whiteQueenSide: false,
      blackKingSide: false,
      blackQueenSide: false,
    },
    halfmoveClock: 0,
    fullmoveNumber: 1,
  };
}
