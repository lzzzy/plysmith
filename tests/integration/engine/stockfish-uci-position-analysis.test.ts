import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import {
  createStockfishUciRuntime,
  StockfishUciMovePolicyAdapter,
  StockfishUciPositionAnalysisAdapter,
} from '../../../app/infrastructure/adapters/engine/index.ts';
import { LineProcessSupervisor } from '../../../app/infrastructure/adapters/process/index.ts';

const fakeEngine = fileURLToPath(
  new URL('../../fixtures/uci/fake-uci-engine.mjs', import.meta.url),
);
const rules = new ChessJsRulesAdapter();

test('maps Stockfish MultiPV, score, WDL, PV and search observations', async (t) => {
  const configuration = stockfishConfiguration();
  const runtime = createStockfishUciRuntime(
    configuration,
    new LineProcessSupervisor(),
  );
  t.after(() => runtime.close());
  const provider = new StockfishUciPositionAnalysisAdapter(
    configuration,
    runtime,
    rules,
  );
  const root = rules.initialState();

  const snapshot = await provider.analyze({
    candidateCount: 2,
    focus: { focusKey: 'initial', root, moves: [], current: root },
    mode: { kind: 'objective', budget: 'fast' },
  });

  assert.equal(snapshot.kind, 'objective');
  assert.equal(snapshot.budget, 'fast');
  assert.deepEqual(snapshot.rootWdl, {
    wins: 430,
    draws: 400,
    losses: 170,
    perspective: 'white',
    semantics: 'stockfish_selfplay',
  });
  assert.deepEqual(
    snapshot.candidates.map((candidate) => ({
      rank: candidate.rank,
      san: candidate.move.san,
      evaluation: candidate.evaluation,
      pv: candidate.principalVariation.map((move) => move.san),
    })),
    [
      {
        rank: 1,
        san: 'e4',
        evaluation: { kind: 'centipawns', value: 34, bound: 'exact' },
        pv: ['e4', 'e5', 'Nf3'],
      },
      {
        rank: 2,
        san: 'd4',
        evaluation: { kind: 'centipawns', value: 20, bound: 'exact' },
        pv: ['d4', 'd5', 'c4'],
      },
    ],
  );
  assert.deepEqual(snapshot.search, {
    limiter: { kind: 'movetime', value: 300 },
    depth: 12,
    selectiveDepth: 18,
    nodes: 12_000,
    elapsedMilliseconds: 200,
    nodesPerSecond: 60_000,
    hashfullPermille: 12,
    tablebaseHits: 0,
  });
});

test('restores playout options when analysis and play share one Stockfish runtime', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'plysmith-stockfish-analysis-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tracePath = path.join(directory, 'uci.trace');
  const configuration = stockfishConfiguration(tracePath);
  const runtime = createStockfishUciRuntime(
    configuration,
    new LineProcessSupervisor(),
  );
  t.after(() => runtime.close());
  const analysis = new StockfishUciPositionAnalysisAdapter(
    configuration,
    runtime,
    rules,
  );
  const playout = new StockfishUciMovePolicyAdapter(configuration, runtime);
  const root = rules.initialState();

  await analysis.analyze({
    candidateCount: 2,
    focus: { focusKey: 'initial', root, moves: [], current: root },
    mode: { kind: 'objective', budget: 'fast' },
  });
  const e4 = rules.applyMove(root, [], {
    kind: 'coordinates',
    value: 'e2e4',
  });
  assert.equal(e4.ok, true);
  if (!e4.ok) throw new Error('Expected e4 to be legal.');
  const decision = await playout.chooseMove({
    root,
    moves: [e4.value.move],
    current: e4.value.after,
    decisionId: 1,
  });

  assert.equal(decision.move.san, 'e7e5');
  const trace = await readFile(tracePath, 'utf8');
  assert.equal(trace.match(/^argv /gm)?.length, 1);
  assert.match(trace, /^setoption name MultiPV value 2$/m);
  assert.match(trace, /^setoption name UCI_ShowWDL value true$/m);
  assert.match(trace, /^setoption name MultiPV value 1$/m);
  assert.match(trace, /^setoption name UCI_ShowWDL value false$/m);
  assert.match(trace, /^setoption name UCI_LimitStrength value false$/m);
});

function stockfishConfiguration(tracePath?: string) {
  return {
    instanceId: 'stockfish-test',
    displayName: 'Stockfish test',
    executablePath: process.execPath,
    arguments: [
      fakeEngine,
      'stockfish-analysis',
      ...(tracePath === undefined ? [] : [tracePath]),
    ],
    threads: 1,
    hashMb: 16,
    moveTimeMs: 10,
    startupTimeoutMs: 1_000,
    moveTimeoutMs: 1_000,
    stopTimeoutMs: 100,
    maxOutputBytes: 64_000,
  };
}
