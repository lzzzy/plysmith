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
  'inventory.display_name_conflict': [
    409,
    'Inventory name conflict',
    'An active analysis already uses this name. Choose another name.',
  ],
  'inventory.invalid_deletion': [
    400,
    'Invalid inventory deletion',
    'The inventory deletion request is invalid.',
  ],
  'inventory.deletion_conflict': [
    409,
    'Inventory deletion conflict',
    'Read the current deletion preview before deleting the item.',
  ],
  'workspace.invalid_removal_confirmation': [
    400,
    'Invalid removal confirmation',
    'Removal requires the versions from its current preview.',
  ],
  'workspace.removal_preview_conflict': [
    409,
    'Removal preview conflict',
    'Read the current removal preview before removing work.',
  ],
  'workspace.startup_revision_conflict': [
    409,
    'Startup revision conflict',
    'Read the current startup preference before changing it.',
  ],
  'workspace.inventory_work_not_allowed': [
    403,
    'Inventory work not allowed',
    'Assign the item to the selected working context before working with it.',
  ],
  'workspace.context_version_conflict': [
    409,
    'Working context version conflict',
    'Read the current context before submitting another change.',
  ],
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
  'diagnostics.invalid_log_level': [
    400,
    'Invalid diagnostic log level',
    'The diagnostic log level is not supported.',
  ],
  'diagnostics.invalid_configuration_revision': [
    400,
    'Invalid diagnostic configuration revision',
    'The diagnostic configuration revision is invalid.',
  ],
  'diagnostics.configuration_conflict': [
    409,
    'Diagnostic configuration conflict',
    'Read the current diagnostic settings before submitting another change.',
  ],
  'diagnostics.invalid_report_request': [
    400,
    'Invalid diagnostic report request',
    'The diagnostic report request is invalid.',
  ],
  'diagnostics.invalid_report_target': [
    400,
    'Invalid diagnostic report target',
    'The diagnostic report target is not permitted.',
  ],
  'diagnostics.report_target_exists': [
    409,
    'Diagnostic report target exists',
    'Choose a new file name for the diagnostic report.',
  ],
  'configuration.engine_invalid': [
    400,
    'Invalid engine configuration',
    'The engine provider configuration is invalid.',
  ],
  'configuration.engine_conflict': [
    409,
    'Engine configuration conflict',
    'Read the current engine provider configuration before saving again.',
  ],
  'playout.invalid': [
    400,
    'Invalid playout request',
    'The playout request is invalid.',
  ],
  'playout.not_found': [
    404,
    'Playout not found',
    'The playout draft does not exist.',
  ],
  'playout.revision_conflict': [
    409,
    'Playout revision conflict',
    'Read the current playout before submitting another change.',
  ],
  'playout.move_policy_unavailable': [
    409,
    'Move policy unavailable',
    'The selected engine does not provide the requested move policy.',
  ],
  'playout.provider_unavailable': [
    503,
    'Engine unavailable',
    'The selected engine is unavailable.',
  ],
  'playout.provider_protocol_error': [
    502,
    'Engine protocol error',
    'The selected engine could not produce a valid move.',
  ],
  'playout.provider_timeout': [
    504,
    'Engine timeout',
    'The selected engine did not respond in time.',
  ],
  'playout.provider_resource_exhausted': [
    503,
    'Engine resource limit reached',
    'The selected engine exceeded its configured resource limit.',
  ],
  'playout.capability_missing': [
    409,
    'Engine capability missing',
    'The selected engine does not provide the requested capability.',
  ],
  'playout.illegal_engine_move': [
    502,
    'Illegal engine move',
    'The selected engine returned an illegal move.',
  ],
  'playout.interrupted': [
    409,
    'Playout interrupted',
    'The playout changed before the engine response was applied.',
  ],
  'analysis.invalid_update': [
    400,
    'Invalid analysis update',
    'The analysis scratch update is invalid.',
  ],
  'analysis.invalid_setup': [
    400,
    'Invalid analysis setup',
    'The analysis setup is not a valid supported chess position.',
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
  'analysis.position_invalid_request': [
    400,
    'Invalid position analysis request',
    'The position analysis request is invalid.',
  ],
  'analysis.position_invalid_focus': [
    409,
    'Position analysis focus changed',
    'The visible analysis focus no longer matches the submitted line.',
  ],
  'analysis.position_provider_unavailable': [
    503,
    'Analysis provider unavailable',
    'The selected analysis provider is unavailable.',
  ],
  'analysis.position_provider_protocol_error': [
    502,
    'Analysis provider protocol error',
    'The selected provider did not produce a valid analysis.',
  ],
  'analysis.position_provider_timeout': [
    504,
    'Analysis provider timeout',
    'The selected provider did not complete the analysis in time.',
  ],
  'analysis.position_provider_resource_exhausted': [
    503,
    'Analysis provider resource limit reached',
    'The selected provider is busy or exceeded its configured resource limit.',
  ],
  'analysis.position_capability_missing': [
    409,
    'Analysis capability missing',
    'The selected provider does not support this analysis.',
  ],
  'analysis.position_illegal_engine_move': [
    502,
    'Illegal analysis move',
    'The selected provider returned an illegal analysis move.',
  ],
  'analysis.position_interrupted': [
    409,
    'Position analysis interrupted',
    'The analysis focus changed before the provider completed.',
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
  'inventory.invalid_revision': [
    400,
    'Invalid inventory revision',
    'The inventory revision request is invalid.',
  ],
  'inventory.revision_conflict': [
    409,
    'Inventory revision conflict',
    'Read the current inventory revision before submitting another change.',
  ],
  'inventory.preview_conflict': [
    409,
    'Inventory revision preview conflict',
    'Preview the inventory revision again before saving it.',
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
  'workspace.impact_not_found': [
    404,
    'Revision impact not found',
    'The pending revision impact does not exist.',
  ],
  'workspace.impact_conflict': [
    409,
    'Revision impact conflict',
    'Read the current revision impact before resolving it.',
  ],
  'workspace.invalid_impact_resolution': [
    400,
    'Invalid revision impact resolution',
    'The revision impact resolution is incomplete or invalid.',
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
        case 'diagnostics.invalid_log_level':
        case 'diagnostics.invalid_configuration_revision':
        case 'diagnostics.invalid_report_request':
        case 'diagnostics.invalid_report_target':
        case 'configuration.engine_invalid':
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
        case 'diagnostics.configuration_conflict':
        case 'diagnostics.report_target_exists':
        case 'configuration.engine_conflict':
        case 'playout.revision_conflict':
        case 'playout.move_policy_unavailable':
        case 'playout.capability_missing':
        case 'playout.interrupted':
        case 'analysis.position_invalid_focus':
        case 'analysis.position_capability_missing':
        case 'analysis.position_interrupted':
        case 'inventory.revision_conflict':
        case 'inventory.preview_conflict':
        case 'inventory.deletion_conflict':
        case 'inventory.display_name_conflict':
        case 'workspace.removal_preview_conflict':
        case 'workspace.startup_revision_conflict':
        case 'workspace.impact_conflict':
        case 'workspace.context_version_conflict':
        case 'workspace.inventory_work_not_allowed':
          return replyWithProblem(
            request,
            reply,
            error.problemCode,
            correlationIdFactory,
          );
        case 'analysis.invalid_update':
        case 'analysis.invalid_setup':
        case 'analysis.invalid_record':
        case 'analysis.invalid_note':
        case 'analysis.position_invalid_request':
        case 'chess.invalid_fen':
        case 'chess.invalid_move_input':
        case 'chess.illegal_move':
        case 'chess.invalid_line':
        case 'inventory.invalid_search':
        case 'inventory.invalid_revision':
        case 'inventory.invalid_deletion':
        case 'workspace.invalid_removal_confirmation':
        case 'workspace.invalid_context':
        case 'workspace.invalid_page':
        case 'workspace.invalid_resume':
        case 'workspace.invalid_impact_resolution':
        case 'playout.invalid':
          return replyWithProblem(
            request,
            reply,
            error.problemCode,
            correlationIdFactory,
          );
        case 'analysis.scratch_not_found':
        case 'inventory.item_not_found':
        case 'workspace.impact_not_found':
        case 'workspace.context_not_found':
        case 'workspace.reference_target_not_found':
        case 'workspace.reference_exists':
        case 'playout.not_found':
          return replyWithProblem(
            request,
            reply,
            error.problemCode,
            correlationIdFactory,
          );
        case 'playout.provider_unavailable':
        case 'playout.provider_protocol_error':
        case 'playout.provider_timeout':
        case 'playout.provider_resource_exhausted':
        case 'playout.illegal_engine_move':
        case 'analysis.position_provider_unavailable':
        case 'analysis.position_provider_protocol_error':
        case 'analysis.position_provider_timeout':
        case 'analysis.position_provider_resource_exhausted':
        case 'analysis.position_illegal_engine_move':
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
