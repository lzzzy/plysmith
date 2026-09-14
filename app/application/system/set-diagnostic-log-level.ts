import {
  diagnosticLogLevels,
  type DiagnosticLogLevel,
  type SetDiagnosticLogLevelRequest,
  type SetDiagnosticLogLevelResult,
} from './diagnostics-models.ts';
import type { DiagnosticSettingsRepository } from './diagnostics-ports.ts';
import {
  invalidDiagnosticConfigurationRevision,
  invalidDiagnosticLogLevel,
} from './diagnostics-problems.ts';
import { settings } from './get-diagnostic-settings.ts';

const configurationRevisionPattern = /^sha256:[a-f0-9]{64}$/;

export interface SetDiagnosticLogLevelUseCase {
  execute(
    request: SetDiagnosticLogLevelRequest,
  ): Promise<SetDiagnosticLogLevelResult>;
}

export class SetDiagnosticLogLevel implements SetDiagnosticLogLevelUseCase {
  readonly #repository: DiagnosticSettingsRepository;
  readonly #activeLevel: DiagnosticLogLevel;

  constructor(dependencies: {
    readonly repository: DiagnosticSettingsRepository;
    readonly activeLevel: DiagnosticLogLevel;
  }) {
    this.#repository = dependencies.repository;
    this.#activeLevel = dependencies.activeLevel;
  }

  async execute(
    request: SetDiagnosticLogLevelRequest,
  ): Promise<SetDiagnosticLogLevelResult> {
    if (!diagnosticLogLevels.includes(request.level)) {
      throw invalidDiagnosticLogLevel();
    }
    if (
      !configurationRevisionPattern.test(request.expectedConfigurationRevision)
    ) {
      throw invalidDiagnosticConfigurationRevision();
    }

    const current = await this.#repository.read();
    const changed = current.level !== request.level;
    const configured = changed
      ? await this.#repository.setLevel(request)
      : current;
    return Object.freeze({
      changed,
      settings: settings(configured, this.#activeLevel),
    });
  }
}
