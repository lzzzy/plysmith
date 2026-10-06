import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { HostDependencies } from './host-dependencies.ts';
import type { LiveState } from '../../../application/live/live-models.ts';
import { EmptyQuerySchema, problemResponses } from './schemas.ts';
import {
  LiveStateSchema,
  LiveCommandBodySchema,
  SaveLiveGameBodySchema,
  LiveSavedSchema,
  LiveProviderConfigurationSchema,
  SaveLiveProviderConfigurationBodySchema,
} from './live-schemas.ts';

function liveStateDto(model: LiveState) {
  const { session, games, ...metadata } = model;
  if (session === undefined) return { ...metadata, games: [...games] };
  const { focus, ...details } = session;
  return {
    ...metadata,
    games: [...games],
    session: {
      ...details,
      steps: [...session.steps],
      legalMoves: [...session.legalMoves],
      ...(focus === undefined
        ? {}
        : { focus: { ...focus, moves: [...focus.moves] } }),
    },
  };
}

export function registerLiveRoutes(
  host: FastifyInstance,
  dependencies: HostDependencies,
): void {
  const api = host.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    '/live',
    {
      schema: {
        operationId: 'GetLiveState',
        querystring: EmptyQuerySchema,
        response: { 200: Type.Ref(LiveStateSchema), ...problemResponses },
      },
    },
    async () => liveStateDto(dependencies.live.getState()),
  );
  api.post(
    '/live/commands',
    {
      schema: {
        operationId: 'LiveCommand',
        querystring: EmptyQuerySchema,
        body: LiveCommandBodySchema,
        response: { 200: Type.Ref(LiveStateSchema), ...problemResponses },
      },
    },
    async ({ body }) => {
      const live = dependencies.live;
      switch (body.kind) {
        case 'observe':
          return liveStateDto(
            await live.observe(body.url, body.expectedRevision),
          );
        case 'play':
          return liveStateDto(
            await live.play(body.gameId, body.expectedRevision),
          );
        case 'select':
          return liveStateDto(live.select(body.ply, body.expectedRevision));
        case 'move':
          return liveStateDto(
            await live.move(body.move, body.expectedRevision),
          );
        case 'act':
          return liveStateDto(
            await live.act(body.action, body.expectedRevision),
          );
        case 'refresh':
          return liveStateDto(await live.refresh(body.expectedRevision));
        case 'disconnect':
          return liveStateDto(await live.disconnect(body.expectedRevision));
        case 'discard':
          return liveStateDto(await live.discard(body.expectedRevision));
      }
    },
  );
  api.post(
    '/live/games',
    {
      schema: {
        operationId: 'SaveLiveGame',
        querystring: EmptyQuerySchema,
        body: SaveLiveGameBodySchema,
        response: { 200: Type.Ref(LiveSavedSchema), ...problemResponses },
      },
    },
    async ({ body }) => dependencies.live.save(body),
  );
  api.get(
    '/configuration/live',
    {
      schema: {
        operationId: 'GetLiveProviderConfiguration',
        querystring: EmptyQuerySchema,
        response: {
          200: Type.Ref(LiveProviderConfigurationSchema),
          ...problemResponses,
        },
      },
    },
    async () => dependencies.getLiveProviderConfiguration.execute(),
  );
  api.put(
    '/configuration/live',
    {
      bodyLimit: 4096,
      schema: {
        operationId: 'SaveLiveProviderConfiguration',
        querystring: EmptyQuerySchema,
        body: SaveLiveProviderConfigurationBodySchema,
        response: {
          200: Type.Ref(LiveProviderConfigurationSchema),
          ...problemResponses,
        },
      },
    },
    async ({ body }) =>
      dependencies.saveLiveProviderConfiguration.execute(body),
  );
}
