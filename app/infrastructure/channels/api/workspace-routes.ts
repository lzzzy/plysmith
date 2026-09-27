import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { HostDependencies } from './host-dependencies.ts';
import {
  addContextReferenceResultDto,
  createWorkingContextResultDto,
  listWorkingContextsResultDto,
  pendingRevisionImpactDto,
  parseLocalId,
  parseResumeRequest,
  removeContextItemResultDto,
  resolvePendingRevisionImpactResultDto,
  setWorkScopeResumeResultDto,
  workingContextWorkspaceDto,
  parseWorkScope,
  workScopeWorkspaceDto,
  startupResumeDto,
  contextRemovalPreviewDto,
  deleteWorkingContextResultDto,
} from './dto-mappers.ts';
import {
  AddContextReferenceBodySchema,
  AddContextReferenceResultSchema,
  ContextIdParamsSchema,
  ContextItemParamsSchema,
  CreateWorkingContextBodySchema,
  UpdateWorkingContextMetadataBodySchema,
  CreateWorkingContextResultSchema,
  EmptyQuerySchema,
  ListWorkingContextsResultSchema,
  PageQuerySchema,
  PendingRevisionImpactSchema,
  problemResponses,
  SetWorkScopeResumeBodySchema,
  SetWorkScopeResumeResultSchema,
  RemoveContextItemResultSchema,
  ResolvePendingRevisionImpactBodySchema,
  ResolvePendingRevisionImpactResultSchema,
  RevisionImpactIdParamsSchema,
  WorkingContextWorkspaceSchema,
  WorkScopeWorkspaceQuerySchema,
  WorkScopeWorkspaceSchema,
  StartupResumeSchema,
  SetStartupResumeBodySchema,
  ContextRemovalPreviewSchema,
  RemoveContextItemBodySchema,
  DeleteWorkingContextBodySchema,
  DeleteWorkingContextResultSchema,
} from './schemas.ts';

