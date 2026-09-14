export const diagnosticLogLevels = ['off', 'error', 'info', 'debug'] as const;

export type DiagnosticLogLevel = (typeof diagnosticLogLevels)[number];

export interface ConfiguredDiagnosticSettings {
  readonly level: DiagnosticLogLevel;
  readonly configurationRevision: string;
}

export interface DiagnosticSettings {
  readonly configuredLevel: DiagnosticLogLevel;
  readonly activeLevel: DiagnosticLogLevel;
  readonly configurationRevision: string;
  readonly restartRequired: boolean;
}

export interface SetDiagnosticLogLevelRequest {
  readonly level: DiagnosticLogLevel;
  readonly expectedConfigurationRevision: string;
}

export interface SetDiagnosticLogLevelResult {
  readonly changed: boolean;
  readonly settings: DiagnosticSettings;
}

export const diagnosticReportManifestVersion = 1 as const;
export const diagnosticReportFormat =
  'plysmith-diagnostics-json-gzip-v1' as const;
export const diagnosticReportMaximumBytes = 10 * 1024 * 1024;

export type DiagnosticReportIncludedCategory =
  | 'product_identity'
  | 'runtime_environment'
  | 'diagnostic_settings'
  | 'redacted_diagnostic_events'
  | 'excluded_data_declaration';

export type DiagnosticReportExcludedCategory =
  | 'secrets_and_credentials'
  | 'active_configuration'
  | 'database_and_backups'
  | 'local_paths'
  | 'chess_and_user_content'
  | 'external_identities'
  | 'provider_payloads'
  | 'memory_and_raw_errors';

export interface DiagnosticReportManifest {
  readonly manifestVersion: typeof diagnosticReportManifestVersion;
  readonly format: typeof diagnosticReportFormat;
  readonly suggestedFileName: string;
  readonly maximumBytes: number;
  readonly includedCategories: readonly DiagnosticReportIncludedCategory[];
  readonly excludedCategories: readonly DiagnosticReportExcludedCategory[];
}

export interface RedactedDiagnosticEvent {
  readonly timestamp: string;
  readonly level: 'error' | 'info' | 'debug';
  readonly eventCode: string;
  readonly component: 'host' | 'desktop';
  readonly status?:
    | 'starting'
    | 'ready'
    | 'succeeded'
    | 'failed'
    | 'discarded'
    | 'available'
    | 'unavailable'
    | 'stopping'
    | 'stopped';
  readonly statusCode?: number;
  readonly durationMilliseconds?: number;
  readonly dataRevision?: number;
  readonly readVersion?: number;
  readonly generation?: number;
}

export interface RedactedDiagnosticEvents {
  readonly events: readonly RedactedDiagnosticEvent[];
  readonly sourceSegmentCount: number;
  readonly discardedLineCount: number;
  readonly truncated: boolean;
}

export interface DiagnosticReportDocument {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly manifest: Omit<DiagnosticReportManifest, 'suggestedFileName'>;
  readonly product: {
    readonly release: string;
    readonly contractFingerprint: string;
  };
  readonly runtime: {
    readonly platform: string;
    readonly architecture: string;
    readonly nodeVersion: string;
  };
  readonly diagnostics: {
    readonly configuredLevel: DiagnosticLogLevel;
    readonly activeLevel: DiagnosticLogLevel;
    readonly restartRequired: boolean;
    readonly events: RedactedDiagnosticEvents;
  };
}

export interface CreateDiagnosticReportRequest {
  readonly acceptedManifestVersion: typeof diagnosticReportManifestVersion;
  readonly destinationPath: string;
}

export interface CreateDiagnosticReportResult {
  readonly created: true;
  readonly generatedAt: string;
  readonly format: typeof diagnosticReportFormat;
  readonly bytesWritten: number;
  readonly eventCount: number;
  readonly discardedLineCount: number;
  readonly truncated: boolean;
}
