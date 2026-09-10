import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import { HostEventStream } from '../../application/events/index.ts';
import {
  GetUserPreferences,
  SetUiLanguage,
} from '../../application/preferences/index.ts';
import { GetSystemStatus } from '../../application/system/index.ts';
import {
  initializeConfiguration,
  loadConfiguration,
} from '../../infrastructure/adapters/configuration/filesystem/index.ts';
import { SqlitePersistenceAdapter } from '../../infrastructure/adapters/persistence/sqlite/index.ts';
import {
  acquireHostOwnerLease,
  clearHostDiscovery,
  type HostOwnerLease,
} from '../../infrastructure/adapters/platform/windows/index.ts';
import { buildHost } from '../../infrastructure/channels/api/index.ts';
import {
  contractFingerprint,
  productRelease,
} from '../../../contracts/host/index.ts';
import { RuntimeStatus } from './runtime-status.ts';

export interface ComposeHostOptions {
  readonly applicationHome: string;
  readonly defaultsDirectory: string;
  readonly hostToken?: string;
  readonly now?: () => string;
  readonly correlationIdFactory?: () => string;
}

export interface ComposedHost {
  readonly applicationHome: string;
  readonly ownerId: string;
  readonly hostToken: string;
  readonly host: FastifyInstance;
  readonly productRelease: string;
  readonly contractFingerprint: string;
  markReady(): void;
  close(): Promise<void>;
}

export async function composeHost(
  options: ComposeHostOptions,
): Promise<ComposedHost> {
  const lease = await acquireHostOwnerLease(options.applicationHome);
  let persistence: SqlitePersistenceAdapter | undefined;
  let host: FastifyInstance | undefined;

  try {
    await initializeConfiguration({
      applicationHome: options.applicationHome,
      defaultsDirectory: options.defaultsDirectory,
    });
    const configuration = await loadConfiguration(options.applicationHome);
    persistence = new SqlitePersistenceAdapter({
      databasePath: configuration.persistence.databasePath,
      ...(options.now === undefined ? {} : { now: options.now }),
    });

    const runtimeStatus = new RuntimeStatus();
    const eventStream = new HostEventStream({
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.correlationIdFactory === undefined
        ? {}
        : { correlationIdFactory: options.correlationIdFactory }),
    });
    const getSystemStatus = new GetSystemStatus({
      runtime: runtimeStatus,
      store: persistence,
    });
    const getUserPreferences = new GetUserPreferences(persistence);
    const setUiLanguage = new SetUiLanguage({
      unitOfWork: persistence,
      clock: { now: options.now ?? (() => new Date().toISOString()) },
      events: eventStream,
    });
    const hostToken =
      options.hostToken ?? randomBytes(32).toString('base64url');
    const correlationIdFactory = options.correlationIdFactory ?? randomUUID;

    host = await buildHost({
      getSystemStatus,
      getUserPreferences,
      setUiLanguage,
      events: eventStream,
      security: { hostToken },
      productRelease,
      contractFingerprint,
      correlationIdFactory,
    });

    return createComposedHost({
      applicationHome: options.applicationHome,
      lease,
      persistence,
      runtimeStatus,
      hostToken,
      host,
    });
  } catch (error) {
    await host?.close();
    await persistence?.close();
    await lease.release();
    throw error;
  }
}

function createComposedHost(input: {
  readonly applicationHome: string;
  readonly lease: HostOwnerLease;
  readonly persistence: SqlitePersistenceAdapter;
  readonly runtimeStatus: RuntimeStatus;
  readonly hostToken: string;
  readonly host: FastifyInstance;
}): ComposedHost {
  let closePromise: Promise<void> | undefined;

  return Object.freeze({
    applicationHome: input.applicationHome,
    ownerId: input.lease.ownerId,
    hostToken: input.hostToken,
    host: input.host,
    productRelease,
    contractFingerprint,
    markReady() {
      input.runtimeStatus.setState('ready');
    },
    close() {
      closePromise ??= closeComposedHost(input);
      return closePromise;
    },
  });
}

async function closeComposedHost(input: {
  readonly applicationHome: string;
  readonly lease: HostOwnerLease;
  readonly persistence: SqlitePersistenceAdapter;
  readonly runtimeStatus: RuntimeStatus;
  readonly host: FastifyInstance;
}): Promise<void> {
  input.runtimeStatus.setState('shutting_down');
  await clearHostDiscovery(input.applicationHome, input.lease.ownerId);
  await input.host.close();
  await input.persistence.close();
  await input.lease.release();
}
