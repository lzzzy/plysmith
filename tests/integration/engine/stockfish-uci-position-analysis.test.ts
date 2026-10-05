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
  type StockfishUciConfiguration,
} from '../../../app/infrastructure/adapters/engine/index.ts';
import {
  LineProcessSupervisor,
  type LineProcessHandle,
} from '../../../app/infrastructure/adapters/process/index.ts';

const fakeEngine = fileURLToPath(
  new URL('../../fixtures/uci/fake-uci-engine.mjs', import.meta.url),
);
const rules = new ChessJsRulesAdapter();

test('shared custom detail levels drive analysis and playout commands with sufficient search deadlines', async (t) => {
  const commands: string[] = [];
  const searchTimeouts: number[] = [];
  let activeSearchBudget: number | undefined;
  const supervisor = new (class extends LineProcessSupervisor {
    override async open(): Promise<LineProcessHandle> {
      const responses: string[] = [];
      return {
        processId: 1,
        session: {
          writeLine(line) {
            commands.push(line);
            if (line === 'uci')
              responses.push(
                'option name Threads type spin default 1 min 1 max 8',
                'option name Hash type spin default 16 min 1 max 128',
                'option name MultiPV type spin default 1 min 1 max 8',
                'option name UCI_ShowWDL type check default false',
                'option name UCI_LimitStrength type check default false',
                'uciok',
              );
            if (line === 'isready') responses.push('readyok');
            if (line.startsWith('go movetime ')) {
              activeSearchBudget = Number(line.split(' ')[2]);
              responses.push(
                'info depth 10 multipv 1 score cp 25 wdl 350 500 150 pv e2e4',
                'bestmove e2e4',
              );
            }
          },
          async readLine(timeoutMs) {
            if (activeSearchBudget !== undefined) {
              assert.ok(
                timeoutMs > activeSearchBudget,
                `Search ${activeSearchBudget} received only ${timeoutMs} ms`,
              );
              searchTimeouts.push(timeoutMs);
            }
            const line = responses.shift();
            if (line === undefined) throw new Error('No response queued.');
            if (line.startsWith('bestmove')) activeSearchBudget = undefined;
            return line;
          },
          resetOutputBudget() {},
        },
        waitForExit: async () => true,
        terminate: async () => undefined,
      };
    }
  })();
  const configuration: StockfishUciConfiguration = {
    ...stockfishConfiguration(),
    detailLevels: { fast: 12_000, thorough: 23_456, very_deep: 600_000 },
    playoutBudget: 'thorough',
    moveTimeoutMs: 10_000,
  };
  const runtime = createStockfishUciRuntime(configuration, supervisor);
  t.after(() => runtime.close());
  const guardedRuntime = {
    get readiness() {
      return runtime.readiness;
    },
    use: ((work, options) => {
      assert.ok(
        options.waitTimeoutMs > 600_000,
        'A queued request must allow the longest configured search to finish.',
      );
      return runtime.use(work, options);
    }) as typeof runtime.use,
    close: () => runtime.close(),
  };
  const analysis = new StockfishUciPositionAnalysisAdapter(
    configuration,
    guardedRuntime,
    rules,
  );
  const root = rules.initialState();
  for (const budget of ['fast', 'thorough', 'very_deep'] as const) {
    const snapshot = await analysis.analyze({
      candidateCount: 1,
      focus: { focusKey: 'initial', root, moves: [], current: root },
      mode: { kind: 'objective', budget },
    });
    assert.equal(
      snapshot.search.limiter.value,
      configuration.detailLevels[budget],
    );
    const playout = new StockfishUciMovePolicyAdapter(
      { ...configuration, playoutBudget: budget },
      guardedRuntime,
    );
    await playout.chooseMove({ root, moves: [], current: root, decisionId: 1 });
  }
  assert.deepEqual(
    commands.filter((line) => line.startsWith('go ')),
    [
      'go movetime 12000',
      'go movetime 12000',
      'go movetime 23456',
      'go movetime 23456',
      'go movetime 600000',
      'go movetime 600000',
    ],
  );
  assert.ok(searchTimeouts.length >= 6);
});

