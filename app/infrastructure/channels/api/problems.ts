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
  'configuration.live_invalid': [
    400,
    'Invalid live configuration',
    'Enter a valid personal Lichess API token.',
  ],
  'configuration.live_conflict': [
    409,
    'Live configuration conflict',
    'Read the current configuration before saving.',
  ],
  'configuration.live_write_failed': [
    503,
    'Live configuration unavailable',
    'The live configuration could not be saved.',
  ],
  'live.fair_play_blocked': [
    403,
    'Engine assistance unavailable',
    'Engine assistance is disabled until ongoing human games are confirmed finished.',
  ],
  'live.authentication_failed': [
    401,
    'Lichess authentication failed',
    'Check the personal API token and its permissions in settings.',
  ],
  'live.rate_limited': [
    429,
    'Lichess request limit',
    'Wait before reconnecting to Lichess.',
  ],
  'live.provider_unavailable': [
    503,
    'Lichess unavailable',
    'The connection to Lichess is unavailable.',
  ],
  'live.protocol_error': [
    502,
    'Invalid Lichess response',
    'The live game could not be verified.',
  ],
  'live.move_rejected': [
    409,
    'Move rejected',
    'Lichess rejected the move. Read the current game before continuing.',
  ],
  'live.move_uncertain': [
    409,
    'Move confirmation pending',
    'The move may have reached Lichess. Resynchronize before continuing; do not resend it.',
  ],
  'live.account_mismatch': [
    403,
    'Account changed',
    'Use the original account to confirm that its games have finished.',
  ],
  'live.busy': [
    409,
    'Live command in progress',
    'Wait for the current command to finish.',
  ],
  'live.closed': [409, 'Live connection closed', 'Open a new live connection.'],
  'live.game_too_long': [
    413,
    'Live game limit',
    'This game exceeds the supported recording length.',
  ],
  'live.guard_unavailable': [
    503,
    'Fair-play state unavailable',
    'Engine assistance remains disabled until its safety state can be verified.',
  ],
  'live.illegal_move': [
    400,
    'Illegal live move',
    'Choose a legal move in the current game.',
  ],
  'live.invalid_action': [
    400,
    'Invalid live action',
    'Choose an action available in the current game.',
  ],
  'live.invalid_game': [
    400,
    'Invalid game link',
    'Use a normal Lichess game URL.',
  ],
  'live.invalid_save': [
    400,
    'Invalid game save',
    'Choose a valid game name and destination.',
  ],
  'live.invalid_selection': [
    400,
    'Invalid live position',
    'Select a position from the recorded game.',
  ],
  'live.no_session': [
    404,
    'No live game',
    'Open a game before using live commands.',
  ],
  'live.not_configured': [
    409,
    'Lichess not configured',
    'Configure a personal API token in settings and restart Plysmith.',
  ],
  'live.not_connected': [
    409,
    'Live game disconnected',
    'Reconnect and verify the current game before continuing.',
  ],
  'live.not_finished': [
    409,
    'Game not finished',
    'Wait for the final verified game before saving.',
  ],
  'live.not_playable': [
    409,
    'Game not playable in Plysmith',
    'Continue this game in the Lichess browser.',
  ],
  'live.not_your_turn': [409, 'Not your turn', 'Wait for the opponent move.'],
  'live.own_game': [
    403,
    'Own ongoing game',
    'Open your own game without engine assistance.',
  ],
  'live.session_exists': [
    409,
    'Live recording open',
    'Save or discard the current recording before opening another game.',
  ],
  'live.stale_state': [
    409,
    'Live game changed',
    'Read the current game before repeating the action.',
  ],
  'live.unsupported_variant': [
    400,
    'Unsupported chess variant',
    'Only standard chess is supported.',
  ],
  'import.publication_busy': [
    409,
    'Import publication busy',
    'Wait for the current publication to finish.',
  ],
  'import.invalid_candidate': [
    400,
    'Invalid import candidate',
    'The candidate has no valid complete chess tree.',
  ],
  'import.invalid_request': [
    400,
    'Invalid import request',
    'The import request does not match the current preview.',
  ],
  'import.warning_confirmation_required': [
    409,
    'Import review required',
    'Acknowledge fidelity warnings before publication.',
  ],
  'import.input_not_found': [
    404,
    'Import input unavailable',
    'Select an accessible local PGN file again.',
  ],
  'import.input_changed': [
    409,
    'Import input changed',
    'The selected file changed during preparation. Select it again.',
  ],
  'import.input_too_large': [
    413,
    'Import input too large',
    'The local PGN file exceeds the supported import size.',
  ],
  'import.format_not_recognized': [
    415,
    'Unsupported import format',
    'Select a standard-chess PGN file.',
  ],
  'import.encoding_choice_required': [
    400,
    'Encoding choice required',
    'This file is not valid UTF-8. Choose an explicit supported character encoding.',
  ],
  'import.encoding_unsupported': [
    415,
    'Unsupported encoding',
    'The selected file encoding is not supported.',
  ],
  'import.input_limit': [
    409,
    'Too many import inputs',
    'Finish an existing import before selecting another file.',
  ],
  'import.input_incomplete': [
    409,
    'Incomplete import input',
    'The selected file has not been fully verified.',
  ],
  'import.interrupted': [
    409,
    'Import interrupted',
    'Preparation was interrupted and must be started again.',
  ],
  'import.preparation_busy': [
    409,
    'Import preparation busy',
    'Finish an existing preparation before starting another.',
  ],
  'import.provider_resource_exhausted': [
    413,
    'Import resource limit',
    'This PGN exceeds a supported import complexity limit.',
  ],
  'import.not_found': [
    404,
    'Import preview unavailable',
    'The requested import preview no longer exists.',
  ],
  'import.name_conflict': [
    409,
    'Import name conflict',
    'Resolve global inventory name conflicts in the import preview.',
  ],
  'import.invalid_selection': [
    400,
    'Invalid import selection',
    'Select only importable candidates.',
  ],
  'inventory.invalid_organization': [
    400,
    'Invalid inventory organization',
    'The inventory organization request is invalid.',
  ],
  'inventory.invalid_name': [
    400,
    'Invalid inventory name',
    'Choose a nonempty name without surrounding whitespace.',
  ],
  'inventory.name_conflict': [
    409,
    'Folder name conflict',
    'A sibling folder already uses this name.',
  ],
  'inventory.folder_not_found': [
    404,
    'Folder not found',
    'The selected inventory folder no longer exists.',
  ],
  'inventory.folder_not_in_context': [
    403,
    'Folder not in context',
    'Choose a folder included in the working context.',
  ],
  'inventory.cycle': [
    409,
    'Folder cycle',
    'A folder cannot be moved into its own subtree.',
  ],
  'inventory.organization_conflict': [
    409,
    'Inventory organization conflict',
    'Read the current organization before submitting another change.',
  ],
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
      if (
        (error.problemCode.startsWith('import.') ||
          error.problemCode.startsWith('live.') ||
          error.problemCode.startsWith('configuration.live_')) &&
        Object.hasOwn(catalog, error.problemCode)
      ) {
        return replyWithProblem(
          request,
          reply,
          error.problemCode as ApiProblemCode,
          correlationIdFactory,
        );
      }
      switch (error.problemCode) {
        case 'inventory.invalid_organization':
        case 'inventory.invalid_name':
        case 'inventory.name_conflict':
        case 'inventory.folder_not_found':
        case 'inventory.folder_not_in_context':
        case 'inventory.cycle':
        case 'inventory.organization_conflict':
          return replyWithProblem(
            request,
            reply,
            error.problemCode,
            correlationIdFactory,
          );
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
