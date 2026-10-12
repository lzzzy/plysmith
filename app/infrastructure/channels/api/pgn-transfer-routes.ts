import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { HostDependencies } from './host-dependencies.ts';
import { ApiProblem } from './problems.ts';
import { EmptyQuerySchema, problemResponses } from './schemas.ts';
import * as schema from './pgn-transfer-schemas.ts';

export function registerPgnTransferRoutes(
  host: FastifyInstance,
  dependencies: HostDependencies,
): void {
  const api = host.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    '/inventory/backup-status',
    {
      schema: {
        operationId: 'GetInventoryBackupStatus',
        querystring: EmptyQuerySchema,
        response: {
          200: Type.Ref(schema.InventoryBackupStatusSchema),
          ...problemResponses,
        },
      },
    },
    async () => {
      const status = await dependencies.inventoryTransfer.getStatus();
      return {
        ...status,
        blockerCodes: status.blockerCodes.map((code) => {
          switch (code) {
            case 'stored_content':
            case 'workspace_state':
            case 'live_session':
            case 'import_active':
            case 'live_active':
            case 'playout_active':
            case 'transfer_busy':
              return code;
            default:
              throw new Error('Unknown restore blocker');
          }
        }),
      };
    },
  );
  api.post(
    '/inventory/backups',
    {
      schema: {
        operationId: 'CreateInventoryBackup',
        querystring: EmptyQuerySchema,
        body: schema.CreateInventoryBackupBodySchema,
        response: {
          200: Type.Ref(schema.InventoryBackupCreatedSchema),
          ...problemResponses,
        },
      },
    },
    async ({ body }) => dependencies.inventoryTransfer.createBackup(body),
  );
  api.post(
    '/inventory/restores/preview',
    {
      schema: {
        operationId: 'PrepareInventoryRestore',
        querystring: EmptyQuerySchema,
        body: schema.PrepareInventoryRestoreBodySchema,
        response: {
          200: Type.Ref(schema.InventoryRestorePreviewSchema),
          ...problemResponses,
        },
      },
    },
    async ({ body }) => dependencies.inventoryTransfer.prepareRestore(body),
  );
  api.post(
    '/inventory/restores/publish',
    {
      schema: {
        operationId: 'RestoreInventory',
        querystring: EmptyQuerySchema,
        body: schema.RestoreInventoryBodySchema,
        response: {
          200: Type.Ref(schema.InventoryRestoredSchema),
          ...problemResponses,
        },
      },
    },
    async ({ body }) => dependencies.inventoryTransfer.restore(body),
  );
  api.delete(
    '/inventory/restores/:restoreId',
    {
      preValidation: async (request) => {
        if (request.body !== undefined)
          throw new ApiProblem('inventory_transfer.invalid_request');
      },
      schema: {
        operationId: 'CancelInventoryRestore',
        querystring: EmptyQuerySchema,
        params: schema.CancelInventoryRestoreParamsSchema,
        response: {
          200: Type.Ref(schema.CancelInventoryRestoreResultSchema),
          ...problemResponses,
        },
      },
    },
    async ({ params }) =>
      dependencies.inventoryTransfer.cancelRestore(params.restoreId),
  );
}
