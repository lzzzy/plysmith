import { ApplicationProblem } from '../problems/application-problem.ts';

interface EngineProviderConfigurationBase {
  readonly instanceId: string;
  readonly displayName: string;
  readonly enabled: boolean;
}

export interface StockfishUciEngineProviderConfigurationInput extends EngineProviderConfigurationBase {
  readonly providerType: 'stockfish-uci';
  readonly executablePath: string;
  readonly arguments: readonly string[];
  readonly threads: number;
  readonly hashMb: number;
  readonly moveTimeMs: number;
  readonly startupTimeoutMs: number;
  readonly moveTimeoutMs: number;
  readonly stopTimeoutMs: number;
  readonly maxOutputBytes: number;
}

export type EngineProviderConfigurationInput =
  StockfishUciEngineProviderConfigurationInput;

export type ConfiguredEngineProvider = EngineProviderConfigurationInput & {
  readonly configurationRevision: string;
  readonly effectiveFingerprint: string;
};

export type EngineProviderConfigurationView = ConfiguredEngineProvider & {
  readonly restartRequired: boolean;
};

export interface EngineProviderConfigurationPreview {
  readonly valid: boolean;
  readonly issues: readonly (
    'executable_not_found' | 'configuration_invalid'
  )[];
}

export interface EngineProviderConfigurationRepository {
  list(): Promise<readonly ConfiguredEngineProvider[]>;
  preview(
    input: EngineProviderConfigurationInput,
  ): Promise<EngineProviderConfigurationPreview>;
  save(request: {
    readonly input: EngineProviderConfigurationInput;
    readonly expectedConfigurationRevision: string | null;
  }): Promise<ConfiguredEngineProvider>;
  disable(request: {
    readonly instanceId: string;
    readonly expectedConfigurationRevision: string;
  }): Promise<ConfiguredEngineProvider>;
}

export interface GetEngineProviderConfigurationsUseCase {
  execute(): Promise<{
    readonly providers: readonly EngineProviderConfigurationView[];
  }>;
}

export class GetEngineProviderConfigurations implements GetEngineProviderConfigurationsUseCase {
  readonly #repository: EngineProviderConfigurationRepository;
  readonly #activeFingerprints: ReadonlyMap<string, string>;

  constructor(dependencies: {
    readonly repository: EngineProviderConfigurationRepository;
    readonly activeFingerprints: ReadonlyMap<string, string>;
  }) {
    this.#repository = dependencies.repository;
    this.#activeFingerprints = dependencies.activeFingerprints;
  }

  async execute(): Promise<{
    readonly providers: readonly EngineProviderConfigurationView[];
  }> {
    const configured = await this.#repository.list();
    return Object.freeze({
      providers: Object.freeze(
        configured.map((provider) =>
          Object.freeze({
            ...provider,
            restartRequired:
              this.#activeFingerprints.get(provider.instanceId) !==
              provider.effectiveFingerprint,
          }),
        ),
      ),
    });
  }
}

export interface PreviewEngineProviderConfigurationUseCase {
  execute(
    input: EngineProviderConfigurationInput,
  ): Promise<EngineProviderConfigurationPreview>;
}

export class PreviewEngineProviderConfiguration implements PreviewEngineProviderConfigurationUseCase {
  readonly #repository: EngineProviderConfigurationRepository;

  constructor(repository: EngineProviderConfigurationRepository) {
    this.#repository = repository;
  }

  execute(
    input: EngineProviderConfigurationInput,
  ): Promise<EngineProviderConfigurationPreview> {
    return this.#repository.preview(input);
  }
}

export interface SaveEngineProviderConfigurationUseCase {
  execute(request: {
    readonly input: EngineProviderConfigurationInput;
    readonly expectedConfigurationRevision: string | null;
  }): Promise<ConfiguredEngineProvider>;
}

export class SaveEngineProviderConfiguration implements SaveEngineProviderConfigurationUseCase {
  readonly #repository: EngineProviderConfigurationRepository;

  constructor(repository: EngineProviderConfigurationRepository) {
    this.#repository = repository;
  }

  async execute(
    request: Parameters<EngineProviderConfigurationRepository['save']>[0],
  ): Promise<ConfiguredEngineProvider> {
    const preview = await this.#repository.preview(request.input);
    if (!preview.valid) {
      throw new ApplicationProblem(
        'configuration.engine_invalid',
        'The engine provider configuration is invalid.',
      );
    }
    return this.#repository.save(request);
  }
}

export interface DisableEngineProviderConfigurationUseCase {
  execute(request: {
    readonly instanceId: string;
    readonly expectedConfigurationRevision: string;
  }): Promise<ConfiguredEngineProvider>;
}

export class DisableEngineProviderConfiguration implements DisableEngineProviderConfigurationUseCase {
  readonly #repository: EngineProviderConfigurationRepository;

  constructor(repository: EngineProviderConfigurationRepository) {
    this.#repository = repository;
  }

  execute(
    request: Parameters<EngineProviderConfigurationRepository['disable']>[0],
  ): Promise<ConfiguredEngineProvider> {
    return this.#repository.disable(request);
  }
}

export function engineConfigurationConflict(): ApplicationProblem {
  return new ApplicationProblem(
    'configuration.engine_conflict',
    'The engine provider configuration has changed.',
  );
}
