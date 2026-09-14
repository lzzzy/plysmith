import {
  diagnosticReportFormat,
  diagnosticReportManifestVersion,
  diagnosticReportMaximumBytes,
  type DiagnosticReportManifest,
} from './diagnostics-models.ts';
import type { DiagnosticClock } from './diagnostics-ports.ts';

export interface GetDiagnosticReportManifestUseCase {
  execute(): Promise<DiagnosticReportManifest>;
}

export class GetDiagnosticReportManifest implements GetDiagnosticReportManifestUseCase {
  readonly #clock: DiagnosticClock;

  constructor(clock: DiagnosticClock) {
    this.#clock = clock;
  }

  async execute(): Promise<DiagnosticReportManifest> {
    return manifest(this.#clock.now());
  }
}

export function manifest(now: string): DiagnosticReportManifest {
  return Object.freeze({
    manifestVersion: diagnosticReportManifestVersion,
    format: diagnosticReportFormat,
    suggestedFileName: `plysmith-diagnostics-${compactTimestamp(now)}.json.gz`,
    maximumBytes: diagnosticReportMaximumBytes,
    includedCategories: Object.freeze([
      'product_identity',
      'runtime_environment',
      'diagnostic_settings',
      'redacted_diagnostic_events',
      'excluded_data_declaration',
    ] as const),
    excludedCategories: Object.freeze([
      'secrets_and_credentials',
      'active_configuration',
      'database_and_backups',
      'local_paths',
      'chess_and_user_content',
      'external_identities',
      'provider_payloads',
      'memory_and_raw_errors',
    ] as const),
  });
}

function compactTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, 14) || 'unknown-time';
}
