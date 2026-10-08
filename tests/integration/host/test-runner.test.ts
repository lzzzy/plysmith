import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  discoverTestFiles,
  partitionTestFiles,
  repositoryRoot,
} from '../../../tools/run-tests.ts';

test('the test phases cover every existing test file exactly once', async () => {
  const entries = await readdir(path.join(repositoryRoot, 'tests'), {
    recursive: true,
  });
  const expected = entries
    .filter((entry) => entry.endsWith('.test.ts'))
    .map((entry) => `tests/${entry.replaceAll('\\', '/')}`)
    .sort();
  const discovered = await discoverTestFiles();
  assert.deepEqual(discovered, expected);
  assert.ok(discovered.length > 0);
  const { parallel, serial } = partitionTestFiles(discovered);
  const scheduled = [...parallel, ...serial];
  assert.equal(new Set(scheduled).size, expected.length);
  assert.deepEqual(scheduled.sort(), expected);
  for (const directory of ['platform', 'mcp', 'process', 'engine']) {
    const owned = expected.filter((file) =>
      file.startsWith(`tests/integration/${directory}/`),
    );
    assert.ok(owned.length > 0, directory);
    assert.ok(
      owned.every((file) => serial.includes(file)),
      directory,
    );
  }
  assert.ok(parallel.every((file) => !file.startsWith('tests/integration/')));
});

test('test partitioning normalizes Windows paths and rejects duplicate scheduling', () => {
  assert.deepEqual(
    partitionTestFiles([
      'tests\\integration\\process\\owner.test.ts',
      'tests/domain/value.test.ts',
    ]),
    {
      parallel: ['tests/domain/value.test.ts'],
      serial: ['tests/integration/process/owner.test.ts'],
    },
  );
  assert.throws(
    () =>
      partitionTestFiles([
        'tests/domain/value.test.ts',
        'tests\\domain\\value.test.ts',
      ]),
    /Duplicate test file/,
  );
});
