import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analysisMoveKey,
  groupAnalysisMoves,
  whiteEvaluation,
  whiteWdl,
  type HumanSnapshot,
  type ObjectiveCandidate,
  type ObjectiveSnapshot,
} from '../../../app/infrastructure/channels/ui/renderer/position-analysis-groups.ts';

const knight = { from: 'g1', to: 'f3', san: 'Sf3' };
const pawn = { from: 'd2', to: 'd4', san: 'd4' };
const bishop = { from: 'f1', to: 'c4', san: 'Lc4' };

function objectiveCandidate(
  move: ObjectiveCandidate['move'],
  rank: number,
  value: number,
): ObjectiveCandidate {
  return {
    rank,
    move,
    evaluation: { kind: 'centipawns', value, bound: 'exact' },
    principalVariation: [move],
  };
}

function objective(
  candidates: readonly ObjectiveCandidate[],
): ObjectiveSnapshot {
  return {
    kind: 'objective',
    focusKey: 'focus',
    providerInstanceId: 'stockfish',
    providerDisplayName: 'Stockfish',
    historyCompleteness: 'complete',
    perspective: 'white',
    budget: 'fast',
    candidates: [...candidates],
    search: { limiter: { kind: 'movetime', value: 300 } },
  };
}

function human(
  providerInstanceId: string,
  candidates: ReadonlyArray<{
    move: HumanSnapshot['candidates'][number]['move'];
    percent: number;
  }>,
): HumanSnapshot {
  return {
    kind: 'human_policy',
    focusKey: 'focus',
    providerInstanceId,
    providerDisplayName: providerInstanceId,
    historyCompleteness: 'complete',
    profileName: providerInstanceId,
    modelName: 'maia.pb.gz',
    candidates: candidates.map(({ move, percent }, index) => ({
      rank: index + 1,
      move,
      policyPercent: percent,
      wdl: {
        wins: 300,
        draws: 400,
        losses: 300,
        perspective: 'white',
        semantics: 'human_outcome',
      },
    })),
  };
}

test('grouping preserves every Stockfish move across Maia sorts', () => {
  const stockfish = objective([
    objectiveCandidate(knight, 1, 50),
    objectiveCandidate(pawn, 2, 30),
  ]);
  const profiles = new Map([
    ['maia-a', human('maia-a', [{ move: bishop, percent: 40 }])],
    ['maia-b', human('maia-b', [{ move: pawn, percent: 25 }])],
  ]);
  const additional = [objectiveCandidate(bishop, 1, 15)];
  const byStockfish = groupAnalysisMoves(
    stockfish,
    additional,
    profiles,
    'stockfish',
  );
  const byMaia = groupAnalysisMoves(stockfish, additional, profiles, 'maia-a');

  assert.deepEqual(
    byStockfish.map((group) => group.move.san),
    ['Sf3', 'd4', 'Lc4'],
  );
  assert.deepEqual(
    byMaia.map((group) => group.move.san),
    ['Lc4', 'Sf3', 'd4'],
  );
  assert.ok(byMaia.every((group) => group.objective !== undefined));
  assert.equal(byMaia[1]?.human.size, 0);
});

test('switching Maia profiles sorts shared moves by the selected policy', () => {
  const stockfish = objective([
    objectiveCandidate(knight, 1, 50),
    objectiveCandidate(pawn, 2, 30),
    objectiveCandidate(bishop, 3, 10),
  ]);
  const profiles = new Map([
    [
      'maia-a',
      human('maia-a', [
        { move: pawn, percent: 60 },
        { move: bishop, percent: 25 },
        { move: knight, percent: 15 },
      ]),
    ],
    [
      'maia-b',
      human('maia-b', [
        { move: bishop, percent: 50 },
        { move: knight, percent: 35 },
        { move: pawn, percent: 15 },
      ]),
    ],
  ]);
  const order = (sortBy: string) =>
    groupAnalysisMoves(stockfish, [], profiles, sortBy).map(
      (group) => group.move.san,
    );

  assert.deepEqual(order('stockfish'), ['Sf3', 'd4', 'Lc4']);
  assert.deepEqual(order('maia-a'), ['d4', 'Lc4', 'Sf3']);
  assert.deepEqual(order('maia-b'), ['Lc4', 'Sf3', 'd4']);
});

test('canonical move identity distinguishes promotions and joins matching moves', () => {
  assert.notEqual(
    analysisMoveKey({ from: 'a7', to: 'a8', promotion: 'queen' }),
    analysisMoveKey({ from: 'a7', to: 'a8', promotion: 'knight' }),
  );
  const stockfish = objective([objectiveCandidate(knight, 1, 45)]);
  const profiles = new Map([
    ['maia-a', human('maia-a', [{ move: knight, percent: 35 }])],
  ]);
  const groups = groupAnalysisMoves(stockfish, [], profiles, 'stockfish');
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.human.get('maia-a')?.policyPercent, 35);
});

test('white display reverses black score bounds, mate and WDL only', () => {
  assert.deepEqual(
    whiteEvaluation({ kind: 'centipawns', value: 60, bound: 'lower' }, 'black'),
    { kind: 'centipawns', value: -60, bound: 'upper' },
  );
  assert.deepEqual(
    whiteEvaluation({ kind: 'mate', moves: 3, bound: 'exact' }, 'black'),
    { kind: 'mate', moves: -3, bound: 'exact' },
  );
  assert.deepEqual(
    whiteWdl({ wins: 700, draws: 200, losses: 100, perspective: 'black' }),
    { wins: 100, draws: 200, losses: 700 },
  );
});
