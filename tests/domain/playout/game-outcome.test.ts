import assert from 'node:assert/strict';
import { test } from 'node:test';

import { localId } from '../../../app/domain/identity/index.ts';
import { createGameRecordDraft } from '../../../app/domain/inventory/index.ts';
import {
  createPlayoutDraft,
  completePlayoutDraft,
  stopPlayoutDraft,
  resolvePlayoutResult,
  validateGameResult,
  gameResultMatchesPlayout,
  type ManualGameResult,
  type GameOutcome,
  type GameResult,
} from '../../../app/domain/playout/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

const draft = createPlayoutDraft({
  draftId: localId('playout-draft', 1),
  origin: { kind: 'initial_position' },
  root: new ChessJsRulesAdapter().initialState(),
  playerSide: 'white',
  policy: {
    capability: 'best_move',
    providerInstanceId: 'test',
    providerFingerprint: 'test:v1',
    providerType: 'test-engine',
    providerDisplayName: 'Test engine',
  },
});
const stopped = stopPlayoutDraft(draft);
const choices: readonly [ManualGameResult, GameOutcome][] = [
  ['white_win', { kind: 'win', winner: 'white' }],
  ['black_win', { kind: 'win', winner: 'black' }],
  ['draw', { kind: 'draw' }],
  ['unfinished', { kind: 'unfinished' }],
];

test('resolves every manual result without modifying the stopped draft or inventing a reason', () => {
  for (const [selection, outcome] of choices) {
    const result = resolvePlayoutResult(stopped, selection);
    assert.deepEqual(result, { outcome, outcomeSource: 'manual' });
    assert.ok(gameResultMatchesPlayout(result, stopped));
    const game = createGameRecordDraft({
      ...stopped,
      ...result,
      displayName: 'Manual game',
      languageTag: 'en-GB',
      provider: {
        providerType: 'test-engine',
        providerDisplayName: 'Test engine',
      },
    });
    assert.deepEqual(game.outcome, outcome);
    assert.equal(game.outcomeSource, 'manual');
    assert.ok(Object.isFrozen(game.outcome));
  }
  assert.deepEqual(stopped.status, {
    kind: 'stopped',
    outcome: { kind: 'unfinished' },
  });
});

test('requires an explicit manual selection and rejects selections on unfinished active play', () => {
  assert.throws(() => resolvePlayoutResult(stopped));
  assert.throws(() =>
    resolvePlayoutResult(stopped, 'checkmate' as ManualGameResult),
  );
  for (const [selection] of choices)
    assert.throws(() => resolvePlayoutResult(draft, selection));
});

test('keeps automatic results immutable and preserves each rules-based draw reason', () => {
  const terminals = [
    completePlayoutDraft(draft, {
      reason: 'checkmate',
      outcome: { kind: 'win', winner: 'black' },
    }),
    ...(
      [
        'stalemate',
        'insufficient_material',
        'threefold_repetition',
        'seventy_five_move',
      ] as const
    ).map((reason) =>
      completePlayoutDraft(draft, {
        reason,
        outcome: { kind: 'draw', reason },
      }),
    ),
  ];
  for (const terminal of terminals) {
    assert.equal(terminal.status.kind, 'terminal');
    if (terminal.status.kind !== 'terminal') assert.fail();
    const result = resolvePlayoutResult(terminal);
    assert.deepEqual(result, {
      outcome: terminal.status.outcome,
      outcomeSource: 'automatic',
    });
    assert.ok(gameResultMatchesPlayout(result, terminal));
    for (const [selection] of choices)
      assert.throws(() => resolvePlayoutResult(terminal, selection));
    assert.equal(
      gameResultMatchesPlayout(
        { outcome: terminal.status.outcome, outcomeSource: 'manual' },
        terminal,
      ),
      false,
    );
  }
});

test('rejects invented or contradictory result provenance', () => {
  const invalid: readonly unknown[] = [
    { outcomeSource: 'manual', outcome: { kind: 'draw', reason: 'stalemate' } },
    {
      outcomeSource: 'manual',
      outcome: { kind: 'win', winner: 'white', reason: 'checkmate' },
    },
    { outcomeSource: 'automatic', outcome: { kind: 'draw' } },
    { outcomeSource: 'automatic', outcome: { kind: 'unfinished' } },
    { outcomeSource: 'manual', outcome: { kind: 'win', winner: 'other' } },
    { outcomeSource: 'manual', outcome: { kind: 'draw', winner: 'white' } },
  ];
  for (const result of invalid)
    assert.throws(() => validateGameResult(result as GameResult));
  assert.equal(
    gameResultMatchesPlayout(
      { outcome: { kind: 'win', winner: 'white' }, outcomeSource: 'automatic' },
      stopped,
    ),
    false,
  );
  assert.throws(() =>
    resolvePlayoutResult(
      completePlayoutDraft(draft, {
        reason: 'checkmate',
        outcome: { kind: 'draw', reason: 'stalemate' },
      }),
    ),
  );
});
