import assert from 'node:assert/strict';
import test from 'node:test';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { liveClockDisplay } from '../../../app/infrastructure/channels/ui/renderer/live-clock-presentation.ts';

const receipt = Date.parse('2026-10-06T12:00:00.000Z');
const rules = new ChessJsRulesAdapter();
const root = rules.initialState();
const first = rules.applyMove(root, [], { kind: 'coordinates', value: 'e2e4' });
assert.ok(first.ok);
const second = rules.applyMove(root, [first.value.move], {
  kind: 'coordinates',
  value: 'e7e5',
});
assert.ok(second.ok);
const reported = {
  status: 'ongoing' as const,
  connected: true,
  root,
  steps: [first.value, second.value],
  blackClockMs: 90000,
};
const session = {
  ...reported,
  whiteClockMs: 60000,
  clockUpdatedAt: new Date(receipt).toISOString(),
};

test('clock catches up after timer suspension without accumulating interval drift', () => {
  assert.deepEqual(liveClockDisplay(session, receipt + 37250), {
    running: true,
    whiteClockMs: 22750,
    blackClockMs: 90000,
  });
  assert.deepEqual(liveClockDisplay(session, receipt - 5000), {
    running: true,
    whiteClockMs: 60000,
    blackClockMs: 90000,
  });
  const snapshot = structuredClone(session);
  assert.equal(liveClockDisplay(session, receipt + 100000).whiteClockMs, 0);
  assert.deepEqual(session, snapshot);
});

test('clock remains reported without a stream anchor or known active time', () => {
  const sources: Parameters<typeof liveClockDisplay>[0][] = [
    { ...reported, whiteClockMs: 60000 },
    { ...reported, clockUpdatedAt: session.clockUpdatedAt },
    { ...session, clockUpdatedAt: 'invalid' },
  ];
  for (const source of sources) {
    const display = liveClockDisplay(source, receipt + 5000);
    assert.equal(display.running, false);
    assert.equal(display.whiteClockMs, source.whiteClockMs);
    assert.equal(display.blackClockMs, 90000);
  }
});

test('clock waits for both initial moves and stops at disconnect or terminal state', () => {
  for (const source of [
    { ...session, steps: [] },
    { ...session, steps: session.steps.slice(0, 1) },
    { ...session, connected: false },
    { ...session, status: 'finalizing' as const },
    { ...session, status: 'ended' as const },
  ]) {
    assert.deepEqual(liveClockDisplay(source, receipt + 5000), {
      running: false,
      whiteClockMs: 60000,
      blackClockMs: 90000,
    });
  }
});
