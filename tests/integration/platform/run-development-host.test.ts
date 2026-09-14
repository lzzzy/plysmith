import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { developmentHostArguments } from '../../../tools/run-development-host.ts';

test('development host watches code but never runtime configuration', () => {
  const applicationHome = path.resolve('C:\\Plysmith Source');

  assert.deepEqual(developmentHostArguments(applicationHome), [
    '--watch',
    `--watch-path=${path.join(applicationHome, 'app')}`,
    `--watch-path=${path.join(applicationHome, 'contracts')}`,
    '--enable-source-maps',
    path.join(applicationHome, 'app', 'bootstrap', 'host', 'main.ts'),
  ]);
  assert.equal(
    developmentHostArguments(applicationHome).some((argument) =>
      argument.includes(path.join(applicationHome, 'configuration')),
    ),
    false,
  );
  assert.equal(
    developmentHostArguments(applicationHome).some((argument) =>
      argument.includes('node_modules'),
    ),
    false,
  );
});
