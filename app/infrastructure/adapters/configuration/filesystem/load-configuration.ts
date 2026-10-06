import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import {
  ConfigurationProblem,
  type ConfigurationProblemCode,
} from './configuration-problem.ts';
import {
  EngineProviderConfigurationDocumentSchema,
  LichessProviderConfigurationSchema,
  PlysmithConfigurationSchema,
  SqliteProviderConfigurationSchema,
  type MaiaChessProviderConfiguration,
  type PlysmithConfiguration,
  type StockfishUciProviderConfiguration,
  type LichessProviderConfiguration,
} from './configuration-schema.ts';
import { loadLichessToken } from './lichess-secret.ts';
import { LICHESS_PROVIDER_INSTANCE_ID } from '../../../../../contracts/host/live-provider-configuration.ts';

export interface RuntimeConfiguration {
  readonly central: PlysmithConfiguration;
  readonly persistence: {
    readonly instanceId: string;
    readonly provider: 'sqlite';
    readonly databasePath: string;
  };
  readonly analysisEngines: readonly RuntimeEngineConfiguration[];
  readonly playoutEngines: readonly RuntimePlayoutEngineConfiguration[];
  readonly liveProviders: readonly RuntimeLiveProviderConfiguration[];
}

export type RuntimeLiveProviderConfiguration =
  | {
      readonly instanceId: string;
      readonly provider: 'lichess';
      readonly status: 'available' | 'unavailable';
      readonly configuration: LichessProviderConfiguration;
      readonly problemCode?: 'configuration.live_token_missing';
    }
  | {
      readonly instanceId: string;
      readonly provider: 'unknown';
      readonly status: 'unavailable';
      readonly problemCode: 'configuration.provider_invalid';
    };

export type RuntimeEngineConfiguration =
  | {
      readonly instanceId: string;
      readonly provider: 'stockfish-uci';
      readonly status: 'available';
      readonly configuration: StockfishUciProviderConfiguration;
    }
  | {
      readonly instanceId: string;
      readonly provider: 'maia-chess';
      readonly status: 'available';
      readonly configuration: MaiaChessProviderConfiguration;
    }
  | {
      readonly instanceId: string;
      readonly provider: 'unknown';
      readonly status: 'unavailable';
      readonly problemCode: 'configuration.provider_invalid';
    };

export type RuntimePlayoutEngineConfiguration = RuntimeEngineConfiguration;

export async function loadConfiguration(
  applicationHome: string,
): Promise<RuntimeConfiguration> {
  const activeDirectory = path.join(applicationHome, 'configuration', 'active');
  const central = await loadCentralConfiguration(applicationHome);

  const instanceId = central.bindings.persistence;
  const persistence = await readDocument(
    path.join(activeDirectory, `${instanceId}.json`),
    SqliteProviderConfigurationSchema,
    'configuration.persistence_invalid',
    'configuration.persistence_invalid',
  );

  if (!persistence.enabled) {
    throw new ConfigurationProblem('configuration.persistence_invalid');
  }

  const engineIds = [
    ...new Set([
      ...central.bindings.analysisEngines,
      ...central.bindings.playoutEngines,
    ]),
  ];
  const loadedEngines = new Map(
    await Promise.all(
      engineIds.map(
        async (engineId) =>
          [engineId, await loadEngine(activeDirectory, engineId)] as const,
      ),
    ),
  );
  const analysisEngines = central.bindings.analysisEngines.map(
    (engineId) => loadedEngines.get(engineId) ?? unavailableEngine(engineId),
  );
  const playoutEngines = central.bindings.playoutEngines.map(
    (engineId) => loadedEngines.get(engineId) ?? unavailableEngine(engineId),
  );
  const liveProviders = await Promise.all(
    central.bindings.liveProviders.map(
      async (liveId): Promise<RuntimeLiveProviderConfiguration> => {
        try {
          if (liveId !== LICHESS_PROVIDER_INSTANCE_ID)
            throw new Error('Unsupported live provider.');
          const configuration = await readDocument(
            path.join(activeDirectory, `${liveId}.json`),
            LichessProviderConfigurationSchema,
            'configuration.central_invalid',
            'configuration.central_invalid',
          );
          const tokenConfigured =
            (await loadLichessToken(applicationHome)) !== undefined;
          Object.freeze(configuration.lichess);
          Object.freeze(configuration);
          return Object.freeze({
            instanceId: liveId,
            provider: 'lichess',
            status: tokenConfigured ? 'available' : 'unavailable',
            configuration,
            ...(tokenConfigured
              ? {}
              : { problemCode: 'configuration.live_token_missing' as const }),
          });
        } catch {
          return Object.freeze({
            instanceId: liveId,
            provider: 'unknown',
            status: 'unavailable',
            problemCode: 'configuration.provider_invalid',
          });
        }
      },
    ),
  );

  return Object.freeze({
    central,
    persistence: Object.freeze({
      instanceId,
      provider: 'sqlite' as const,
      databasePath: resolveManagedDatabasePath(
        applicationHome,
        persistence.sqlite.databasePath,
      ),
    }),
    analysisEngines: Object.freeze(analysisEngines),
    playoutEngines: Object.freeze(playoutEngines),
    liveProviders: Object.freeze(liveProviders),
  });
}

