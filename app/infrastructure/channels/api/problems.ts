import type { FastifyInstance, FastifyReply } from 'fastify';
import { ApplicationProblem } from '../../../application/problems/application-problem.ts';
import type { ProblemDetails } from './schemas.ts';

export const problemUriBase =
  'https://github.com/lzzzy/plysmith/blob/main/docs/problems/';

const catalog = {
  'request.invalid': [
    400,
    'Invalid request',
    'The request does not match the host contract.',
  ],
  'request.not_found': [
    404,
    'Not found',
    'The requested operation is not available.',
  ],
  'request.not_acceptable': [
    406,
    'Not acceptable',
    'This operation requires an event-stream response.',
  ],
  'request.too_large': [
    413,
    'Request too large',
    'The request exceeds the size limit.',
  ],
  'request.unsupported_media_type': [
    415,
    'Unsupported media type',
    'The request requires application/json.',
  ],
  'host.invalid_host': [
    403,
    'Invalid host',
    'The request must target the local host.',
  ],
  'host.invalid_origin': [
    403,
    'Invalid origin',
    'The request origin is not permitted.',
  ],
  'host.invalid_preflight': [
    403,
    'Invalid preflight',
    'The requested cross-origin operation is not permitted.',
  ],
  'host.unauthorized': [
    401,
    'Unauthorized',
    'A valid local connection token is required.',
  ],
  'host.failure': [
    500,
    'Host failure',
    'The host could not complete the operation.',
  ],
  'preference.invalid_ui_language': [
    400,
    'Invalid UI language',
    'The UI language must be de-DE or en-GB.',
  ],
  'preference.invalid_revision': [
    400,
    'Invalid preference revision',
    'The expected preference revision must be a positive safe integer.',
  ],
  'preference.revision_conflict': [
    409,
    'Preference revision conflict',
    'Read the current preferences before submitting another change.',
  ],
} as const;

export type ApiProblemCode = keyof typeof catalog;

export class ApiProblem extends Error {
  readonly code: ApiProblemCode;

  constructor(code: ApiProblemCode) {
    super(code);
    this.code = code;
  }
}

export function sendProblem(
  reply: FastifyReply,
  code: ApiProblemCode,
  correlationIdFactory: () => string,
  parameters: ProblemDetails['parameters'] = {},
) {
  const [status, title, detail] = catalog[code];
  const correlationId = correlationIdFactory();
  const problem: ProblemDetails = {
    type: `${problemUriBase}${code}.md`,
    title,
    status,
    detail,
    instance: `urn:plysmith:problem:${correlationId}`,
    code,
    correlationId,
    retryable: false,
    parameters,
  };
  if (status === 401) reply.header('www-authenticate', 'Bearer');
  return reply.code(status).type('application/problem+json').send(problem);
}

export function installProblemHandling(
  host: FastifyInstance,
  correlationIdFactory: () => string,
) {
  host.setErrorHandler((error, _request, reply) => {
    if (reply.raw.headersSent) {
      reply.raw.end();
      return;
    }
    if (error instanceof ApiProblem) {
      return sendProblem(reply, error.code, correlationIdFactory);
    }
    if (error instanceof ApplicationProblem) {
      switch (error.problemCode) {
        case 'preference.invalid_ui_language':
        case 'preference.invalid_revision':
          return sendProblem(reply, error.problemCode, correlationIdFactory);
        case 'preference.revision_conflict': {
          const parameters: ProblemDetails['parameters'] = {};
          for (const key of ['expectedRevision', 'currentRevision'] as const) {
            const value = error.parameters[key];
            if (
              typeof value === 'number' &&
              Number.isSafeInteger(value) &&
              value > 0
            ) {
              parameters[key] = value;
            }
          }
          return sendProblem(
            reply,
            error.problemCode,
            correlationIdFactory,
            parameters,
          );
        }
      }
    }
    if (typeof error === 'object' && error !== null) {
      if ('validation' in error) {
        return sendProblem(reply, 'request.invalid', correlationIdFactory);
      }
      if ('code' in error) {
        switch (error.code) {
          case 'FST_ERR_CTP_INVALID_JSON_BODY':
          case 'FST_ERR_CTP_EMPTY_JSON_BODY':
            return sendProblem(reply, 'request.invalid', correlationIdFactory);
          case 'FST_ERR_CTP_BODY_TOO_LARGE':
            return sendProblem(
              reply,
              'request.too_large',
              correlationIdFactory,
            );
          case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
            return sendProblem(
              reply,
              'request.unsupported_media_type',
              correlationIdFactory,
            );
        }
      }
    }
    return sendProblem(reply, 'host.failure', correlationIdFactory);
  });
  host.setNotFoundHandler((_request, reply) =>
    sendProblem(reply, 'request.not_found', correlationIdFactory),
  );
}
