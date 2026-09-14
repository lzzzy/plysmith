import type {
  ConfiguredDiagnosticSettings,
  DiagnosticLogLevel,
  DiagnosticReportDocument,
  RedactedDiagnosticEvents,
} from './diagnostics-models.ts';

export interface DiagnosticSettingsRepository {
  read(): Promise<ConfiguredDiagnosticSettings>;
  setLevel(request: {
    readonly level: DiagnosticLogLevel;
    readonly expectedConfigurationRevision: string;
  }): Promise<ConfiguredDiagnosticSettings>;
}

export interface DiagnosticReportSource {
  readRedactedEvents(request: {
    readonly maximumSourceBytes: number;
    readonly maximumEvents: number;
  }): Promise<RedactedDiagnosticEvents>;
}

export interface DiagnosticReportWriter {
  write(request: {
    readonly destinationPath: string;
    readonly maximumBytes: number;
    readonly document: DiagnosticReportDocument;
  }): Promise<{ readonly bytesWritten: number }>;
}

export interface DiagnosticClock {
  now(): string;
}
