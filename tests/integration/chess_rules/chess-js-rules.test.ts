import assert from 'node:assert/strict';
import test from 'node:test';

import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import type { CanonicalMove } from '../../../app/domain/chess_graph/index.ts';

test('terminal status is derived from the rules rather than an engine', () => {
  const rules = new ChessJsRulesAdapter();
  const root = rules.initialState();
  const moves: CanonicalMove[] = [];
  for (const value of ['f2f3', 'e7e5', 'g2g4', 'd8h4']) {
    const applied = rules.applyMove(root, moves, {
      kind: 'coordinates',
      value,
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) throw new Error('Expected a legal move.');
    moves.push(applied.value.move);
  }

  assert.deepEqual(rules.gameStatus(root, moves), {
    ok: true,
    value: { kind: 'terminal', reason: 'checkmate', winner: 'black' },
  });
});

test('threefold repetition is recognized from the played position history', () => {
  const rules = new ChessJsRulesAdapter();
  const root = rules.initialState();
  const moves: CanonicalMove[] = [];
  for (const value of [
    'g1f3',
    'g8f6',
    'f3g1',
    'f6g8',
    'g1f3',
    'g8f6',
    'f3g1',
    'f6g8',
  ]) {
    const applied = rules.applyMove(root, moves, {
      kind: 'coordinates',
      value,
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) throw new Error('Expected a legal move.');
    moves.push(applied.value.move);
  }

  assert.deepEqual(rules.gameStatus(root, moves), {
    ok: true,
    value: { kind: 'terminal', reason: 'threefold_repetition' },
  });
});

test('threefold repetition ignores an ineffective en-passant square', () => {
  const rules = new ChessJsRulesAdapter();
  const parsed = rules.parseFen('4k3/8/8/8/4p3/8/3P4/K3R3 w - - 0 1');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error('Expected a valid position.');
  const root = parsed.value;
  const moves: CanonicalMove[] = [];
  for (const value of [
    'd2d4',
    'e8f8',
    'a1b1',
    'f8e8',
    'b1a1',
    'e8f8',
    'a1b1',
    'f8e8',
    'b1a1',
  ]) {
    const applied = rules.applyMove(root, moves, {
      kind: 'coordinates',
      value,
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) throw new Error('Expected a legal move.');
    moves.push(applied.value.move);
  }

  assert.deepEqual(rules.gameStatus(root, moves), {
    ok: true,
    value: { kind: 'terminal', reason: 'threefold_repetition' },
  });
});

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

test('a structured setup becomes one canonical state with unknown history', () => {
  const rules = new ChessJsRulesAdapter();
  const result = rules.validateSetup({
    pieces: [
      { square: 'e8', color: 'black', role: 'king' },
      { square: 'e1', color: 'white', role: 'king' },
      { square: 'a1', color: 'white', role: 'rook' },
    ],
    sideToMove: 'black',
    castlingRights: {
      whiteKingSide: false,
      whiteQueenSide: true,
      blackKingSide: false,
      blackQueenSide: false,
    },
    halfmoveClock: 7,
    fullmoveNumber: 12,
  });

  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(
    result.setup.pieces.map((piece) => piece.square),
    ['a1', 'e1', 'e8'],
  );
  assert.equal(result.state.fen, '4k3/8/8/8/8/8/8/R3K3 b Q - 7 12');
  assert.equal(result.state.playState.historyKnowledge, 'unknown');
});

test('structured setup problems are stable and field related', () => {
  const rules = new ChessJsRulesAdapter();
  const result = rules.validateSetup({
    pieces: [
      { square: 'e1', color: 'white', role: 'king' },
      { square: 'e8', color: 'black', role: 'king' },
      { square: 'e2', color: 'white', role: 'pawn' },
      { square: 'e2', color: 'black', role: 'pawn' },
      { square: 'a8', color: 'white', role: 'pawn' },
    ],
    sideToMove: 'white',
    castlingRights: {
      whiteKingSide: true,
      whiteQueenSide: false,
      blackKingSide: false,
      blackQueenSide: false,
    },
    enPassantSquare: 'e3',
    halfmoveClock: -1,
    fullmoveNumber: 0,
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    [
      'duplicate_square',
      'pawn_on_back_rank',
      'invalid_castling_rights',
      'invalid_en_passant_square',
      'invalid_halfmove_clock',
      'invalid_fullmove_number',
    ],
  );
});
