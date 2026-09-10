import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import {
  HostEventSchema,
  apiSchemas,
} from '../../../app/infrastructure/channels/api/contract.ts';
import {
  buildFixture,
  finiteSource,
  gapEvent,
  headers,
  languageEvent,
} from './fixtures.ts';

test('SSE frames preserve ordered replay, ids and the constant wire event name', async (t) => {
  const cursors: (string | undefined)[] = [];
  const events = [languageEvent(2), languageEvent(3)];
  const { host } = await buildFixture(t, {
    events: finiteSource(events, cursors),
  });
  const response = await host.inject({
    url: '/events',
    headers: {
      ...headers,
      accept: 'text/event-stream',
      'last-event-id': 'generation:1',
      origin: 'app://plysmith',
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'text/event-stream');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(
    response.headers['access-control-allow-origin'],
    'app://plysmith',
  );
  assert.deepEqual(cursors, ['generation:1']);
  const frames = response.body.trim().split('\n\n');
  assert.equal(frames.length, 2);
  const validator = TypeCompiler.Compile(HostEventSchema, [...apiSchemas]);
  frames.forEach((frame, index) => {
    const event = events[index];
    assert.ok(event);
    assert.ok(frame.startsWith(`id: ${event.eventId}\nevent: host-event\n`));
    const json = frame.split('\ndata: ')[1];
    assert.ok(json);
    const dto: unknown = JSON.parse(json);
    assert.ok(validator.Check(dto));
    assert.deepEqual(dto, event);
  });
});

test('an explicit replay gap tells the client to read authoritative query snapshots', async (t) => {
  const { host } = await buildFixture(t, {
    events: finiteSource([gapEvent()]),
  });
  const response = await host.inject({
    url: '/events',
    headers: { ...headers, 'last-event-id': 'old-generation:99' },
  });
  assert.equal(response.statusCode, 200);
  assert.ok(response.body.includes('event: host-event\n'));
  assert.ok(response.body.includes('"kind":"host.replay-gap"'));
  const snapshot = await host.inject({ url: '/preferences', headers });
  assert.equal(snapshot.json().dataRevision, 0);
  assert.equal(snapshot.json().uiLocale, 'de-DE');
});

test('SSE rejects malformed cursor and unacceptable media ranges before subscribing', async (t) => {
  const cursors: (string | undefined)[] = [];
  const { host } = await buildFixture(t, { events: finiteSource([], cursors) });
  for (const cursor of ['', 'x'.repeat(161), 'bad cursor', 'id\u0000']) {
    const response = await host.inject({
      url: '/events',
      headers: { ...headers, 'last-event-id': cursor },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'request.invalid');
  }
  for (const accept of [
    'application/json',
    '*/*, text/event-stream;q=0',
    'text/*;q=0',
  ]) {
    const response = await host.inject({
      url: '/events',
      headers: { ...headers, accept },
    });
    assert.equal(response.statusCode, 406);
    assert.equal(response.json().code, 'request.not_acceptable');
    assert.match(
      String(response.headers['content-type']),
      /^application\/problem\+json/,
    );
  }
  assert.equal(cursors.length, 0);
});

test('subscription failure before the first frame remains a correlated HTTP problem', async (t) => {
  const { host } = await buildFixture(t, {
    events: {
      subscribe: () => {
        throw new Error('CANARY subscription internals');
      },
    },
  });
  const response = await host.inject({ url: '/events', headers });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().code, 'host.failure');
  assert.equal(response.json().correlationId, 'test-correlation');
  assert.ok(!response.body.includes('CANARY'));
});

test('SSE explicitly projects payload and metadata without internal fields', async (t) => {
  const original = languageEvent();
  assert.equal(original.kind, 'preference.ui-language-changed');
  const extra = {
    ...original,
    secret: 'CANARY',
    payload: { ...original.payload, secret: 'CANARY' },
  };
  const { host } = await buildFixture(t, { events: finiteSource([extra]) });
  const response = await host.inject({ url: '/events', headers });
  assert.equal(response.statusCode, 200);
  assert.ok(!response.body.includes('CANARY'));
  assert.ok(response.body.includes('preference.ui-language-changed'));
});

test('invalid event ids cannot inject extra SSE frames and always close the subscription', async (t) => {
  let closes = 0;
  const { host } = await buildFixture(t, {
    events: {
      subscribe: () => ({
        events: (async function* () {
          yield { ...languageEvent(), eventId: 'bad\nevent: CANARY' };
        })(),
        close: () => {
          closes++;
        },
      }),
    },
  });
  const response = await host.inject({ url: '/events', headers });
  assert.ok(!response.body.includes('CANARY'));
  assert.equal(closes, 1);
});
