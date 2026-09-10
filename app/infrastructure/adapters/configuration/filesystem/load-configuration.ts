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
  type PlysmithConfiguration,
} from './configuration-schema.ts';

export interface RuntimeConfiguration {
  readonly central: PlysmithConfiguration;
  readonly persistence: {
    readonly instanceId: string;
    readonly provider: 'sqlite';
    readonly databasePath: string;
  };
}

export async function loadConfiguration(
  applicationHome: string,
): Promise<RuntimeConfiguration> {
  const activeDirectory = path.join(applicationHome, 'configuration', 'active');
  const central = await readDocument(
    path.join(activeDirectory, 'plysmith.json'),
    PlysmithConfigurationSchema,
    'configuration.active_missing',
    'configuration.central_invalid',
  );

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

  return Object.freeze({
    central: deepFreezeCentral(central),
    persistence: Object.freeze({
      instanceId,
      provider: 'sqlite' as const,
      databasePath: resolveManagedDatabasePath(
        applicationHome,
        persistence.sqlite.databasePath,
      ),
    }),
  });
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
  Object.freeze(central.bindings.analysisEngines);
  Object.freeze(central.bindings.playoutEngines);
  Object.freeze(central.bindings.liveProviders);
  Object.freeze(central.bindings);
  return Object.freeze(central);
}
