import type { HostConnection } from '../../host_client/index.ts';
import type { DiagnosticEventInput } from '../../../../../contracts/diagnostics/index.ts';

export const desktopBootstrapChannel = 'plysmith:desktop-bootstrap';
export const desktopDiagnosticsChannel = 'plysmith:desktop-diagnostics';
export const desktopDiagnosticReportDestinationChannel =
  'plysmith:diagnostic-report-destination';

const rendererEventCodes = new Set([
  'renderer.lifecycle.starting',
  'renderer.bootstrap.unavailable',
  'renderer.refresh.completed',
  'renderer.refresh.failed',
  'renderer.refresh.discarded',
  'renderer.command.completed',
  'renderer.command.failed',
  'renderer.events.reconnected',
  'renderer.events.invalid',
  'renderer.analysis.navigation_requested',
  'client.request.completed',
  'client.request.failed',
] satisfies readonly DiagnosticEventInput['eventCode'][]);

export type RendererDiagnosticEvent = DiagnosticEventInput & {
  readonly eventCode:
    | 'renderer.lifecycle.starting'
    | 'renderer.bootstrap.unavailable'
    | 'renderer.refresh.completed'
    | 'renderer.refresh.failed'
    | 'renderer.refresh.discarded'
    | 'renderer.command.completed'
    | 'renderer.command.failed'
    | 'renderer.events.reconnected'
    | 'renderer.events.invalid'
    | 'renderer.analysis.navigation_requested'
    | 'client.request.completed'
    | 'client.request.failed';
};

export type DesktopBootstrap =
  | {
      readonly kind: 'ready';
      readonly generation: number;
      readonly connection: HostConnection;
    }
  | {
      readonly kind: 'unavailable';
      readonly generation: number;
    };

export interface PlysmithDesktopApi {
  getBootstrap(): Promise<DesktopBootstrap>;
  chooseDiagnosticReportDestination(
    suggestedFileName: string,
  ): Promise<string | undefined>;
  recordDiagnostic(event: RendererDiagnosticEvent): void;
}

export function parseDiagnosticReportSuggestedFileName(
  candidate: unknown,
): string | undefined {
  if (
    typeof candidate !== 'string' ||
    candidate.length > 120 ||
    !/^plysmith-diagnostics-\d{14}\.json\.gz$/.test(candidate)
  ) {
    return undefined;
  }
  return candidate;
}

export function parseRendererDiagnosticEvent(
  candidate: unknown,
): RendererDiagnosticEvent | undefined {
  if (!isRecord(candidate)) return undefined;
  const allowedKeys = new Set([
    'level',
    'eventCode',
    'correlationId',
    'operation',
    'status',
    'problemCode',
    'statusCode',
    'durationMilliseconds',
    'dataRevision',
    'readVersion',
    'generation',
    'itemId',
    'revisionId',
    'anchorId',
    'contextId',
    'scratchId',
  ]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key)))
    return undefined;
  if (
    !isEventLevel(candidate.level) ||
    typeof candidate.eventCode !== 'string' ||
    !rendererEventCodes.has(
      candidate.eventCode as RendererDiagnosticEvent['eventCode'],
    ) ||
    !isOptionalIdentifier(candidate.correlationId, 80) ||
    !isOptionalIdentifier(candidate.operation, 80) ||
    !isOptionalStatus(candidate.status) ||
    !isOptionalIdentifier(candidate.problemCode, 80) ||
    !isOptionalNumber(candidate.statusCode) ||
    !isOptionalNumber(candidate.durationMilliseconds) ||
    !isOptionalNumber(candidate.dataRevision) ||
    !isOptionalNumber(candidate.readVersion) ||
    !isOptionalNumber(candidate.generation) ||
    !isOptionalLocalId(candidate.itemId) ||
    !isOptionalLocalId(candidate.revisionId) ||
    !isOptionalLocalId(candidate.anchorId) ||
    !isOptionalLocalId(candidate.contextId) ||
    !isOptionalIdentifier(candidate.scratchId, 80)
  ) {
    return undefined;
  }
  return Object.freeze({
    level: candidate.level,
    eventCode: candidate.eventCode,
    ...copyDefined(candidate, 'correlationId'),
    ...copyDefined(candidate, 'operation'),
    ...copyDefined(candidate, 'status'),
    ...copyDefined(candidate, 'problemCode'),
    ...copyDefined(candidate, 'statusCode'),
    ...copyDefined(candidate, 'durationMilliseconds'),
    ...copyDefined(candidate, 'dataRevision'),
    ...copyDefined(candidate, 'readVersion'),
    ...copyDefined(candidate, 'generation'),
    ...copyDefined(candidate, 'itemId'),
    ...copyDefined(candidate, 'revisionId'),
    ...copyDefined(candidate, 'anchorId'),
    ...copyDefined(candidate, 'contextId'),
    ...copyDefined(candidate, 'scratchId'),
  }) as RendererDiagnosticEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEventLevel(value: unknown): value is 'error' | 'info' | 'debug' {
  return value === 'error' || value === 'info' || value === 'debug';
}

function isOptionalIdentifier(value: unknown, maxLength: number): boolean {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      value.length > 0 &&
      value.length <= maxLength &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))
  );
}

function isOptionalLocalId(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'string' && /^\d{1,20}$/.test(value))
  );
}

function isOptionalNumber(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' && Number.isFinite(value) && value >= 0)
  );
}

function isOptionalStatus(value: unknown): boolean {
  return (
    value === undefined ||
    value === 'starting' ||
    value === 'ready' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'discarded' ||
    value === 'available' ||
    value === 'unavailable' ||
    value === 'stopping' ||
    value === 'stopped'
  );
}

function copyDefined(
  candidate: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return candidate[key] === undefined ? {} : { [key]: candidate[key] };
}
