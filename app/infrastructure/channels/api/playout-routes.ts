import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';

import type { HostDependencies } from './host-dependencies.ts';
import {
  completePlayoutResultDto,
  parseLocalId,
  parsePlayoutStart,
  parseWorkScope,
  playoutResultDto,
} from './dto-mappers.ts';
import {
  CompletePlayoutBodySchema,
  CompletePlayoutResultSchema,
  DiscardPlayoutResultSchema,
  EmptyQuerySchema,
  ExpectedPlayoutBodySchema,
  GetPlayoutQuerySchema,
  GetPlayoutResultSchema,
  ListMovePolicyProvidersResultSchema,
  PlayoutResultSchema,
  StartPlayoutBodySchema,
  SubmitPlayoutMoveBodySchema,
  problemResponses,
} from './schemas.ts';

export function registerPlayoutRoutes(
  host: FastifyInstance,
  dependencies: HostDependencies,
): void {
  const api = host.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    '/playout/providers',
    {
      schema: {
        operationId: 'ListMovePolicyProviders',
        querystring: EmptyQuerySchema,
        response: {
          200: Type.Ref(ListMovePolicyProvidersResultSchema),
          ...problemResponses,
        },
      },
    },
    async () => ({
      providers: dependencies.listMovePolicyProviders
        .execute()
        .map((entry) => ({
          ...entry,
          capabilities: [...entry.capabilities],
        })),
    }),
  );
  api.get(
    '/playout',
    {
      schema: {
        operationId: 'GetPlayout',
        querystring: GetPlayoutQuerySchema,
        response: {
          200: Type.Ref(GetPlayoutResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) => {
      const result = await dependencies.getPlayout.execute({
        scope: parseWorkScope({
          kind: request.query.scopeKind,
          ...(request.query.contextId === undefined
            ? {}
            : { contextId: request.query.contextId }),
        }),
      });
      return result === undefined ? null : playoutResultDto(result);
    },
  );
  api.post(
    '/playout',
    {
      schema: {
        operationId: 'StartPlayout',
        querystring: EmptyQuerySchema,
        body: StartPlayoutBodySchema,
        response: { 200: Type.Ref(PlayoutResultSchema), ...problemResponses },
      },
    },
    async (request) =>
      playoutResultDto(
        await dependencies.startPlayout.execute({
          scope: parseWorkScope(request.body.scope),
          start: parsePlayoutStart(request.body.start),
          ...(request.body.sourcePath === undefined
            ? {}
            : {
                sourcePath: {
                  displayName: request.body.sourcePath.displayName,
                  rootFen: request.body.sourcePath.rootFen,
                  moves: request.body.sourcePath.moves,
                },
              }),
          providerInstanceId: request.body.providerInstanceId,
          capability: request.body.capability,
          opening: request.body.opening,
        }),
      ),
  );
  api.post(
    '/playout/moves',
    {
      schema: {
        operationId: 'SubmitPlayoutMove',
        querystring: EmptyQuerySchema,
        body: SubmitPlayoutMoveBodySchema,
        response: { 200: Type.Ref(PlayoutResultSchema), ...problemResponses },
      },
    },
    async (request) =>
      playoutResultDto(
        await dependencies.submitPlayoutMove.execute({
          ...expected(request.body),
          move: request.body.move,
        }),
      ),
  );
  api.post(
    '/playout/retry',
    expectedRoute('RetryPlayoutPolicyMove'),
    async (request) =>
      playoutResultDto(
        await dependencies.retryPlayoutPolicyMove.execute(
          expected(request.body),
        ),
      ),
  );
  api.post('/playout/pause', expectedRoute('PausePlayout'), async (request) =>
    playoutResultDto(
      await dependencies.pausePlayout.execute(expected(request.body)),
    ),
  );
  api.post('/playout/resume', expectedRoute('ResumePlayout'), async (request) =>
    playoutResultDto(
      await dependencies.resumePlayout.execute(expected(request.body)),
    ),
  );
  api.post('/playout/stop', expectedRoute('StopPlayout'), async (request) =>
    playoutResultDto(
      await dependencies.stopPlayout.execute(expected(request.body)),
    ),
  );
  api.post(
    '/playout/cancel-completion',
    expectedRoute('CancelPlayoutCompletion'),
    async (request) =>
      playoutResultDto(
        await dependencies.cancelPlayoutCompletion.execute(
          expected(request.body),
        ),
      ),
  );
  api.post(
    '/playout/complete',
    {
      schema: {
        operationId: 'CompletePlayout',
        querystring: EmptyQuerySchema,
        body: CompletePlayoutBodySchema,
        response: {
          200: Type.Ref(CompletePlayoutResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      completePlayoutResultDto(
        await dependencies.completePlayout.execute({
          ...expected(request.body),
          completionId: request.body.completionId,
          ...(request.body.manualResult === undefined
            ? {}
            : { manualResult: request.body.manualResult }),
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
        }),
      ),
  );
  api.delete(
    '/playout',
    {
      schema: {
        operationId: 'DiscardPlayout',
        querystring: EmptyQuerySchema,
        body: ExpectedPlayoutBodySchema,
        response: {
          200: Type.Ref(DiscardPlayoutResultSchema),
          ...problemResponses,
        },
      },
    },
    async (request) =>
      dependencies.discardPlayout.execute(expected(request.body)),
  );
}

function expectedRoute(operationId: string) {
  return {
    schema: {
      operationId,
      querystring: EmptyQuerySchema,
      body: ExpectedPlayoutBodySchema,
      response: { 200: Type.Ref(PlayoutResultSchema), ...problemResponses },
    },
  };
}

function expected(body: {
  readonly scope: {
    readonly kind: 'free' | 'context';
    readonly contextId?: string;
  };
  readonly draftId: string;
  readonly expectedDraftRevision: number;
}) {
  return {
    scope: parseWorkScope(body.scope),
    draftId: parseLocalId('playout-draft', body.draftId),
    expectedDraftRevision: body.expectedDraftRevision,
  };
}
