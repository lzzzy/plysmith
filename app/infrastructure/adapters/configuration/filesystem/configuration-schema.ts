import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import {
  ENGINE_PROVIDER_TIMEOUT_LIMITS,
  STOCKFISH_DETAIL_LEVEL_LIMITS,
} from '../../../../../contracts/host/engine-provider-configuration.ts';
import { LICHESS_TOKEN_ENVIRONMENT_VARIABLE } from '../../../../../contracts/host/live-provider-configuration.ts';

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
    schemaVersion: Type.Literal(2),
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
        detailLevels: Type.Object(
          {
            fast: Type.Integer(STOCKFISH_DETAIL_LEVEL_LIMITS),
            thorough: Type.Integer(STOCKFISH_DETAIL_LEVEL_LIMITS),
            very_deep: Type.Integer(STOCKFISH_DETAIL_LEVEL_LIMITS),
          },
          { additionalProperties: false },
        ),
        playoutBudget: Type.Union([
          Type.Literal('fast'),
          Type.Literal('thorough'),
          Type.Literal('very_deep'),
        ]),
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

export const LichessProviderConfigurationSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    provider: Type.Literal('lichess'),
    configurationRevision: Type.String({
      pattern:
        '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    }),
    lichess: Type.Object(
      {
        tokenEnvironmentVariable: Type.Literal(
          LICHESS_TOKEN_ENVIRONMENT_VARIABLE,
        ),
      },
      { additionalProperties: false },
    ),
  },
  {
    $id: 'https://github.com/lzzzy/plysmith/blob/main/configuration/schemas/lichess-provider.schema.json',
    additionalProperties: false,
  },
);

export type LichessProviderConfiguration = Static<
  typeof LichessProviderConfigurationSchema
>;

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
