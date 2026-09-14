import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApplicationProblem } from '../../../application/problems/application-problem.ts';
import type { ProblemDetails } from './schemas.ts';
import {
  markRequestProblem,
  requestCorrelationId,
} from './request-diagnostics.ts';

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
  'analysis.invalid_update': [
    400,
    'Invalid analysis update',
    'The analysis scratch update is invalid.',
  ],
  'analysis.scratch_not_found': [
    404,
    'Analysis scratch not found',
    'The analysis scratch does not exist.',
  ],
  'analysis.scratch_revision_conflict': [
    409,
    'Analysis scratch revision conflict',
    'Read the current analysis workspace before submitting another change.',
  ],
  'analysis.note_revision_conflict': [
    409,
    'Analysis note revision conflict',
    'Read the current analysis workspace before submitting another change.',
  ],
  'analysis.invalid_record': [
    400,
    'Invalid analysis record',
    'The analysis record input or note draft is invalid.',
  ],
  'analysis.invalid_note': [
    400,
    'Invalid analysis note',
    'The analysis note, source anchor or visibility is invalid.',
  ],
  'chess.invalid_fen': [
    400,
    'Invalid chess position',
    'The FEN does not describe a valid supported chess position.',
  ],
  'chess.invalid_move_input': [
    400,
    'Invalid move input',
    'The move input does not use a supported notation.',
  ],
  'chess.illegal_move': [
    400,
    'Illegal move',
    'The move is not legal in the current position.',
  ],
  'chess.invalid_line': [
    400,
    'Invalid chess line',
    'The stored or submitted move line is invalid.',
  ],
  'inventory.invalid_search': [
    400,
    'Invalid inventory search',
    'The inventory search request is invalid.',
  ],
  'inventory.item_not_found': [
    404,
    'Inventory item not found',
    'The inventory item does not exist.',
  ],
  'workspace.invalid_context': [
    400,
    'Invalid working context',
    'The working context input is invalid.',
  ],
  'workspace.context_not_found': [
    404,
    'Working context not found',
    'The working context does not exist.',
  ],
  'workspace.invalid_page': [
    400,
    'Invalid working context page',
    'The working context page request is invalid.',
  ],
  'workspace.invalid_resume': [
    400,
    'Invalid work-scope resume',
    'The work-scope resume is invalid.',
  ],
  'workspace.resume_revision_conflict': [
    409,
    'Work-scope resume revision conflict',
    'Read the current working context before submitting another change.',
  ],
  'workspace.reference_target_not_found': [
    404,
    'Context reference target not found',
    'The referenced inventory item or anchor does not exist.',
  ],
  'workspace.reference_exists': [
    409,
    'Context reference already exists',
    'The working context already references this anchor.',
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
  correlationId: string,
  parameters: ProblemDetails['parameters'] = {},
) {
  const [status, title, detail] = catalog[code];
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
  host.setErrorHandler((error, request, reply) => {
    if (reply.raw.headersSent) {
      reply.raw.end();
      return;
    }
    if (error instanceof ApiProblem) {
      return replyWithProblem(request, reply, error.code, correlationIdFactory);
    }
    if (error instanceof ApplicationProblem) {
      switch (error.problemCode) {
        case 'preference.invalid_ui_language':
        case 'preference.invalid_revision':
          return replyWithProblem(
            request,
            reply,
            error.problemCode,
            correlationIdFactory,
          );
        case 'preference.revision_conflict':
        case 'analysis.scratch_revision_conflict':
        case 'analysis.note_revision_conflict':
        case 'workspace.resume_revision_conflict': {
          const parameters: ProblemDetails['parameters'] = {};
          for (const key of ['expectedRevision', 'currentRevision'] as const) {
            const value = error.parameters[key];
            if (
              typeof value === 'number' &&
              Number.isSafeInteger(value) &&
              value >= 0
            ) {
              parameters[key] = value;
            }
          }
          return replyWithProblem(
            request,
            reply,
            error.problemCode,
            correlationIdFactory,
            parameters,
          );
        }
        case 'analysis.invalid_update':
        case 'analysis.invalid_record':
        case 'analysis.invalid_note':
        case 'chess.invalid_fen':
        case 'chess.invalid_move_input':
        case 'chess.illegal_move':
        case 'chess.invalid_line':
        case 'inventory.invalid_search':
        case 'workspace.invalid_context':
        case 'workspace.invalid_page':
        case 'workspace.invalid_resume':
          return replyWithProblem(
            request,
            reply,
            error.problemCode,
            correlationIdFactory,
          );
        case 'analysis.scratch_not_found':
        case 'inventory.item_not_found':
        case 'workspace.context_not_found':
        case 'workspace.reference_target_not_found':
        case 'workspace.reference_exists':
          return replyWithProblem(
            request,
            reply,
            error.problemCode,
            correlationIdFactory,
          );
      }
    }
    if (typeof error === 'object' && error !== null) {
      if ('validation' in error) {
        return replyWithProblem(
          request,
          reply,
          'request.invalid',
          correlationIdFactory,
        );
      }
      if ('code' in error) {
        switch (error.code) {
          case 'FST_ERR_CTP_INVALID_JSON_BODY':
          case 'FST_ERR_CTP_EMPTY_JSON_BODY':
            return replyWithProblem(
              request,
              reply,
              'request.invalid',
              correlationIdFactory,
            );
          case 'FST_ERR_CTP_BODY_TOO_LARGE':
            return replyWithProblem(
              request,
              reply,
              'request.too_large',
              correlationIdFactory,
            );
          case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
            return replyWithProblem(
              request,
              reply,
              'request.unsupported_media_type',
              correlationIdFactory,
            );
        }
      }
    }
    return replyWithProblem(
      request,
      reply,
      'host.failure',
      correlationIdFactory,
    );
  });
  host.setNotFoundHandler((request, reply) =>
    replyWithProblem(request, reply, 'request.not_found', correlationIdFactory),
  );
}

function replyWithProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  code: ApiProblemCode,
  correlationIdFactory: () => string,
  parameters: ProblemDetails['parameters'] = {},
) {
  markRequestProblem(request, code);
  return sendProblem(
    reply,
    code,
    requestCorrelationId(request, correlationIdFactory),
    parameters,
  );
}
