import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import {
  createMaiaChessUciRuntime,
  MaiaChessMovePolicyAdapter,
  MaiaChessPositionAnalysisAdapter,
} from '../../../app/infrastructure/adapters/engine/index.ts';
import {
  LineProcessSupervisor,
  type LineProcessHandle,
  type LineProcessSession,
} from '../../../app/infrastructure/adapters/process/index.ts';

const rules = new ChessJsRulesAdapter();

test('maps Maia policy and separately inferred candidate WDL', async (t) => {
  const supervisor = new MaiaAnalysisSupervisor();
  const configuration = maiaConfiguration();
  const runtime = createMaiaChessUciRuntime(configuration, supervisor);
  t.after(() => runtime.close());
  const provider = new MaiaChessPositionAnalysisAdapter(
    configuration,
    runtime,
    rules,
  );
  const root = rules.initialState();

  const snapshot = await provider.analyze({
    candidateCount: 2,
    focus: { focusKey: 'initial', root, moves: [], current: root },
    mode: { kind: 'human_policy' },
  });

  assert.deepEqual(snapshot.rootWdl, {
    wins: 500,
    draws: 200,
    losses: 300,
    perspective: 'white',
    semantics: 'human_outcome',
  });
  assert.deepEqual(
    snapshot.candidates.map((candidate) => ({
      san: candidate.move.san,
      policyPercent: candidate.policyPercent,
      wdl: candidate.wdl,
    })),
    [
      {
        san: 'e4',
        policyPercent: 65,
        wdl: {
          wins: 500,
          draws: 300,
          losses: 200,
          perspective: 'white',
          semantics: 'human_outcome',
        },
      },
      {
        san: 'd4',
        policyPercent: 20,
        wdl: {
          wins: 400,
          draws: 350,
          losses: 250,
          perspective: 'white',
          semantics: 'human_outcome',
        },
      },
    ],
  );
  assert.ok(supervisor.commands.some((line) => line.endsWith('moves e2e4')));
  assert.ok(supervisor.commands.some((line) => line.endsWith('moves d2d4')));
});

