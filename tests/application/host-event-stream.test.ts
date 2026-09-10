import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HostEventStream,
  type HostEventSubscription,
} from '../../app/application/events/index.ts';

test('delivers live preference events with monotonic ids and revisions', async () => {
  const stream = makeStream();
  const controller = new AbortController();
  const subscription = stream.subscribe({
    lastEventId: undefined,
    signal: controller.signal,
  });
  const iterator = subscription.events[Symbol.asyncIterator]();

  stream.publish(languageChanged(1, 2));
  stream.publish(languageChanged(2, 3));

  assert.deepEqual((await iterator.next()).value, {
    eventId: 'generation-1:1',
    kind: 'preference.ui-language-changed',
    sequence: 1,
    dataRevision: 1,
    occurredAt: '2026-09-08T11:00:00.000Z',
    subscriptionRevision: 1,
    correlationId: 'correlation-1',
    preferenceRevision: 2,
    payload: { previousUiLocale: 'de-DE', uiLocale: 'en-GB' },
  });
  assert.equal((await iterator.next()).value?.eventId, 'generation-1:2');
  subscription.close();
});

test('replays buffered events after a known cursor', async () => {
  const stream = makeStream();
  stream.publish(languageChanged(1, 2));
  stream.publish(languageChanged(2, 3));

  const subscription = stream.subscribe({
    lastEventId: 'generation-1:1',
    signal: new AbortController().signal,
  });

  assert.equal((await next(subscription)).eventId, 'generation-1:2');
  subscription.close();
});

test('emits a replay gap for another host generation or expired cursor', async () => {
  const stream = makeStream({ replayCapacity: 1 });
  stream.publish(languageChanged(1, 2));
  stream.publish(languageChanged(2, 3));

  for (const cursor of ['other-generation:2', 'generation-1:0']) {
    const subscription = stream.subscribe({
      lastEventId: cursor,
      signal: new AbortController().signal,
    });
    const event = await next(subscription);
    assert.equal(event.kind, 'host.replay-gap');
    assert.equal(event.payload.reason, 'replay_unavailable');
    assert.equal(event.dataRevision, 2);
    subscription.close();
  }
});

test('replaces an overflowing subscriber queue with a slow-consumer gap', async () => {
  const stream = makeStream({ subscriberQueueCapacity: 1 });
  const subscription = stream.subscribe({
    lastEventId: undefined,
    signal: new AbortController().signal,
  });
  stream.publish(languageChanged(1, 2));
  stream.publish(languageChanged(2, 3));

  const event = await next(subscription);
  assert.equal(event.kind, 'host.replay-gap');
  assert.equal(event.payload.reason, 'slow_consumer');
  subscription.close();
});

test('abort closes a pending subscription read', async () => {
  const stream = makeStream();
  const controller = new AbortController();
  const subscription = stream.subscribe({
    lastEventId: undefined,
    signal: controller.signal,
  });
  const pending = subscription.events[Symbol.asyncIterator]().next();

  controller.abort();

  assert.deepEqual(await pending, { done: true, value: undefined });
});

function makeStream(
  options: {
    replayCapacity?: number;
    subscriberQueueCapacity?: number;
  } = {},
): HostEventStream {
  let correlation = 0;
  return new HostEventStream({
    ...options,
    generation: 'generation-1',
    now: () => '2026-09-08T12:00:00.000Z',
    correlationIdFactory: () => `correlation-${++correlation}`,
  });
}

function languageChanged(dataRevision: number, preferenceRevision: number) {
  return {
    kind: 'preference.ui-language-changed' as const,
    occurredAt: '2026-09-08T11:00:00.000Z',
    dataRevision,
    preferenceRevision,
    payload: {
      previousUiLocale: 'de-DE' as const,
      uiLocale: 'en-GB' as const,
    },
  };
}

async function next(subscription: HostEventSubscription) {
  const result = await subscription.events[Symbol.asyncIterator]().next();
  assert.equal(result.done, false);
  assert.ok(result.value);
  return result.value;
}
