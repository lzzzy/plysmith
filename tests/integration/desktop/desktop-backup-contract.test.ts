import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBackupSuggestedFileName } from '../../../app/infrastructure/channels/ui/desktop/contract.ts';

test('native backup accepts only a plain canonical suggested filename', () => {
  const fileName = 'plysmith-backup-20261012-120000.pgn';
  assert.equal(parseBackupSuggestedFileName(fileName), fileName);
  for (const value of [
    undefined,
    null,
    {},
    12,
    '../' + fileName,
    'C:/' + fileName,
    'backup.pgn',
    fileName + '.exe',
    fileName + '\n',
    'x'.repeat(10000),
  ])
    assert.equal(parseBackupSuggestedFileName(value), undefined);
});
