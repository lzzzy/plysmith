import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateInventorySourcePath } from '../../../app/domain/playout/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

const rules = new ChessJsRulesAdapter();
const root = rules.initialState();
const e4 = rules.applyMove(root, [], { kind: 'coordinates', value: 'e2e4' });
assert.ok(e4.ok);
const e5 = rules.applyMove(root, [e4.value.move], {
  kind: 'coordinates',
  value: 'e7e5',
});
assert.ok(e5.ok);

test('retains the exact inventory prefix before a playout continuation', () => {
  const source = { root, steps: [e4.value] };
  const path = { displayName: 'Source', root, steps: [e4.value, e5.value] };
  assert.doesNotThrow(() =>
    validateInventorySourcePath(source, path, e5.value.after),
  );
  assert.throws(() =>
    validateInventorySourcePath(source, undefined, e5.value.after),
  );
  assert.throws(() =>
    validateInventorySourcePath(
      source,
      { ...path, steps: [e5.value] },
      e5.value.after,
    ),
  );
  assert.throws(() =>
    validateInventorySourcePath(source, path, e4.value.after),
  );
});

test('rejects a rewritten source move even when its supplied position is unchanged', () => {
  const source = { root, steps: [e4.value] };
  const altered = {
    ...e4.value,
    move: { ...e4.value.move, from: 'd2', to: 'd4', san: 'd4' },
  };
  assert.throws(() =>
    validateInventorySourcePath(
      source,
      { displayName: 'Source', root, steps: [altered, e5.value] },
      e5.value.after,
    ),
  );
});
