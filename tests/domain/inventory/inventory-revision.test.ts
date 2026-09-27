import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendAnalysisMove,
  moveAnalysisCursor,
  startAnalysisScratch,
} from '../../../app/domain/analysis/index.ts';
import { localId } from '../../../app/domain/identity/index.ts';
import {
  inventoryRevisionCandidateSteps,
  planInventoryRevision,
  promoteAnalysisExplorationToRevision,
  type InventoryRevisionLine,
} from '../../../app/domain/inventory/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

const rules = new ChessJsRulesAdapter();

test('inventory extension keeps the full prefix and starts at the line end', () => {
  const line = openingLine();
  const endAnchor = line.steps[3]!.anchorId;
  const plan = planInventoryRevision({
    line,
    mode: 'extend',
    anchorId: endAnchor,
  });

  assert.equal(plan.preservedSteps.length, 4);
  assert.equal(plan.removedSteps.length, 0);
  assert.equal(plan.cutAnchorId.value, endAnchor.value);
  assert.equal(plan.scratchRoot.fen, line.steps[3]!.after.fen);
});

test('truncate keeps the selected position while replace keeps its predecessor', () => {
  const line = openingLine();
  const selected = line.steps[2]!.anchorId;
  const truncated = planInventoryRevision({
    line,
    mode: 'truncate_after',
    anchorId: selected,
  });
  const replaced = planInventoryRevision({
    line,
    mode: 'replace_move',
    anchorId: selected,
  });

  assert.deepEqual(
    truncated.preservedSteps.map((step) => step.move.san),
    ['e4', 'e5', 'Nf3'],
  );
  assert.deepEqual(
    replaced.preservedSteps.map((step) => step.move.san),
    ['e4', 'e5'],
  );
  assert.equal(replaced.cutAnchorId.value, line.steps[1]!.anchorId.value);
  assert.equal(replaced.returnAnchorId.value, selected.value);
});

test('candidate combines the stable prefix with the transient suffix', () => {
  const line = openingLine();
  const plan = planInventoryRevision({
    line,
    mode: 'replace_move',
    anchorId: line.steps[3]!.anchorId,
  });
  let scratch = startAnalysisScratch(
    'revision-scratch',
    plan.scratchRoot,
    {
      kind: 'inventory_anchor',
      itemId: line.itemId,
      revisionId: line.revisionId,
      anchorId: plan.cutAnchorId,
    },
    plan.intent,
  );
  const applied = rules.applyMove(scratch.root, [], {
    kind: 'notation',
    value: 'd6',
    locale: 'en-GB',
  });
  assert.equal(applied.ok, true);
  if (!applied.ok) throw new Error('Expected a legal move.');
  scratch = appendAnalysisMove(scratch, applied.value);

  assert.deepEqual(
    inventoryRevisionCandidateSteps({ base: line, scratch }).map(
      (step) => step.move.san,
    ),
    ['e4', 'e5', 'Nf3', 'd6'],
  );
});

test('an explored continuation can become a truncate revision without replaying moves', () => {
  const line = openingLine();
  const cutAnchor = line.steps[1]!.anchorId;
  const plan = planInventoryRevision({
    line,
    mode: 'truncate_after',
    anchorId: cutAnchor,
  });
  let exploration = startAnalysisScratch('exploration', plan.scratchRoot, {
    kind: 'inventory_anchor',
    itemId: line.itemId,
    revisionId: line.revisionId,
    anchorId: cutAnchor,
  });
  const applied = rules.applyMove(exploration.root, [], {
    kind: 'notation',
    value: 'Bc4',
    locale: 'en-GB',
  });
  assert.equal(applied.ok, true);
  if (!applied.ok) throw new Error('Expected a legal move.');
  exploration = appendAnalysisMove(exploration, applied.value);

  const revision = promoteAnalysisExplorationToRevision({
    scratch: exploration,
    plan,
  });

  assert.equal(revision.scratchId, exploration.scratchId);
  assert.equal(revision.scratchRevision, exploration.scratchRevision + 1);
  assert.equal(revision.intent.kind, 'inventory_revision');
  assert.deepEqual(
    inventoryRevisionCandidateSteps({ base: line, scratch: revision }).map(
      (step) => step.move.san,
    ),
    ['e4', 'e5', 'Bc4'],
  );
});

