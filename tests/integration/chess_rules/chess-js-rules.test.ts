import assert from 'node:assert/strict';
import test from 'node:test';

import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

test('initial position is canonical and uses a1-to-h8 board order', () => {
  const rules = new ChessJsRulesAdapter();
  const state = rules.initialState();

  assert.equal(
    state.position.boardKey,
    'RNBQKBNRPPPPPPPP................................pppppppprnbqkbnr',
  );
  assert.equal(state.position.sideToMove, 'white');
  assert.deepEqual(state.position.castlingRights, {
    whiteKingSide: true,
    whiteQueenSide: true,
    blackKingSide: true,
    blackQueenSide: true,
  });
  assert.equal(state.position.effectiveEnPassantSquare, -1);
  assert.equal(state.playState.historyKnowledge, 'complete');
});

test('German, English and coordinate inputs produce the same canonical move', () => {
  const rules = new ChessJsRulesAdapter();
  const root = rules.initialState();
  const inputs = [
    { kind: 'notation', value: 'Sf3', locale: 'de-DE' },
    { kind: 'notation', value: 'Nf3', locale: 'en-GB' },
    { kind: 'coordinates', value: 'g1f3' },
  ] as const;
  const results = inputs.map((input) => rules.applyMove(root, [], input));

  for (const result of results) assert.equal(result.ok, true);
  const moves = results.map((result) => (result.ok ? result.value.move : null));
  assert.deepEqual(moves, [
    { from: 'g1', to: 'f3', san: 'Nf3' },
    { from: 'g1', to: 'f3', san: 'Nf3' },
    { from: 'g1', to: 'f3', san: 'Nf3' },
  ]);
});

test('FEN counters remain PlayState while ineffective en-passant is removed from Position', () => {
  const rules = new ChessJsRulesAdapter();
  const result = rules.parseFen(
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 7 12',
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.position.effectiveEnPassantSquare, -1);
  assert.equal(result.value.playState.halfmoveClock, 7);
  assert.equal(result.value.playState.fullmoveNumber, 12);
  assert.equal(result.value.playState.historyKnowledge, 'unknown');
});

test('illegal and malformed moves are distinguished without leaking library errors', () => {
  const rules = new ChessJsRulesAdapter();
  const root = rules.initialState();

  assert.deepEqual(
    rules.applyMove(root, [], { kind: 'coordinates', value: 'bad' }),
    { ok: false, reason: 'invalid_move_input' },
  );
  assert.deepEqual(
    rules.applyMove(root, [], { kind: 'coordinates', value: 'e2e5' }),
    { ok: false, reason: 'illegal_move' },
  );
  assert.deepEqual(rules.parseFen('not a fen'), {
    ok: false,
    reason: 'invalid_fen',
  });
});
