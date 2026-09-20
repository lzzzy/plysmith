import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const ProviderInstanceIdSchema = Type.String({
  minLength: 1,
  pattern: '^[a-z0-9][a-z0-9-]*$',
});

export const PlysmithConfigurationSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    diagnostics: Type.Object(
      {
        logging: Type.Object(
          {
            level: Type.Union([
              Type.Literal('off'),
              Type.Literal('error'),
              Type.Literal('info'),
              Type.Literal('debug'),
            ]),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
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

export const StockfishUciProviderConfigurationSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    provider: Type.Literal('stockfish-uci'),
    enabled: Type.Boolean(),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    stockfish: Type.Object(
      {
        executablePath: Type.String({ minLength: 1 }),
        executableSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
        arguments: Type.Array(Type.String({ maxLength: 1_024 }), {
          maxItems: 32,
        }),
        threads: Type.Integer({ minimum: 1, maximum: 256 }),
        hashMb: Type.Integer({ minimum: 1, maximum: 65_536 }),
        moveTimeMs: Type.Integer({ minimum: 10, maximum: 600_000 }),
        startupTimeoutMs: Type.Integer({ minimum: 100, maximum: 60_000 }),
        moveTimeoutMs: Type.Integer({ minimum: 100, maximum: 660_000 }),
        stopTimeoutMs: Type.Integer({ minimum: 100, maximum: 30_000 }),
        maxOutputBytes: Type.Integer({ minimum: 1_024, maximum: 16_777_216 }),
      },
      { additionalProperties: false },
    ),
  },
  {
    $id: 'https://github.com/lzzzy/plysmith/blob/main/configuration/schemas/stockfish-uci-provider.schema.json',
    additionalProperties: false,
  },
);

export type PlysmithConfiguration = Static<typeof PlysmithConfigurationSchema>;
export type SqliteProviderConfiguration = Static<
  typeof SqliteProviderConfigurationSchema
>;
export type StockfishUciProviderConfiguration = Static<
  typeof StockfishUciProviderConfigurationSchema
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
