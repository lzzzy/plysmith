import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { MovePolicyProviderError } from '../../../app/application/playout/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { MaiaChessMovePolicyAdapter } from '../../../app/infrastructure/adapters/engine/index.ts';
import {
  LineProcessSupervisor,
  type LineProcessOptions,
  type LineProcessSession,
} from '../../../app/infrastructure/adapters/process/index.ts';
const rules = new ChessJsRulesAdapter();

test('runs Maia Chess through Lc0 with one node and complete known position history', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'plysmith-maia-chess-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const weightsPath = path.join(directory, 'maia-1500.pb.gz');
  await writeFile(weightsPath, 'test weights');
  const supervisor = new RecordingUciSupervisor();
  const provider = new MaiaChessMovePolicyAdapter(
    {
      instanceId: 'maia-1500',
      displayName: 'Maia 1500',
      executablePath: 'lc0',
      weightsPath,
      startupTimeoutMs: 1_000,
      moveTimeoutMs: 1_000,
      stopTimeoutMs: 100,
      maxOutputBytes: 64_000,
    },
    supervisor,
  );
  const root = rules.initialState();
  const user = rules.applyMove(root, [], {
    kind: 'coordinates',
    value: 'e2e4',
  });
  assert.equal(user.ok, true);
  if (!user.ok) throw new Error('Expected a legal move.');

  const selected = await provider.chooseMove({
    root,
    moves: [user.value.move],
    current: user.value.after,
    decisionId: 1,
  });

  assert.deepEqual(selected.move, { from: 'e7', to: 'e5', san: 'e7e5' });
  assert.equal(selected.reproducibility, 'deterministic');
  assert.deepEqual(provider.descriptor.capabilities, ['human_profile']);
  assert.deepEqual(provider.descriptor.profile, {
    modelName: 'maia-1500.pb.gz',
    selectionMode: 'most_likely',
    historyMode: 'known_position_history',
    reproducibility: 'deterministic',
  });
  assert.deepEqual(supervisor.arguments, [
    '--config=',
    `--weights=${weightsPath}`,
  ]);
  assert.ok(
    supervisor.commands.some((line) =>
      /^position fen .* moves e2e4$/.test(line),
    ),
  );
  assert.ok(supervisor.commands.includes('go nodes 1'));
});

test('surfaces an Lc0 model error without waiting for the move timeout', async () => {
  const supervisor = new RecordingUciSupervisor(
    'error The file seems to be unparseable.',
  );
  const provider = new MaiaChessMovePolicyAdapter(
    {
      instanceId: 'maia-1500',
      displayName: 'Maia 1500',
      executablePath: 'lc0',
      weightsPath: 'maia-1500.pb.gz',
      startupTimeoutMs: 1_000,
      moveTimeoutMs: 30_000,
      stopTimeoutMs: 100,
      maxOutputBytes: 64_000,
    },
    supervisor,
  );
  const root = rules.initialState();

  await assert.rejects(
    provider.chooseMove({ root, moves: [], current: root, decisionId: 1 }),
    (error: unknown) =>
      error instanceof MovePolicyProviderError &&
      error.code === 'provider_protocol_error',
  );
});

class RecordingUciSupervisor extends LineProcessSupervisor {
  arguments: readonly string[] = [];
  readonly commands: string[] = [];
  readonly moveResponse: string;

  constructor(moveResponse: string = 'bestmove e7e5') {
    super();
    this.moveResponse = moveResponse;
  }

  override async run<T>(
    options: LineProcessOptions,
    work: (session: LineProcessSession) => Promise<T>,
  ): Promise<T> {
    this.arguments = options.arguments;
    const responses: string[] = [];
    return work({
      writeLine: (line) => {
        this.commands.push(line);
        if (line === 'uci') responses.push('id name Lc0', 'uciok');
        if (line === 'isready') responses.push('readyok');
        if (line === 'go nodes 1') responses.push(this.moveResponse);
      },
      readLine: () => {
        const response = responses.shift();
        return response === undefined
          ? Promise.reject(new Error('No UCI response queued.'))
          : Promise.resolve(response);
      },
    });
  }
}
