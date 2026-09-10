import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { test, type TestContext } from 'node:test';
import {
  SetUiLanguage,
  type UiLanguageChanged,
} from '../../../app/application/preferences/index.ts';
import {
  type HostEvent,
  type HostEventSource,
  type HostEventSubscription,
} from '../../../app/application/events/index.ts';
import { buildHost } from '../../../app/infrastructure/channels/api/index.ts';
import {
  createFixture,
  gapEvent,
  occurredAt,
  token,
} from '../../contract/api/fixtures.ts';

class TestSubscription
  implements HostEventSubscription, AsyncIterable<HostEvent>
{
  readonly events = this;
  readonly queue: HostEvent[];
  readonly #onClose: () => void;
  #pending: ((result: IteratorResult<HostEvent>) => void) | undefined;
  #closed = false;

  constructor(replay: HostEvent[], onClose: () => void) {
    this.queue = replay;
    this.#onClose = onClose;
  }

  push(event: HostEvent) {
    if (this.#closed) return;
    if (this.#pending) {
      const pending = this.#pending;
      this.#pending = undefined;
      pending({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#pending?.({ done: true, value: undefined });
    this.#pending = undefined;
    this.queue.length = 0;
    this.#onClose();
  }

  [Symbol.asyncIterator](): AsyncIterator<HostEvent> {
    return {
      next: () => {
        if (this.#closed)
          return Promise.resolve({ done: true, value: undefined });
        const event = this.queue.shift();
        if (event) return Promise.resolve({ done: false, value: event });
        return new Promise((resolve) => {
          this.#pending = resolve;
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ done: true, value: undefined });
      },
    };
  }
}

class TestEventSource implements HostEventSource {
  readonly subscriptions = new Set<TestSubscription>();
  readonly history: HostEvent[] = [];
  #waitForClose: (() => void) | undefined;

  publish(event: UiLanguageChanged) {
    const sequence = this.history.length + 1;
    const envelope: HostEvent = {
      ...event,
      sequence,
      eventId: `generation:${sequence}`,
      subscriptionRevision: 1,
      correlationId: 'test-correlation',
    };
    this.history.push(envelope);
    for (const subscription of this.subscriptions) subscription.push(envelope);
  }

  subscribe({
    lastEventId,
    signal,
  }: Parameters<HostEventSource['subscribe']>[0]) {
    const index = this.history.findIndex(
      (event) => event.eventId === lastEventId,
    );
    const replay =
      lastEventId === undefined
        ? []
        : index < 0
          ? [gapEvent()]
          : this.history.slice(index + 1);
    const subscription = new TestSubscription(replay, () => {
      signal.removeEventListener('abort', abort);
      this.subscriptions.delete(subscription);
      this.#waitForClose?.();
      this.#waitForClose = undefined;
    });
    const abort = () => subscription.close();
    this.subscriptions.add(subscription);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) subscription.close();
    return subscription;
  }

  nextClose() {
    return new Promise<void>((resolve) => {
      this.#waitForClose = resolve;
    });
  }
}

async function startTestHost(t: TestContext) {
  const fixture = createFixture();
  const source = new TestEventSource();
  const host = await buildHost({
    ...fixture.dependencies,
    events: source,
    setUiLanguage: new SetUiLanguage({
      unitOfWork: fixture.store,
      clock: { now: () => occurredAt },
      events: source,
    }),
  });
  t.after(() => host.close());
  const url = await host.listen({ host: '127.0.0.1', port: 0 });
  const authorization = { authorization: `Bearer ${token}` };

  async function connect(lastEventId?: string) {
    const controller = new AbortController();
    t.after(() => controller.abort());
    const response = await fetch(`${url}/events`, {
      headers: {
        ...authorization,
        origin: 'app://plysmith',
        ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
      },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      'app://plysmith',
    );
    assert.ok(response.body);
    const reader = response.body.getReader();
    let buffer = '';
    const decoder = new TextDecoder();
    return {
      controller,
      reader,
      nextEvent: async () => {
        while (!buffer.includes('\n\n')) {
          const chunk = await reader.read();
          assert.equal(
            chunk.done,
            false,
            'Expected another event before stream closure',
          );
          buffer += decoder.decode(chunk.value, { stream: true });
        }
        const separator = buffer.indexOf('\n\n');
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        assert.ok(frame.includes('\nevent: host-event\n'));
        const json = frame.split('\ndata: ')[1];
        assert.ok(json);
        return JSON.parse(json) as HostEvent;
      },
    };
  }

  async function setLanguage(uiLocale: string, expectedRevision: number) {
    const response = await fetch(`${url}/preferences/ui-language`, {
      method: 'PUT',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ uiLocale, expectedRevision }),
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  return { host, source, url, authorization, connect, setLanguage };
}

test(
  'loopback: two clients see committed changes and disconnect releases the pending subscription',
  { timeout: 10000 },
  async (t) => {
    const { source, connect, setLanguage, url, authorization } =
      await startTestHost(t);
    const first = await connect();
    const second = await connect();
    assert.equal(source.subscriptions.size, 2);
    await setLanguage('en-GB', 1);
    const firstEvent = await first.nextEvent();
    assert.deepEqual(await second.nextEvent(), firstEvent);
    assert.equal(firstEvent.kind, 'preference.ui-language-changed');
    assert.equal(firstEvent.dataRevision, 1);
    const snapshot = await fetch(`${url}/preferences`, {
      headers: authorization,
    });
    const preferences = await snapshot.json();
    assert.ok(
      typeof preferences === 'object' &&
        preferences !== null &&
        'preferenceRevision' in preferences &&
        'uiLocale' in preferences,
    );
    assert.equal(preferences.preferenceRevision, 2);
    assert.equal(preferences.uiLocale, 'en-GB');

    const closed = source.nextClose();
    first.controller.abort();
    await closed;
    assert.equal(source.subscriptions.size, 1);
    await setLanguage('de-DE', 2);
    assert.equal((await second.nextEvent()).sequence, 2);
  },
);

test(
  'loopback: Last-Event-ID replays missed changes and an unknown cursor yields a gap before new events',
  { timeout: 10000 },
  async (t) => {
    const { connect, setLanguage } = await startTestHost(t);
    await setLanguage('en-GB', 1);
    await setLanguage('de-DE', 2);
    const replay = await connect('generation:1');
    assert.equal((await replay.nextEvent()).eventId, 'generation:2');
    const gap = await connect('previous-host:99');
    assert.equal((await gap.nextEvent()).kind, 'host.replay-gap');
    await setLanguage('en-GB', 3);
    assert.equal((await gap.nextEvent()).eventId, 'generation:3');
  },
);

test(
  'loopback: host close releases idle streams and the port without waiting for a client disconnect',
  { timeout: 10000 },
  async (t) => {
    const { host, source, connect } = await startTestHost(t);
    const client = await connect();
    await host.close();
    assert.equal(source.subscriptions.size, 0);
    assert.equal(host.server.listening, false);
    assert.equal((await client.reader.read()).done, true);
  },
);

test(
  'loopback: disconnect closes a subscription that completes registration late',
  { timeout: 10000 },
  async (t) => {
    const fixture = createFixture();
    let registrationStarted!: () => void;
    let finishRegistration!: () => void;
    let requestAborted!: () => void;
    let subscriptionClosed!: () => void;
    let iteratorEntered = false;
    let closeCount = 0;
    const started = new Promise<void>((resolve) => {
      registrationStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      finishRegistration = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      requestAborted = resolve;
    });
    const closed = new Promise<void>((resolve) => {
      subscriptionClosed = resolve;
    });
    const events: HostEventSource = {
      subscribe: async ({ signal }) => {
        signal.addEventListener('abort', requestAborted, { once: true });
        registrationStarted();
        await released;
        return {
          events: {
            [Symbol.asyncIterator]() {
              iteratorEntered = true;
              throw new Error('A disconnected subscription was consumed.');
            },
          },
          close: () => {
            closeCount += 1;
            subscriptionClosed();
          },
        };
      },
    };
    const host = await buildHost({ ...fixture.dependencies, events });
    t.after(() => host.close());
    const url = await host.listen({ host: '127.0.0.1', port: 0 });
    const request = httpRequest(`${url}/events`, {
      headers: { authorization: `Bearer ${token}` },
    });
    request.on('error', () => undefined);
    request.end();

    await started;
    request.destroy();
    await aborted;
    finishRegistration();
    await closed;
    assert.equal(iteratorEntered, false);
    assert.equal(closeCount, 1);
  },
);

test(
  'loopback: an otherwise valid Host header cannot name a different local port',
  { timeout: 10000 },
  async (t) => {
    const { url, authorization } = await startTestHost(t);
    const port = Number(new URL(url).port);
    // fetch normalizes Host, so send this intentionally mismatched header with HTTP.
    const response = await new Promise<{
      status: number | undefined;
      body: string;
    }>((resolve, reject) => {
      const request = httpRequest(
        `${url}/status`,
        {
          headers: {
            ...authorization,
            host: `127.0.0.1:${port === 43210 ? 43211 : 43210}`,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('end', () =>
            resolve({
              status: response.statusCode,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      request.on('error', reject);
      request.end();
    });
    assert.equal(response.status, 403);
    assert.equal(JSON.parse(response.body).code, 'host.invalid_host');
  },
);
