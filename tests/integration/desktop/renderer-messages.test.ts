import assert from 'node:assert/strict';
import test from 'node:test';

import { messages } from '../../../app/infrastructure/channels/ui/renderer/messages.ts';

test('German working-context terminology and bilingual message keys are uniform', () => {
  assert.equal(messages['de-DE']['scope.free'], 'Gesamter Bestand');
  assert.deepEqual(
    Object.keys(messages['de-DE']).sort(),
    Object.keys(messages['en-GB']).sort(),
  );
  for (const [id, value] of Object.entries(messages['de-DE'])) {
    assert.doesNotMatch(
      value.replaceAll('{context}', ''),
      /Working Context|\bContext\b|\bContexte\b|contextbezogen/i,
      id,
    );
  }
  for (const catalogue of Object.values(messages)) {
    assert.match(catalogue['manage.expandFamily'], /\{name\}/);
    assert.match(catalogue['manage.collapseFamily'], /\{name\}/);
  }
});

test('product messages do not expose process or development topology', () => {
  const internalTerms =
    /application host|desktop|watch[- ]?modus|watch mode|hostvertrag|host contract/i;

  for (const [locale, catalogue] of Object.entries(messages)) {
    for (const [messageId, message] of Object.entries(catalogue)) {
      assert.doesNotMatch(message, internalTerms, `${locale}:${messageId}`);
    }
  }
});

test('derived records name the origin of the current record type', () => {
  assert.equal(
    messages['de-DE']['analysis.analysisOrigin'],
    'Ausgangsstellung dieser Analyse',
  );
  assert.equal(
    messages['de-DE']['analysis.gameOrigin'],
    'Ausgangsstellung dieser Partie',
  );
  assert.equal(
    messages['en-GB']['analysis.gameOrigin'],
    'Starting position of this game',
  );
  assert.equal(messages['de-DE']['analysis.moveList'], 'Zugfolge');
  assert.equal(messages['en-GB']['analysis.moveList'], 'Move sequence');
  assert.equal(
    messages['de-DE']['manage.discardDraftAndOpenItem'],
    'Entwurf verwerfen und Eintrag öffnen',
  );
  assert.equal(
    messages['en-GB']['manage.discardDraftAndOpenItem'],
    'Discard draft and open item',
  );
});

test('inventory navigation uses the analysis activity label', () => {
  assert.equal(messages['de-DE']['activity.analyze'], 'Analysieren');
  assert.equal(messages['en-GB']['activity.analyze'], 'Analyse');
});

test('saving an inventory change uses a user-facing action label', () => {
  assert.equal(messages['de-DE']['inventory.saveRevision'], 'Speichern');
  assert.equal(messages['en-GB']['inventory.saveRevision'], 'Save');
});

test('draft review does not imply that the first action already saves', () => {
  assert.equal(
    messages['de-DE']['draft.unsavedChange'],
    'Ungespeicherte Änderung',
  );
  assert.equal(messages['en-GB']['draft.unsavedChange'], 'Unsaved change');
  assert.equal(messages['de-DE']['draft.reviewChange'], 'Änderung prüfen…');
  assert.equal(messages['en-GB']['draft.reviewChange'], 'Review change…');
  assert.match(messages['de-DE']['inventory.contextsRenamedDetail'], /Name/);
  assert.match(messages['de-DE']['inventory.contextsUpdatedDetail'], /Fassung/);
  assert.doesNotMatch(
    messages['de-DE']['inventory.contextsRenamedDetail'],
    /Revision|Bestandsverknüpfung/,
  );
  assert.equal(
    messages['de-DE']['inventory.revisionSaved'],
    'Änderung gespeichert.',
  );
  assert.equal(messages['en-GB']['inventory.revisionSaved'], 'Change saved.');
});

test('new game and position playout use the shared activity label', () => {
  assert.equal(messages['de-DE']['manage.newGame'], 'Neue Partie');
  assert.equal(messages['en-GB']['manage.newGame'], 'New game');
  assert.equal(messages['de-DE']['activity.playout'], 'Ausspielen');
  assert.equal(messages['en-GB']['activity.playout'], 'Play out');
  assert.match(
    messages['de-DE']['playout.replace.initialDetail'],
    /Grundstellung/,
  );
  assert.match(
    messages['en-GB']['playout.replace.initialDetail'],
    /initial position/,
  );
});
