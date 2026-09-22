import {
  PositionAnalysisProviderError,
  type PositionAnalysisCapability,
  type PositionAnalysisProvider,
  type PositionAnalysisProviderDescriptor,
  type PositionAnalysisRegistry,
  type PositionAnalysisSnapshot,
} from '../../../application/analysis/index.ts';

export class ConfiguredPositionAnalysisRegistry implements PositionAnalysisRegistry {
  readonly #providers: ReadonlyMap<string, PositionAnalysisProvider>;

  constructor(providers: readonly PositionAnalysisProvider[]) {
    const byId = new Map<string, PositionAnalysisProvider>();
    for (const provider of providers) {
      if (byId.has(provider.descriptor.instanceId)) {
        throw new Error(
          'Position analysis provider instance ids must be unique.',
        );
      }
      byId.set(provider.descriptor.instanceId, provider);
    }
    this.#providers = byId;
  }

  list(): readonly PositionAnalysisProviderDescriptor[] {
    return Object.freeze(
      [...this.#providers.values()].map((provider) => provider.descriptor),
    );
  }

  resolve(
    instanceId: string,
    capability: PositionAnalysisCapability,
  ): PositionAnalysisProvider | undefined {
    const provider = this.#providers.get(instanceId);
    return provider?.descriptor.capability === capability
      ? provider
      : undefined;
  }
}

export class UnavailablePositionAnalysisProvider implements PositionAnalysisProvider {
  readonly descriptor: PositionAnalysisProviderDescriptor;

  constructor(input: {
    readonly instanceId: string;
    readonly providerType: string;
    readonly displayName: string;
    readonly capability: PositionAnalysisCapability;
    readonly problemCode: string;
  }) {
    this.descriptor = Object.freeze({
      ...input,
      readiness: 'cold' as const,
      status: 'unavailable' as const,
    });
  }

  analyze(): Promise<PositionAnalysisSnapshot> {
    return Promise.reject(
      new PositionAnalysisProviderError('provider_unavailable'),
    );
  }
}
