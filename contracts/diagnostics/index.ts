export const diagnosticLogLevels = ['off', 'error', 'info', 'debug'] as const;

export type DiagnosticLogLevel = (typeof diagnosticLogLevels)[number];
export type DiagnosticEventLevel = Exclude<DiagnosticLogLevel, 'off'>;
export type DiagnosticComponent = 'host' | 'desktop';

export const diagnosticEventCodes = [
  'host.lifecycle.starting',
  'host.lifecycle.ready',
  'host.lifecycle.start_failed',
  'host.lifecycle.stopping',
  'host.lifecycle.stopped',
  'host.request.completed',
  'desktop.lifecycle.starting',
  'desktop.lifecycle.ready',
  'desktop.lifecycle.start_failed',
  'desktop.lifecycle.stopping',
  'desktop.host_connection.available',
  'desktop.host_connection.unavailable',
  'desktop.renderer.load_failed',
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
] as const;

export type DiagnosticEventCode = (typeof diagnosticEventCodes)[number];

export const diagnosticEventStatuses = [
  'starting',
  'ready',
  'succeeded',
  'failed',
  'discarded',
  'available',
  'unavailable',
  'stopping',
  'stopped',
] as const;

export type DiagnosticEventStatus = (typeof diagnosticEventStatuses)[number];

export interface DiagnosticEventInput {
  readonly level: DiagnosticEventLevel;
  readonly eventCode: DiagnosticEventCode;
  readonly correlationId?: string;
  readonly operation?: string;
  readonly status?: DiagnosticEventStatus;
  readonly problemCode?: string;
  readonly statusCode?: number;
  readonly durationMilliseconds?: number;
  readonly dataRevision?: number;
  readonly readVersion?: number;
  readonly generation?: number;
  readonly itemId?: string;
  readonly revisionId?: string;
  readonly anchorId?: string;
  readonly contextId?: string;
  readonly scratchId?: string;
}

export interface DiagnosticSink {
  write(event: DiagnosticEventInput): void;
}
