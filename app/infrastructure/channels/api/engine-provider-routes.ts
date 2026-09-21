import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';

import type { HostDependencies } from './host-dependencies.ts';
import type { EngineProviderConfigurationView } from '../../../application/playout/index.ts';
import {
  RemoveEngineProviderConfigurationBodySchema,
  EmptyQuerySchema,
  EngineProviderConfigurationPreviewSchema,
  EngineProviderConfigurationSchema,
  EngineProviderInstanceParamsSchema,
  ListEngineProviderConfigurationsResultSchema,
  PreviewEngineProviderConfigurationBodySchema,
  SaveEngineProviderConfigurationBodySchema,
  problemResponses,
} from './schemas.ts';

export function registerEngineProviderRoutes(
  host: FastifyInstance,
  dependencies: HostDependencies,
): void {
  const api = host.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    '/engine-providers/configurations',
    {
      schema: {
        operationId: 'GetEngineProviderConfigurations',
        querystring: EmptyQuerySchema,
        response: {
          200: Type.Ref(ListEngineProviderConfigurationsResultSchema),
          ...problemResponses,
        },
      },
    },
    async () => {
      const result =
        await dependencies.getEngineProviderConfigurations.execute();
      return { providers: result.providers.map(configurationDto) };
    },
  );
  api.post(
    '/engine-providers/configuration-preview',
    {
      schema: {
        operationId: 'PreviewEngineProviderConfiguration',
        querystring: EmptyQuerySchema,
        body: PreviewEngineProviderConfigurationBodySchema,
        response: {
          200: Type.Ref(EngineProviderConfigurationPreviewSchema),
          ...problemResponses,
        },
      },
    },
    async (request) => {
      const result =
        await dependencies.previewEngineProviderConfiguration.execute(
          request.body,
        );
      return { valid: result.valid, issues: [...result.issues] };
    },
  );
  api.put(
    '/engine-providers/configurations/:instanceId',
    {
      schema: {
        operationId: 'SaveEngineProviderConfiguration',
        params: EngineProviderInstanceParamsSchema,
        querystring: EmptyQuerySchema,
        body: SaveEngineProviderConfigurationBodySchema,
        response: {
          200: Type.Ref(EngineProviderConfigurationSchema),
          ...problemResponses,
        },
      },
    },
    async (request) => {
      const saved = await dependencies.saveEngineProviderConfiguration.execute({
        ...request.body,
        input: { ...request.body.input, instanceId: request.params.instanceId },
      });
      return readSavedConfiguration(dependencies, saved.instanceId);
    },
  );
  api.delete(
    '/engine-providers/configurations/:instanceId',
    {
      schema: {
        operationId: 'RemoveEngineProviderConfiguration',
        params: EngineProviderInstanceParamsSchema,
        querystring: EmptyQuerySchema,
        body: RemoveEngineProviderConfigurationBodySchema,
        response: {
          200: Type.Ref(EngineProviderConfigurationSchema),
          ...problemResponses,
        },
      },
    },
    async (request) => {
      const removed =
        await dependencies.removeEngineProviderConfiguration.execute({
          instanceId: request.params.instanceId,
          expectedConfigurationRevision:
            request.body.expectedConfigurationRevision,
        });
      return configurationDto({ ...removed, restartRequired: true });
    },
  );
}

async function readSavedConfiguration(
  dependencies: HostDependencies,
  instanceId: string,
) {
  const result = await dependencies.getEngineProviderConfigurations.execute();
  const configured = result.providers.find(
    (provider) => provider.instanceId === instanceId,
  );
  if (configured === undefined) {
    throw new Error('Saved engine provider configuration is unavailable.');
  }
  return configurationDto(configured);
}

function configurationDto(configuration: EngineProviderConfigurationView) {
  return configuration.providerType === 'stockfish-uci'
    ? { ...configuration, arguments: [...configuration.arguments] }
    : { ...configuration };
}
