import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

import { HostEventStream } from '../../application/events/index.ts';
import {
  CreateAnalysisRecord,
  CreateAnalysisNote,
  CreatePositionNote,
  DeleteAnalysisNote,
  FreeAnalysisSession,
  GetAnalysisWorkspace,
  UpdateAnalysisScratch,
  UpdateAnalysisNote,
} from '../../application/analysis/index.ts';
import { SearchInventory } from '../../application/inventory/index.ts';
import {
  GetUserPreferences,
  SetUiLanguage,
} from '../../application/preferences/index.ts';
import {
  CreateDiagnosticReport,
  GetDiagnosticReportManifest,
  GetDiagnosticSettings,
  GetSystemStatus,
  SetDiagnosticLogLevel,
} from '../../application/system/index.ts';
import {
  AddContextReference,
  CreateWorkingContext,
  GetWorkingContextWorkspace,
  ListWorkingContexts,
  SetWorkScopeResume,
} from '../../application/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../infrastructure/adapters/chess_rules/chess_js/index.ts';
import {
  initializeConfiguration,
  FileDiagnosticSettingsRepository,
  loadConfiguration,
} from '../../infrastructure/adapters/configuration/filesystem/index.ts';
import {
  FileDiagnosticLog,
  FileDiagnosticReport,
} from '../../infrastructure/adapters/diagnostics/filesystem/index.ts';
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
  let diagnostics: FileDiagnosticLog | undefined;

  try {
    await initializeConfiguration({
      applicationHome: options.applicationHome,
      defaultsDirectory: options.defaultsDirectory,
    });
    const configuration = await loadConfiguration(options.applicationHome);
    diagnostics = new FileDiagnosticLog({
      applicationHome: options.applicationHome,
      component: 'host',
      productRelease,
      level: configuration.central.diagnostics.logging.level,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    diagnostics.write({
      level: 'info',
      eventCode: 'host.lifecycle.starting',
      status: 'starting',
    });
    persistence = new SqlitePersistenceAdapter({
      databasePath: configuration.persistence.databasePath,
      ...(options.now === undefined ? {} : { now: options.now }),
    });

    const runtimeStatus = new RuntimeStatus();
    const clock = { now: options.now ?? (() => new Date().toISOString()) };
    const activeLevel = configuration.central.diagnostics.logging.level;
    const diagnosticSettings = new FileDiagnosticSettingsRepository(
      options.applicationHome,
    );
    const diagnosticReport = new FileDiagnosticReport({
      applicationHome: options.applicationHome,
      protectedRoots: [path.resolve(options.defaultsDirectory, '..', '..')],
    });
    const getDiagnosticSettings = new GetDiagnosticSettings({
      repository: diagnosticSettings,
      activeLevel,
    });
    const setDiagnosticLogLevel = new SetDiagnosticLogLevel({
      repository: diagnosticSettings,
      activeLevel,
    });
    const getDiagnosticReportManifest = new GetDiagnosticReportManifest(clock);
    const createDiagnosticReport = new CreateDiagnosticReport({
      settings: diagnosticSettings,
      source: diagnosticReport,
      writer: diagnosticReport,
      clock,
      activeLevel,
      productRelease,
      contractFingerprint,
      runtime: {
        platform: process.platform,
        architecture: process.arch,
        nodeVersion: process.versions.node,
      },
    });
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
      clock,
      events: eventStream,
    });
    const rules = new ChessJsRulesAdapter();
    const freeAnalysisSession = new FreeAnalysisSession();
    const getAnalysisWorkspace = new GetAnalysisWorkspace({
      reader: persistence,
      freeSession: freeAnalysisSession,
      rules,
      storeStatus: persistence,
    });
    const updateAnalysisScratch = new UpdateAnalysisScratch({
      reader: persistence,
      writer: persistence,
      freeSession: freeAnalysisSession,
      rules,
      clock,
      events: eventStream,
      storeStatus: persistence,
      scratchId: randomUUID,
    });
    const createAnalysisRecord = new CreateAnalysisRecord({
      reader: persistence,
      writer: persistence,
      freeSession: freeAnalysisSession,
      clock,
      inventoryEvents: eventStream,
      workspaceEvents: eventStream,
    });
    const createAnalysisNote = new CreateAnalysisNote({
      reader: persistence,
      writer: persistence,
      freeSession: freeAnalysisSession,
      clock,
      analysisEvents: eventStream,
      workspaceEvents: eventStream,
    });
    const createPositionNote = new CreatePositionNote({
      writer: persistence,
      clock,
      events: eventStream,
    });
    const updateAnalysisNote = new UpdateAnalysisNote({
      writer: persistence,
      clock,
      events: eventStream,
    });
    const deleteAnalysisNote = new DeleteAnalysisNote({
      writer: persistence,
      clock,
      events: eventStream,
    });
    const searchInventory = new SearchInventory(persistence);
    const listWorkingContexts = new ListWorkingContexts(persistence);
    const getWorkingContextWorkspace = new GetWorkingContextWorkspace(
      persistence,
    );
    const createWorkingContext = new CreateWorkingContext({
      writer: persistence,
      clock,
      events: eventStream,
    });
    const addContextReference = new AddContextReference({
      writer: persistence,
      clock,
      events: eventStream,
    });
    const setWorkScopeResume = new SetWorkScopeResume({
      writer: persistence,
      clock,
      events: eventStream,
    });
    const hostToken =
      options.hostToken ?? randomBytes(32).toString('base64url');
    const correlationIdFactory = options.correlationIdFactory ?? randomUUID;

    host = await buildHost({
      getSystemStatus,
      getDiagnosticSettings,
      setDiagnosticLogLevel,
      getDiagnosticReportManifest,
      createDiagnosticReport,
      getUserPreferences,
      setUiLanguage,
      getAnalysisWorkspace,
      updateAnalysisScratch,
      createAnalysisRecord,
      createAnalysisNote,
      createPositionNote,
      updateAnalysisNote,
      deleteAnalysisNote,
      searchInventory,
      listWorkingContexts,
      getWorkingContextWorkspace,
      createWorkingContext,
      addContextReference,
      setWorkScopeResume,
      events: eventStream,
      security: { hostToken },
      productRelease,
      contractFingerprint,
      correlationIdFactory,
      diagnostics,
    });

    return createComposedHost({
      applicationHome: options.applicationHome,
      lease,
      persistence,
      runtimeStatus,
      hostToken,
      host,
      diagnostics,
    });
  } catch (error) {
    diagnostics?.write({
      level: 'error',
      eventCode: 'host.lifecycle.start_failed',
      status: 'failed',
    });
    await host?.close();
    await persistence?.close();
    await lease.release();
    await diagnostics?.close();
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
  readonly diagnostics: FileDiagnosticLog;
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
      input.diagnostics.write({
        level: 'info',
        eventCode: 'host.lifecycle.ready',
        status: 'ready',
      });
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
  readonly diagnostics: FileDiagnosticLog;
}): Promise<void> {
  input.runtimeStatus.setState('shutting_down');
  input.diagnostics.write({
    level: 'info',
    eventCode: 'host.lifecycle.stopping',
    status: 'stopping',
  });
  await clearHostDiscovery(input.applicationHome, input.lease.ownerId);
  await input.host.close();
  await input.persistence.close();
  await input.lease.release();
  input.diagnostics.write({
    level: 'info',
    eventCode: 'host.lifecycle.stopped',
    status: 'stopped',
  });
  await input.diagnostics.close();
}
