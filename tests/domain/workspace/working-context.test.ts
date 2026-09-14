import assert from 'node:assert/strict';
import { test } from 'node:test';

import { localId } from '../../../app/domain/identity/index.ts';
import {
  contextWorkScope,
  createWorkingContextDraft,
  freeWorkScope,
} from '../../../app/domain/workspace/index.ts';

test('a working context keeps its explicit purpose, boundary and next step', () => {
  const context = createWorkingContextDraft({
    displayName: 'Eröffnungsrepertoire',
    purpose: 'Das eigene Repertoire mit Weiß ausbauen.',
    boundary: 'Nur praktisch spielbare Haupt- und Nebenwege.',
    nextStep: 'Die Antwort 1...c5 untersuchen.',
  });
  assert.deepEqual(context, {
    displayName: 'Eröffnungsrepertoire',
    purpose: 'Das eigene Repertoire mit Weiß ausbauen.',
    boundary: 'Nur praktisch spielbare Haupt- und Nebenwege.',
    nextStep: 'Die Antwort 1...c5 untersuchen.',
  });
  assert.ok(Object.isFrozen(context));
});

test('work scopes distinguish the free session from a persisted context', () => {
  const contextId = localId('working-context', 42);
  assert.deepEqual(freeWorkScope(), { kind: 'free' });
  assert.deepEqual(contextWorkScope(contextId), {
    kind: 'context',
    contextId: { kind: 'working-context', value: 42 },
  });
  assert.throws(() => localId('working-context', 0));
});

test('working context text is bounded and never silently trimmed', () => {
  for (const displayName of ['', ' context', 'context ']) {
    assert.throws(() => createWorkingContextDraft({ displayName }));
  }
});
