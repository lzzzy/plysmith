import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import type { AppliedMove } from '../../../app/domain/chess_graph/index.ts';
import { createAnalysisRecordDraft } from '../../../app/domain/inventory/index.ts';

const rules = new ChessJsRulesAdapter();

test('analysis creation shares the inventory name budget', () => {
  const input = {
    displayName: 'x'.repeat(160),
    languageTag: 'en-GB',
    originMode: 'initial_position' as const,
    root: rules.initialState(),
    steps: [],
  };
  assert.equal(createAnalysisRecordDraft(input).displayName.length, 160);
  assert.throws(() =>
    createAnalysisRecordDraft({ ...input, displayName: 'x'.repeat(161) }),
  );
});

test('analysis creation accepts the complete editable note budget', () => {
  const input = {
    displayName: 'Budget check',
    languageTag: 'en-GB',
    originMode: 'initial_position' as const,
    root: rules.initialState(),
    steps: [],
  };
  assert.equal(
    createAnalysisRecordDraft({
      ...input,
      noteBody: 'x'.repeat(128000),
    }).note?.body.length,
    128000,
  );
  assert.throws(() =>
    createAnalysisRecordDraft({
      ...input,
      noteBody: 'x'.repeat(128001),
    }),
  );
});

test('an analysis record keeps its optional comment separate from its move path', () => {
  const root = rules.initialState();
  const applied = rules.applyMove(root, [], {
    kind: 'notation',
    value: 'e4',
    locale: 'en-GB',
  });
  if (!applied.ok) throw new Error('Expected a legal test move.');
  const steps: AppliedMove[] = [applied.value];

  const record = createAnalysisRecordDraft({
    displayName: 'Offene Spiele prüfen',
    languageTag: 'de-DE',
    originMode: 'initial_position',
    root,
    steps,
    noteBody: 'Dieser Aufbau bleibt flexibel.',
  });

  assert.equal(record.originMode, 'initial_position');
  assert.deepEqual(
    record.steps.map((step) => step.move.san),
    ['e4'],
  );
  assert.equal(record.note?.body, 'Dieser Aufbau bleibt flexibel.');
  assert.deepEqual(record.note?.moves, []);
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(record.steps));
  assert.ok(Object.isFrozen(record.note));
  assert.ok(Object.isFrozen(record.note?.moves));
  steps.length = 0;
  assert.equal(record.steps.length, 1);
});

test('an analysis record accepts a root-only position and rejects invalid metadata', () => {
  const input = {
    displayName: 'Leerer Pfad',
    languageTag: 'de-DE',
    originMode: 'fen' as const,
    root: rules.initialState(),
    steps: [],
  };
  const rootOnly = createAnalysisRecordDraft(input);
  assert.deepEqual(rootOnly.steps, []);
  assert.equal(rootOnly.note, undefined);
  assert.equal(rootOnly.originMode, 'fen');

  assert.throws(() =>
    createAnalysisRecordDraft({
      ...input,
      displayName: ' Unsauber',
    }),
  );
  assert.throws(() =>
    createAnalysisRecordDraft({ ...input, languageTag: 'invalid_language' }),
  );
});
