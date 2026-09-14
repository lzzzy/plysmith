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
import { localId } from '../../../app/domain/identity/index.ts';

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

test('SSE converts local identifiers in iteration-two refresh hints to wire ids', async (t) => {
  const event = {
    eventId: 'generation:4',
    sequence: 4,
    kind: 'workspace.reference-added' as const,
    dataRevision: 5,
    occurredAt: '2026-09-08T12:00:00.000Z',
    subscriptionRevision: 1,
    correlationId: 'test-correlation',
    payload: {
      contextId: localId('working-context', 2),
      referenceId: localId('context-reference', 9),
    },
  };
  const noteEvent = {
    eventId: 'generation:5',
    sequence: 5,
    kind: 'analysis.contribution-changed' as const,
    dataRevision: 6,
    occurredAt: '2026-09-08T12:00:01.000Z',
    subscriptionRevision: 1,
    correlationId: 'test-correlation',
    payload: {
      itemId: localId('inventory-item', 3),
      contributionId: localId('contribution', 10),
      changeKind: 'deleted' as const,
    },
  };
  const createdNoteEvent = {
    eventId: 'generation:6',
    sequence: 6,
    kind: 'analysis.contribution-created' as const,
    dataRevision: 7,
    occurredAt: '2026-09-08T12:00:02.000Z',
    subscriptionRevision: 1,
    correlationId: 'test-correlation',
    payload: {
      itemId: localId('inventory-item', 3),
      contributionId: localId('contribution', 11),
    },
  };
  const { host } = await buildFixture(t, {
    events: finiteSource([event, noteEvent, createdNoteEvent]),
  });
  const response = await host.inject({ url: '/events', headers });
  assert.equal(response.statusCode, 200);
  assert.ok(response.body.includes('"contextId":"2"'));
  assert.ok(response.body.includes('"referenceId":"9"'));
  assert.ok(response.body.includes('"contributionId":"10"'));
  assert.ok(response.body.includes('"changeKind":"deleted"'));
  assert.ok(response.body.includes('"contributionId":"11"'));
  assert.ok(response.body.includes('"kind":"analysis.contribution-created"'));
  assert.ok(!response.body.includes('"value"'));
});
