import { createHash, randomUUID } from 'node:crypto';
import {
  open,
  readFile,
  rename,
  unlink,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';

import { Value } from '@sinclair/typebox/value';

import {
  diagnosticConfigurationConflict,
  type ConfiguredDiagnosticSettings,
  type DiagnosticSettingsRepository,
} from '../../../../application/system/index.ts';
import {
  PlysmithConfigurationSchema,
  type PlysmithConfiguration,
} from './configuration-schema.ts';

export class FileDiagnosticSettingsRepository implements DiagnosticSettingsRepository {
  readonly #filePath: string;
  readonly #lockPath: string;

  constructor(applicationHome: string) {
    const activeDirectory = path.join(
      applicationHome,
      'configuration',
      'active',
    );
    this.#filePath = path.join(activeDirectory, 'plysmith.json');
    this.#lockPath = path.join(activeDirectory, '.diagnostic-settings.lock');
  }

  async read(): Promise<ConfiguredDiagnosticSettings> {
    return configuredSettings(await readCentralSource(this.#filePath));
  }

  async setLevel(
    request: Parameters<DiagnosticSettingsRepository['setLevel']>[0],
  ): Promise<ConfiguredDiagnosticSettings> {
    let lock: FileHandle;
    try {
      lock = await open(this.#lockPath, 'wx');
    } catch (error) {
      if (errorCode(error) === 'EEXIST')
        throw diagnosticConfigurationConflict();
      throw error;
    }

    let temporaryPath: string | undefined;
    try {
      const current = await readCentralSource(this.#filePath);
      if (revision(current.source) !== request.expectedConfigurationRevision) {
        throw diagnosticConfigurationConflict();
      }
      if (current.configuration.diagnostics.logging.level === request.level) {
        return configuredSettings(current);
      }

      const next: PlysmithConfiguration = {
        ...current.configuration,
        diagnostics: { logging: { level: request.level } },
      };
      if (!Value.Check(PlysmithConfigurationSchema, next)) {
        throw new Error('The updated central configuration is invalid.');
      }
      const source = `${JSON.stringify(next, null, 2)}\n`;
      temporaryPath = path.join(
        path.dirname(this.#filePath),
        `.plysmith-${process.pid}-${randomUUID()}.tmp`,
      );
      await writeFile(temporaryPath, source, { encoding: 'utf8', flag: 'wx' });

      const confirmed = await readFile(this.#filePath, 'utf8');
      if (revision(confirmed) !== request.expectedConfigurationRevision) {
        throw diagnosticConfigurationConflict();
      }
      await rename(temporaryPath, this.#filePath);
      temporaryPath = undefined;
      return Object.freeze({
        level: request.level,
        configurationRevision: revision(source),
      });
    } finally {
      await lock.close();
      await removeIfPresent(temporaryPath);
      await removeIfPresent(this.#lockPath);
    }
  }
}

async function readCentralSource(filePath: string): Promise<{
  readonly source: string;
  readonly configuration: PlysmithConfiguration;
}> {
  const source = await readFile(filePath, 'utf8');
  const candidate: unknown = JSON.parse(source);
  if (!Value.Check(PlysmithConfigurationSchema, candidate)) {
    throw new Error('The central configuration is invalid.');
  }
  return { source, configuration: candidate };
}

function configuredSettings(source: {
  readonly source: string;
  readonly configuration: PlysmithConfiguration;
}): ConfiguredDiagnosticSettings {
  return Object.freeze({
    level: source.configuration.diagnostics.logging.level,
    configurationRevision: revision(source.source),
  });
}

function revision(source: string): string {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

async function removeIfPresent(filePath: string | undefined): Promise<void> {
  if (filePath === undefined) return;
  try {
    await unlink(filePath);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
}
