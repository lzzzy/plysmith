import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { HostDependencies } from './host-dependencies.ts';
import {
  analysisNoteMutationResultDto,
  analysisWorkspaceDto,
  createAnalysisRecordResultDto,
  createAnalysisNoteResultDto,
  parseAnalysisScratchAction,
  parseAnalysisWorkspaceQuery,
  parseLocalId,
  parseWorkScope,
  updateAnalysisScratchResultDto,
} from './dto-mappers.ts';
import {
  AnalysisWorkspaceSchema,
  AnalysisNoteMutationResultSchema,
  ContributionIdParamsSchema,
  CreatePositionNoteBodySchema,
  CreateAnalysisRecordBodySchema,
  CreateAnalysisRecordResultSchema,
  CreateAnalysisNoteBodySchema,
  CreateAnalysisNoteResultSchema,
  EmptyQuerySchema,
  GetAnalysisWorkspaceQuerySchema,
  problemResponses,
  DeleteAnalysisNoteBodySchema,
  UpdateAnalysisNoteBodySchema,
  UpdateAnalysisScratchBodySchema,
  UpdateAnalysisScratchResultSchema,
} from './schemas.ts';

export function registerAnalysisRoutes(
  host: FastifyInstance,
  dependencies: HostDependencies,
) {
  const api = host.withTypeProvider<TypeBoxTypeProvider>();

  api.get(
    '/analysis/workspace',
    {
      schema: {
        operationId: 'GetAnalysisWorkspace',
        querystring: GetAnalysisWorkspaceQuerySchema,
        response: {
          200: Type.Ref(AnalysisWorkspaceSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      analysisWorkspaceDto(
        await dependencies.getAnalysisWorkspace.execute(
          parseAnalysisWorkspaceQuery(request.query),
        ),
      ),
  );

  api.put(
    '/analysis/scratch',
    {
      schema: {
        operationId: 'UpdateAnalysisScratch',
        querystring: EmptyQuerySchema,
        body: UpdateAnalysisScratchBodySchema,
        response: {
          200: Type.Ref(UpdateAnalysisScratchResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      updateAnalysisScratchResultDto(
        await dependencies.updateAnalysisScratch.execute({
          scope: parseWorkScope(request.body.scope),
          expectedScratchId: request.body.expectedScratchId,
          expectedScratchRevision: request.body.expectedScratchRevision,
          action: parseAnalysisScratchAction(request.body.action),
        }),
      ),
  );

  api.post(
    '/inventory/analysis-records',
    {
      schema: {
        operationId: 'CreateAnalysisRecord',
        querystring: EmptyQuerySchema,
        body: CreateAnalysisRecordBodySchema,
        response: {
          200: Type.Ref(CreateAnalysisRecordResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      createAnalysisRecordResultDto(
        await dependencies.createAnalysisRecord.execute({
          scope: parseWorkScope(request.body.scope),
          expectedScratchId: request.body.expectedScratchId,
          expectedScratchRevision: request.body.expectedScratchRevision,
          displayName: request.body.displayName,
          languageTag: request.body.languageTag,
          ...(request.body.targetContextId === undefined
            ? {}
            : {
                targetContextId: parseLocalId(
                  'working-context',
                  request.body.targetContextId,
                ),
              }),
          ...(request.body.noteScope === undefined
            ? {}
            : {
                noteScope:
                  request.body.noteScope.kind === 'global'
                    ? { kind: 'global' as const }
                    : {
                        kind: 'context' as const,
                        contextId: parseLocalId(
                          'working-context',
                          request.body.noteScope.contextId,
                        ),
                      },
              }),
        }),
      ),
  );

  api.post(
    '/analysis/notes',
    {
      schema: {
        operationId: 'CreateAnalysisNote',
        querystring: EmptyQuerySchema,
        body: CreateAnalysisNoteBodySchema,
        response: {
          200: Type.Ref(CreateAnalysisNoteResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      createAnalysisNoteResultDto(
        await dependencies.createAnalysisNote.execute({
          scope: parseWorkScope(request.body.scope),
          expectedScratchId: request.body.expectedScratchId,
          expectedScratchRevision: request.body.expectedScratchRevision,
          languageTag: request.body.languageTag,
          noteScope:
            request.body.noteScope.kind === 'global'
              ? { kind: 'global' }
              : {
                  kind: 'context',
                  contextId: parseLocalId(
                    'working-context',
                    request.body.noteScope.contextId,
                  ),
                },
        }),
      ),
  );

  api.post(
    '/analysis/position-notes',
    {
      schema: {
        operationId: 'CreatePositionNote',
        querystring: EmptyQuerySchema,
        body: CreatePositionNoteBodySchema,
        response: {
          200: Type.Ref(AnalysisNoteMutationResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      analysisNoteMutationResultDto(
        await dependencies.createPositionNote.execute({
          scope: parseWorkScope(request.body.scope),
          itemId: parseLocalId('inventory-item', request.body.itemId),
          revisionId: parseLocalId('item-revision', request.body.revisionId),
          anchorId: parseLocalId('anchor', request.body.anchorId),
          body: request.body.body,
          languageTag: request.body.languageTag,
          noteScope:
            request.body.noteScope.kind === 'global'
              ? { kind: 'global' }
              : {
                  kind: 'context',
                  contextId: parseLocalId(
                    'working-context',
                    request.body.noteScope.contextId,
                  ),
                },
        }),
      ),
  );

  api.patch(
    '/analysis/notes/:contributionId',
    {
      schema: {
        operationId: 'UpdateAnalysisNote',
        params: ContributionIdParamsSchema,
        querystring: EmptyQuerySchema,
        body: UpdateAnalysisNoteBodySchema,
        response: {
          200: Type.Ref(AnalysisNoteMutationResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      analysisNoteMutationResultDto(
        await dependencies.updateAnalysisNote.execute({
          scope: parseWorkScope(request.body.scope),
          contributionId: parseLocalId(
            'contribution',
            request.params.contributionId,
          ),
          expectedContributionVersion: request.body.expectedContributionVersion,
          body: request.body.body,
        }),
      ),
  );

  api.delete(
    '/analysis/notes/:contributionId',
    {
      schema: {
        operationId: 'DeleteAnalysisNote',
        params: ContributionIdParamsSchema,
        querystring: EmptyQuerySchema,
        body: DeleteAnalysisNoteBodySchema,
        response: {
          200: Type.Ref(AnalysisNoteMutationResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      analysisNoteMutationResultDto(
        await dependencies.deleteAnalysisNote.execute({
          scope: parseWorkScope(request.body.scope),
          contributionId: parseLocalId(
            'contribution',
            request.params.contributionId,
          ),
          expectedContributionVersion: request.body.expectedContributionVersion,
        }),
      ),
  );
}