test('uses the last complete MultiPV pass with distinct root moves', async (t) => {
  const info = (depth: number, rank: number, move: string) =>
    `info depth ${depth} multipv ${rank} score cp ${depth} wdl ${depth} 500 ${500 - depth} pv ${move}`;
  const complete = [info(10, 1, 'e2e4'), info(10, 2, 'd2d4')];
  for (const [name, later, expected, depth] of [
    ['incomplete deeper pass', [info(11, 1, 'd2d4')], ['e4', 'd4'], 10],
    [
      'duplicate roots',
      [info(11, 1, 'd2d4'), info(11, 2, 'd2d4')],
      ['e4', 'd4'],
      10,
    ],
    [
      'mixed depths',
      [info(11, 1, 'd2d4'), info(10, 2, 'e2e4')],
      ['e4', 'd4'],
      10,
    ],
    ['same-depth incomplete pass', [info(10, 1, 'd2d4')], ['e4', 'd4'], 10],
    [
      'complete deeper pass',
      [info(11, 1, 'd2d4'), info(11, 2, 'e2e4')],
      ['d4', 'e4'],
      11,
    ],
  ] as const) {
    await t.test(name, async (subtest) => {
      const supervisor = new (class extends LineProcessSupervisor {
        override async open(): Promise<LineProcessHandle> {
          const responses: string[] = [];
          return {
            processId: 1,
            session: {
              writeLine(line) {
                if (line === 'uci')
                  responses.push(
                    'option name Threads type spin default 1 min 1 max 8',
                    'option name Hash type spin default 16 min 1 max 128',
                    'option name MultiPV type spin default 1 min 1 max 8',
                    'option name UCI_ShowWDL type check default false',
                    'option name UCI_LimitStrength type check default false',
                    'uciok',
                  );
                if (line === 'isready') responses.push('readyok');
                if (line.startsWith('go '))
                  responses.push(...complete, ...later, 'bestmove d2d4');
              },
              async readLine() {
                const line = responses.shift();
                if (line === undefined) throw new Error('No response queued.');
                return line;
              },
              resetOutputBudget() {},
            },
            waitForExit: async () => true,
            terminate: async () => undefined,
          };
        }
      })();
      const configuration = stockfishConfiguration();
      const runtime = createStockfishUciRuntime(configuration, supervisor);
      subtest.after(() => runtime.close());
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
      assert.deepEqual(
        snapshot.candidates.map((candidate) => candidate.move.san),
        expected,
      );
      assert.equal(snapshot.search.depth, depth);
      assert.equal(snapshot.rootWdl?.wins, depth);
      for (const candidate of snapshot.candidates) {
        assert.deepEqual(candidate.evaluation, {
          kind: 'centipawns',
          value: depth,
          bound: 'exact',
        });
      }
    });
  }
});

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
  assert.equal(snapshot.perspective, 'white');
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
    limiter: { kind: 'movetime', value: 500 },
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
    detailLevels: { fast: 500, thorough: 10, very_deep: 5_000 },
    playoutBudget: 'thorough' as const,
    startupTimeoutMs: 1_000,
    moveTimeoutMs: 1_000,
    stopTimeoutMs: 100,
    maxOutputBytes: 64_000,
  };
}

test('restricted Stockfish search preserves black focus and exact history', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'plysmith-root-moves-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tracePath = path.join(directory, 'uci.trace');
  const configuration = stockfishConfiguration(tracePath);
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
  const e4 = rules.applyMove(root, [], { kind: 'coordinates', value: 'e2e4' });
  if (!e4.ok) throw new Error('Expected legal e4.');
  const c5 = rules.applyMove(root, [e4.value.move], {
    kind: 'coordinates',
    value: 'c7c5',
  });
  if (!c5.ok) throw new Error('Expected legal c5.');
  const snapshot = await provider.analyze({
    candidateCount: 5,
    focus: {
      focusKey: 'after-e4',
      root,
      moves: [e4.value.move],
      current: e4.value.after,
    },
    mode: { kind: 'objective', budget: 'fast', rootMoves: [c5.value.move] },
  });
  assert.equal(snapshot.focusKey, 'after-e4');
  assert.equal(snapshot.perspective, 'black');
  assert.equal(
    snapshot.historyCompleteness,
    e4.value.after.playState.historyKnowledge,
  );
  assert.deepEqual(
    snapshot.candidates.map((candidate) => candidate.move),
    [c5.value.move],
  );
  assert.deepEqual(snapshot.candidates[0]?.evaluation, {
    kind: 'centipawns',
    value: -73,
    bound: 'upper',
  });
  assert.deepEqual(snapshot.candidates[0]?.principalVariation, [c5.value.move]);
  assert.equal(snapshot.rootWdl?.perspective, 'black');
  const trace = await readFile(tracePath, 'utf8');
  assert.ok(trace.includes(`position fen ${root.fen} moves e2e4`));
  assert.match(trace, /^go movetime 500 searchmoves c7c5$/m);
  assert.match(trace, /^setoption name MultiPV value 1$/m);
  const unrestricted = await provider.analyze({
    candidateCount: 2,
    focus: { focusKey: 'initial-again', root, moves: [], current: root },
    mode: { kind: 'objective', budget: 'fast' },
  });
  assert.deepEqual(
    unrestricted.candidates.map((candidate) => candidate.move.san),
    ['e4', 'd4'],
  );
});

test('restricted root moves preserve distinct black promotions', async (t) => {
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
  const parsed = rules.parseFen('7k/8/8/8/8/8/6p1/K7 b - - 0 1');
  if (!parsed.ok) throw new Error('Expected promotion position.');
  const legal = rules.legalMoves(parsed.value, []);
  if (!legal.ok) throw new Error('Expected legal promotions.');
  const rootMoves = legal.value.filter(
    (move) => move.promotion === 'queen' || move.promotion === 'knight',
  );
  assert.equal(rootMoves.length, 2);
  const snapshot = await provider.analyze({
    candidateCount: 2,
    focus: {
      focusKey: 'promotions',
      root: parsed.value,
      current: parsed.value,
      moves: [],
    },
    mode: { kind: 'objective', budget: 'fast', rootMoves },
  });
  assert.deepEqual(
    snapshot.candidates.map((candidate) => candidate.move),
    rootMoves,
  );
  assert.equal(snapshot.perspective, 'black');
});

test('terminal objective positions return no invented score or engine search', async (t) => {
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
  for (const fen of [
    '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1',
    '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
  ]) {
    const state = rules.parseFen(fen);
    if (!state.ok) throw new Error('Expected legal terminal position.');
    const snapshot = await provider.analyze({
      candidateCount: 5,
      focus: {
        focusKey: fen,
        root: state.value,
        moves: [],
        current: state.value,
      },
      mode: { kind: 'objective', budget: 'fast' },
    });
    assert.deepEqual(snapshot.candidates, []);
    assert.equal(snapshot.rootWdl, undefined);
    assert.equal(snapshot.perspective, 'black');
  }
  assert.equal(runtime.readiness, 'cold');
});
