import { Type, type Static } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { InventoryOrganizationChange } from '../../../application/inventory/index.ts';
import type { HostDependencies } from './host-dependencies.ts';
import { contextFolderRemovalPreviewDto, parseLocalId } from './dto-mappers.ts';
import {
  InventoryOrganizationQuerySchema,
  InventoryOrganizationSchema,
  ChangeInventoryOrganizationBodySchema,
  ChangeInventoryOrganizationResultSchema,
  ContextFolderRemovalQuerySchema,
  ContextFolderRemovalPreviewSchema,
  InventoryNameAvailabilityQuerySchema,
  InventoryNameAvailabilitySchema,
  EmptyQuerySchema,
  problemResponses,
} from './schemas.ts';

function parseChange(
  change: Static<typeof ChangeInventoryOrganizationBodySchema>['change'],
): InventoryOrganizationChange {
  switch (change.kind) {
    case 'create_folder':
      return {
        kind: change.kind,
        displayName: change.displayName,
        ...(change.parentFolderId === undefined
          ? {}
          : {
              parentFolderId: parseLocalId(
                'inventory-folder',
                change.parentFolderId,
              ),
            }),
      };
    case 'rename_folder':
      return {
        kind: change.kind,
        displayName: change.displayName,
        folderId: parseLocalId('inventory-folder', change.folderId),
      };
    case 'move_folder':
      return {
        kind: change.kind,
        folderId: parseLocalId('inventory-folder', change.folderId),
        ...(change.parentFolderId === undefined
          ? {}
          : {
              parentFolderId: parseLocalId(
                'inventory-folder',
                change.parentFolderId,
              ),
            }),
      };
    case 'delete_folder':
      return {
        kind: change.kind,
        folderId: parseLocalId('inventory-folder', change.folderId),
      };
    case 'move_items':
      return {
        kind: change.kind,
        itemIds: change.itemIds.map((id) => parseLocalId('inventory-item', id)),
        ...(change.folderId === undefined
          ? {}
          : { folderId: parseLocalId('inventory-folder', change.folderId) }),
        ...(change.contextId === undefined
          ? {}
          : { contextId: parseLocalId('working-context', change.contextId) }),
        ...(change.workContextId === undefined
          ? {}
          : {
              workContextId: parseLocalId(
                'working-context',
                change.workContextId,
              ),
            }),
      };
    case 'include_folder':
      return {
        kind: change.kind,
        folderId: parseLocalId('inventory-folder', change.folderId),
        contextId: parseLocalId('working-context', change.contextId),
        includeItems: change.includeItems,
      };
    case 'remove_context_folder':
      return {
        kind: change.kind,
        folderId: parseLocalId('inventory-folder', change.folderId),
        contextId: parseLocalId('working-context', change.contextId),
      };
  }
}

export function registerInventoryOrganizationRoutes(
  host: FastifyInstance,
  dependencies: HostDependencies,
) {
  const api = host.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    '/inventory/organization',
    {
      schema: {
        operationId: 'GetInventoryOrganization',
        querystring: InventoryOrganizationQuerySchema,
        response: {
          200: Type.Ref(InventoryOrganizationSchema),
          ...problemResponses,
        },
      },
    },
    async ({ query }) => {
      const result = await dependencies.getInventoryOrganization.execute(
        query.contextId === undefined
          ? {}
          : { contextId: parseLocalId('working-context', query.contextId) },
      );
      return {
        folders: result.folders.map((folder) => ({
          folderId: String(folder.folderId.value),
          displayName: folder.displayName,
          itemCount: folder.itemCount,
          ...(folder.parentFolderId === undefined
            ? {}
            : { parentFolderId: String(folder.parentFolderId.value) }),
          ...(folder.contextItemCount === undefined
            ? {}
            : { contextItemCount: folder.contextItemCount }),
          contextLinkCount: folder.contextLinkCount,
        })),
        linkedFolderIds: result.linkedFolderIds.map((id) => String(id.value)),
        dataRevision: result.dataRevision,
      };
    },
  );
  api.post(
    '/inventory/organization',
    {
      schema: {
        operationId: 'ChangeInventoryOrganization',
        querystring: EmptyQuerySchema,
        body: ChangeInventoryOrganizationBodySchema,
        response: {
          200: Type.Ref(ChangeInventoryOrganizationResultSchema),
          ...problemResponses,
        },
      },
    },
    async ({ body }) => {
      const result = await dependencies.changeInventoryOrganization.execute({
        expectedDataRevision: body.expectedDataRevision,
        change: parseChange(body.change),
      });
      return {
        dataRevision: result.dataRevision,
        ...(result.folderId === undefined
          ? {}
          : { folderId: String(result.folderId.value) }),
      };
    },
  );
  api.get(
    '/inventory/organization/removal-preview',
    {
      schema: {
        operationId: 'PreviewContextFolderRemoval',
        querystring: ContextFolderRemovalQuerySchema,
        response: {
          200: Type.Ref(ContextFolderRemovalPreviewSchema),
          ...problemResponses,
        },
      },
    },
    async ({ query }) =>
      contextFolderRemovalPreviewDto(
        await dependencies.previewContextFolderRemoval.execute({
          folderId: parseLocalId('inventory-folder', query.folderId),
          contextId: parseLocalId('working-context', query.contextId),
        }),
      ),
  );
  api.get(
    '/inventory/name-availability',
    {
      schema: {
        operationId: 'CheckInventoryNameAvailability',
        querystring: InventoryNameAvailabilityQuerySchema,
        response: {
          200: Type.Ref(InventoryNameAvailabilitySchema),
          ...problemResponses,
        },
      },
    },
    async ({ query }) =>
      dependencies.checkInventoryNameAvailability.execute({
        displayName: query.displayName,
        ...(query.excludingItemId === undefined
          ? {}
          : {
              excludingItemId: parseLocalId(
                'inventory-item',
                query.excludingItemId,
              ),
            }),
      }),
  );
}
