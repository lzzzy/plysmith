import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { localId } from '../../../app/domain/identity/index.ts';
import {
  appendPolicyPlayoutMove,
  appendUserPlayoutMove,
  cancelPlayoutCompletion,
  completePlayoutDraft,
  createPlayoutDraft,
  pausePlayoutDraft,
  resumePlayoutDraft,
  retryPlayoutPolicy,
  stopPlayoutDraft,
} from '../../../app/domain/playout/index.ts';

const rules = new ChessJsRulesAdapter();

describe('PlayoutDraft', () => {
  it('moves from a user turn to one revision-protected policy decision', () => {
    const draft = createDraft('white');
    const userMove = apply(draft.root, [], 'e2e4');
    const waiting = appendUserPlayoutMove(draft, userMove);

    assert.equal(waiting.draftRevision, 2);
    assert.deepEqual(waiting.status, {
      kind: 'awaiting_policy',
      decisionId: 1,
    });

    const policyMove = apply(draft.root, [userMove.move], 'e7e5');
    const active = appendPolicyPlayoutMove(waiting, 1, policyMove);
    assert.equal(active.draftRevision, 3);
    assert.equal(active.status.kind, 'active');
    assert.equal(active.steps[1]?.actor, 'provider');
    assert.throws(() => appendPolicyPlayoutMove(waiting, 2, policyMove));
  });

  it('invalidates an old policy response on retry and pause-resume', () => {
    const draft = createDraft('black');
    assert.deepEqual(draft.status, {
      kind: 'awaiting_policy',
      decisionId: 1,
    });

    const retried = retryPlayoutPolicy(draft);
    assert.deepEqual(retried.status, {
      kind: 'awaiting_policy',
      decisionId: 2,
    });
    const paused = pausePlayoutDraft(retried);
    const resumed = resumePlayoutDraft(paused);
    assert.deepEqual(resumed.status, {
      kind: 'awaiting_policy',
      decisionId: 3,
    });
  });

  for (const playerSide of ['white', 'black'] as const) {
    it(`cancels completion to paused with ${playerSide} as player`, () => {
      const draft = createDraft(playerSide);
      const stopped = stopPlayoutDraft(draft);
      const cancelled = cancelPlayoutCompletion(stopped);

      assert.deepEqual(cancelled, {
        ...stopped,
        draftRevision: stopped.draftRevision + 1,
        status: { kind: 'paused' },
      });
      assert.equal(stopped.status.kind, 'stopped');
      assert.ok(Object.isFrozen(cancelled));
      const resumed = resumePlayoutDraft(cancelled);
      assert.deepEqual(
        resumed.status,
        playerSide === 'white'
          ? { kind: 'active' }
          : {
              kind: 'awaiting_policy',
              decisionId: stopped.decisionGeneration + 1,
            },
      );
    });
  }

  it('only cancels completion preparation, never an automatic terminal end', () => {
    const active = createDraft('white');
    const terminal = completePlayoutDraft(active, {
      reason: 'stalemate',
      outcome: { kind: 'draw', reason: 'stalemate' },
    });
    for (const draft of [
      active,
      createDraft('black'),
      pausePlayoutDraft(active),
      terminal,
    ]) {
      assert.throws(() => cancelPlayoutCompletion(draft));
    }
  });
});

function createDraft(playerSide: 'white' | 'black') {
  return createPlayoutDraft({
    draftId: localId('playout-draft', 1),
    origin: { kind: 'initial_position' },
    root: rules.initialState(),
    playerSide,
    policy: {
      capability: 'best_move',
      providerInstanceId: 'stockfish-main',
      providerFingerprint: 'stockfish-main:reference',
      providerType: 'stockfish-uci',
      providerDisplayName: 'Stockfish',
    },
  });
}

function apply(
  root: ReturnType<ChessJsRulesAdapter['initialState']>,
  moves: readonly { from: string; to: string; san: string }[],
  value: string,
) {
  const result = rules.applyMove(root, moves, {
    kind: 'coordinates',
    value,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected a legal move.');
  return result.value;
}
