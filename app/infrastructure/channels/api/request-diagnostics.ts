import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { DiagnosticSink } from '../../../../contracts/diagnostics/index.ts';

interface RequestDiagnosticContext {
  readonly correlationId: string;
  readonly startedAt: number;
  problemCode?: string;
}

const requestContexts = new WeakMap<FastifyRequest, RequestDiagnosticContext>();
const correlationPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

export function installRequestDiagnostics(
  host: FastifyInstance,
  diagnostics: DiagnosticSink,
  correlationIdFactory: () => string,
): void {
  host.addHook('onRequest', async (request) => {
    const supplied = request.headers['x-plysmith-correlation-id'];
    const correlationId =
      typeof supplied === 'string' && correlationPattern.test(supplied)
        ? supplied
        : correlationIdFactory();
    requestContexts.set(request, {
      correlationId,
      startedAt: performance.now(),
    });
  });
  host.addHook('onResponse', async (request, reply) => {
    const context = requestContexts.get(request);
    if (context === undefined) return;
    const failed = reply.statusCode >= 400;
    const operation = requestOperation(request);
    if (!failed && operation === 'GetSystemStatus') return;
    diagnostics.write({
      level: reply.statusCode >= 500 ? 'error' : failed ? 'info' : 'debug',
      eventCode: 'host.request.completed',
      correlationId: context.correlationId,
      operation,
      status: failed ? 'failed' : 'succeeded',
      ...(context.problemCode === undefined
        ? {}
        : { problemCode: context.problemCode }),
      statusCode: reply.statusCode,
      durationMilliseconds: performance.now() - context.startedAt,
    });
  });
}

export function requestCorrelationId(
  request: FastifyRequest,
  correlationIdFactory: () => string,
): string {
  return requestContexts.get(request)?.correlationId ?? correlationIdFactory();
}

export function markRequestProblem(
  request: FastifyRequest,
  problemCode: string,
): void {
  const context = requestContexts.get(request);
  if (context !== undefined) context.problemCode = problemCode;
}

function requestOperation(request: FastifyRequest): string {
  const schema = request.routeOptions.schema as
    { readonly operationId?: unknown } | undefined;
  return typeof schema?.operationId === 'string' &&
    /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(schema.operationId)
    ? schema.operationId
    : request.method === 'OPTIONS'
      ? 'Preflight'
      : 'UnknownRequest';
}
