import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const ProviderInstanceIdSchema = Type.String({
  minLength: 1,
  pattern: '^[a-z0-9][a-z0-9-]*$',
});

export const PlysmithConfigurationSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    bindings: Type.Object(
      {
        persistence: ProviderInstanceIdSchema,
        analysisEngines: Type.Array(ProviderInstanceIdSchema, {
          uniqueItems: true,
        }),
        playoutEngines: Type.Array(ProviderInstanceIdSchema, {
          uniqueItems: true,
        }),
        liveProviders: Type.Array(ProviderInstanceIdSchema, {
          uniqueItems: true,
        }),
      },
      { additionalProperties: false },
    ),
  },
  {
    $id: 'https://github.com/lzzzy/plysmith/blob/main/configuration/schemas/plysmith.schema.json',
    additionalProperties: false,
  },
);

export const SqliteProviderConfigurationSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    provider: Type.Literal('sqlite'),
    enabled: Type.Boolean(),
    sqlite: Type.Object(
      {
        databasePath: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
  },
  {
    $id: 'https://github.com/lzzzy/plysmith/blob/main/configuration/schemas/sqlite-provider.schema.json',
    additionalProperties: false,
  },
);

export type PlysmithConfiguration = Static<typeof PlysmithConfigurationSchema>;
export type SqliteProviderConfiguration = Static<
  typeof SqliteProviderConfigurationSchema
>;

export interface MinimalConfigurationSet {
  plysmith: PlysmithConfiguration;
  sqliteMain: SqliteProviderConfiguration;
}

export function validateMinimalConfigurationSet(
  candidate: unknown,
): candidate is MinimalConfigurationSet {
  if (!isRecord(candidate)) {
    return false;
  }

  const plysmith = candidate.plysmith;
  const sqliteMain = candidate.sqliteMain;

  return (
    Value.Check(PlysmithConfigurationSchema, plysmith) &&
    Value.Check(SqliteProviderConfigurationSchema, sqliteMain) &&
    plysmith.bindings.persistence === 'sqlite-main' &&
    sqliteMain.enabled
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
