import { Value } from '@sinclair/typebox/value';
import { EventSource } from 'eventsource';

import {
  apiSchemas,
  HostEventSchema,
  type HostEvent,
} from '../api/contract.ts';
import {
  createHostFetch,
  type HostConnection,
  type HostFetchOptions,
} from './host-fetch.ts';

export interface HostEventClientOptions extends HostFetchOptions {
  readonly onEvent: (event: HostEvent) => void;
  readonly onGap: (
    event: Extract<HostEvent, { kind: 'host.replay-gap' }>,
  ) => void;
  readonly onReconnect?: () => void;
  readonly onInvalidEvent?: () => void;
}

export class HostEventClient {
  readonly #eventSource: EventSource;
  readonly ready: Promise<void>;

  constructor(connection: HostConnection, options: HostEventClientOptions) {
    const hostFetch = createHostFetch(connection, options);
    let opened = false;
    let resolveReady: (() => void) | undefined;
    let rejectReady: ((error: Error) => void) | undefined;
    this.ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this.#eventSource = new EventSource(
      new URL('/events', connection.endpoint),
      {
        maxBufferSize: 256 * 1024,
        fetch: (url, init) =>
          hostFetch(url, init as RequestInit) as ReturnType<typeof hostFetch>,
      },
    );
    this.#eventSource.addEventListener('open', () => {
      if (!opened) {
        opened = true;
        resolveReady?.();
        return;
      }
      options.onReconnect?.();
    });
    this.#eventSource.addEventListener('error', () => {
      if (!opened) {
        rejectReady?.(new Error('Host event subscription unavailable.'));
        this.close();
      }
    });
    this.#eventSource.addEventListener('host-event', (message) => {
      let candidate: unknown;
      try {
        candidate = JSON.parse(String(message.data));
      } catch {
        options.onInvalidEvent?.();
        this.close();
        return;
      }
      if (!Value.Check(HostEventSchema, [...apiSchemas], candidate)) {
        options.onInvalidEvent?.();
        this.close();
        return;
      }
      if (candidate.kind === 'host.replay-gap') {
        options.onGap(candidate);
      }
      options.onEvent(candidate);
    });
  }

  close(): void {
    this.#eventSource.close();
  }
}
