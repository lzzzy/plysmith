import type { MovePolicyCapability } from '../../../domain/playout/index.ts';
import type {
  MovePolicyProvider,
  MovePolicyProviderDescriptor,
  MovePolicyRegistry,
} from '../../../application/playout/index.ts';
import { MovePolicyProviderError } from '../../../application/playout/index.ts';

export class ConfiguredMovePolicyRegistry implements MovePolicyRegistry {
  readonly #providers: ReadonlyMap<string, MovePolicyProvider>;

  constructor(providers: readonly MovePolicyProvider[]) {
    const entries = providers.map(
      (provider) => [provider.descriptor.instanceId, provider] as const,
    );
    if (
      new Set(entries.map(([instanceId]) => instanceId)).size !== entries.length
    ) {
      throw new Error('Move policy provider instance ids must be unique.');
    }
    this.#providers = new Map(entries);
  }

  list(): readonly MovePolicyProviderDescriptor[] {
    return Object.freeze(
      [...this.#providers.values()].map((provider) => provider.descriptor),
    );
  }

  resolve(
    instanceId: string,
    capability: MovePolicyCapability,
  ): MovePolicyProvider | undefined {
    const provider = this.#providers.get(instanceId);
    return provider?.descriptor.capabilities.includes(capability)
      ? provider
      : undefined;
  }
}

export class UnavailableMovePolicyProvider implements MovePolicyProvider {
  readonly descriptor: MovePolicyProviderDescriptor;

  constructor(input: {
    readonly instanceId: string;
    readonly providerType: string;
    readonly displayName: string;
    readonly problemCode: string;
  }) {
    this.descriptor = Object.freeze({
      instanceId: input.instanceId,
      providerType: input.providerType,
      displayName: input.displayName,
      fingerprint: `unavailable:${input.instanceId}`,
      capabilities: Object.freeze(['best_move']) as readonly ['best_move'],
      status: 'unavailable',
      problemCode: input.problemCode,
    });
  }

  chooseMove(): Promise<never> {
    return Promise.reject(new MovePolicyProviderError('provider_unavailable'));
  }
}