export async function loadCentralConfiguration(
  applicationHome: string,
): Promise<PlysmithConfiguration> {
  const central = await readDocument(
    path.join(applicationHome, 'configuration', 'active', 'plysmith.json'),
    PlysmithConfigurationSchema,
    'configuration.active_missing',
    'configuration.central_invalid',
  );
  return deepFreezeCentral(central);
}

async function readDocument<T extends TSchema>(
  filePath: string,
  schema: T,
  missingCode: ConfigurationProblemCode,
  invalidCode: ConfigurationProblemCode,
): Promise<Static<T>> {
  let source: string;

  try {
    source = await readFile(filePath, 'utf8');
  } catch {
    throw new ConfigurationProblem(missingCode);
  }

  let candidate: unknown;

  try {
    candidate = JSON.parse(source);
  } catch {
    throw new ConfigurationProblem(invalidCode);
  }

  if (!Value.Check(schema, candidate)) {
    throw new ConfigurationProblem(invalidCode);
  }

  return candidate as Static<T>;
}

async function loadEngine(
  activeDirectory: string,
  instanceId: string,
): Promise<RuntimeEngineConfiguration> {
  try {
    const configuration = await readDocument(
      path.join(activeDirectory, `${instanceId}.json`),
      EngineProviderConfigurationDocumentSchema,
      'configuration.central_invalid',
      'configuration.central_invalid',
    );
    if (configuration.provider === 'stockfish-uci') {
      const engine = configuration.stockfish;
      if (!path.isAbsolute(engine.executablePath)) {
        return unavailableEngine(instanceId);
      }
      await access(engine.executablePath);
      Object.freeze(engine.arguments);
      Object.freeze(engine.detailLevels);
      Object.freeze(engine);
      Object.freeze(configuration);
      return Object.freeze({
        instanceId,
        provider: configuration.provider,
        status: 'available' as const,
        configuration,
      });
    }
    const engine = configuration.maia;
    if (
      !path.isAbsolute(engine.executablePath) ||
      !path.isAbsolute(engine.weightsPath)
    ) {
      return unavailableEngine(instanceId);
    }
    await Promise.all([
      access(engine.executablePath),
      access(engine.weightsPath),
    ]);
    Object.freeze(engine);
    Object.freeze(configuration);
    return Object.freeze({
      instanceId,
      provider: configuration.provider,
      status: 'available' as const,
      configuration,
    });
  } catch {
    return unavailableEngine(instanceId);
  }
}

function unavailableEngine(
  instanceId: string,
): RuntimePlayoutEngineConfiguration {
  return Object.freeze({
    instanceId,
    provider: 'unknown' as const,
    status: 'unavailable' as const,
    problemCode: 'configuration.provider_invalid' as const,
  });
}

function resolveManagedDatabasePath(
  applicationHome: string,
  configuredPath: string,
): string {
  if (path.isAbsolute(configuredPath)) {
    throw new ConfigurationProblem('configuration.persistence_path_invalid');
  }

  const resolvedHome = path.resolve(applicationHome);
  const resolvedDatabase = path.resolve(resolvedHome, configuredPath);
  const relative = path.relative(resolvedHome, resolvedDatabase);

  if (
    relative.length === 0 ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new ConfigurationProblem('configuration.persistence_path_invalid');
  }

  return resolvedDatabase;
}

function deepFreezeCentral(
  central: PlysmithConfiguration,
): PlysmithConfiguration {
  Object.freeze(central.diagnostics.logging);
  Object.freeze(central.diagnostics);
  Object.freeze(central.bindings.analysisEngines);
  Object.freeze(central.bindings.playoutEngines);
  Object.freeze(central.bindings.liveProviders);
  Object.freeze(central.bindings);
  return Object.freeze(central);
}