for (const rootOnly of [false, true]) {
  test(`end-anchored exploration promotes to extend (root-only: ${rootOnly})`, () => {
    const line = { ...openingLine(), ...(rootOnly ? { steps: [] } : {}) };
    const plan = planInventoryRevision({
      line,
      mode: 'extend',
      anchorId: line.steps.at(-1)?.anchorId ?? line.rootAnchorId,
    });
    let exploration = startAnalysisScratch(
      'end-exploration',
      plan.scratchRoot,
      {
        kind: 'inventory_anchor',
        itemId: line.itemId,
        revisionId: line.revisionId,
        anchorId: plan.cutAnchorId,
      },
    );
    const applied = rules.applyMove(exploration.root, [], {
      kind: 'notation',
      value: rootOnly ? 'e4' : 'Bc4',
      locale: 'en-GB',
    });
    if (!applied.ok) throw new Error('Expected a legal move.');
    exploration = appendAnalysisMove(exploration, applied.value);

    const revision = promoteAnalysisExplorationToRevision({
      scratch: exploration,
      plan,
    });

    assert.deepEqual(revision, {
      ...exploration,
      scratchRevision: exploration.scratchRevision + 1,
      intent: plan.intent,
    });
    assert.equal(plan.removedSteps.length, 0);
    assert.deepEqual(plan.preservedSteps, line.steps);
    assert.deepEqual(
      inventoryRevisionCandidateSteps({ base: line, scratch: revision }),
      [...line.steps, ...exploration.steps],
    );
  });
}

test('only a complete exploration from the revision cut can be promoted', () => {
  const line = openingLine();
  const plan = planInventoryRevision({
    line,
    mode: 'truncate_after',
    anchorId: line.steps[1]!.anchorId,
  });
  const wrongOrigin = startAnalysisScratch('wrong-origin', plan.scratchRoot, {
    kind: 'inventory_anchor',
    itemId: line.itemId,
    revisionId: line.revisionId,
    anchorId: line.rootAnchorId,
  });
  const empty = startAnalysisScratch('empty', plan.scratchRoot, {
    kind: 'inventory_anchor',
    itemId: line.itemId,
    revisionId: line.revisionId,
    anchorId: plan.cutAnchorId,
  });

  assert.throws(() =>
    promoteAnalysisExplorationToRevision({ scratch: wrongOrigin, plan }),
  );
  assert.throws(() =>
    promoteAnalysisExplorationToRevision({ scratch: empty, plan }),
  );
});

test('extend promotion retains origin identity, root and complete-cursor guards', () => {
  const line = openingLine();
  const plan = planInventoryRevision({
    line,
    mode: 'extend',
    anchorId: line.steps.at(-1)!.anchorId,
  });
  const origin = {
    kind: 'inventory_anchor' as const,
    itemId: line.itemId,
    revisionId: line.revisionId,
    anchorId: plan.cutAnchorId,
  };
  const empty = startAnalysisScratch('guarded', plan.scratchRoot, origin);
  const applied = rules.applyMove(empty.root, [], {
    kind: 'notation',
    value: 'Bc4',
    locale: 'en-GB',
  });
  if (!applied.ok) throw new Error('Expected a legal move.');
  const scratch = appendAnalysisMove(empty, applied.value);
  const invalid = [
    empty,
    moveAnalysisCursor(scratch, 0),
    { ...scratch, intent: plan.intent },
    { ...scratch, origin: { kind: 'initial_position' as const } },
    {
      ...scratch,
      origin: { ...origin, itemId: localId('inventory-item', 99) },
    },
    {
      ...scratch,
      origin: { ...origin, revisionId: localId('item-revision', 99) },
    },
    { ...scratch, origin: { ...origin, anchorId: line.rootAnchorId } },
    { ...scratch, root: { ...scratch.root, fen: line.root.fen } },
    { ...scratch, root: { ...scratch.root, position: line.root.position } },
  ];
  for (const candidate of invalid) {
    assert.throws(() =>
      promoteAnalysisExplorationToRevision({ scratch: candidate, plan }),
    );
  }
  for (const mode of ['metadata', 'replace_move'] as const) {
    assert.throws(() =>
      promoteAnalysisExplorationToRevision({
        scratch,
        plan: { ...plan, mode },
      }),
    );
  }
});

