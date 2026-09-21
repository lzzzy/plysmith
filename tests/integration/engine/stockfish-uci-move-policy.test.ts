import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MovePolicyProviderError } from '../../../app/application/playout/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { StockfishUciMovePolicyAdapter } from '../../../app/infrastructure/adapters/engine/index.ts';
import { LineProcessSupervisor } from '../../../app/infrastructure/adapters/process/index.ts';

const fakeEngine = fileURLToPath(
  new URL('../../fixtures/uci/fake-uci-engine.mjs', import.meta.url),
);
const rules = new ChessJsRulesAdapter();

test('normalizes one Fake-UCI best move behind the move-policy port', async () => {
  const provider = await adapter('normal');
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

  assert.deepEqual(selected.move, {
    from: 'e7',
    to: 'e5',
    san: 'e7e5',
  });
  assert.equal(selected.providerInstanceId, 'stockfish-test');
  assert.equal(provider.descriptor.providerType, 'stockfish-uci');
  assert.deepEqual(provider.descriptor.capabilities, ['best_move']);
});

for (const [mode, code] of [
  ['timeout', 'provider_timeout'],
  ['chatter', 'provider_timeout'],
  ['crash', 'provider_protocol_error'],
  ['flood', 'provider_resource_exhausted'],
  ['missing-option', 'capability_missing'],
] as const) {
  test(`maps Fake-UCI ${mode} to ${code}`, async () => {
    await assert.rejects(
      (await adapter(mode)).chooseMove({
        root: rules.initialState(),
        moves: [],
        current: rules.initialState(),
        decisionId: 1,
      }),
      (error) =>
        error instanceof MovePolicyProviderError && error.code === code,
    );
  });
}

async function adapter(mode: string): Promise<StockfishUciMovePolicyAdapter> {
  return new StockfishUciMovePolicyAdapter(
    {
      instanceId: 'stockfish-test',
      displayName: 'Stockfish test',
      executablePath: process.execPath,
      arguments: [fakeEngine, mode],
      threads: 1,
      hashMb: 16,
      moveTimeMs: 10,
      startupTimeoutMs: 1_000,
      moveTimeoutMs: mode === 'timeout' || mode === 'chatter' ? 30 : 1_000,
      stopTimeoutMs: 100,
      maxOutputBytes: mode === 'flood' ? 1_000 : 64_000,
    },
    new LineProcessSupervisor(),
  );
}
