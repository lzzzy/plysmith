import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { HostDependencies } from './host-dependencies.ts';
import {
  analysisRecordDto,
  inventoryRevisionPreviewDto,
  listInventoryRevisionsResultDto,
  parseLocalId,
  parseWorkScope,
  saveInventoryRevisionResultDto,
  searchInventoryResultDto,
  startInventoryRevisionResultDto,
} from './dto-mappers.ts';
import {
  EmptyQuerySchema,
  InventoryItemIdParamsSchema,
  InventoryRevisionParamsSchema,
  InventoryRevisionPreviewSchema,
  InventoryRevisionReadQuerySchema,
  InventoryRevisionScratchBodySchema,
  InventorySearchQuerySchema,
  ListInventoryRevisionsResultSchema,
  PageQuerySchema,
  problemResponses,
  SaveInventoryRevisionBodySchema,
  SaveInventoryRevisionResultSchema,
  SearchInventoryResultSchema,
  StartInventoryRevisionBodySchema,
  StartInventoryRevisionResultSchema,
  AnalysisRecordSchema,
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

  api.post(
    '/inventory/items/:itemId/revision-edits',
    {
      schema: {
        operationId: 'StartInventoryRevision',
        params: InventoryItemIdParamsSchema,
        querystring: EmptyQuerySchema,
        body: StartInventoryRevisionBodySchema,
        response: {
          200: Type.Ref(StartInventoryRevisionResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      startInventoryRevisionResultDto(
        await dependencies.startInventoryRevision.execute({
          scope: parseWorkScope(request.body.scope),
          itemId: parseLocalId('inventory-item', request.params.itemId),
          baseRevisionId: parseLocalId(
            'item-revision',
            request.body.baseRevisionId,
          ),
          anchorId: parseLocalId('anchor', request.body.anchorId),
          mode: request.body.mode,
          expectedScratchId: request.body.expectedScratchId,
          expectedScratchRevision: request.body.expectedScratchRevision,
          ...(request.body.displayName === undefined
            ? {}
            : { displayName: request.body.displayName }),
          ...(request.body.summary === undefined
            ? {}
            : { summary: request.body.summary }),
          ...(request.body.firstMove === undefined
            ? {}
            : { firstMove: request.body.firstMove }),
        }),
      ),
  );

  api.post(
    '/inventory/revision-edits/preview',
    {
      schema: {
        operationId: 'PreviewInventoryRevision',
        querystring: EmptyQuerySchema,
        body: InventoryRevisionScratchBodySchema,
        response: {
          200: Type.Ref(InventoryRevisionPreviewSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      inventoryRevisionPreviewDto(
        await dependencies.previewInventoryRevision.execute({
          scope: parseWorkScope(request.body.scope),
          expectedScratchId: request.body.expectedScratchId,
          expectedScratchRevision: request.body.expectedScratchRevision,
        }),
      ),
  );

  api.post(
    '/inventory/revision-edits/save',
    {
      schema: {
        operationId: 'SaveInventoryRevision',
        querystring: EmptyQuerySchema,
        body: SaveInventoryRevisionBodySchema,
        response: {
          200: Type.Ref(SaveInventoryRevisionResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      saveInventoryRevisionResultDto(
        await dependencies.saveInventoryRevision.execute({
          scope: parseWorkScope(request.body.scope),
          expectedScratchId: request.body.expectedScratchId,
          expectedScratchRevision: request.body.expectedScratchRevision,
          previewFingerprint: request.body.previewFingerprint,
        }),
      ),
  );

  api.get(
    '/inventory/items/:itemId/revisions/:revisionId',
    {
      schema: {
        operationId: 'GetInventoryRevision',
        params: InventoryRevisionParamsSchema,
        querystring: InventoryRevisionReadQuerySchema,
        response: {
          200: Type.Ref(AnalysisRecordSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      analysisRecordDto(
        await dependencies.getInventoryRevision.execute({
          scope: parseWorkScope({
            kind: request.query.scopeKind,
            ...(request.query.contextId === undefined
              ? {}
              : { contextId: request.query.contextId }),
          }),
          itemId: parseLocalId('inventory-item', request.params.itemId),
          revisionId: parseLocalId('item-revision', request.params.revisionId),
          ...(request.query.anchorId === undefined
            ? {}
            : {
                anchorId: parseLocalId('anchor', request.query.anchorId),
              }),
        }),
      ),
  );

  api.get(
    '/inventory/items/:itemId/revisions',
    {
      schema: {
        operationId: 'ListInventoryRevisions',
        params: InventoryItemIdParamsSchema,
        querystring: PageQuerySchema,
        response: {
          200: Type.Ref(ListInventoryRevisionsResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      listInventoryRevisionsResultDto(
        await dependencies.listInventoryRevisions.execute({
          itemId: parseLocalId('inventory-item', request.params.itemId),
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
