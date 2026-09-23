import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { developmentHostArguments } from '../../../tools/run-development-host.ts';

test('development host watches imported modules instead of whole directories', () => {
  const applicationHome = path.resolve('C:\\Plysmith Source');

  assert.deepEqual(developmentHostArguments(applicationHome), [
    '--watch',
    '--enable-source-maps',
    path.join(applicationHome, 'app', 'bootstrap', 'host', 'main.ts'),
  ]);
  assert.equal(
    developmentHostArguments(applicationHome).some((argument) =>
      argument.startsWith('--watch-path='),
    ),
    false,
  );
});
