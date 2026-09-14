import assert from 'node:assert/strict';
import test from 'node:test';

import {
  localizeSan,
  parseFenBoard,
  pieceName,
} from '../../../app/infrastructure/channels/ui/renderer/chess-display.ts';

test('FEN board projection keeps square, colour and piece semantics', () => {
  const board = parseFenBoard(
    'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1',
  );

  assert.deepEqual(board.get('f3'), {
    colour: 'white',
    kind: 'knight',
    symbol: '♘',
  });
  assert.equal(pieceName(board.get('f3')!, 'de-DE'), 'Weiß Springer');
  assert.equal(pieceName(board.get('a8')!, 'en-GB'), 'Black rook');
  assert.equal(board.has('g1'), false);
});

test('visible SAN is localized without changing coordinates or castling', () => {
  assert.equal(localizeSan('Nf3', 'de-DE'), 'Sf3');
  assert.equal(localizeSan('Bxc6+', 'de-DE'), 'Lxc6+');
  assert.equal(localizeSan('e8=Q+', 'de-DE'), 'e8=D+');
  assert.equal(localizeSan('O-O', 'de-DE'), 'O-O');
  assert.equal(localizeSan('Nf3', 'en-GB'), 'Nf3');
});
