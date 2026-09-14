import type { TestContext } from 'node:test';
import { GetSystemStatus } from '../../../app/application/system/index.ts';
import {
  GetUserPreferences,
  SetUiLanguage,
  type UiLanguageChanged,
} from '../../../app/application/preferences/index.ts';
import type {
  HostEvent,
  HostEventSource,
} from '../../../app/application/events/index.ts';
import {
  buildHost,
  type HostDependencies,
} from '../../../app/infrastructure/channels/api/index.ts';
import { FakePreferencesStore } from '../../application/fake-preferences-store.ts';

export const token = 'test-only-host-token';
export const headers = {
  host: '127.0.0.1:43210',
  authorization: `Bearer ${token}`,
};
export const occurredAt = '2026-09-08T12:00:00.000Z';

export function createFixture() {
  const store = new FakePreferencesStore();
  const published: UiLanguageChanged[] = [];
  const unavailableUseCase = {
    execute: async (): Promise<never> => {
      throw new Error('Use case not configured for this fixture.');
    },
  };
  const dependencies: HostDependencies = {
    getSystemStatus: new GetSystemStatus({
      runtime: { getState: () => 'ready' },
      store,
    }),
    getDiagnosticSettings: {
      execute: async () => ({
        configuredLevel: 'off',
        activeLevel: 'off',
        configurationRevision: `sha256:${'a'.repeat(64)}`,
        restartRequired: false,
      }),
    },
    setDiagnosticLogLevel: {
      execute: async () => ({
        changed: false,
        settings: {
          configuredLevel: 'off',
          activeLevel: 'off',
          configurationRevision: `sha256:${'a'.repeat(64)}`,
          restartRequired: false,
        },
      }),
    },
    getDiagnosticReportManifest: {
      execute: async () => ({
        manifestVersion: 1,
        format: 'plysmith-diagnostics-json-gzip-v1',
        suggestedFileName: 'plysmith-diagnostics-20260908120000.json.gz',
        maximumBytes: 10_485_760,
        includedCategories: [
          'product_identity',
          'runtime_environment',
          'diagnostic_settings',
          'redacted_diagnostic_events',
          'excluded_data_declaration',
        ],
        excludedCategories: [
          'secrets_and_credentials',
          'active_configuration',
          'database_and_backups',
          'local_paths',
          'chess_and_user_content',
          'external_identities',
          'provider_payloads',
          'memory_and_raw_errors',
        ],
      }),
    },
    createDiagnosticReport: {
      execute: async () => ({
        created: true,
        generatedAt: occurredAt,
        format: 'plysmith-diagnostics-json-gzip-v1',
        bytesWritten: 123,
        eventCount: 2,
        discardedLineCount: 0,
        truncated: false,
      }),
    },
    getUserPreferences: new GetUserPreferences(store),
    setUiLanguage: new SetUiLanguage({
      unitOfWork: store,
      clock: { now: () => occurredAt },
      events: {
        publish: (event) => {
          published.push(event);
        },
      },
    }),
    getAnalysisWorkspace: unavailableUseCase,
    updateAnalysisScratch: unavailableUseCase,
    createAnalysisRecord: unavailableUseCase,
    createAnalysisNote: unavailableUseCase,
    createPositionNote: unavailableUseCase,
    updateAnalysisNote: unavailableUseCase,
    deleteAnalysisNote: unavailableUseCase,
    searchInventory: unavailableUseCase,
    listWorkingContexts: unavailableUseCase,
    getWorkingContextWorkspace: unavailableUseCase,
    createWorkingContext: unavailableUseCase,
    addContextReference: unavailableUseCase,
    setWorkScopeResume: unavailableUseCase,
    events: finiteSource([]),
    security: { hostToken: token },
    productRelease: '0.0.0-test',
    contractFingerprint: 'test-contract-fingerprint',
    correlationIdFactory: () => 'test-correlation',
  };
  return { store, published, dependencies };
}

export async function buildFixture(
  t: TestContext,
  overrides: Partial<HostDependencies> = {},
) {
  const fixture = createFixture();
  const host = await buildHost({ ...fixture.dependencies, ...overrides });
  t.after(() => host.close());
  return { ...fixture, host };
}

export function languageEvent(sequence = 1): HostEvent {
  return {
    eventId: `generation:${sequence}`,
    sequence,
    kind: 'preference.ui-language-changed',
    dataRevision: sequence,
    occurredAt,
    preferenceRevision: sequence + 1,
    subscriptionRevision: 1,
    correlationId: 'test-correlation',
    payload: { previousUiLocale: 'de-DE', uiLocale: 'en-GB' },
  };
}

export function gapEvent(): HostEvent {
  return {
    eventId: 'new-generation:0',
    kind: 'host.replay-gap',
    sequence: 0,
    dataRevision: 0,
    occurredAt,
    subscriptionRevision: 1,
    correlationId: 'test-correlation',
    payload: { reason: 'replay_unavailable' },
  };
}

export function finiteSource(
  events: readonly HostEvent[],
  cursors: (string | undefined)[] = [],
): HostEventSource {
  return {
    subscribe: ({ lastEventId }) => {
      cursors.push(lastEventId);
      return {
        events: (async function* () {
          yield* events;
        })(),
        close: () => undefined,
      };
    },
  };
}
