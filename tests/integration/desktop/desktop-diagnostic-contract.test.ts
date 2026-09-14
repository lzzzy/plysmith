import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRendererDiagnosticEvent } from '../../../app/infrastructure/channels/ui/desktop/contract.ts';

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
