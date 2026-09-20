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
} from './dto-mappers.ts';
import {
  AddContextReferenceBodySchema,
  AddContextReferenceResultSchema,
  ContextIdParamsSchema,
  ContextItemParamsSchema,
  CreateWorkingContextBodySchema,
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
} from './schemas.ts';

export function registerWorkspaceRoutes(
  host: FastifyInstance,
  dependencies: HostDependencies,
) {
  const api = host.withTypeProvider<TypeBoxTypeProvider>();

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

  api.delete(
    '/working-contexts/:contextId/items/:itemId',
    {
      schema: {
        operationId: 'RemoveContextItem',
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
    '/working-contexts/:contextId/resume',
    {
      schema: {
        operationId: 'SetWorkScopeResume',
        params: ContextIdParamsSchema,
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
          parseResumeRequest(request.params.contextId, request.body),
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
          resolution: request.body.resolution,
        }),
      ),
  );
}