export function registerWorkspaceRoutes(
  host: FastifyInstance,
  dependencies: HostDependencies,
) {
  const api = host.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    '/workspace/scope',
    {
      schema: {
        operationId: 'GetWorkScopeWorkspace',
        querystring: WorkScopeWorkspaceQuerySchema,
        response: {
          200: Type.Ref(WorkScopeWorkspaceSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      workScopeWorkspaceDto(
        await dependencies.getWorkScopeWorkspace.execute({
          scope: parseWorkScope({
            kind: request.query.scopeKind,
            ...(request.query.contextId === undefined
              ? {}
              : { contextId: request.query.contextId }),
          }),
        }),
      ),
  );
  api.get(
    '/workspace/startup',
    {
      schema: {
        operationId: 'GetStartupResume',
        querystring: EmptyQuerySchema,
        response: { 200: Type.Ref(StartupResumeSchema), ...problemResponses },
      },
    },
    async () => startupResumeDto(await dependencies.getStartupResume.execute()),
  );
  api.put(
    '/workspace/startup',
    {
      schema: {
        operationId: 'SetStartupResume',
        querystring: EmptyQuerySchema,
        body: SetStartupResumeBodySchema,
        response: { 200: Type.Ref(StartupResumeSchema), ...problemResponses },
      },
    },
    async (request) =>
      startupResumeDto(
        await dependencies.setStartupResume.execute({
          ...request.body,
          scope: parseWorkScope(request.body.scope),
        }),
      ),
  );
  api.get(
    '/working-contexts/:contextId/items/:itemId/removal-preview',
    {
      schema: {
        operationId: 'PreviewContextItemRemoval',
        params: ContextItemParamsSchema,
        querystring: EmptyQuerySchema,
        response: {
          200: Type.Ref(ContextRemovalPreviewSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      contextRemovalPreviewDto(
        await dependencies.previewContextItemRemoval.execute({
          contextId: parseLocalId('working-context', request.params.contextId),
          itemId: parseLocalId('inventory-item', request.params.itemId),
        }),
      ),
  );
  api.get(
    '/working-contexts/:contextId/deletion-preview',
    {
      schema: {
        operationId: 'PreviewWorkingContextDeletion',
        params: ContextIdParamsSchema,
        querystring: EmptyQuerySchema,
        response: {
          200: Type.Ref(ContextRemovalPreviewSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      contextRemovalPreviewDto(
        await dependencies.previewWorkingContextDeletion.execute({
          contextId: parseLocalId('working-context', request.params.contextId),
        }),
      ),
  );
  api.delete(
    '/working-contexts/:contextId',
    {
      schema: {
        operationId: 'DeleteWorkingContext',
        params: ContextIdParamsSchema,
        querystring: EmptyQuerySchema,
        body: DeleteWorkingContextBodySchema,
        response: {
          200: Type.Ref(DeleteWorkingContextResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      deleteWorkingContextResultDto(
        await dependencies.deleteWorkingContext.execute({
          ...request.body,
          contextId: parseLocalId('working-context', request.params.contextId),
        }),
      ),
  );

  api.get(
    '/working-contexts',
    {
      schema: {
        operationId: 'ListWorkingContexts',
        querystring: PageQuerySchema,
        response: {
          200: Type.Ref(ListWorkingContextsResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      listWorkingContextsResultDto(
        await dependencies.listWorkingContexts.execute({
          ...(request.query.pageSize === undefined
            ? {}
            : { pageSize: Number(request.query.pageSize) }),
          ...(request.query.cursor === undefined
            ? {}
            : { cursor: request.query.cursor }),
        }),
      ),
  );

  api.get(
    '/working-contexts/:contextId',
    {
      schema: {
        operationId: 'GetWorkingContextWorkspace',
        params: ContextIdParamsSchema,
        querystring: EmptyQuerySchema,
        response: {
          200: Type.Ref(WorkingContextWorkspaceSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      workingContextWorkspaceDto(
        await dependencies.getWorkingContextWorkspace.execute({
          contextId: parseLocalId('working-context', request.params.contextId),
        }),
      ),
  );

  api.post(
    '/working-contexts',
    {
      schema: {
        operationId: 'CreateWorkingContext',
        querystring: EmptyQuerySchema,
        body: CreateWorkingContextBodySchema,
        response: {
          200: Type.Ref(CreateWorkingContextResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      createWorkingContextResultDto(
        await dependencies.createWorkingContext.execute({
          displayName: request.body.displayName,
          ...(request.body.purpose === undefined
            ? {}
            : { purpose: request.body.purpose }),
          ...(request.body.boundary === undefined
            ? {}
            : { boundary: request.body.boundary }),
          ...(request.body.nextStep === undefined
            ? {}
            : { nextStep: request.body.nextStep }),
        }),
      ),
  );

  api.put(
    '/working-contexts/:contextId/metadata',
    {
      schema: {
        operationId: 'UpdateWorkingContextMetadata',
        params: ContextIdParamsSchema,
        querystring: EmptyQuerySchema,
        body: UpdateWorkingContextMetadataBodySchema,
        response: {
          200: Type.Ref(CreateWorkingContextResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      createWorkingContextResultDto(
        await dependencies.updateWorkingContextMetadata.execute({
          ...request.body,
          contextId: parseLocalId('working-context', request.params.contextId),
        }),
      ),
  );

  api.delete(
    '/working-contexts/:contextId/items/:itemId',
    {
      schema: {
        operationId: 'RemoveContextItem',
        body: RemoveContextItemBodySchema,
        params: ContextItemParamsSchema,
        querystring: EmptyQuerySchema,
        response: {
          200: Type.Ref(RemoveContextItemResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      removeContextItemResultDto(
        await dependencies.removeContextItem.execute({
          ...request.body,
          contextId: parseLocalId('working-context', request.params.contextId),
          itemId: parseLocalId('inventory-item', request.params.itemId),
        }),
      ),
  );

  api.post(
    '/working-contexts/:contextId/references',
    {
      schema: {
        operationId: 'AddContextReference',
        params: ContextIdParamsSchema,
        querystring: EmptyQuerySchema,
        body: AddContextReferenceBodySchema,
        response: {
          200: Type.Ref(AddContextReferenceResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      addContextReferenceResultDto(
        await dependencies.addContextReference.execute({
          contextId: parseLocalId('working-context', request.params.contextId),
          itemId: parseLocalId('inventory-item', request.body.itemId),
          anchorId: parseLocalId('anchor', request.body.anchorId),
        }),
      ),
  );

  api.put(
    '/workspace/resume',
    {
      schema: {
        operationId: 'SetWorkScopeResume',
        querystring: EmptyQuerySchema,
        body: SetWorkScopeResumeBodySchema,
        response: {
          200: Type.Ref(SetWorkScopeResumeResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      setWorkScopeResumeResultDto(
        await dependencies.setWorkScopeResume.execute(
          parseResumeRequest(request.body.scope, request.body),
        ),
      ),
  );

  api.get(
    '/workspace/revision-impacts/:impactId',
    {
      schema: {
        operationId: 'GetPendingRevisionImpact',
        params: RevisionImpactIdParamsSchema,
        querystring: EmptyQuerySchema,
        response: {
          200: Type.Ref(PendingRevisionImpactSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      pendingRevisionImpactDto(
        await dependencies.getPendingRevisionImpact.execute({
          impactId: parseLocalId('revision-impact', request.params.impactId),
        }),
      ),
  );

  api.post(
    '/workspace/revision-impacts/:impactId/resolution',
    {
      schema: {
        operationId: 'ResolvePendingRevisionImpact',
        params: RevisionImpactIdParamsSchema,
        querystring: EmptyQuerySchema,
        body: ResolvePendingRevisionImpactBodySchema,
        response: {
          200: Type.Ref(ResolvePendingRevisionImpactResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      resolvePendingRevisionImpactResultDto(
        await dependencies.resolvePendingRevisionImpact.execute({
          impactId: parseLocalId('revision-impact', request.params.impactId),
          expectedImpactVersion: request.body.expectedImpactVersion,
          expectedDataRevision: request.body.expectedDataRevision,
          resolution: request.body.resolution,
        }),
      ),
  );
}
