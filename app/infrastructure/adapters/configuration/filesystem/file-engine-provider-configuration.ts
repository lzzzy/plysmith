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
import {
  EngineProviderConfigurationDocumentSchema,
  MaiaChessProviderConfigurationSchema,
  PlysmithConfigurationSchema,
  StockfishUciProviderConfigurationSchema,
  type EngineProviderConfigurationDocument,
  type PlysmithConfiguration,
} from './configuration-schema.ts';

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
        this.#readProvider(instanceId),
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
    const issues: Array<
      'executable_not_found' | 'weights_not_found' | 'configuration_invalid'
    > = [];
    if (!validInput(input)) issues.push('configuration_invalid');
    if (path.isAbsolute(input.executablePath)) {
      try {
        await access(input.executablePath);
      } catch {
        issues.push('executable_not_found');
      }
    }
    if (
      input.providerType === 'maia-chess' &&
      path.isAbsolute(input.weightsPath)
    ) {
      try {
        await access(input.weightsPath);
      } catch {
        issues.push('weights_not_found');
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
      const providerPath = path.join(
        this.#activeDirectory,
        `${request.input.instanceId}.json`,
      );
      const current = await this.#readProvider(request.input.instanceId);
      if (
        (current?.configurationRevision ?? null) !==
          request.expectedConfigurationRevision ||
        (current === undefined &&
          request.expectedConfigurationRevision === null &&
          (await fileExists(providerPath)))
      ) {
        throw engineConfigurationConflict();
      }
      const document = documentFromInput(request.input);
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
      return configured(request.input, providerSource);
    } finally {
      await lock.close();
      await Promise.all(temporaryPaths.map(removeIfPresent));
      await removeIfPresent(this.#lockPath);
    }
  }

  async remove(request: {
    readonly instanceId: string;
    readonly expectedConfigurationRevision: string;
  }): Promise<ConfiguredEngineProvider> {
    const lock = await this.#lock();
    let centralTemporary: string | undefined;
    let removedProviderPath: string | undefined;
    try {
      const current = await this.#readProviderDocument(request.instanceId);
      if (
        current === undefined ||
        revision(current.source) !== request.expectedConfigurationRevision
      ) {
        throw engineConfigurationConflict();
      }
      const central = await readCentral(this.#centralPath);
      const nextCentral = {
        ...central.configuration,
        bindings: {
          ...central.configuration.bindings,
          playoutEngines: central.configuration.bindings.playoutEngines.filter(
            (instanceId) => instanceId !== request.instanceId,
          ),
        },
      };
      if (!Value.Check(PlysmithConfigurationSchema, nextCentral)) {
        throw new Error('The updated central configuration is invalid.');
      }
      const providerPath = path.join(
        this.#activeDirectory,
        `${request.instanceId}.json`,
      );
      centralTemporary = temporary(this.#centralPath);
      await writeFile(
        centralTemporary,
        `${JSON.stringify(nextCentral, null, 2)}\n`,
        {
          encoding: 'utf8',
          flag: 'wx',
        },
      );
      if (
        (await readFile(providerPath, 'utf8')) !== current.source ||
        (await readFile(this.#centralPath, 'utf8')) !== central.source
      ) {
        throw engineConfigurationConflict();
      }
      removedProviderPath = temporary(providerPath);
      await rename(providerPath, removedProviderPath);
      try {
        await rename(centralTemporary, this.#centralPath);
        centralTemporary = undefined;
      } catch (error) {
        await rename(removedProviderPath, providerPath);
        removedProviderPath = undefined;
        throw error;
      }
      await unlink(removedProviderPath);
      removedProviderPath = undefined;
      return configured(
        inputFromDocument(request.instanceId, current.document),
        current.source,
      );
    } finally {
      await lock.close();
      if (centralTemporary !== undefined) {
        await removeIfPresent(centralTemporary);
      }
      if (removedProviderPath !== undefined) {
        await removeIfPresent(removedProviderPath);
      }
      await removeIfPresent(this.#lockPath);
    }
  }

  async #readProvider(
    instanceId: string,
  ): Promise<ConfiguredEngineProvider | undefined> {
    const stored = await this.#readProviderDocument(instanceId);
    if (stored === undefined) return undefined;
    const input = inputFromDocument(instanceId, stored.document);
    return configured(input, stored.source);
  }

  async #readProviderDocument(instanceId: string): Promise<
    | {
        readonly source: string;
        readonly document: EngineProviderConfigurationDocument;
      }
    | undefined
  > {
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
    let candidate: unknown;
    try {
      candidate = JSON.parse(source);
    } catch {
      return undefined;
    }
    if (!Value.Check(EngineProviderConfigurationDocumentSchema, candidate)) {
      return undefined;
    }
    return { source, document: candidate };
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
    (input.providerType !== 'maia-chess' ||
      path.isAbsolute(input.weightsPath)) &&
    Value.Check(
      input.providerType === 'stockfish-uci'
        ? StockfishUciProviderConfigurationSchema
        : MaiaChessProviderConfigurationSchema,
      documentFromInput(input),
    )
  );
}

function documentFromInput(
  input: EngineProviderConfigurationInput,
): EngineProviderConfigurationDocument {
  if (input.providerType === 'maia-chess') {
    return {
      schemaVersion: 1,
      provider: 'maia-chess',
      displayName: input.displayName,
      maia: {
        executablePath: input.executablePath,
        weightsPath: input.weightsPath,
        startupTimeoutMs: input.startupTimeoutMs,
        moveTimeoutMs: input.moveTimeoutMs,
        stopTimeoutMs: input.stopTimeoutMs,
        maxOutputBytes: input.maxOutputBytes,
      },
    };
  }
  return {
    schemaVersion: 1,
    provider: 'stockfish-uci',
    displayName: input.displayName,
    stockfish: {
      executablePath: input.executablePath,
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
  document: EngineProviderConfigurationDocument,
): EngineProviderConfigurationInput {
  if (document.provider === 'maia-chess') {
    return Object.freeze({
      instanceId,
      providerType: 'maia-chess' as const,
      displayName: document.displayName,
      executablePath: document.maia.executablePath,
      weightsPath: document.maia.weightsPath,
      startupTimeoutMs: document.maia.startupTimeoutMs,
      moveTimeoutMs: document.maia.moveTimeoutMs,
      stopTimeoutMs: document.maia.stopTimeoutMs,
      maxOutputBytes: document.maia.maxOutputBytes,
    });
  }
  return Object.freeze({
    instanceId,
    providerType: 'stockfish-uci' as const,
    displayName: document.displayName,
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
  providerSource: string,
): ConfiguredEngineProvider {
  return Object.freeze({
    ...input,
    configurationRevision: revision(providerSource),
    effectiveFingerprint: revision(
      `${JSON.stringify(documentFromInput(input))}\n`,
    ),
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
}
