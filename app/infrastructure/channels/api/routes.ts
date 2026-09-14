import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { UserPreferences } from '../../../application/preferences/index.ts';
import type { HostDependencies } from './host-dependencies.ts';
import {
  EmptyQuerySchema,
  problemResponses,
  SetUiLanguageBodySchema,
  SetUiLanguageResultSchema,
  SystemStatusSchema,
  UserPreferencesSchema,
} from './schemas.ts';
import { registerAnalysisRoutes } from './analysis-routes.ts';
import { registerInventoryRoutes } from './inventory-routes.ts';
import { registerWorkspaceRoutes } from './workspace-routes.ts';

function preferencesDto(model: UserPreferences) {
  return {
    uiLocale: model.uiLocale,
    preferenceRevision: model.preferenceRevision,
    dataRevision: model.dataRevision,
    updatedAt: model.updatedAt,
  };
}

export function registerUseCaseRoutes(
  host: FastifyInstance,
  dependencies: HostDependencies,
) {
  const api = host.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    '/status',
    {
      schema: {
        operationId: 'GetSystemStatus',
        querystring: EmptyQuerySchema,
        response: { 200: Type.Ref(SystemStatusSchema), ...problemResponses },
      },
    },
    async () => {
      const model = await dependencies.getSystemStatus.execute();
      return {
        state: model.state,
        persistence: {
          schemaVersion: model.persistence.schemaVersion,
          dataRevision: model.persistence.dataRevision,
        },
        productRelease: dependencies.productRelease,
        contractFingerprint: dependencies.contractFingerprint,
      };
    },
  );

  api.get(
    '/preferences',
    {
      schema: {
        operationId: 'GetUserPreferences',
        querystring: EmptyQuerySchema,
        response: { 200: Type.Ref(UserPreferencesSchema), ...problemResponses },
      },
    },
    async () => preferencesDto(await dependencies.getUserPreferences.execute()),
  );

  api.put(
    '/preferences/ui-language',
    {
      schema: {
        operationId: 'SetUiLanguage',
        querystring: EmptyQuerySchema,
        body: SetUiLanguageBodySchema,
        response: {
          200: Type.Ref(SetUiLanguageResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) => {
      const result = await dependencies.setUiLanguage.execute({
        uiLocale: request.body.uiLocale,
        expectedRevision: request.body.expectedRevision,
      });
      return {
        changed: result.changed,
        preferences: preferencesDto(result.preferences),
      };
    },
  );

  registerAnalysisRoutes(api, dependencies);
  registerInventoryRoutes(api, dependencies);
  registerWorkspaceRoutes(api, dependencies);
}
