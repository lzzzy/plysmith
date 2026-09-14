import type {
  DiagnosticLogLevel,
  DiagnosticSettings,
} from './diagnostics-models.ts';
import type { DiagnosticSettingsRepository } from './diagnostics-ports.ts';

export interface GetDiagnosticSettingsUseCase {
  execute(): Promise<DiagnosticSettings>;
}

export class GetDiagnosticSettings implements GetDiagnosticSettingsUseCase {
  readonly #repository: DiagnosticSettingsRepository;
  readonly #activeLevel: DiagnosticLogLevel;

  constructor(dependencies: {
    readonly repository: DiagnosticSettingsRepository;
    readonly activeLevel: DiagnosticLogLevel;
  }) {
    this.#repository = dependencies.repository;
    this.#activeLevel = dependencies.activeLevel;
  }

  async execute(): Promise<DiagnosticSettings> {
    const configured = await this.#repository.read();
    return settings(configured, this.#activeLevel);
  }
}

export function settings(
  configured: Awaited<ReturnType<DiagnosticSettingsRepository['read']>>,
  activeLevel: DiagnosticLogLevel,
): DiagnosticSettings {
  return Object.freeze({
    configuredLevel: configured.level,
    activeLevel,
    configurationRevision: configured.configurationRevision,
    restartRequired: configured.level !== activeLevel,
  });
}
