import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { TestStdioTransport } from '../../fixtures/stdio-transport.ts';
import { TestResources } from '../../fixtures/test-resources.ts';

test('stdio cleanup observes child close even when stdin EOF does not stop the child', async (t) => {
  const transport = new TestStdioTransport({
    command: process.execPath,
    args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000);'],
  });
  let closed = 0;
  transport.onclose = () => {
    closed += 1;
  };
  t.after(() => transport.close());
  await transport.start();
  assert.notEqual(transport.pid, null);
  const closing = transport.close();
  assert.equal(transport.close(), closing);
  await closing;
  assert.equal(closed, 1);
  assert.equal(transport.pid, null);
});

test('closing a transport during startup observes its owned child close', async (t) => {
  const transport = new TestStdioTransport({
    command: process.execPath,
    args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000);'],
  });
  let exited = false;
  transport.onclose = () => {
    exited = true;
  };
  t.after(() => transport.close());
  const starting = transport.start();
  const closing = transport.close();
  await starting;
  await closing;
  assert.equal(exited, true);
  assert.equal(transport.pid, null);
});

test('cancelling an MCP handshake closes its owned child before fixture cleanup finishes', async (t) => {
  const controller = new AbortController();
  const resources = new TestResources(controller.signal);
  t.after(() => resources.close());
  const starting = Promise.withResolvers<void>();
  class ObservedTransport extends TestStdioTransport {
    override async start() {
      const started = super.start();
      starting.resolve();
      await started;
    }
  }
  const transport = new ObservedTransport({
    command: process.execPath,
    args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000);'],
  });
  const client = new Client({ name: 'cancelled-handshake', version: '1.0.0' });
  let exited = false;
  transport.onclose = () => {
    exited = true;
  };
  resources.defer(() => transport.close());
  resources.defer(() => client.close());
  const connection = resources.run(() =>
    client.connect(transport, { signal: controller.signal }),
  );
  const aborted = new Error('MCP fixture cancelled during attach.');
  const rejected = assert.rejects(connection, aborted);
  await starting.promise;
  controller.abort(aborted);
  await rejected;
  await resources.close();
  assert.equal(exited, true);
  assert.equal(transport.pid, null);
});
