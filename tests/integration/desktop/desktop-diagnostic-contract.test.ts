import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseDiagnosticReportSuggestedFileName,
  parseRendererDiagnosticEvent,
} from '../../../app/infrastructure/channels/ui/desktop/contract.ts';

test('accepts only bounded content-free renderer diagnostic fields', () => {
  assert.deepEqual(
    parseRendererDiagnosticEvent({
      level: 'error',
      eventCode: 'renderer.command.failed',
      correlationId: 'correlation-1',
      operation: 'create_analysis_note',
      status: 'failed',
      problemCode: 'analysis.invalid_note',
      statusCode: 400,
      durationMilliseconds: 12.5,
      itemId: '11',
      revisionId: '12',
      anchorId: '13',
    }),
    {
      level: 'error',
      eventCode: 'renderer.command.failed',
      correlationId: 'correlation-1',
      operation: 'create_analysis_note',
      status: 'failed',
      problemCode: 'analysis.invalid_note',
      statusCode: 400,
      durationMilliseconds: 12.5,
      itemId: '11',
      revisionId: '12',
      anchorId: '13',
    },
  );
});

test('rejects unknown event codes, fields and user content', () => {
  for (const candidate of [
    {
      level: 'error',
      eventCode: 'host.request.completed',
    },
    {
      level: 'error',
      eventCode: 'renderer.command.failed',
      note: 'private note text',
    },
    {
      level: 'error',
      eventCode: 'renderer.command.failed',
      operation: 'contains spaces and user text',
    },
    {
      level: 'error',
      eventCode: 'renderer.analysis.navigation_requested',
      itemId: '../database',
    },
  ]) {
    assert.equal(parseRendererDiagnosticEvent(candidate), undefined);
  }
});

test('live diagnostics accept only safe integer counters and no upstream content', () => {
  const candidate = {
    level: 'debug',
    eventCode: 'renderer.live.state',
    status: 'succeeded',
    liveRevision: 12,
    ply: 3,
    selectedPly: 0,
    attempt: 1,
  };
  assert.deepEqual(parseRendererDiagnosticEvent(candidate), candidate);
  for (const key of ['liveRevision', 'ply', 'selectedPly', 'attempt']) {
    for (const value of [
      -1,
      1.5,
      Infinity,
      NaN,
      Number.MAX_SAFE_INTEGER + 1,
      '3',
    ])
      assert.equal(
        parseRendererDiagnosticEvent({ ...candidate, [key]: value }),
        undefined,
      );
  }
  for (const key of ['gameId', 'name', 'token', 'moves', 'fen', 'url'])
    assert.equal(
      parseRendererDiagnosticEvent({ ...candidate, [key]: 'private-canary' }),
      undefined,
    );
});

test('accepts only the bounded diagnostic report filename shape', () => {
  assert.equal(
    parseDiagnosticReportSuggestedFileName(
      'plysmith-diagnostics-20260914154309.json.gz',
    ),
    'plysmith-diagnostics-20260914154309.json.gz',
  );
  for (const candidate of [
    '../plysmith-diagnostics-20260914154309.json.gz',
    'C:\\private\\plysmith-diagnostics-20260914154309.json.gz',
    'plysmith-diagnostics-today.json.gz',
    'plysmith-diagnostics-20260914154309.json',
    '',
    undefined,
  ]) {
    assert.equal(parseDiagnosticReportSuggestedFileName(candidate), undefined);
  }
});
