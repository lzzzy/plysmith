import { Type, type Static } from '@sinclair/typebox';

const objectOptions = { additionalProperties: false } as const;
const revision = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const preferenceRevision = Type.Integer({
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
});
const timestamp = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$',
});
const identifier = Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: '^[A-Za-z0-9._:-]+$',
});

export const UiLocaleSchema = Type.Union([
  Type.Literal('de-DE'),
  Type.Literal('en-GB'),
]);

export const EmptyQuerySchema = Type.Object({}, objectOptions);

export const UserPreferencesSchema = Type.Object(
  {
    uiLocale: UiLocaleSchema,
    preferenceRevision,
    dataRevision: revision,
    updatedAt: timestamp,
  },
  { ...objectOptions, $id: 'UserPreferences' },
);

export const SetUiLanguageBodySchema = Type.Object(
  { uiLocale: UiLocaleSchema, expectedRevision: preferenceRevision },
  { ...objectOptions, $id: 'SetUiLanguageBody' },
);

export const SetUiLanguageResultSchema = Type.Object(
  { changed: Type.Boolean(), preferences: Type.Ref(UserPreferencesSchema) },
  { ...objectOptions, $id: 'SetUiLanguageResult' },
);

export const SystemStatusSchema = Type.Object(
  {
    state: Type.Union([
      Type.Literal('starting'),
      Type.Literal('ready'),
      Type.Literal('degraded'),
      Type.Literal('startup_blocked'),
      Type.Literal('shutting_down'),
    ]),
    persistence: Type.Object(
      { schemaVersion: preferenceRevision, dataRevision: revision },
      objectOptions,
    ),
    productRelease: Type.String({ minLength: 1 }),
    contractFingerprint: Type.String({ minLength: 1 }),
  },
  { ...objectOptions, $id: 'SystemStatus' },
);

export const ProblemDetailsSchema = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    detail: Type.String(),
    instance: Type.String(),
    code: Type.String(),
    correlationId: identifier,
    retryable: Type.Boolean(),
    parameters: Type.Object(
      {
        expectedRevision: Type.Optional(preferenceRevision),
        currentRevision: Type.Optional(preferenceRevision),
      },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'ProblemDetails' },
);

const eventMetadata = {
  eventId: identifier,
  sequence: revision,
  dataRevision: revision,
  occurredAt: timestamp,
  subscriptionRevision: preferenceRevision,
  correlationId: identifier,
};

export const UiLanguageChangedEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('preference.ui-language-changed'),
    preferenceRevision,
    payload: Type.Object(
      { previousUiLocale: UiLocaleSchema, uiLocale: UiLocaleSchema },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'UiLanguageChangedEvent' },
);

export const ReplayGapEventSchema = Type.Object(
  {
    ...eventMetadata,
    kind: Type.Literal('host.replay-gap'),
    payload: Type.Object(
      {
        reason: Type.Union([
          Type.Literal('replay_unavailable'),
          Type.Literal('slow_consumer'),
        ]),
      },
      objectOptions,
    ),
  },
  { ...objectOptions, $id: 'ReplayGapEvent' },
);

export const HostEventSchema = Type.Union(
  [Type.Ref(UiLanguageChangedEventSchema), Type.Ref(ReplayGapEventSchema)],
  { $id: 'HostEvent' },
);

// Validate only this selected header; ordinary HTTP headers remain permitted.
export const EventHeadersSchema = Type.Object(
  { 'last-event-id': Type.Optional(identifier) },
  objectOptions,
);

export const apiSchemas = [
  UserPreferencesSchema,
  SetUiLanguageBodySchema,
  SetUiLanguageResultSchema,
  SystemStatusSchema,
  ProblemDetailsSchema,
  UiLanguageChangedEventSchema,
  ReplayGapEventSchema,
  HostEventSchema,
] as const;

export type HostEvent =
  | Static<typeof UiLanguageChangedEventSchema>
  | Static<typeof ReplayGapEventSchema>;
export type ProblemDetails = Static<typeof ProblemDetailsSchema>;

export const problemResponses = {
  400: problemResponse(),
  401: problemResponse(),
  403: problemResponse(),
  404: problemResponse(),
  406: problemResponse(),
  409: problemResponse(),
  413: problemResponse(),
  415: problemResponse(),
  500: problemResponse(),
};

function problemResponse() {
  return {
    description: 'A safe, stable Plysmith problem.',
    content: {
      'application/problem+json': { schema: Type.Ref(ProblemDetailsSchema) },
    },
  };
}
