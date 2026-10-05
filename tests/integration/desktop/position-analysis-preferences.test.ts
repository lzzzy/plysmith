import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readPositionAnalysisPreferences,
  savePositionAnalysisPreferences,
} from '../../../app/infrastructure/channels/ui/renderer/position-analysis-preferences.ts';

test('desktop analysis preferences preserve empty choices and validate stored values', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let stored: string | null = null;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    },
  });
  try {
    assert.deepEqual(readPositionAnalysisPreferences(), {
      budget: 'fast',
      sortBy: 'stockfish',
    });
    const choices = {
      budget: 'very_deep' as const,
      humanProviderIds: [],
      objectiveProviderId: 'engine-two',
      sortBy: 'stockfish',
    };
    savePositionAnalysisPreferences(choices);
    assert.deepEqual(readPositionAnalysisPreferences(), choices);
    stored =
      '{"budget":"unsupported","humanProviderIds":[7],"objectiveProviderId":false,"sortBy":null}';
    assert.deepEqual(readPositionAnalysisPreferences(), {
      budget: 'fast',
      sortBy: 'stockfish',
    });
    stored = 'not json';
    assert.deepEqual(readPositionAnalysisPreferences(), {
      budget: 'fast',
      sortBy: 'stockfish',
    });
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('Unavailable storage');
      },
    });
    assert.deepEqual(readPositionAnalysisPreferences(), {
      budget: 'fast',
      sortBy: 'stockfish',
    });
    assert.doesNotThrow(() => savePositionAnalysisPreferences(choices));
  } finally {
    if (previous !== undefined)
      Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
