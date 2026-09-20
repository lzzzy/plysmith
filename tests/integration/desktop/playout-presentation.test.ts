import assert from 'node:assert/strict';
import test from 'node:test';

import { playoutMoveRows } from '../../../app/infrastructure/channels/ui/renderer/playout-presentation.ts';

test('numbers and localizes playout moves from an arbitrary black-to-move root', () => {
  assert.deepEqual(
    playoutMoveRows(
      {
        position: { sideToMove: 'black' },
        playState: { fullmoveNumber: 3 },
      },
      [
        { move: { san: 'c5' } },
        { move: { san: 'Nf3' } },
        { move: { san: 'Nc6' } },
      ],
      'de-DE',
    ),
    [
      { moveNumber: 3, black: { notation: 'c5', ply: 1 } },
      {
        moveNumber: 4,
        white: { notation: 'Sf3', ply: 2 },
        black: { notation: 'Sc6', ply: 3 },
      },
    ],
  );

  assert.equal(
    playoutMoveRows(
      {
        position: { sideToMove: 'white' },
        playState: { fullmoveNumber: 1 },
      },
      [{ move: { san: 'Nf3' } }],
      'en-GB',
    )[0]?.white?.notation,
    'Nf3',
  );
});
