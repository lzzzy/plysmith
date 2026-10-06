import { randomUUID } from 'node:crypto';
import {
  lstat,
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
  LICHESS_PROVIDER_INSTANCE_ID,
  LICHESS_TOKEN_ENVIRONMENT_VARIABLE,
} from '../../../../../contracts/host/live-provider-configuration.ts';
import type {
  LiveProviderConfigurationRepository,
  LiveProviderConfigurationState,
  SaveLiveProviderConfigurationRequest,
} from '../../../../application/live/live-provider-configuration.ts';
import { ApplicationProblem } from '../../../../application/problems/application-problem.ts';
import {
  LichessProviderConfigurationSchema,
  PlysmithConfigurationSchema,
  type LichessProviderConfiguration,
} from './configuration-schema.ts';
import {
  isValidLichessToken,
  parseLichessEnvironment,
} from './lichess-secret.ts';

export class FileLiveProviderConfigurationRepository implements LiveProviderConfigurationRepository {
  readonly #home: string;
  readonly #active: string;

  constructor(applicationHome: string) {
    this.#home = applicationHome;
    this.#active = path.join(applicationHome, 'configuration', 'active');
  }

  async get(): Promise<LiveProviderConfigurationState> {
    try {
      return (await this.#snapshot()).state;
    } catch {
      throw problem('invalid');
    }
  }

  async save(
    request: SaveLiveProviderConfigurationRequest,
  ): Promise<LiveProviderConfigurationState> {
    if (!isValidLichessToken(request.token)) throw problem('invalid');
    const locks: { path: string; handle: FileHandle }[] = [];
    const staged: string[] = [];
    const published: { path: string; previous: string | undefined }[] = [];
    let recoveryRequired = false;
    try {
      await assertDirectory(this.#active);
      // Exclude both existing central-document writers for the entire publication.
      for (const name of [
        '.engine-settings.lock',
        '.diagnostic-settings.lock',
        '.live-settings.lock',
      ]) {
        const filePath = path.join(this.#active, name);
        try {
          locks.push({
            path: filePath,
            handle: await open(filePath, 'wx', 0o600),
          });
        } catch (error) {
          if (errorCode(error) === 'EEXIST') throw problem('conflict');
          throw error;
        }
      }
      const current = await this.#snapshot();
      if (
        current.state.configurationRevision !==
        request.expectedConfigurationRevision
      )
        throw problem('conflict');
      const document: LichessProviderConfiguration = {
        schemaVersion: 1,
        provider: 'lichess',
        configurationRevision: randomUUID(),
        lichess: {
          tokenEnvironmentVariable: LICHESS_TOKEN_ENVIRONMENT_VARIABLE,
        },
      };
      const nextCentral = {
        ...current.central,
        bindings: {
          ...current.central.bindings,
          liveProviders: [LICHESS_PROVIDER_INSTANCE_ID],
        },
      };
      const writes = [
        {
          path: path.join(this.#home, '.env'),
          source: `${LICHESS_TOKEN_ENVIRONMENT_VARIABLE}=${request.token}\n`,
          previous: current.envSource,
        },
        {
          path: this.#providerPath(),
          source: `${JSON.stringify(document, null, 2)}\n`,
          previous: current.providerSource,
        },
        {
          path: path.join(this.#active, 'plysmith.json'),
          source: `${JSON.stringify(nextCentral, null, 2)}\n`,
          previous: current.centralSource,
        },
      ];
      for (const write of writes) {
        const temporary = path.join(
          this.#active,
          `.lichess-main.json-${process.pid}-${randomUUID()}.tmp`,
        );
        staged.push(temporary);
        await writeFile(temporary, write.source, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
      }
      for (const [index, write] of writes.entries()) {
        if ((await readSafeFile(write.path)) !== write.previous)
          throw problem('conflict');
        await rename(staged[index]!, write.path);
        published.push(write);
      }
      return Object.freeze({
        configured: true,
        tokenConfigured: true,
        configurationRevision: document.configurationRevision,
      });
    } catch (error) {
      // Restart rejects an interrupted publication; ordinary failures restore the prior set.
      try {
        for (const write of published.reverse()) {
          if (write.previous === undefined) await removeIfPresent(write.path);
          else {
            const temporary = path.join(
              this.#active,
              `.lichess-main.json-${process.pid}-${randomUUID()}.tmp`,
            );
            staged.push(temporary);
            await writeFile(temporary, write.previous, {
              encoding: 'utf8',
              flag: 'wx',
              mode: 0o600,
            });
            await rename(temporary, write.path);
          }
        }
      } catch {
        recoveryRequired = true;
        throw problem('write_failed');
      }
      if (error instanceof ApplicationProblem) throw error;
      throw problem('write_failed');
    } finally {
      for (const temporary of staged) await removeIfPresent(temporary);
      for (const lock of locks.reverse()) {
        await lock.handle.close();
        if (
          !recoveryRequired ||
          path.basename(lock.path) !== '.live-settings.lock'
        )
          await removeIfPresent(lock.path);
      }
    }
  }

  #providerPath(): string {
    return path.join(this.#active, `${LICHESS_PROVIDER_INSTANCE_ID}.json`);
  }

  async #snapshot() {
    const centralSource = await readSafeFile(
      path.join(this.#active, 'plysmith.json'),
    );
    const central: unknown = JSON.parse(centralSource ?? 'null');
    if (
      !Value.Check(PlysmithConfigurationSchema, central) ||
      central.bindings.liveProviders.some(
        (id) => id !== LICHESS_PROVIDER_INSTANCE_ID,
      ) ||
      central.bindings.persistence === LICHESS_PROVIDER_INSTANCE_ID ||
      central.bindings.analysisEngines.includes(LICHESS_PROVIDER_INSTANCE_ID) ||
      central.bindings.playoutEngines.includes(LICHESS_PROVIDER_INSTANCE_ID)
    )
      throw problem('invalid');
    const providerSource = await readSafeFile(this.#providerPath());
    const provider: unknown = JSON.parse(providerSource ?? 'null');
    const bound = central.bindings.liveProviders.includes(
      LICHESS_PROVIDER_INSTANCE_ID,
    );
    if (
      (bound || providerSource !== undefined) &&
      !Value.Check(LichessProviderConfigurationSchema, provider)
    )
      throw problem('invalid');
    const envSource = await readSafeFile(path.join(this.#home, '.env'));
    const environment = parseLichessEnvironment(envSource ?? '');
    if (environment === undefined) throw problem('invalid');
    const state: LiveProviderConfigurationState = Object.freeze({
      configured: bound,
      tokenConfigured: environment.token !== undefined,
      configurationRevision:
        bound && Value.Check(LichessProviderConfigurationSchema, provider)
          ? provider.configurationRevision
          : null,
    });
    return { central, centralSource, providerSource, envSource, state };
  }
}

function problem(
  kind: 'invalid' | 'conflict' | 'write_failed',
): ApplicationProblem {
  return new ApplicationProblem(
    `configuration.live_${kind}`,
    'The live provider configuration could not be processed.',
  );
}

async function assertDirectory(directory: string): Promise<void> {
  const parent = path.dirname(directory);
  if (parent !== directory) await assertDirectory(parent);
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw problem('invalid');
}

async function readSafeFile(filePath: string): Promise<string | undefined> {
  await assertDirectory(path.dirname(filePath));
  try {
    const info = await lstat(filePath);
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size > 65_536
    )
      throw problem('invalid');
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
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
