import assert from 'node:assert/strict';
import test from 'node:test';
import { analysisScratchHasChanges } from '../../app/application/analysis/index.ts';
import {
  startAnalysisScratch,
  appendAnalysisMove,
  moveAnalysisCursor,
} from '../../app/domain/analysis/index.ts';
import { localId } from '../../app/domain/identity/index.ts';
import {
  planInventoryRevision,
  type InventoryRevisionLine,
} from '../../app/domain/inventory/index.ts';
import { ChessJsRulesAdapter } from '../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

const rules = new ChessJsRulesAdapter();
const root = rules.initialState();
const applied = rules.applyMove(root, [], {
  kind: 'notation',
  value: 'e4',
  locale: 'en-GB',
});
if (!applied.ok) throw new Error('Expected a legal move.');
const base: InventoryRevisionLine = {
  itemId: localId('inventory-item', 1),
  revisionId: localId('item-revision', 2),
  rootAnchorId: localId('anchor', 3),
  root,
  displayName: 'Openings',
  summary: 'Original',
  steps: [{ ...applied.value, anchorId: localId('anchor', 4) }],
};
const origin = {
  kind: 'inventory_anchor' as const,
  itemId: base.itemId,
  revisionId: base.revisionId,
  anchorId: base.rootAnchorId,
};

test('scratch changes distinguish disposable exploration from root-only setup and full paths', () => {
  assert.equal(analysisScratchHasChanges(undefined), false);
  const empty = startAnalysisScratch('empty', root);
  assert.equal(analysisScratchHasChanges(empty), false);
  assert.equal(
    analysisScratchHasChanges(startAnalysisScratch('bound', root, origin)),
    false,
  );
  for (const kind of ['fen', 'position_setup'] as const) {
    assert.equal(
      analysisScratchHasChanges(startAnalysisScratch(kind, root, { kind })),
      true,
    );
  }
  const path = appendAnalysisMove(empty, applied.value);
  assert.equal(analysisScratchHasChanges(moveAnalysisCursor(path, 0)), true);
  assert.equal(
    analysisScratchHasChanges({
      ...empty,
      noteDraft: { body: 'Own work', moves: [] },
    }),
    true,
  );
  assert.equal(
    analysisScratchHasChanges({
      ...empty,
      noteDraft: { body: '  ', moves: [applied.value.move] },
    }),
    true,
  );
});

test('revision changes compare the complete saved line and metadata, not scratch length', () => {
  for (const [mode, anchorId, displayName, expected] of [
    ['extend', base.steps[0]!.anchorId, base.displayName, false],
    ['truncate_after', base.steps[0]!.anchorId, base.displayName, false],
    ['truncate_after', base.rootAnchorId, base.displayName, true],
    ['metadata', base.rootAnchorId, base.displayName, false],
    ['metadata', base.rootAnchorId, 'Renamed', true],
    ['replace_move', base.steps[0]!.anchorId, base.displayName, true],
  ] as const) {
    const plan = planInventoryRevision({
      line: base,
      mode,
      anchorId,
      displayName,
    });
    const scratch = startAnalysisScratch(
      'revision',
      plan.scratchRoot,
      {
        ...origin,
        anchorId: plan.cutAnchorId,
      },
      plan.intent,
    );
    assert.equal(
      analysisScratchHasChanges(scratch, base),
      expected,
      mode + ':' + displayName,
    );
    assert.equal(
      analysisScratchHasChanges(scratch),
      true,
      'Missing baseline stays protected',
    );
  }
  const plan = planInventoryRevision({
    line: base,
    mode: 'metadata',
    anchorId: base.rootAnchorId,
    summary: null,
  });
  assert.equal(
    analysisScratchHasChanges(
      startAnalysisScratch('summary', plan.scratchRoot, origin, plan.intent),
      base,
    ),
    true,
  );
});

test('revision dirty checks compare the complete candidate even when its cursor is rewound', () => {
  const plan = planInventoryRevision({
    line: base,
    mode: 'replace_move',
    anchorId: base.steps[0]!.anchorId,
  });
  const scratch = startAnalysisScratch(
    'unchanged-replacement',
    root,
    origin,
    plan.intent,
  );
  const unchanged = appendAnalysisMove(scratch, applied.value);
  assert.equal(analysisScratchHasChanges(unchanged, base), false);
  assert.equal(
    analysisScratchHasChanges(moveAnalysisCursor(unchanged, 0), base),
    false,
  );
  const changed = rules.applyMove(root, [], {
    kind: 'notation',
    value: 'd4',
    locale: 'en-GB',
  });
  if (!changed.ok) throw new Error('Expected a legal move.');
  assert.equal(
    analysisScratchHasChanges(
      moveAnalysisCursor(appendAnalysisMove(scratch, changed.value), 0),
      base,
    ),
    true,
  );
});
