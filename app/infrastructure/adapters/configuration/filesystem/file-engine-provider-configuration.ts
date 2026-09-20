import { createHash, randomUUID } from 'node:crypto';
import {
  access,
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
  engineConfigurationConflict,
  type ConfiguredEngineProvider,
  type EngineProviderConfigurationInput,
  type EngineProviderConfigurationPreview,
  type EngineProviderConfigurationRepository,
} from '../../../../application/playout/index.ts';
import { stockfishUciConfigurationFingerprint } from '../../engine/index.ts';
import {
  PlysmithConfigurationSchema,
  StockfishUciProviderConfigurationSchema,
  type PlysmithConfiguration,
  type StockfishUciProviderConfiguration,
} from './configuration-schema.ts';
import { fileSha256 } from './file-sha256.ts';

export class FileEngineProviderConfigurationRepository implements EngineProviderConfigurationRepository {
  readonly #activeDirectory: string;
  readonly #centralPath: string;
  readonly #lockPath: string;

  constructor(applicationHome: string) {
    this.#activeDirectory = path.join(
      applicationHome,
      'configuration',
      'active',
    );
    this.#centralPath = path.join(this.#activeDirectory, 'plysmith.json');
    this.#lockPath = path.join(this.#activeDirectory, '.engine-settings.lock');
  }

  async list(): Promise<readonly ConfiguredEngineProvider[]> {
    const central = await readCentral(this.#centralPath);
    const providers = await Promise.all(
      central.configuration.bindings.playoutEngines.map((instanceId) =>
        this.#readProvider(instanceId, central.source),
      ),
    );
    return Object.freeze(
      providers.filter(
        (provider): provider is ConfiguredEngineProvider =>
          provider !== undefined,
      ),
    );
  }

  async preview(
    input: EngineProviderConfigurationInput,
  ): Promise<EngineProviderConfigurationPreview> {
    const issues: Array<'executable_not_found' | 'configuration_invalid'> = [];
    if (!validInput(input)) issues.push('configuration_invalid');
    if (path.isAbsolute(input.executablePath)) {
      try {
        await access(input.executablePath);
      } catch {
        issues.push('executable_not_found');
      }
    }
    return Object.freeze({
      valid: issues.length === 0,
      issues: Object.freeze(issues),
    });
  }

  async save(request: {
    readonly input: EngineProviderConfigurationInput;
    readonly expectedConfigurationRevision: string | null;
  }): Promise<ConfiguredEngineProvider> {
    const lock = await this.#lock();
    const temporaryPaths: string[] = [];
    try {
      const central = await readCentral(this.#centralPath);
      const current = await this.#readProvider(
        request.input.instanceId,
        central.source,
      );
      if (
        (current?.configurationRevision ?? null) !==
        request.expectedConfigurationRevision
      ) {
        throw engineConfigurationConflict();
      }
      const executableSha256 = await fileSha256(request.input.executablePath);
      const document = documentFromInput(request.input, executableSha256);
      const providerSource = `${JSON.stringify(document, null, 2)}\n`;
      const nextCentral =
        central.configuration.bindings.playoutEngines.includes(
          request.input.instanceId,
        )
          ? central.configuration
          : {
              ...central.configuration,
              bindings: {
                ...central.configuration.bindings,
                playoutEngines: [
                  ...central.configuration.bindings.playoutEngines,
                  request.input.instanceId,
                ],
              },
            };
      if (!Value.Check(PlysmithConfigurationSchema, nextCentral)) {
        throw new Error('The updated central configuration is invalid.');
      }
      const centralSource = `${JSON.stringify(nextCentral, null, 2)}\n`;
      const providerPath = path.join(
        this.#activeDirectory,
        `${request.input.instanceId}.json`,
      );
      const providerTemporary = temporary(providerPath);
      temporaryPaths.push(providerTemporary);
      await writeFile(providerTemporary, providerSource, {
        encoding: 'utf8',
        flag: 'wx',
      });

      let centralTemporary: string | undefined;
      if (centralSource !== central.source) {
        centralTemporary = temporary(this.#centralPath);
        temporaryPaths.push(centralTemporary);
        await writeFile(centralTemporary, centralSource, {
          encoding: 'utf8',
          flag: 'wx',
        });
      }
      if ((await readFile(this.#centralPath, 'utf8')) !== central.source) {
        throw engineConfigurationConflict();
      }
      await rename(providerTemporary, providerPath);
      temporaryPaths.splice(temporaryPaths.indexOf(providerTemporary), 1);
      if (centralTemporary !== undefined) {
        await rename(centralTemporary, this.#centralPath);
        temporaryPaths.splice(temporaryPaths.indexOf(centralTemporary), 1);
      }
      return configured(
        request.input,
        executableSha256,
        centralSource,
        providerSource,
      );
    } finally {
      await lock.close();
      await Promise.all(temporaryPaths.map(removeIfPresent));
      await removeIfPresent(this.#lockPath);
    }
  }

  async disable(request: {
    readonly instanceId: string;
    readonly expectedConfigurationRevision: string;
  }): Promise<ConfiguredEngineProvider> {
    const current = (await this.list()).find(
      (provider) => provider.instanceId === request.instanceId,
    );
    if (current === undefined) throw engineConfigurationConflict();
    return this.save({
      input: { ...current, enabled: false },
      expectedConfigurationRevision: request.expectedConfigurationRevision,
    });
  }

  async #readProvider(
    instanceId: string,
    centralSource: string,
  ): Promise<ConfiguredEngineProvider | undefined> {
    let source: string;
    try {
      source = await readFile(
        path.join(this.#activeDirectory, `${instanceId}.json`),
        'utf8',
      );
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return undefined;
      throw error;
    }
    const candidate: unknown = JSON.parse(source);
    if (!Value.Check(StockfishUciProviderConfigurationSchema, candidate)) {
      return undefined;
    }
    const input = inputFromDocument(instanceId, candidate);
    return configured(
      input,
      candidate.stockfish.executableSha256,
      centralSource,
      source,
    );
  }

  async #lock(): Promise<FileHandle> {
    try {
      return await open(this.#lockPath, 'wx');
    } catch (error) {
      if (errorCode(error) === 'EEXIST') throw engineConfigurationConflict();
      throw error;
    }
  }
}

function validInput(input: EngineProviderConfigurationInput): boolean {
  return (
    /^[a-z0-9][a-z0-9-]*$/.test(input.instanceId) &&
    path.isAbsolute(input.executablePath) &&
    Value.Check(
      StockfishUciProviderConfigurationSchema,
      documentFromInput(input, '0'.repeat(64)),
    )
  );
}

function documentFromInput(
  input: EngineProviderConfigurationInput,
  executableSha256: string,
): StockfishUciProviderConfiguration {
  return {
    schemaVersion: 1,
    provider: 'stockfish-uci',
    enabled: input.enabled,
    displayName: input.displayName,
    stockfish: {
      executablePath: input.executablePath,
      executableSha256,
      arguments: [...input.arguments],
      threads: input.threads,
      hashMb: input.hashMb,
      moveTimeMs: input.moveTimeMs,
      startupTimeoutMs: input.startupTimeoutMs,
      moveTimeoutMs: input.moveTimeoutMs,
      stopTimeoutMs: input.stopTimeoutMs,
      maxOutputBytes: input.maxOutputBytes,
    },
  };
}

function inputFromDocument(
  instanceId: string,
  document: StockfishUciProviderConfiguration,
): EngineProviderConfigurationInput {
  return Object.freeze({
    instanceId,
    providerType: 'stockfish-uci' as const,
    displayName: document.displayName,
    enabled: document.enabled,
    executablePath: document.stockfish.executablePath,
    arguments: Object.freeze([...document.stockfish.arguments]),
    threads: document.stockfish.threads,
    hashMb: document.stockfish.hashMb,
    moveTimeMs: document.stockfish.moveTimeMs,
    startupTimeoutMs: document.stockfish.startupTimeoutMs,
    moveTimeoutMs: document.stockfish.moveTimeoutMs,
    stopTimeoutMs: document.stockfish.stopTimeoutMs,
    maxOutputBytes: document.stockfish.maxOutputBytes,
  });
}

function configured(
  input: EngineProviderConfigurationInput,
  executableSha256: string,
  centralSource: string,
  providerSource: string,
): ConfiguredEngineProvider {
  return Object.freeze({
    ...input,
    configurationRevision: revision(`${centralSource}\0${providerSource}`),
    effectiveFingerprint: stockfishUciConfigurationFingerprint({
      instanceId: input.instanceId,
      displayName: input.displayName,
      enabled: input.enabled,
      executablePath: input.executablePath,
      executableSha256,
      arguments: input.arguments,
      threads: input.threads,
      hashMb: input.hashMb,
      moveTimeMs: input.moveTimeMs,
      startupTimeoutMs: input.startupTimeoutMs,
      moveTimeoutMs: input.moveTimeoutMs,
      stopTimeoutMs: input.stopTimeoutMs,
      maxOutputBytes: input.maxOutputBytes,
    }),
  });
}

async function readCentral(filePath: string): Promise<{
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

function revision(source: string): string {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

function temporary(target: string): string {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}-${process.pid}-${randomUUID()}.tmp`,
  );
}

async function removeIfPresent(filePath: string): Promise<void> {
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
