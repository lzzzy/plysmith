import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import {
  appendAnalysisMove,
  moveAnalysisCursor,
  prepareAnalysisNote,
  startAnalysisScratch,
} from '../../../app/domain/analysis/index.ts';
import { createAnalysisRecordDraft } from '../../../app/domain/inventory/index.ts';

const rules = new ChessJsRulesAdapter();

test('an analysis record contains only the confirmed current path', () => {
  let scratch = startAnalysisScratch('scratch-1', rules.initialState());
  scratch = appendAnalysisMove(
    scratch,
    requireMove(scratch, { kind: 'notation', value: 'e4', locale: 'en-GB' }),
  );
  scratch = appendAnalysisMove(
    scratch,
    requireMove(scratch, { kind: 'notation', value: 'e5', locale: 'en-GB' }),
  );
  scratch = moveAnalysisCursor(scratch, 1);
  scratch = prepareAnalysisNote(scratch, 'Dieser Aufbau bleibt flexibel.');

  const record = createAnalysisRecordDraft({
    displayName: 'Offene Spiele prüfen',
    languageTag: 'de-DE',
    scratch,
  });

  assert.equal(record.originMode, 'initial_position');
  assert.deepEqual(
    record.steps.map((step) => step.move.san),
    ['e4'],
  );
  assert.equal(record.note?.body, 'Dieser Aufbau bleibt flexibel.');
  assert.ok(Object.isFrozen(record));
});

test('an analysis record accepts a path without a note and rejects invalid metadata', () => {
  const empty = startAnalysisScratch('scratch-1', rules.initialState());
  const scratch = appendAnalysisMove(
    empty,
    requireMove(empty, { kind: 'coordinates', value: 'e2e4' }),
  );
  const record = createAnalysisRecordDraft({
    displayName: 'Noch ohne Notiz',
    languageTag: 'de-DE',
    scratch,
  });
  assert.equal(record.note, undefined);

  assert.throws(() =>
    createAnalysisRecordDraft({
      displayName: ' Unsauber',
      languageTag: 'de-DE',
      scratch,
    }),
  );
  assert.throws(() =>
    createAnalysisRecordDraft({
      displayName: 'Leerer Pfad',
      languageTag: 'de-DE',
      scratch: empty,
    }),
  );
});

function requireMove(
  scratch: ReturnType<typeof startAnalysisScratch>,
  input: Parameters<ChessJsRulesAdapter['applyMove']>[2],
) {
  const applied = rules.applyMove(
    scratch.root,
    scratch.steps.slice(0, scratch.cursor).map((step) => step.move),
    input,
  );
  assert.equal(applied.ok, true);
  if (!applied.ok) throw new Error('Expected a legal test move.');
  return applied.value;
}
