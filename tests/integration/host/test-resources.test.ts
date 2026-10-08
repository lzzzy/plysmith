import assert from 'node:assert/strict';
import test from 'node:test';

import { TestResources } from '../../fixtures/test-resources.ts';

test('a late acquisition is disposed after cancellation without starting its next step', async () => {
  const controller = new AbortController();
  const resources = new TestResources(controller.signal);
  const started = Promise.withResolvers<void>();
  const acquired = Promise.withResolvers<string>();
  const closed: string[] = [];
  const acquisition = resources.acquire(
    () => {
      started.resolve();
      return acquired.promise;
    },
    (value) => {
      closed.push(value);
    },
  );
  const rejected = assert.rejects(acquisition, { name: 'AbortError' });
  await started.promise;
  controller.abort();
  let complete = false;
  const cleanup = resources.close().then(() => {
    complete = true;
  });
  await Promise.resolve();
  assert.equal(complete, false);
  acquired.resolve('host');
  await rejected;
  await cleanup;
  assert.deepEqual(closed, ['host']);
  await assert.rejects(
    resources.run(() => assert.fail('No late listen or publication')),
    { name: 'AbortError' },
  );
  await resources.close();
  assert.deepEqual(closed, ['host']);
});

test('cleanup awaits an in-flight operation before closing resources in reverse order', async () => {
  const resources = new TestResources(new AbortController().signal);
  const operations: string[] = [];
  await resources.acquire(
    () => 'home',
    (value) => {
      operations.push(value);
    },
  );
  await resources.acquire(
    () => 'host',
    (value) => {
      operations.push(value);
    },
  );
  const started = Promise.withResolvers<void>();
  const publication = Promise.withResolvers<void>();
  const pending = resources.run(() => {
    started.resolve();
    return publication.promise;
  });
  const rejected = assert.rejects(pending, /already closing/);
  await started.promise;
  const cleanup = resources.close();
  assert.deepEqual(operations, []);
  publication.resolve();
  await rejected;
  await cleanup;
  assert.deepEqual(operations, ['host', 'home']);
});

test('failed acquisition and cleanup do not prevent the remaining cleanup', async () => {
  const resources = new TestResources(new AbortController().signal);
  const failure = new Error('Host close failed');
  let homeClosed = 0;
  await resources.acquire(
    () => 'home',
    () => {
      homeClosed += 1;
    },
  );
  await resources.acquire(
    () => 'host',
    () => {
      throw failure;
    },
  );
  await assert.rejects(
    resources.acquire(
      () => Promise.reject(new Error('setup')),
      () => assert.fail('Nothing acquired'),
    ),
    /setup/,
  );
  const cleanup = resources.close();
  assert.equal(resources.close(), cleanup);
  await assert.rejects(
    cleanup,
    (error) => error instanceof AggregateError && error.errors[0] === failure,
  );
  assert.equal(homeClosed, 1);
});
