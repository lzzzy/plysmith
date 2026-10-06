import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FairPlayGate,
  fairPlayUseCase,
} from '../../app/application/live/fair-play-gate.ts';
import {
  fairPlayMovePolicies,
  fairPlayPositionAnalyses,
} from '../../app/application/live/fair-play-providers.ts';
import { ApplicationProblem } from '../../app/application/problems/application-problem.ts';
import type { PositionAnalysisProvider } from '../../app/application/analysis/position-analysis.ts';
import type { MovePolicyProvider } from '../../app/application/playout/playout-ports.ts';
import { ChessJsRulesAdapter } from '../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

const blocked = (error: unknown) =>
  error instanceof ApplicationProblem &&
  error.problemCode === 'live.fair_play_blocked';
const root = new ChessJsRulesAdapter().initialState();

test('fair play rejects assistance before invoking work', async () => {
  const gate = new FairPlayGate();
  gate.setBlocked(true);
  let calls = 0;
  await assert.rejects(
    gate.run(async () => ++calls),
    blocked,
  );
  assert.equal(calls, 0);
});

test('blocking aborts existing assistance and never releases a late result after unblocking', async () => {
  const gate = new FairPlayGate();
  let finish!: (value: number) => void;
  let signal!: AbortSignal;
  const pending = gate.run((received) => {
    signal = received;
    return new Promise<number>((resolve) => {
      finish = resolve;
    });
  });
  gate.setBlocked(true);
  assert.equal(signal.aborted, true);
  gate.setBlocked(false);
  finish(42);
  await assert.rejects(pending, blocked);
  assert.equal(await gate.run(async () => 7), 7);
});

test('both objective and human-policy providers use the host gate', async () => {
  const gate = new FairPlayGate();
  let calls = 0;
  for (const capability of [
    'objective_position_analysis',
    'human_policy_analysis',
  ] as const) {
    const provider: PositionAnalysisProvider = {
      descriptor: {
        instanceId: capability,
        providerType: 'test',
        displayName: 'Test',
        capability,
        readiness: 'ready',
        status: 'available',
      },
      analyze: async () => {
        calls++;
        throw new Error('Must not be called.');
      },
    };
    const registry = fairPlayPositionAnalyses(
      { list: () => [provider.descriptor], resolve: () => provider },
      gate,
    );
    const guarded = registry.resolve(capability, capability)!;
    assert.equal(guarded.descriptor, provider.descriptor);
    gate.setBlocked(true);
    await assert.rejects(
      guarded.analyze({
        candidateCount: 1,
        focus: { focusKey: 'test', root, current: root, moves: [] },
        mode: { kind: 'human_policy' },
      }),
      blocked,
    );
  }
  assert.equal(calls, 0);
});

test('local engine move policies cannot bypass the human-game gate', async () => {
  const gate = new FairPlayGate();
  let calls = 0;
  const provider: MovePolicyProvider = {
    descriptor: {
      instanceId: 'test',
      providerType: 'test',
      displayName: 'Test',
      fingerprint: 'test',
      capabilities: ['best_move'],
      readiness: 'ready',
      status: 'available',
    },
    chooseMove: async () => {
      calls++;
      throw new Error('Must not be called.');
    },
  };
  const registry = fairPlayMovePolicies(
    { list: () => [provider.descriptor], resolve: () => provider },
    gate,
  );
  gate.setBlocked(true);
  await assert.rejects(
    registry
      .resolve('test', 'best_move')!
      .chooseMove({ root, current: root, moves: [], decisionId: 1 }),
    blocked,
  );
  assert.equal(calls, 0);
});

test('the outer use-case gate protects asynchronous cached-work reads', async () => {
  const gate = new FairPlayGate();
  let finish!: () => void;
  const useCase = fairPlayUseCase(
    {
      execute: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { cached: true };
      },
    },
    gate,
  );
  const pending = useCase.execute();
  gate.setBlocked(true);
  finish();
  await assert.rejects(pending, blocked);
});
