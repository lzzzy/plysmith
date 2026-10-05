import { Type, type Static } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { HostDependencies } from './host-dependencies.ts';
import type { ImportFolderDestination } from '../../../application/inventory/import-models.ts';
import { parseLocalId } from './dto-mappers.ts';
import { EmptyQuerySchema, problemResponses } from './schemas.ts';
import {
  ImportInputDescriptorSchema,
  RegisterImportInputBodySchema,
  ImportPreviewSchema,
  PrepareImportBodySchema,
  CheckImportNamesBodySchema,
  ImportNameChecksSchema,
  PublishImportBodySchema,
  ImportPublishedSchema,
  DiscardImportBodySchema,
  DiscardImportResultSchema,
  type ImportFolderDestinationSchema,
} from './import-schemas.ts';

function folderRequest(
  folder: Static<typeof ImportFolderDestinationSchema>,
): ImportFolderDestination {
  switch (folder.kind) {
    case 'unfiled':
      return folder;
    case 'existing':
      return {
        kind: 'existing',
        folderId: parseLocalId('inventory-folder', folder.folderId),
      };
    case 'new':
      return {
        kind: 'new',
        displayName: folder.displayName,
        ...(folder.parentFolderId === undefined
          ? {}
          : {
              parentFolderId: parseLocalId(
                'inventory-folder',
                folder.parentFolderId,
              ),
            }),
      };
  }
}

export function registerImportRoutes(
  host: FastifyInstance,
  dependencies: HostDependencies,
): void {
  const api = host.withTypeProvider<TypeBoxTypeProvider>();
  api.post(
    '/inventory/import-inputs',
    {
      schema: {
        operationId: 'RegisterImportInput',
        querystring: EmptyQuerySchema,
        body: RegisterImportInputBodySchema,
        response: {
          200: Type.Ref(ImportInputDescriptorSchema),
          ...problemResponses,
        },
      },
    },
    async ({ body }) => dependencies.registerImportInput.execute(body),
  );
  api.post(
    '/inventory/imports/preview',
    {
      schema: {
        operationId: 'PrepareImport',
        querystring: EmptyQuerySchema,
        body: PrepareImportBodySchema,
        response: { 200: Type.Ref(ImportPreviewSchema), ...problemResponses },
      },
    },
    async ({ body }) => {
      const result = await dependencies.prepareImport.execute(body);
      return {
        ...result,
        candidates: result.candidates.map((candidate) => ({
          ...candidate,
          findings: [...candidate.findings],
        })),
      };
    },
  );
  api.post(
    '/inventory/imports/names',
    {
      bodyLimit: 1048576,
      schema: {
        operationId: 'CheckImportNames',
        querystring: EmptyQuerySchema,
        body: CheckImportNamesBodySchema,
        response: {
          200: Type.Ref(ImportNameChecksSchema),
          ...problemResponses,
        },
      },
    },
    async ({ body }) => {
      const result = await dependencies.checkImportNames.execute(body);
      return { ...result, candidates: [...result.candidates] };
    },
  );
  api.post(
    '/inventory/imports/publish',
    {
      bodyLimit: 1048576,
      schema: {
        operationId: 'PublishImport',
        querystring: EmptyQuerySchema,
        body: PublishImportBodySchema,
        response: { 200: Type.Ref(ImportPublishedSchema), ...problemResponses },
      },
    },
    async ({ body }) => {
      const result = await dependencies.publishImport.execute({
        ...body,
        folder: folderRequest(body.folder),
      });
      return {
        dataRevision: result.dataRevision,
        ...(result.folderId === undefined
          ? {}
          : { folderId: String(result.folderId.value) }),
        items: result.items.map((item) => ({
          ...item,
          itemId: String(item.itemId.value),
          revisionId: String(item.revisionId.value),
        })),
      };
    },
  );
  api.post(
    '/inventory/imports/discard',
    {
      schema: {
        operationId: 'DiscardImport',
        querystring: EmptyQuerySchema,
        body: DiscardImportBodySchema,
        response: {
          200: Type.Ref(DiscardImportResultSchema),
          ...problemResponses,
        },
      },
    },
    async ({ body }) => dependencies.discardImport.execute(body),
  );
}
