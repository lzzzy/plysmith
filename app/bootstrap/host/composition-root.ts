import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

import { HostEventStream } from '../../application/events/index.ts';
import {
  ActivePositionAnalysisLanes,
  AnalyzePosition,
  CreateAnalysisRecord,
  CreateAnalysisNote,
  CreatePositionNote,
  DeleteAnalysisNote,
  FreeAnalysisSession,
  GetAnalysisWorkspace,
  ListPositionAnalysisProviders,
  UpdateAnalysisScratch,
  UpdateAnalysisNote,
  ValidateAnalysisSetup,
  type PositionAnalysisProvider,
} from '../../application/analysis/index.ts';
import {
  GetInventoryRevision,
  DeleteInventoryItem,
  PreviewInventoryItemDeletion,
  GetPendingRevisionImpact,
  ListInventoryRevisions,
  PreviewInventoryRevision,
  PromoteAnalysisToInventoryRevision,
  ResolvePendingRevisionImpact,
  SaveInventoryRevision,
  SearchInventory,
  GetInventoryOrganization,
  ChangeInventoryOrganization,
  PreviewContextFolderRemoval,
  CheckInventoryNameAvailability,
  StartInventoryRevision,
} from '../../application/inventory/index.ts';
import {
  GetUserPreferences,
  SetUiLanguage,
} from '../../application/preferences/index.ts';
import {
  CompletePlayout,
  ActiveMovePolicyDecisions,
  DiscardPlayout,
  GetPlayout,
  ListMovePolicyProviders,
  PausePlayout,
  CancelPlayoutCompletion,
  ResumePlayout,
  RetryPlayoutPolicyMove,
  StartPlayout,
  StopPlayout,
  SubmitPlayoutMove,
  type MovePolicyProvider,
  RemoveEngineProviderConfiguration,
  GetEngineProviderConfigurations,
  PreviewEngineProviderConfiguration,
  SaveEngineProviderConfiguration,
} from '../../application/playout/index.ts';
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
  UpdateWorkingContextMetadata,
  GetWorkingContextWorkspace,
  ListWorkingContexts,
  RemoveContextItem,
  SetWorkScopeResume,
  SetManagementPresentation,
  GetWorkScopeWorkspace,
  GetStartupResume,
  SetStartupResume,
  PreviewContextItemRemoval,
  PreviewWorkingContextDeletion,
  DeleteWorkingContext,
} from '../../application/workspace/index.ts';
import { ChessJsRulesAdapter } from '../../infrastructure/adapters/chess_rules/chess_js/index.ts';
import {
  ConfiguredMovePolicyRegistry,
  ConfiguredPositionAnalysisRegistry,
  createMaiaChessUciRuntime,
  createStockfishUciRuntime,
  MaiaChessMovePolicyAdapter,
  MaiaChessPositionAnalysisAdapter,
  StockfishUciMovePolicyAdapter,
  StockfishUciPositionAnalysisAdapter,
  UnavailableMovePolicyProvider,
  type UciEngineRuntime,
  type MaiaChessConfiguration,
  type StockfishUciConfiguration,
} from '../../infrastructure/adapters/engine/index.ts';
import { LineProcessSupervisor } from '../../infrastructure/adapters/process/index.ts';
import {
  initializeConfiguration,
  FileDiagnosticSettingsRepository,
  FileEngineProviderConfigurationRepository,
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
  const engineRuntimes: UciEngineRuntime[] = [];

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
    const engineProviderConfigurations =
      new FileEngineProviderConfigurationRepository(options.applicationHome);
    type RuntimeBinding =
      | {
          readonly kind: 'maia-chess';
          readonly configuration: MaiaChessConfiguration;
          readonly runtime: UciEngineRuntime;
        }
      | {
          readonly kind: 'stockfish-uci';
          readonly configuration: StockfishUciConfiguration;
          readonly runtime: UciEngineRuntime;
        };
    const runtimeBindings = new Map<string, RuntimeBinding>();
    for (const engine of [
      ...configuration.analysisEngines,
      ...configuration.playoutEngines,
    ]) {
      if (
        engine.provider === 'unknown' ||
        runtimeBindings.has(engine.instanceId)
      )
        continue;
      if (engine.provider === 'maia-chess') {
        const settings = engine.configuration;
        const adapterConfiguration: MaiaChessConfiguration = {
          instanceId: engine.instanceId,
          displayName: settings.displayName,
          executablePath: settings.maia.executablePath,
          weightsPath: settings.maia.weightsPath,
          startupTimeoutMs: settings.maia.startupTimeoutMs,
          moveTimeoutMs: settings.maia.moveTimeoutMs,
          stopTimeoutMs: settings.maia.stopTimeoutMs,
          maxOutputBytes: settings.maia.maxOutputBytes,
        };
        const runtime = createMaiaChessUciRuntime(
          adapterConfiguration,
          new LineProcessSupervisor(),
        );
        engineRuntimes.push(runtime);
        runtimeBindings.set(engine.instanceId, {
          kind: 'maia-chess',
          configuration: adapterConfiguration,
          runtime,
        });
        continue;
      }
      const settings = engine.configuration;
      const adapterConfiguration: StockfishUciConfiguration = {
        instanceId: engine.instanceId,
        displayName: settings.displayName,
        executablePath: settings.stockfish.executablePath,
        arguments: settings.stockfish.arguments,
        threads: settings.stockfish.threads,
        hashMb: settings.stockfish.hashMb,
        moveTimeMs: settings.stockfish.moveTimeMs,
        startupTimeoutMs: settings.stockfish.startupTimeoutMs,
        moveTimeoutMs: settings.stockfish.moveTimeoutMs,
        stopTimeoutMs: settings.stockfish.stopTimeoutMs,
        maxOutputBytes: settings.stockfish.maxOutputBytes,
      };
      const runtime = createStockfishUciRuntime(
        adapterConfiguration,
        new LineProcessSupervisor(),
      );
      engineRuntimes.push(runtime);
      runtimeBindings.set(engine.instanceId, {
        kind: 'stockfish-uci',
        configuration: adapterConfiguration,
        runtime,
      });
    }
    const movePolicies = new ConfiguredMovePolicyRegistry(
      configuration.playoutEngines.map((engine): MovePolicyProvider => {
        if (engine.provider === 'unknown') {
          return new UnavailableMovePolicyProvider({
            instanceId: engine.instanceId,
            providerType: engine.provider,
            displayName: engine.instanceId,
            problemCode: engine.problemCode,
          });
        }
        const binding = runtimeBindings.get(engine.instanceId);
        if (binding?.kind === 'maia-chess') {
          return new MaiaChessMovePolicyAdapter(
            binding.configuration,
            binding.runtime,
          );
        }
        if (binding?.kind === 'stockfish-uci') {
          return new StockfishUciMovePolicyAdapter(
            binding.configuration,
            binding.runtime,
          );
        }
        return new UnavailableMovePolicyProvider({
          instanceId: engine.instanceId,
          providerType: engine.provider,
          displayName: engine.instanceId,
          problemCode: 'configuration.provider_invalid',
        });
      }),
    );
    const positionAnalyses = new ConfiguredPositionAnalysisRegistry(
      configuration.analysisEngines.flatMap(
        (engine): readonly PositionAnalysisProvider[] => {
          const binding = runtimeBindings.get(engine.instanceId);
          if (binding?.kind === 'maia-chess') {
            return [
              new MaiaChessPositionAnalysisAdapter(
                binding.configuration,
                binding.runtime,
                rules,
              ),
            ];
          }
          if (binding?.kind === 'stockfish-uci') {
            return [
              new StockfishUciPositionAnalysisAdapter(
                binding.configuration,
                binding.runtime,
                rules,
              ),
            ];
          }
          return [];
        },
      ),
    );
    const configuredEngineProviders = await engineProviderConfigurations.list();
    const activeEngineFingerprints = new Map(
      configuredEngineProviders.map(
        (provider) =>
          [provider.instanceId, provider.effectiveFingerprint] as const,
      ),
    );
    const getEngineProviderConfigurations = new GetEngineProviderConfigurations(
      {
        repository: engineProviderConfigurations,
        activeFingerprints: activeEngineFingerprints,
      },
    );
    const previewEngineProviderConfiguration =
      new PreviewEngineProviderConfiguration(engineProviderConfigurations);
    const saveEngineProviderConfiguration = new SaveEngineProviderConfiguration(
      engineProviderConfigurations,
    );
    const removeEngineProviderConfiguration =
      new RemoveEngineProviderConfiguration(engineProviderConfigurations);
    const freeAnalysisSession = new FreeAnalysisSession({ persistence, clock });
    const getAnalysisWorkspace = new GetAnalysisWorkspace({
      reader: persistence,
      freeSession: freeAnalysisSession,
      rules,
      storeStatus: persistence,
    });
    const validateAnalysisSetup = new ValidateAnalysisSetup({ rules });
    const listPositionAnalysisProviders = new ListPositionAnalysisProviders(
      positionAnalyses,
    );
    const analyzePosition = new AnalyzePosition({
      workspace: persistence,
      rules,
      providers: positionAnalyses,
      lanes: new ActivePositionAnalysisLanes(),
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
    const getInventoryOrganization = new GetInventoryOrganization(persistence);
    const changeInventoryOrganization = new ChangeInventoryOrganization({
      writer: persistence,
      clock,
      events: eventStream,
    });
    const previewContextFolderRemoval = new PreviewContextFolderRemoval(
      persistence,
    );
    const checkInventoryNameAvailability = new CheckInventoryNameAvailability(
      persistence,
    );
    const previewInventoryItemDeletion = new PreviewInventoryItemDeletion(
      persistence,
    );
    const deleteInventoryItem = new DeleteInventoryItem({
      writer: persistence,
      clock,
      events: eventStream,
    });
    const getWorkScopeWorkspace = new GetWorkScopeWorkspace(persistence);
    const getStartupResume = new GetStartupResume(persistence);
    const setStartupResume = new SetStartupResume({
      writer: persistence,
      clock,
      events: eventStream,
    });
    const previewContextItemRemoval = new PreviewContextItemRemoval(
      persistence,
    );
    const previewWorkingContextDeletion = new PreviewWorkingContextDeletion(
      persistence,
    );
    const activeMovePolicyDecisions = new ActiveMovePolicyDecisions();
    const deleteWorkingContext = new DeleteWorkingContext({
      writer: persistence,
      playout: activeMovePolicyDecisions,
      clock,
      events: eventStream,
    });
    const startInventoryRevision = new StartInventoryRevision({
      inventory: persistence,
      contextReader: persistence,
      contextWriter: persistence,
      freeSession: freeAnalysisSession,
      rules,
      clock,
      events: eventStream,
      storeStatus: persistence,
      scratchId: randomUUID,
    });
    const previewInventoryRevision = new PreviewInventoryRevision({
      inventory: persistence,
      contextReader: persistence,
      freeSession: freeAnalysisSession,
    });
    const promoteAnalysisToInventoryRevision =
      new PromoteAnalysisToInventoryRevision({
        inventory: persistence,
        contextReader: persistence,
        contextWriter: persistence,
        freeSession: freeAnalysisSession,
        clock,
        events: eventStream,
        storeStatus: persistence,
      });
    const saveInventoryRevision = new SaveInventoryRevision({
      reader: persistence,
      writer: persistence,
      freeSession: freeAnalysisSession,
      clock,
      inventoryEvents: eventStream,
      impactEvents: eventStream,
      scratchEvents: eventStream,
    });
    const getInventoryRevision = new GetInventoryRevision(persistence);
    const listInventoryRevisions = new ListInventoryRevisions(persistence);
    const getPendingRevisionImpact = new GetPendingRevisionImpact(persistence);
    const resolvePendingRevisionImpact = new ResolvePendingRevisionImpact({
      writer: persistence,
      clock,
      events: eventStream,
    });
    const listWorkingContexts = new ListWorkingContexts(persistence);
    const getWorkingContextWorkspace = new GetWorkingContextWorkspace(
      persistence,
    );
    const updateWorkingContextMetadata = new UpdateWorkingContextMetadata({
      writer: persistence,
      clock,
      events: eventStream,
    });
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
    const removeContextItem = new RemoveContextItem({
      writer: persistence,
      clock,
      events: eventStream,
    });
    const setWorkScopeResume = new SetWorkScopeResume({
      writer: persistence,
      clock,
      events: eventStream,
    });
    const setManagementPresentation = new SetManagementPresentation({
      writer: persistence,
      clock,
      events: eventStream,
    });
    const playoutDependencies = {
      reader: persistence,
      writer: persistence,
      rules,
      policies: movePolicies,
      decisions: activeMovePolicyDecisions,
      clock,
      events: eventStream,
    };
    const listMovePolicyProviders = new ListMovePolicyProviders(movePolicies);
    const getPlayout = new GetPlayout(persistence, rules);
    const startPlayout = new StartPlayout({
      ...playoutDependencies,
      analysis: persistence,
    });
    const submitPlayoutMove = new SubmitPlayoutMove(playoutDependencies);
    const retryPlayoutPolicyMove = new RetryPlayoutPolicyMove(
      playoutDependencies,
    );
    const pausePlayout = new PausePlayout(playoutDependencies);
    const resumePlayout = new ResumePlayout(playoutDependencies);
    const stopPlayout = new StopPlayout(playoutDependencies);
    const cancelPlayoutCompletion = new CancelPlayoutCompletion(
      playoutDependencies,
    );
    const completePlayout = new CompletePlayout(playoutDependencies);
    const discardPlayout = new DiscardPlayout(playoutDependencies);
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
      listPositionAnalysisProviders,
      analyzePosition,
      validateAnalysisSetup,
      updateAnalysisScratch,
      createAnalysisRecord,
      createAnalysisNote,
      createPositionNote,
      updateAnalysisNote,
      deleteAnalysisNote,
      searchInventory,
      getInventoryOrganization,
      changeInventoryOrganization,
      previewContextFolderRemoval,
      checkInventoryNameAvailability,
      previewInventoryItemDeletion,
      deleteInventoryItem,
      getWorkScopeWorkspace,
      getStartupResume,
      setStartupResume,
      previewContextItemRemoval,
      previewWorkingContextDeletion,
      deleteWorkingContext,
      startInventoryRevision,
      promoteAnalysisToInventoryRevision,
      previewInventoryRevision,
      saveInventoryRevision,
      getInventoryRevision,
      listInventoryRevisions,
      getPendingRevisionImpact,
      resolvePendingRevisionImpact,
      listWorkingContexts,
      getWorkingContextWorkspace,
      createWorkingContext,
      updateWorkingContextMetadata,
      addContextReference,
      removeContextItem,
      setWorkScopeResume,
      setManagementPresentation,
      listMovePolicyProviders,
      getPlayout,
      startPlayout,
      submitPlayoutMove,
      retryPlayoutPolicyMove,
      pausePlayout,
      resumePlayout,
      stopPlayout,
      cancelPlayoutCompletion,
      completePlayout,
      discardPlayout,
      getEngineProviderConfigurations,
      previewEngineProviderConfiguration,
      saveEngineProviderConfiguration,
      removeEngineProviderConfiguration,
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
      engineRuntimes,
    });
  } catch (error) {
    diagnostics?.write({
      level: 'error',
      eventCode: 'host.lifecycle.start_failed',
      status: 'failed',
    });
    await host?.close();
    await Promise.allSettled(engineRuntimes.map((runtime) => runtime.close()));
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
  readonly engineRuntimes: readonly UciEngineRuntime[];
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
  readonly engineRuntimes: readonly UciEngineRuntime[];
}): Promise<void> {
  input.runtimeStatus.setState('shutting_down');
  input.diagnostics.write({
    level: 'info',
    eventCode: 'host.lifecycle.stopping',
    status: 'stopping',
  });
  await clearHostDiscovery(input.applicationHome, input.lease.ownerId);
  const failures: unknown[] = [];
  const processClosures = await Promise.allSettled([
    Promise.resolve().then(() => input.host.close()),
    ...input.engineRuntimes.map((runtime) => runtime.close()),
  ]);
  failures.push(
    ...processClosures
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason),
  );
  for (const close of [
    () => input.persistence.close(),
    () => input.lease.release(),
  ]) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  input.diagnostics.write({
    level: 'info',
    eventCode: 'host.lifecycle.stopped',
    status: 'stopped',
  });
  try {
    await input.diagnostics.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) throw failures[0];
}
