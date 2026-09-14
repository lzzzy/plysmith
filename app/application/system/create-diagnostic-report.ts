import {
  diagnosticReportManifestVersion,
  type CreateDiagnosticReportRequest,
  type CreateDiagnosticReportResult,
  type DiagnosticLogLevel,
  type DiagnosticReportDocument,
} from './diagnostics-models.ts';
import type {
  DiagnosticClock,
  DiagnosticReportSource,
  DiagnosticReportWriter,
  DiagnosticSettingsRepository,
} from './diagnostics-ports.ts';
import { invalidDiagnosticReportRequest } from './diagnostics-problems.ts';
import { manifest } from './get-diagnostic-report-manifest.ts';

const maximumSourceBytes = 10 * 1024 * 1024;
const maximumEvents = 20_000;

export interface CreateDiagnosticReportUseCase {
  execute(
    request: CreateDiagnosticReportRequest,
  ): Promise<CreateDiagnosticReportResult>;
}

export class CreateDiagnosticReport implements CreateDiagnosticReportUseCase {
  readonly #settings: DiagnosticSettingsRepository;
  readonly #source: DiagnosticReportSource;
  readonly #writer: DiagnosticReportWriter;
  readonly #clock: DiagnosticClock;
  readonly #activeLevel: DiagnosticLogLevel;
  readonly #productRelease: string;
  readonly #contractFingerprint: string;
  readonly #runtime: DiagnosticReportDocument['runtime'];

  constructor(dependencies: {
    readonly settings: DiagnosticSettingsRepository;
    readonly source: DiagnosticReportSource;
    readonly writer: DiagnosticReportWriter;
    readonly clock: DiagnosticClock;
    readonly activeLevel: DiagnosticLogLevel;
    readonly productRelease: string;
    readonly contractFingerprint: string;
    readonly runtime: DiagnosticReportDocument['runtime'];
  }) {
    this.#settings = dependencies.settings;
    this.#source = dependencies.source;
    this.#writer = dependencies.writer;
    this.#clock = dependencies.clock;
    this.#activeLevel = dependencies.activeLevel;
    this.#productRelease = dependencies.productRelease;
    this.#contractFingerprint = dependencies.contractFingerprint;
    this.#runtime = Object.freeze({ ...dependencies.runtime });
  }

  async execute(
    request: CreateDiagnosticReportRequest,
  ): Promise<CreateDiagnosticReportResult> {
    if (
      request.acceptedManifestVersion !== diagnosticReportManifestVersion ||
      typeof request.destinationPath !== 'string' ||
      request.destinationPath.length === 0 ||
      request.destinationPath.length > 1_024 ||
      request.destinationPath.includes('\0')
    ) {
      throw invalidDiagnosticReportRequest();
    }

    const generatedAt = this.#clock.now();
    const [configured, events] = await Promise.all([
      this.#settings.read(),
      this.#source.readRedactedEvents({ maximumSourceBytes, maximumEvents }),
    ]);
    const reportManifest = manifest(generatedAt);
    const document: DiagnosticReportDocument = Object.freeze({
      schemaVersion: 1,
      generatedAt,
      manifest: Object.freeze({
        manifestVersion: reportManifest.manifestVersion,
        format: reportManifest.format,
        maximumBytes: reportManifest.maximumBytes,
        includedCategories: reportManifest.includedCategories,
        excludedCategories: reportManifest.excludedCategories,
      }),
      product: Object.freeze({
        release: this.#productRelease,
        contractFingerprint: this.#contractFingerprint,
      }),
      runtime: this.#runtime,
      diagnostics: Object.freeze({
        configuredLevel: configured.level,
        activeLevel: this.#activeLevel,
        restartRequired: configured.level !== this.#activeLevel,
        events,
      }),
    });
    const written = await this.#writer.write({
      destinationPath: request.destinationPath,
      maximumBytes: reportManifest.maximumBytes,
      document,
    });
    return Object.freeze({
      created: true,
      generatedAt,
      format: reportManifest.format,
      bytesWritten: written.bytesWritten,
      eventCount: events.events.length,
      discardedLineCount: events.discardedLineCount,
      truncated: events.truncated,
    });
  }
}
