import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HostEventStream,
  type HostEventSubscription,
} from '../../app/application/events/index.ts';
import { localId } from '../../app/domain/identity/index.ts';

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

test('projects analysis, inventory and workspace changes as compact refresh hints', async () => {
  const stream = makeStream();
  const subscription = stream.subscribe({
    lastEventId: undefined,
    signal: new AbortController().signal,
  });
  const contextId = localId('working-context', 3);

  stream.publish({
    kind: 'analysis.scratch-changed',
    occurredAt: '2026-09-08T11:00:00.000Z',
    dataRevision: 4,
    scope: { kind: 'context', contextId },
    scratchId: 'scratch-2',
    scratchRevision: 2,
  });
  stream.publish({
    kind: 'analysis.contribution-created',
    occurredAt: '2026-09-08T11:00:00.000Z',
    dataRevision: 5,
    itemId: localId('inventory-item', 7),
    contributionId: localId('contribution', 9),
  });
  stream.publish({
    kind: 'analysis.contribution-changed',
    changeKind: 'updated',
    occurredAt: '2026-09-08T11:00:00.000Z',
    dataRevision: 6,
    itemId: localId('inventory-item', 7),
    contributionId: localId('contribution', 9),
  });
  stream.publish({
    kind: 'inventory.item-created',
    occurredAt: '2026-09-08T11:00:00.000Z',
    dataRevision: 6,
    itemId: localId('inventory-item', 7),
    revisionId: localId('item-revision', 8),
  });
  stream.publish({
    kind: 'workspace.context-created',
    occurredAt: '2026-09-08T11:00:00.000Z',
    dataRevision: 7,
    contextId,
    contextVersion: 1,
  });

  const scratch = await next(subscription);
  const contribution = await next(subscription);
  const changedContribution = await next(subscription);
  const inventory = await next(subscription);
  const workspace = await next(subscription);
  assert.deepEqual(scratch.payload, {
    scope: { kind: 'context', contextId },
    scratchId: 'scratch-2',
    scratchRevision: 2,
  });
  assert.deepEqual(inventory.payload, {
    itemId: localId('inventory-item', 7),
    revisionId: localId('item-revision', 8),
  });
  assert.deepEqual(contribution.payload, {
    itemId: localId('inventory-item', 7),
    contributionId: localId('contribution', 9),
  });
  assert.deepEqual(changedContribution.payload, {
    itemId: localId('inventory-item', 7),
    contributionId: localId('contribution', 9),
    changeKind: 'updated',
  });
  assert.deepEqual(workspace.payload, { contextId, contextVersion: 1 });
  assert.deepEqual(
    [
      scratch.kind,
      contribution.kind,
      changedContribution.kind,
      inventory.kind,
      workspace.kind,
    ],
    [
      'analysis.scratch-changed',
      'analysis.contribution-created',
      'analysis.contribution-changed',
      'inventory.item-created',
      'workspace.context-created',
    ],
  );
  subscription.close();
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
