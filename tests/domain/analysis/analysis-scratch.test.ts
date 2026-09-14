import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendAnalysisMove,
  clearAnalysisNote,
  currentAnalysisMoves,
  currentAnalysisState,
  moveAnalysisCursor,
  prepareAnalysisNote,
  startAnalysisScratch,
} from '../../../app/domain/analysis/index.ts';
import type {
  AppliedMove,
  ChessState,
} from '../../../app/domain/chess_graph/index.ts';

test('analysis scratch navigates without changing its stored line', () => {
  const root = state('root');
  const first = transition(root, 'e2', 'e4', 'e4', state('after-e4'));
  const second = transition(first.after, 'e7', 'e5', 'e5', state('after-e5'));
  let scratch = startAnalysisScratch('scratch-1', root);
  scratch = appendAnalysisMove(scratch, first);
  scratch = appendAnalysisMove(scratch, second);
  scratch = moveAnalysisCursor(scratch, 1);

  assert.equal(currentAnalysisState(scratch).fen, 'after-e4');
  assert.deepEqual(
    currentAnalysisMoves(scratch).map(({ san }) => san),
    ['e4'],
  );
  assert.equal(scratch.steps.length, 2);
  assert.equal(scratch.scratchRevision, 4);
});

test('a move behind the cursor replaces the transient tail', () => {
  const root = state('root');
  const first = transition(root, 'e2', 'e4', 'e4', state('after-e4'));
  const oldTail = transition(first.after, 'e7', 'e5', 'e5', state('after-e5'));
  const newTail = transition(first.after, 'c7', 'c5', 'c5', state('after-c5'));
  let scratch = appendAnalysisMove(
    appendAnalysisMove(startAnalysisScratch('scratch-1', root), first),
    oldTail,
  );
  scratch = appendAnalysisMove(moveAnalysisCursor(scratch, 1), newTail);

  assert.equal(scratch.steps.length, 2);
  assert.deepEqual(
    scratch.steps.map(({ move }) => move.san),
    ['e4', 'c5'],
  );
  assert.equal(currentAnalysisState(scratch).fen, 'after-c5');
});

test('preparing a note copies the current path without consuming scratch', () => {
  const root = state('root');
  let scratch = startAnalysisScratch('scratch-1', root);
  scratch = appendAnalysisMove(
    scratch,
    transition(root, 'g1', 'f3', 'Nf3', state('after-nf3')),
  );
  const prepared = prepareAnalysisNote(scratch, 'Candidate line');

  assert.deepEqual(prepared.noteDraft, {
    body: 'Candidate line',
    moves: [{ from: 'g1', to: 'f3', san: 'Nf3' }],
  });
  assert.equal(prepared.steps.length, 1);
  assert.equal(prepared.cursor, 1);
  assert.equal(scratch.noteDraft, undefined);
});

test('clearing a prepared note keeps the explored path intact', () => {
  const root = state('root');
  const scratch = appendAnalysisMove(
    startAnalysisScratch('scratch-1', root),
    transition(root, 'g1', 'f3', 'Nf3', state('after-nf3')),
  );
  const prepared = prepareAnalysisNote(scratch, 'Candidate line');
  const cleared = clearAnalysisNote(prepared);

  assert.equal(cleared.noteDraft, undefined);
  assert.deepEqual(
    cleared.steps.map(({ move }) => move.san),
    ['Nf3'],
  );
  assert.equal(cleared.cursor, 1);
  assert.equal(cleared.scratchRevision, prepared.scratchRevision + 1);
});

function state(fen: string): ChessState {
  return {
    fen,
    position: {
      ruleSetId: 'standardChess',
      boardKey: '.'.repeat(64),
      sideToMove: 'white',
      castlingRights: {
        whiteKingSide: false,
        whiteQueenSide: false,
        blackKingSide: false,
        blackQueenSide: false,
      },
      effectiveEnPassantSquare: -1,
      positionKey: fen,
    },
    playState: {
      halfmoveClock: 0,
      fullmoveNumber: 1,
      historyKnowledge: 'unknown',
    },
  };
}

function transition(
  before: ChessState,
  from: string,
  to: string,
  san: string,
  after: ChessState,
): AppliedMove {
  return { before, move: { from, to, san }, after };
}
