import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import { ENGINE_PROVIDER_TIMEOUT_LIMITS } from '../../../../../contracts/host/engine-provider-configuration.ts';

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
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    stockfish: Type.Object(
      {
        executablePath: Type.String({ minLength: 1, maxLength: 1_024 }),
        arguments: Type.Array(Type.String({ maxLength: 1_024 }), {
          maxItems: 32,
        }),
        threads: Type.Integer({ minimum: 1, maximum: 256 }),
        hashMb: Type.Integer({ minimum: 1, maximum: 65_536 }),
        moveTimeMs: Type.Integer({ minimum: 10, maximum: 600_000 }),
        startupTimeoutMs: Type.Integer(ENGINE_PROVIDER_TIMEOUT_LIMITS.startup),
        moveTimeoutMs: Type.Integer(
          ENGINE_PROVIDER_TIMEOUT_LIMITS.stockfishMove,
        ),
        stopTimeoutMs: Type.Integer(ENGINE_PROVIDER_TIMEOUT_LIMITS.stop),
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

export const MaiaChessProviderConfigurationSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    provider: Type.Literal('maia-chess'),
    displayName: Type.String({ minLength: 1, maxLength: 160 }),
    maia: Type.Object(
      {
        executablePath: Type.String({ minLength: 1, maxLength: 1_024 }),
        weightsPath: Type.String({ minLength: 1, maxLength: 1_024 }),
        startupTimeoutMs: Type.Integer(ENGINE_PROVIDER_TIMEOUT_LIMITS.startup),
        moveTimeoutMs: Type.Integer(ENGINE_PROVIDER_TIMEOUT_LIMITS.maiaMove),
        stopTimeoutMs: Type.Integer(ENGINE_PROVIDER_TIMEOUT_LIMITS.stop),
        maxOutputBytes: Type.Integer({ minimum: 1_024, maximum: 16_777_216 }),
      },
      { additionalProperties: false },
    ),
  },
  {
    $id: 'https://github.com/lzzzy/plysmith/blob/main/configuration/schemas/maia-chess-provider.schema.json',
    additionalProperties: false,
  },
);

export const EngineProviderConfigurationDocumentSchema = Type.Union([
  StockfishUciProviderConfigurationSchema,
  MaiaChessProviderConfigurationSchema,
]);

export type PlysmithConfiguration = Static<typeof PlysmithConfigurationSchema>;
export type SqliteProviderConfiguration = Static<
  typeof SqliteProviderConfigurationSchema
>;
export type StockfishUciProviderConfiguration = Static<
  typeof StockfishUciProviderConfigurationSchema
>;
export type MaiaChessProviderConfiguration = Static<
  typeof MaiaChessProviderConfigurationSchema
>;
export type EngineProviderConfigurationDocument = Static<
  typeof EngineProviderConfigurationDocumentSchema
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
