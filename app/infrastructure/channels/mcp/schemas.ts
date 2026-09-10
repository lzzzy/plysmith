import { Type } from '@sinclair/typebox';

const objectOptions = { additionalProperties: false } as const;
const revision = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const preferenceRevision = Type.Integer({
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
});
const uiLocale = Type.Union([Type.Literal('de-DE'), Type.Literal('en-GB')]);

export const EmptyArgumentsSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const SetUiLanguageArgumentsSchema = Type.Object(
  {
    uiLocale,
    expectedRevision: preferenceRevision,
  },
  { additionalProperties: false },
);

export const UserPreferencesSchema = Type.Object(
  {
    uiLocale,
    preferenceRevision,
    dataRevision: revision,
    updatedAt: Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$',
    }),
  },
  objectOptions,
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
  objectOptions,
);

export const SetUiLanguageResultSchema = Type.Object(
  { changed: Type.Boolean(), preferences: UserPreferencesSchema },
  objectOptions,
);

export const HostProblemSchema = Type.Object(
  {
    type: Type.String(),
    title: Type.String(),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    detail: Type.String(),
    instance: Type.String(),
    code: Type.String(),
    correlationId: Type.String(),
    retryable: Type.Boolean(),
    parameters: Type.Object(
      {
        expectedRevision: Type.Optional(preferenceRevision),
        currentRevision: Type.Optional(preferenceRevision),
      },
      objectOptions,
    ),
  },
  objectOptions,
);
