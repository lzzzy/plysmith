import { TypeCompiler } from '@sinclair/typebox/compiler';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  HostEvent as ApplicationHostEvent,
  HostEventSource,
  HostEventSubscription,
} from '../../../application/events/index.ts';
import { ApiProblem } from './problems.ts';
import {
  apiSchemas,
  EmptyQuerySchema,
  EventHeadersSchema,
  HostEventSchema,
  problemResponses,
  type HostEvent,
} from './schemas.ts';

const eventValidator = TypeCompiler.Compile(HostEventSchema, [...apiSchemas]);
const headerValidator = TypeCompiler.Compile(EventHeadersSchema);

function eventDto(event: ApplicationHostEvent): HostEvent {
  const metadata = {
    eventId: event.eventId,
    sequence: event.sequence,
    dataRevision: event.dataRevision,
    occurredAt: event.occurredAt,
    subscriptionRevision: event.subscriptionRevision,
    correlationId: event.correlationId,
  };
  switch (event.kind) {
    case 'preference.ui-language-changed':
      return {
        ...metadata,
        kind: event.kind,
        preferenceRevision: event.preferenceRevision,
        payload: {
          previousUiLocale: event.payload.previousUiLocale,
          uiLocale: event.payload.uiLocale,
        },
      };
    case 'host.replay-gap':
      return {
        ...metadata,
        kind: event.kind,
        payload: { reason: event.payload.reason },
      };
    case 'analysis.scratch-changed':
      return {
        ...metadata,
        kind: event.kind,
        payload: {
          scope:
            event.payload.scope.kind === 'free'
              ? { kind: 'free' }
              : {
                  kind: 'context',
                  contextId: String(event.payload.scope.contextId.value),
                },
          ...(event.payload.scratchId === undefined
            ? {}
            : { scratchId: event.payload.scratchId }),
          ...(event.payload.scratchRevision === undefined
            ? {}
            : { scratchRevision: event.payload.scratchRevision }),
        },
      };
    case 'analysis.contribution-created':
      return {
        ...metadata,
        kind: event.kind,
        payload: {
          itemId: String(event.payload.itemId.value),
          contributionId: String(event.payload.contributionId.value),
        },
      };
    case 'inventory.item-created':
      return {
        ...metadata,
        kind: event.kind,
        payload: {
          itemId: String(event.payload.itemId.value),
          revisionId: String(event.payload.revisionId.value),
        },
      };
    case 'analysis.contribution-changed':
      return {
        ...metadata,
        kind: event.kind,
        payload: {
          itemId: String(event.payload.itemId.value),
          contributionId: String(event.payload.contributionId.value),
          changeKind: event.payload.changeKind,
        },
      };
    case 'workspace.context-created':
      return {
        ...metadata,
        kind: event.kind,
        payload: {
          contextId: String(event.payload.contextId.value),
          contextVersion: event.payload.contextVersion,
        },
      };
    case 'workspace.reference-added':
      return {
        ...metadata,
        kind: event.kind,
        payload: {
          contextId: String(event.payload.contextId.value),
          referenceId: String(event.payload.referenceId.value),
        },
      };
    case 'workspace.resume-updated':
      return {
        ...metadata,
        kind: event.kind,
        payload: {
          contextId: String(event.payload.contextId.value),
          area: event.payload.area,
          resumeVersion: event.payload.resumeVersion,
        },
      };
    default: {
      const unsupported: never = event;
      void unsupported;
      throw new Error('Unsupported host event.');
    }
  }
}

// Choose the most specific media range, including an explicit SSE refusal.
function acceptsEventStream(accept: string | undefined): boolean {
  if (!accept) return true;
  let specificity = -1;
  let quality = 0;
  for (const range of accept.split(',')) {
    const [type, ...parameters] = range.trim().toLowerCase().split(';');
    const candidate = ['*/*', 'text/*', 'text/event-stream'].indexOf(
      type?.trim() ?? '',
    );
    if (candidate < 0) continue;
    const parameter = parameters
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith('q='));
    const weight = parameter === undefined ? 1 : Number(parameter.slice(2));
    const validWeight =
      Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0;
    if (candidate > specificity) {
      specificity = candidate;
      quality = validWeight;
    } else if (candidate === specificity) {
      quality = Math.max(quality, validWeight);
    }
  }
  return quality > 0;
}

async function sendEvent(
  reply: FastifyReply,
  event: HostEvent,
  signal: AbortSignal,
) {
  if (signal.aborted) return;
  let disconnected!: () => void;
  const closed = new Promise<void>((resolve) => {
    disconnected = resolve;
  });
  signal.addEventListener('abort', disconnected, { once: true });
  try {
    // Also release a write waiting on drain when the client closes its socket.
    await Promise.race([
      reply.sse.send({ id: event.eventId, event: 'host-event', data: event }),
      closed,
    ]);
  } finally {
    signal.removeEventListener('abort', disconnected);
  }
}

export function registerEventsRoute(
  host: FastifyInstance,
  source: HostEventSource,
) {
  const connections = new Set<() => void>();
  host.addHook('preClose', async () => {
    for (const close of connections) close();
  });

  host.get(
    '/events',
    {
      sse: 'manual',
      schema: {
        operationId: 'SubscribeHostEvents',
        querystring: EmptyQuerySchema,
        response: {
          200: {
            description:
              'SSE frames use event: host-event, id: eventId and JSON data matching HostEvent. A host.replay-gap requires fresh query snapshots.',
            content: {
              'text/event-stream': {
                schema: Type.String({
                  'x-host-event-schema': {
                    $ref: '#/components/schemas/HostEvent',
                  },
                }),
              },
            },
          },
          ...problemResponses,
        },
      },
    },
    async (request, reply) => {
      if (!acceptsEventStream(request.headers.accept)) {
        throw new ApiProblem('request.not_acceptable');
      }
      const lastEventId = request.headers['last-event-id'];
      const selectedHeaders =
        lastEventId === undefined ? {} : { 'last-event-id': lastEventId };
      if (!headerValidator.Check(selectedHeaders))
        throw new ApiProblem('request.invalid');

      const controller = new AbortController();
      let subscription: HostEventSubscription | undefined;
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        connections.delete(close);
        controller.abort();
        subscription?.close();
        reply.sse.close();
      };
      connections.add(close);
      reply.sse.onClose(close);
      try {
        subscription = await source.subscribe({
          lastEventId: selectedHeaders['last-event-id'],
          signal: controller.signal,
        });
        if (closed) {
          subscription.close();
          return;
        }
        reply.sse.sendHeaders();
        reply.raw.flushHeaders();
        for await (const event of subscription.events) {
          if (closed) break;
          const dto = eventDto(event);
          if (!eventValidator.Check(dto))
            throw new Error('Invalid host event.');
          await sendEvent(reply, dto, controller.signal);
        }
      } finally {
        close();
      }
    },
  );
}