test('metadata revision preserves the line and changes only descriptive data', () => {
  const line = openingLine();
  const returnAnchor = line.steps[1]!.anchorId;
  const plan = planInventoryRevision({
    line,
    mode: 'metadata',
    anchorId: returnAnchor,
    displayName: 'Renamed open game',
    summary: 'A clearer description.',
  });
  const scratch = startAnalysisScratch(
    'metadata-scratch',
    plan.scratchRoot,
    {
      kind: 'inventory_anchor',
      itemId: line.itemId,
      revisionId: line.revisionId,
      anchorId: plan.cutAnchorId,
    },
    plan.intent,
  );

  assert.equal(plan.cutAnchorId.value, line.steps.at(-1)!.anchorId.value);
  assert.equal(plan.returnAnchorId.value, returnAnchor.value);
  assert.equal(plan.intent.displayName, 'Renamed open game');
  assert.equal(plan.intent.summary, 'A clearer description.');
  assert.deepEqual(
    inventoryRevisionCandidateSteps({ base: line, scratch }).map(
      (step) => step.move.san,
    ),
    ['e4', 'e5', 'Nf3', 'Nc6'],
  );
});

test('replacing a move requires a replacement suffix', () => {
  const line = openingLine();
  const plan = planInventoryRevision({
    line,
    mode: 'replace_move',
    anchorId: line.steps[2]!.anchorId,
  });
  const scratch = startAnalysisScratch(
    'revision-scratch',
    plan.scratchRoot,
    {
      kind: 'inventory_anchor',
      itemId: line.itemId,
      revisionId: line.revisionId,
      anchorId: plan.cutAnchorId,
    },
    plan.intent,
  );

  assert.throws(() => inventoryRevisionCandidateSteps({ base: line, scratch }));
});

test('extension rejects a middle anchor and replacing rejects the root', () => {
  const line = openingLine();
  assert.throws(() =>
    planInventoryRevision({
      line,
      mode: 'extend',
      anchorId: line.steps[1]!.anchorId,
    }),
  );
  assert.throws(() =>
    planInventoryRevision({
      line,
      mode: 'replace_move',
      anchorId: line.rootAnchorId,
    }),
  );
});

function openingLine(): InventoryRevisionLine {
  const root = rules.initialState();
  const moves = ['e4', 'e5', 'Nf3', 'Nc6'];
  const steps = [];
  let state = root;
  for (const [index, notation] of moves.entries()) {
    const applied = rules.applyMove(
      root,
      steps.map((step) => step.move),
      { kind: 'notation', value: notation, locale: 'en-GB' },
    );
    assert.equal(applied.ok, true);
    if (!applied.ok) throw new Error('Expected a legal move.');
    state = applied.value.after;
    steps.push({
      ...applied.value,
      anchorId: localId('anchor', index + 2),
    });
  }
  void state;
  return {
    itemId: localId('inventory-item', 1),
    revisionId: localId('item-revision', 1),
    rootAnchorId: localId('anchor', 1),
    root,
    steps,
    displayName: 'Open game',
  };
}
