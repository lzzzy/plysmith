import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { developmentHostArguments } from '../../../tools/run-development-host.ts';

test('development host watches only owned source and contract roots', () => {
  const applicationHome = path.resolve('C:\\Plysmith Source');

  assert.deepEqual(developmentHostArguments(applicationHome), [
    '--watch',
    `--watch-path=${path.join(applicationHome, 'app')}`,
    `--watch-path=${path.join(applicationHome, 'configuration')}`,
    `--watch-path=${path.join(applicationHome, 'contracts')}`,
    '--enable-source-maps',
    path.join(applicationHome, 'app', 'bootstrap', 'host', 'main.ts'),
  ]);
  assert.equal(
    developmentHostArguments(applicationHome).some((argument) =>
      argument.includes('node_modules'),
    ),
    false,
  );
});
