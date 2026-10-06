export interface LiveProviderConfigurationState {
  readonly configured: boolean;
  readonly tokenConfigured: boolean;
  readonly configurationRevision: string | null;
}

export interface SaveLiveProviderConfigurationRequest {
  readonly token: string;
  readonly expectedConfigurationRevision: string | null;
}

export interface LiveProviderConfigurationRepository {
  get(): Promise<LiveProviderConfigurationState>;
  save(
    request: SaveLiveProviderConfigurationRequest,
  ): Promise<LiveProviderConfigurationState>;
}

export interface LiveProviderConfigurationView extends LiveProviderConfigurationState {
  readonly restartRequired: boolean;
}

export class GetLiveProviderConfiguration {
  readonly #repository: LiveProviderConfigurationRepository;
  readonly #activeConfigurationRevision: string | null;

  constructor(dependencies: {
    readonly repository: LiveProviderConfigurationRepository;
    readonly activeConfigurationRevision: string | null;
  }) {
    this.#repository = dependencies.repository;
    this.#activeConfigurationRevision =
      dependencies.activeConfigurationRevision;
  }

  async execute(): Promise<LiveProviderConfigurationView> {
    const state = await this.#repository.get();
    return Object.freeze({
      ...state,
      restartRequired:
        state.configurationRevision !== this.#activeConfigurationRevision,
    });
  }
}

export class SaveLiveProviderConfiguration {
  readonly #repository: LiveProviderConfigurationRepository;

  constructor(repository: LiveProviderConfigurationRepository) {
    this.#repository = repository;
  }

  async execute(
    request: SaveLiveProviderConfigurationRequest,
  ): Promise<LiveProviderConfigurationView> {
    return Object.freeze({
      ...(await this.#repository.save(request)),
      restartRequired: true,
    });
  }
}
