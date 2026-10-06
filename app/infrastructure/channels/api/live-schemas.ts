import { Type } from '@sinclair/typebox';
import { LICHESS_TOKEN_PATTERN } from '../../../../contracts/host/live-provider-configuration.ts';
import type { components } from '../../../../contracts/host/index.ts';

const closed = { additionalProperties: false } as const;
const revision = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const gameId = Type.String({ pattern: '^[a-zA-Z0-9]{8}$' });
const name = Type.String({ minLength: 1, maxLength: 160 });
const side = Type.Union([Type.Literal('white'), Type.Literal('black')]);
const player = Type.Object(
  { id: Type.Optional(name), name, rating: Type.Optional(revision) },
  closed,
);
const ownGame = Type.Object(
  {
    gameId,
    displayName: name,
    opponentRating: Type.Optional(revision),
    playerSide: side,
    boardCompatible: Type.Boolean(),
    standard: Type.Boolean(),
  },
  closed,
);
const outcome = Type.Union(
  (['white_win', 'black_win', 'draw', 'unfinished'] as const).map((value) =>
    Type.Literal(value),
  ),
);
const state = Type.Unsafe<components['schemas']['ChessState']>({
  $ref: 'ChessState',
});
const move = Type.Unsafe<components['schemas']['CanonicalMove']>({
  $ref: 'CanonicalMove',
});
const focus = Type.Object(
  {
    focusKey: Type.String({ maxLength: 256 }),
    root: state,
    moves: Type.Array(move, { maxItems: 1000 }),
    current: state,
  },
  closed,
);

export const LiveStateSchema = Type.Object(
  {
    revision,
    configured: Type.Boolean(),
    online: Type.Boolean(),
    connection: Type.Union(
      (
        [
          'unconfigured',
          'disconnected',
          'connecting',
          'connected',
          'reconnecting',
          'failed',
        ] as const
      ).map((value) => Type.Literal(value)),
    ),
    fairPlayBlocked: Type.Boolean(),
    accountName: Type.Optional(name),
    games: Type.Array(ownGame, { maxItems: 100 }),
    problemCode: Type.Optional(Type.String({ maxLength: 160 })),
    session: Type.Optional(
      Type.Object(
        {
          gameId,
          role: Type.Union([Type.Literal('observe'), Type.Literal('play')]),
          white: player,
          black: player,
          playerSide: Type.Optional(side),
          root: state,
          steps: Type.Array(Type.Object({ move, after: state }, closed), {
            maxItems: 1000,
          }),
          selectedPly: Type.Integer({ minimum: 0, maximum: 1000 }),
          current: state,
          analysisRevision: revision,
          legalMoves: Type.Array(move, { maxItems: 256 }),
          status: Type.Union([
            Type.Literal('ongoing'),
            Type.Literal('finalizing'),
            Type.Literal('ended'),
          ]),
          connected: Type.Boolean(),
          outcome,
          pendingMove: Type.Boolean(),
          whiteClockMs: Type.Optional(revision),
          blackClockMs: Type.Optional(revision),
          clockUpdatedAt: Type.Optional(Type.String({ format: 'date-time' })),
          whiteDrawOffer: Type.Optional(Type.Boolean()),
          blackDrawOffer: Type.Optional(Type.Boolean()),
          focus: Type.Optional(focus),
          problemCode: Type.Optional(Type.String({ maxLength: 160 })),
        },
        closed,
      ),
    ),
  },
  { ...closed, $id: 'LiveState' },
);

const expected = { expectedRevision: revision };
export const LiveCommandBodySchema = Type.Union(
  [
    Type.Object(
      {
        ...expected,
        kind: Type.Literal('observe'),
        url: Type.String({ minLength: 1, maxLength: 256 }),
      },
      closed,
    ),
    Type.Object({ ...expected, kind: Type.Literal('play'), gameId }, closed),
    Type.Object(
      {
        ...expected,
        kind: Type.Literal('select'),
        ply: Type.Integer({ minimum: 0, maximum: 1000 }),
      },
      closed,
    ),
    Type.Object(
      {
        ...expected,
        kind: Type.Literal('move'),
        move: Type.String({ pattern: '^[a-h][1-8][a-h][1-8][qrbn]?$' }),
      },
      closed,
    ),
    Type.Object(
      {
        ...expected,
        kind: Type.Literal('act'),
        action: Type.Union(
          (
            [
              'resign',
              'abort',
              'offer_draw',
              'accept_draw',
              'decline_draw',
            ] as const
          ).map((value) => Type.Literal(value)),
        ),
      },
      closed,
    ),
    Type.Object({ ...expected, kind: Type.Literal('refresh') }, closed),
    Type.Object({ ...expected, kind: Type.Literal('disconnect') }, closed),
    Type.Object({ ...expected, kind: Type.Literal('discard') }, closed),
  ],
  { $id: 'LiveCommandBody' },
);

export const SaveLiveGameBodySchema = Type.Object(
  {
    ...expected,
    displayName: name,
    languageTag: Type.Union([Type.Literal('de-DE'), Type.Literal('en-GB')]),
    folderId: Type.Optional(
      Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    ),
    workingContextId: Type.Optional(
      Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    ),
  },
  { ...closed, $id: 'SaveLiveGameBody' },
);
export const LiveSavedSchema = Type.Object(
  {
    itemId: Type.Integer({ minimum: 1 }),
    revisionId: Type.Integer({ minimum: 1 }),
    dataRevision: revision,
  },
  { ...closed, $id: 'LiveSaved' },
);

export const LiveProviderConfigurationSchema = Type.Object(
  {
    configured: Type.Boolean(),
    tokenConfigured: Type.Boolean(),
    configurationRevision: Type.Union([
      Type.String({ maxLength: 128 }),
      Type.Null(),
    ]),
    restartRequired: Type.Boolean(),
  },
  { ...closed, $id: 'LiveProviderConfiguration' },
);
export const SaveLiveProviderConfigurationBodySchema = Type.Object(
  {
    token: Type.String({ pattern: LICHESS_TOKEN_PATTERN, writeOnly: true }),
    expectedConfigurationRevision: Type.Union([
      Type.String({ maxLength: 128 }),
      Type.Null(),
    ]),
  },
  { ...closed, $id: 'SaveLiveProviderConfigurationBody' },
);

export const liveSchemas = [
  LiveStateSchema,
  LiveCommandBodySchema,
  SaveLiveGameBodySchema,
  LiveSavedSchema,
  LiveProviderConfigurationSchema,
  SaveLiveProviderConfigurationBodySchema,
];
