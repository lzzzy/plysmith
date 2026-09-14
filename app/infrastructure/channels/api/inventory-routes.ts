import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { HostDependencies } from './host-dependencies.ts';
import { parseLocalId, searchInventoryResultDto } from './dto-mappers.ts';
import {
  InventorySearchQuerySchema,
  problemResponses,
  SearchInventoryResultSchema,
} from './schemas.ts';

export function registerInventoryRoutes(
  host: FastifyInstance,
  dependencies: HostDependencies,
) {
  const api = host.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    '/inventory',
    {
      schema: {
        operationId: 'SearchInventory',
        querystring: InventorySearchQuerySchema,
        response: {
          200: Type.Ref(SearchInventoryResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      searchInventoryResultDto(
        await dependencies.searchInventory.execute({
          ...(request.query.query === undefined
            ? {}
            : { query: request.query.query }),
          ...(request.query.contextId === undefined
            ? {}
            : {
                contextId: parseLocalId(
                  'working-context',
                  request.query.contextId,
                ),
              }),
          ...(request.query.pageSize === undefined
            ? {}
            : { pageSize: Number(request.query.pageSize) }),
          ...(request.query.cursor === undefined
            ? {}
            : { cursor: request.query.cursor }),
        }),
      ),
  );
}
