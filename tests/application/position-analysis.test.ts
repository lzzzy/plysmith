import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ActivePositionAnalysisLanes,
  AnalyzePosition,
  PositionAnalysisProviderError,
  type PositionAnalysisProvider,
  type PositionAnalysisProviderRequest,
} from '../../app/application/analysis/index.ts';
import { ApplicationProblem } from '../../app/application/problems/application-problem.ts';
import { ChessJsRulesAdapter } from '../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { ConfiguredPositionAnalysisRegistry } from '../../app/infrastructure/adapters/engine/index.ts';

const rules = new ChessJsRulesAdapter();

test('analyzes the exact visible position and preserves its focus key', async () => {
  const root = rules.initialState();
  const e4 = rules.applyMove(root, [], {
    kind: 'coordinates',
    value: 'e2e4',
  });
  assert.equal(e4.ok, true);
  if (!e4.ok) throw new Error('Expected e4 to be legal.');
  let received: PositionAnalysisProviderRequest | undefined;
  const provider = objectiveProvider(async (request) => {
    received = request;
    return objectiveSnapshot(request.focus.focusKey);
  });
  const useCase = analyzePosition(provider);

  const result = await useCase.execute({
    consumerId: 'desktop-test',
    laneId: 'objective',
    providerInstanceId: provider.descriptor.instanceId,
    candidateCount: 3,
    focus: {
      focusKey: 'visible-e4',
      root,
      moves: [e4.value.move],
      current: e4.value.after,
    },
    mode: { kind: 'objective', budget: 'fast' },
  });

  assert.equal(result.focusKey, 'visible-e4');
  assert.equal(received?.focus.current.fen, e4.value.after.fen);
  assert.deepEqual(received?.focus.moves, [e4.value.move]);
});

test('replaces an older request in the same consumer lane', async () => {
  const root = rules.initialState();
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const provider = objectiveProvider((request, signal) => {
    if (request.focus.focusKey === 'new-focus') {
      return Promise.resolve(objectiveSnapshot('new-focus'));
    }
    markStarted?.();
    return new Promise((_, reject) => {
      signal?.addEventListener(
        'abort',
        () => reject(new PositionAnalysisProviderError('interrupted')),
        { once: true },
      );
    });
  });
  const useCase = analyzePosition(provider);
  const request = {
    consumerId: 'desktop-test',
    laneId: 'objective',
    providerInstanceId: provider.descriptor.instanceId,
    candidateCount: 3,
    focus: { focusKey: 'old-focus', root, moves: [], current: root },
    mode: { kind: 'objective' as const, budget: 'fast' as const },
  };

  const oldAnalysis = useCase.execute(request);
  await started;
  const newAnalysis = useCase.execute({
    ...request,
    focus: { ...request.focus, focusKey: 'new-focus' },
  });

  await assert.rejects(
    oldAnalysis,
    (error: unknown) =>
      error instanceof ApplicationProblem &&
      error.problemCode === 'analysis.position_interrupted',
  );
  assert.equal((await newAnalysis).focusKey, 'new-focus');
});

test('rejects a focus whose move history does not reach the current state', async () => {
  const root = rules.initialState();
  const provider = objectiveProvider(async (request) =>
    objectiveSnapshot(request.focus.focusKey),
  );

  await assert.rejects(
    analyzePosition(provider).execute({
      consumerId: 'desktop-test',
      laneId: 'objective',
      providerInstanceId: provider.descriptor.instanceId,
      candidateCount: 3,
      focus: {
        focusKey: 'invalid-focus',
        root,
        moves: [],
        current: { ...root, fen: root.fen.replace(' w ', ' b ') },
      },
      mode: { kind: 'objective', budget: 'fast' },
    }),
    (error: unknown) =>
      error instanceof ApplicationProblem &&
      error.problemCode === 'analysis.position_invalid_focus',
  );
});

function analyzePosition(provider: PositionAnalysisProvider): AnalyzePosition {
  return new AnalyzePosition({
    rules,
    providers: new ConfiguredPositionAnalysisRegistry([provider]),
    lanes: new ActivePositionAnalysisLanes(),
  });
}

function objectiveProvider(
  analyze: PositionAnalysisProvider['analyze'],
): PositionAnalysisProvider {
  return {
    descriptor: {
      instanceId: 'stockfish-test',
      providerType: 'stockfish-uci',
      displayName: 'Stockfish test',
      capability: 'objective_position_analysis',
      readiness: 'ready',
      status: 'available',
    },
    analyze,
  };
}

function objectiveSnapshot(focusKey: string) {
  return {
    kind: 'objective' as const,
    perspective: 'white' as const,
    focusKey,
    providerInstanceId: 'stockfish-test',
    providerDisplayName: 'Stockfish test',
    historyCompleteness: 'complete' as const,
    budget: 'fast' as const,
    candidates: [],
    search: { limiter: { kind: 'movetime' as const, value: 300 } },
  };
}

test('validates restricted root moves before calling the provider', async () => {
  const root = rules.initialState();
  const legal = rules.legalMoves(root, []);
  if (!legal.ok) throw new Error('Expected legal moves.');
  const first = legal.value[0]!;
  let calls = 0;
  const provider = objectiveProvider(async (request) => {
    calls += 1;
    return objectiveSnapshot(request.focus.focusKey);
  });
  const execute = analyzePosition(provider);
  const base = {
    consumerId: 'test',
    laneId: 'objective',
    providerInstanceId: provider.descriptor.instanceId,
    candidateCount: 8,
    focus: { focusKey: 'root', root, moves: [], current: root },
  };
  for (const rootMoves of [
    [],
    [first, first],
    legal.value.slice(0, 9),
    [{ ...first, san: 'wrong' }],
    [{ ...first, to: first.from }],
  ]) {
    await assert.rejects(
      execute.execute({
        ...base,
        mode: { kind: 'objective', budget: 'fast', rootMoves },
      }),
      (error: unknown) =>
        error instanceof ApplicationProblem &&
        error.problemCode === 'analysis.position_invalid_request',
    );
  }
  assert.equal(calls, 0);
  await execute.execute({
    ...base,
    mode: {
      kind: 'objective',
      budget: 'fast',
      rootMoves: legal.value.slice(0, 8),
    },
  });
  assert.equal(calls, 1);
});
