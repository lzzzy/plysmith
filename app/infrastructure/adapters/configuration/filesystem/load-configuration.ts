import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import {
  ConfigurationProblem,
  type ConfigurationProblemCode,
} from './configuration-problem.ts';
import {
  PlysmithConfigurationSchema,
  SqliteProviderConfigurationSchema,
  StockfishUciProviderConfigurationSchema,
  type PlysmithConfiguration,
  type StockfishUciProviderConfiguration,
} from './configuration-schema.ts';
import { fileSha256 } from './file-sha256.ts';

export interface RuntimeConfiguration {
  readonly central: PlysmithConfiguration;
  readonly persistence: {
    readonly instanceId: string;
    readonly provider: 'sqlite';
    readonly databasePath: string;
  };
  readonly playoutEngines: readonly RuntimePlayoutEngineConfiguration[];
}

export type RuntimePlayoutEngineConfiguration =
  | {
      readonly instanceId: string;
      readonly provider: 'stockfish-uci';
      readonly status: 'available' | 'disabled';
      readonly configuration: StockfishUciProviderConfiguration;
    }
  | {
      readonly instanceId: string;
      readonly provider: 'unknown';
      readonly status: 'unavailable';
      readonly problemCode: 'configuration.provider_invalid';
    };

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

  const playoutEngines = await Promise.all(
    central.bindings.playoutEngines.map((playoutInstanceId) =>
      loadPlayoutEngine(activeDirectory, playoutInstanceId),
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
    playoutEngines: Object.freeze(playoutEngines),
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

async function loadPlayoutEngine(
  activeDirectory: string,
  instanceId: string,
): Promise<RuntimePlayoutEngineConfiguration> {
  try {
    const configuration = await readDocument(
      path.join(activeDirectory, `${instanceId}.json`),
      StockfishUciProviderConfigurationSchema,
      'configuration.central_invalid',
      'configuration.central_invalid',
    );
    if (!path.isAbsolute(configuration.stockfish.executablePath)) {
      return unavailableEngine(instanceId);
    }
    if (
      (await fileSha256(configuration.stockfish.executablePath)) !==
      configuration.stockfish.executableSha256
    ) {
      return unavailableEngine(instanceId);
    }
    Object.freeze(configuration.stockfish.arguments);
    Object.freeze(configuration.stockfish);
    Object.freeze(configuration);
    return Object.freeze({
      instanceId,
      provider: 'stockfish-uci' as const,
      status: configuration.enabled
        ? ('available' as const)
        : ('disabled' as const),
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
