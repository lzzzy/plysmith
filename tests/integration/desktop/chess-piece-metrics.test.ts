import assert from 'node:assert/strict';
import test from 'node:test';

import {
  notoChessPieceBaseline,
  prefersWindowsChessSymbols,
} from '../../../app/infrastructure/channels/ui/renderer/chess-piece-metrics.ts';

test('Noto chess piece baselines center each visible glyph contour', () => {
  assert.equal(notoChessPieceBaseline('♔'), 86.5);
  assert.equal(notoChessPieceBaseline('♗'), 84);
  assert.equal(notoChessPieceBaseline('♜'), 86);
  assert.equal(notoChessPieceBaseline('♟'), 88);
});

test('Windows keeps the preferred system chess symbols', () => {
  assert.equal(
    prefersWindowsChessSymbols(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    ),
    true,
  );
  assert.equal(
    prefersWindowsChessSymbols(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    ),
    false,
  );
  assert.equal(
    prefersWindowsChessSymbols(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    ),
    false,
  );
});
