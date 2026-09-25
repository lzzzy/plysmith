import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from '@sinclair/typebox/value';

import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import {
  AnalyzePositionArgumentsSchema,
  PositionAnalysisSnapshotSchema,
} from '../../../app/infrastructure/channels/mcp/schemas.ts';

test('MCP contracts accept bounded objective root moves and explicit score perspective', () => {
  const root = new ChessJsRulesAdapter().initialState();
  const move = { from: 'e2', to: 'e4', san: 'e4' };
  const request = {
    consumerId: 'test',
    laneId: 'objective',
    providerInstanceId: 'test',
    candidateCount: 1,
    focus: { focusKey: 'root', root, current: root, moves: [] },
    mode: { kind: 'objective', budget: 'fast', rootMoves: [move] },
  };
  assert.equal(Value.Check(AnalyzePositionArgumentsSchema, request), true);
  for (const rootMoves of [
    [],
    Array.from({ length: 9 }, () => move),
    [{ ...move, from: 'z9' }],
  ]) {
    assert.equal(
      Value.Check(AnalyzePositionArgumentsSchema, {
        ...request,
        mode: { ...request.mode, rootMoves },
      }),
      false,
    );
  }
  assert.equal(
    Value.Check(AnalyzePositionArgumentsSchema, {
      ...request,
      mode: { kind: 'human_policy', rootMoves: [move] },
    }),
    false,
  );
  const snapshot = {
    kind: 'objective',
    perspective: 'black',
    focusKey: 'root',
    providerInstanceId: 'test',
    providerDisplayName: 'test',
    historyCompleteness: 'complete',
    budget: 'fast',
    candidates: [],
    search: { limiter: { kind: 'movetime', value: 300 } },
  };
  assert.equal(Value.Check(PositionAnalysisSnapshotSchema, snapshot), true);
  assert.equal(
    Value.Check(PositionAnalysisSnapshotSchema, {
      ...snapshot,
      perspective: undefined,
    }),
    false,
  );
});
