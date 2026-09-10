import { randomUUID } from 'node:crypto';

import type {
  UiLanguageChanged,
  UiLanguageChangedPublisher,
} from '../preferences/index.ts';

export type HostEvent =
  PreferenceUiLanguageChangedHostEvent | ReplayGapHostEvent;

export interface PreferenceUiLanguageChangedHostEvent extends HostEventMetadata {
  readonly kind: 'preference.ui-language-changed';
  readonly preferenceRevision: number;
  readonly payload: UiLanguageChanged['payload'];
}

export interface ReplayGapHostEvent extends HostEventMetadata {
  readonly kind: 'host.replay-gap';
  readonly payload: {
    readonly reason: 'replay_unavailable' | 'slow_consumer';
  };
}

export interface HostEventMetadata {
  readonly eventId: string;
  readonly sequence: number;
  readonly dataRevision: number;
  readonly occurredAt: string;
  readonly subscriptionRevision: number;
  readonly correlationId: string;
}

export interface HostEventSubscription {
  readonly events: AsyncIterable<HostEvent>;
  close(): void;
}

export interface HostEventSource {
  subscribe(request: {
    readonly lastEventId: string | undefined;
    readonly signal: AbortSignal;
  }): HostEventSubscription | Promise<HostEventSubscription>;
}

export interface HostEventStreamOptions {
  readonly replayCapacity?: number;
  readonly subscriberQueueCapacity?: number;
  readonly generation?: string;
  readonly now?: () => string;
  readonly correlationIdFactory?: () => string;
}

export class HostEventStream
  implements UiLanguageChangedPublisher, HostEventSource
{
  readonly #replayCapacity: number;
  readonly #subscriberQueueCapacity: number;
  readonly #generation: string;
  readonly #now: () => string;
  readonly #correlationIdFactory: () => string;
  readonly #replay: HostEvent[] = [];
  readonly #subscribers = new Set<EventQueue>();
  #sequence = 0;
  #dataRevision = 0;
  #controlSequence = 0;

  constructor(options: HostEventStreamOptions = {}) {
    this.#replayCapacity = positiveInteger(options.replayCapacity ?? 128);
    this.#subscriberQueueCapacity = positiveInteger(
      options.subscriberQueueCapacity ?? 128,
    );
    this.#generation = options.generation ?? randomUUID();
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#correlationIdFactory = options.correlationIdFactory ?? randomUUID;
  }

  publish(event: UiLanguageChanged): void {
    try {
      const hostEvent: PreferenceUiLanguageChangedHostEvent = Object.freeze({
        eventId: this.#nextEventId(),
        kind: event.kind,
        sequence: this.#sequence,
        dataRevision: event.dataRevision,
        occurredAt: event.occurredAt,
        subscriptionRevision: 1,
        correlationId: this.#correlationIdFactory(),
        preferenceRevision: event.preferenceRevision,
        payload: Object.freeze({ ...event.payload }),
      });
      this.#dataRevision = event.dataRevision;
      this.#replay.push(hostEvent);
      while (this.#replay.length > this.#replayCapacity) {
        this.#replay.shift();
      }

      for (const subscriber of this.#subscribers) {
        if (!subscriber.push(hostEvent)) {
          subscriber.replaceWith(this.#replayGap('slow_consumer'));
        }
      }
    } catch {
      // Committed Application commands must not fail because event delivery did.
    }
  }

  subscribe(request: {
    readonly lastEventId: string | undefined;
    readonly signal: AbortSignal;
  }): HostEventSubscription {
    const queue = new EventQueue(this.#subscriberQueueCapacity, () => {
      this.#subscribers.delete(queue);
      request.signal.removeEventListener('abort', close);
    });
    const close = (): void => queue.close();
    request.signal.addEventListener('abort', close, { once: true });

    for (const event of this.#selectReplay(request.lastEventId)) {
      queue.push(event);
    }
    this.#subscribers.add(queue);

    if (request.signal.aborted) {
      queue.close();
    }

    return Object.freeze({
      events: queue,
      close,
    });
  }

  #selectReplay(lastEventId: string | undefined): readonly HostEvent[] {
    if (lastEventId === undefined) {
      return [];
    }

    const lastSequence = this.#parseEventId(lastEventId);
    const earliestSequence = this.#replay[0]?.sequence ?? this.#sequence + 1;
    if (
      lastSequence === undefined ||
      lastSequence > this.#sequence ||
      lastSequence < earliestSequence - 1
    ) {
      return [this.#replayGap('replay_unavailable')];
    }

    return this.#replay.filter((event) => event.sequence > lastSequence);
  }

  #parseEventId(eventId: string): number | undefined {
    const prefix = `${this.#generation}:`;
    if (!eventId.startsWith(prefix)) {
      return undefined;
    }
    const sequence = Number(eventId.slice(prefix.length));
    return Number.isSafeInteger(sequence) && sequence >= 0
      ? sequence
      : undefined;
  }

  #nextEventId(): string {
    this.#sequence += 1;
    return `${this.#generation}:${this.#sequence}`;
  }

  #replayGap(
    reason: ReplayGapHostEvent['payload']['reason'],
  ): ReplayGapHostEvent {
    this.#controlSequence += 1;
    return Object.freeze({
      eventId: `${this.#generation}:gap:${this.#controlSequence}`,
      kind: 'host.replay-gap',
      sequence: this.#sequence,
      dataRevision: this.#dataRevision,
      occurredAt: this.#now(),
      subscriptionRevision: 1,
      correlationId: this.#correlationIdFactory(),
      payload: Object.freeze({ reason }),
    });
  }
}

class EventQueue implements AsyncIterable<HostEvent> {
  readonly #capacity: number;
  readonly #onClose: () => void;
  readonly #events: HostEvent[] = [];
  #waiting: ((result: IteratorResult<HostEvent>) => void) | undefined;
  #closed = false;

  constructor(capacity: number, onClose: () => void) {
    this.#capacity = capacity;
    this.#onClose = onClose;
  }

  push(event: HostEvent): boolean {
    if (this.#closed) {
      return true;
    }
    if (this.#waiting !== undefined) {
      const resolve = this.#waiting;
      this.#waiting = undefined;
      resolve({ done: false, value: event });
      return true;
    }
    if (this.#events.length >= this.#capacity) {
      return false;
    }
    this.#events.push(event);
    return true;
  }

  replaceWith(event: HostEvent): void {
    this.#events.length = 0;
    this.push(event);
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#events.length = 0;
    this.#onClose();
    this.#waiting?.({ done: true, value: undefined });
    this.#waiting = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<HostEvent> {
    return {
      next: () => this.#next(),
      return: async () => {
        this.close();
        return { done: true, value: undefined };
      },
    };
  }

  #next(): Promise<IteratorResult<HostEvent>> {
    const event = this.#events.shift();
    if (event !== undefined) {
      return Promise.resolve({ done: false, value: event });
    }
    if (this.#closed) {
      return Promise.resolve({ done: true, value: undefined });
    }
    if (this.#waiting !== undefined) {
      return Promise.reject(new Error('Only one event consumer is supported.'));
    }
    return new Promise((resolve) => {
      this.#waiting = resolve;
    });
  }
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('Event stream capacities must be positive integers.');
  }
  return value;
}