test('restores Maia playout options on the shared provider runtime', async (t) => {
  const supervisor = new MaiaAnalysisSupervisor();
  const configuration = maiaConfiguration();
  const runtime = createMaiaChessUciRuntime(configuration, supervisor);
  t.after(() => runtime.close());
  const analysis = new MaiaChessPositionAnalysisAdapter(
    configuration,
    runtime,
    rules,
  );
  const playout = new MaiaChessMovePolicyAdapter(configuration, runtime);
  const root = rules.initialState();

  await analysis.analyze({
    candidateCount: 2,
    focus: { focusKey: 'initial', root, moves: [], current: root },
    mode: { kind: 'human_policy' },
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
  assert.equal(supervisor.openCount, 1);
  assert.deepEqual(
    supervisor.commands.filter((line) => line.includes('VerboseMoveStats')),
    [
      'setoption name VerboseMoveStats value true',
      'setoption name VerboseMoveStats value false',
      'setoption name VerboseMoveStats value false',
      'setoption name VerboseMoveStats value false',
    ],
  );
});

test('accepts Lc0 rook-square castling in Maia policy', async (t) => {
  const parsed = rules.parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error('Expected valid castling position.');
  const legal = rules.legalMoves(parsed.value, []);
  assert.equal(legal.ok, true);
  if (!legal.ok) throw new Error('Expected legal castling moves.');
  const policyLines = legal.value.map((move) => {
    const uci =
      move.san === 'O-O-O'
        ? 'e1a1'
        : move.san === 'O-O'
          ? 'e1h1'
          : `${move.from}${move.to}`;
    return `info string ${uci} (322) N: 0 (P: ${move.san === 'O-O-O' ? '100.00' : '0.00'}%)`;
  });
  const supervisor = new MaiaAnalysisSupervisor([
    ...policyLines,
    'info depth 1 score cp 0 wdl 500 200 300 pv e1a1',
    'bestmove e1c1',
  ]);
  const configuration = maiaConfiguration();
  const runtime = createMaiaChessUciRuntime(configuration, supervisor);
  t.after(() => runtime.close());
  const provider = new MaiaChessPositionAnalysisAdapter(
    configuration,
    runtime,
    rules,
  );

  const snapshot = await provider.analyze({
    candidateCount: 1,
    focus: {
      focusKey: 'castling',
      root: parsed.value,
      moves: [],
      current: parsed.value,
    },
    mode: { kind: 'human_policy' },
  });

  assert.equal(snapshot.candidates[0]?.move.san, 'O-O-O');
  assert.equal(snapshot.candidates[0]?.policyPercent, 100);
});

test('returns no Maia model prediction when no legal moves remain', async (t) => {
  const supervisor = new MaiaAnalysisSupervisor();
  const configuration = maiaConfiguration();
  const runtime = createMaiaChessUciRuntime(configuration, supervisor);
  t.after(() => runtime.close());
  const provider = new MaiaChessPositionAnalysisAdapter(
    configuration,
    runtime,
    rules,
  );

  for (const [reason, fen] of [
    ['checkmate', '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1'],
    ['stalemate', '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'],
  ] as const) {
    const parsed = rules.parseFen(fen);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) throw new Error(`Expected valid ${reason} position.`);
    const status = rules.gameStatus(parsed.value, []);
    assert.equal(status.ok, true);
    if (!status.ok) throw new Error(`Expected ${reason} status.`);
    assert.equal(status.value.kind, 'terminal');

    const snapshot = await provider.analyze({
      candidateCount: 5,
      focus: {
        focusKey: reason,
        root: parsed.value,
        moves: [],
        current: parsed.value,
      },
      mode: { kind: 'human_policy' },
    });

    assert.deepEqual(snapshot.candidates, []);
    assert.equal(Object.hasOwn(snapshot, 'rootWdl'), false);
  }
  assert.equal(supervisor.openCount, 0);
});

function maiaConfiguration() {
  return {
    instanceId: 'maia-test',
    displayName: 'Maia test',
    executablePath: 'lc0',
    weightsPath: 'maia-test.pb.gz',
    startupTimeoutMs: 1_000,
    moveTimeoutMs: 1_000,
    stopTimeoutMs: 100,
    maxOutputBytes: 64_000,
  };
}

class MaiaAnalysisSupervisor extends LineProcessSupervisor {
  readonly commands: string[] = [];
  openCount = 0;
  #position = '';
  readonly #rootLines: readonly string[];

  constructor(rootLines: readonly string[] = rootResponse()) {
    super();
    this.#rootLines = rootLines;
  }

  override async open(): Promise<LineProcessHandle> {
    this.openCount += 1;
    const responses: string[] = [];
    const session: LineProcessSession = {
      writeLine: (line) => {
        this.commands.push(line);
        if (line === 'uci') {
          responses.push(
            'id name Lc0',
            'option name VerboseMoveStats type check default false',
            'option name UCI_ShowWDL type check default false',
            'option name PolicyTemperature type string default 1.0',
            'option name ContemptMode type combo default disable var disable',
            'option name WDLCalibrationElo type spin default 0 min -1000 max 1000',
            'uciok',
          );
        }
        if (line === 'isready') responses.push('readyok');
        if (line.startsWith('position ')) this.#position = line;
        if (line === 'go nodes 1') {
          if (!this.#position.includes(' moves ')) {
            responses.push(...this.#rootLines);
          } else if (this.#position.endsWith(' e2e4')) {
            responses.push(
              'info depth 1 score cp 0 wdl 200 300 500 pv e7e5',
              'bestmove e7e5',
            );
          } else {
            responses.push(
              'info depth 1 score cp 0 wdl 250 350 400 pv d7d5',
              'bestmove d7d5',
            );
          }
        }
      },
      readLine: () => {
        const response = responses.shift();
        return response === undefined
          ? Promise.reject(new Error('No UCI response queued.'))
          : Promise.resolve(response);
      },
      resetOutputBudget() {},
    };
    return {
      processId: 1,
      session,
      waitForExit: async () => true,
      terminate: async () => undefined,
    };
  }
}

function rootResponse(): string[] {
  const secondaryMoves = [
    'a2a3',
    'a2a4',
    'b2b3',
    'b2b4',
    'c2c3',
    'c2c4',
    'd2d3',
    'e2e3',
    'f2f3',
    'f2f4',
    'g2g3',
    'g2g4',
    'h2h3',
    'h2h4',
    'b1a3',
    'b1c3',
    'g1f3',
    'g1h3',
  ];
  return [
    'info string e2e4 (322) N: 0 (P: 65.00%)',
    'info string d2d4 (322) N: 0 (P: 20.00%)',
    ...secondaryMoves.map(
      (move) => `info string ${move} (322) N: 0 (P: 0.83%)`,
    ),
    'info depth 1 score cp 0 wdl 500 200 300 pv e2e4',
    'bestmove e2e4',
  ];
}
