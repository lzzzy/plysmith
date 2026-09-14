import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CreateDiagnosticReport,
  GetDiagnosticReportManifest,
  GetDiagnosticSettings,
  SetDiagnosticLogLevel,
  type ConfiguredDiagnosticSettings,
  type DiagnosticReportDocument,
  type DiagnosticSettingsRepository,
} from '../../app/application/system/index.ts';

const revision = `sha256:${'a'.repeat(64)}`;
const nextRevision = `sha256:${'b'.repeat(64)}`;

test('diagnostic settings distinguish configured and active product levels', async () => {
  const useCase = new GetDiagnosticSettings({
    repository: repository({ level: 'debug', configurationRevision: revision }),
    activeLevel: 'off',
  });

  assert.deepEqual(await useCase.execute(), {
    configuredLevel: 'debug',
    activeLevel: 'off',
    configurationRevision: revision,
    restartRequired: true,
  });
});

test('diagnostic log level writes once and reports a pending restart', async () => {
  const writes: unknown[] = [];
  const settings = repository(
    { level: 'off', configurationRevision: revision },
    async (request) => {
      writes.push(request);
      return { level: request.level, configurationRevision: nextRevision };
    },
  );
  const useCase = new SetDiagnosticLogLevel({
    repository: settings,
    activeLevel: 'off',
  });

  assert.deepEqual(
    await useCase.execute({
      level: 'debug',
      expectedConfigurationRevision: revision,
    }),
    {
      changed: true,
      settings: {
        configuredLevel: 'debug',
        activeLevel: 'off',
        configurationRevision: nextRevision,
        restartRequired: true,
      },
    },
  );
  assert.deepEqual(writes, [
    { level: 'debug', expectedConfigurationRevision: revision },
  ]);
});

test('unchanged diagnostic log level is a no-op after revision validation', async () => {
  const settings = repository(
    { level: 'info', configurationRevision: revision },
    async (): Promise<never> => {
      throw new Error('unexpected write');
    },
  );
  const useCase = new SetDiagnosticLogLevel({
    repository: settings,
    activeLevel: 'info',
  });

  assert.equal(
    (
      await useCase.execute({
        level: 'info',
        expectedConfigurationRevision: revision,
      })
    ).changed,
    false,
  );
});

test('diagnostic report binds the visible manifest to the written document', async () => {
  const now = '2026-09-14T16:30:00.000Z';
  const manifestUseCase = new GetDiagnosticReportManifest({ now: () => now });
  const visibleManifest = await manifestUseCase.execute();
  let written: DiagnosticReportDocument | undefined;
  const useCase = new CreateDiagnosticReport({
    settings: repository({ level: 'debug', configurationRevision: revision }),
    source: {
      readRedactedEvents: async () => ({
        events: [
          {
            timestamp: now,
            level: 'error',
            eventCode: 'host.lifecycle.start_failed',
            component: 'host',
            status: 'failed',
          },
        ],
        sourceSegmentCount: 1,
        discardedLineCount: 2,
        truncated: false,
      }),
    },
    writer: {
      write: async (request) => {
        written = request.document;
        assert.equal(request.maximumBytes, visibleManifest.maximumBytes);
        assert.equal(request.destinationPath, 'C:\\reports\\report.json.gz');
        return { bytesWritten: 321 };
      },
    },
    clock: { now: () => now },
    activeLevel: 'info',
    productRelease: '0.0.0',
    contractFingerprint: `sha256:${'c'.repeat(64)}`,
    runtime: { platform: 'win32', architecture: 'x64', nodeVersion: '24.0.0' },
  });

  const result = await useCase.execute({
    acceptedManifestVersion: visibleManifest.manifestVersion,
    destinationPath: 'C:\\reports\\report.json.gz',
  });
  assert.deepEqual(result, {
    created: true,
    generatedAt: now,
    format: 'plysmith-diagnostics-json-gzip-v1',
    bytesWritten: 321,
    eventCount: 1,
    discardedLineCount: 2,
    truncated: false,
  });
  assert.deepEqual(
    written?.manifest.includedCategories,
    visibleManifest.includedCategories,
  );
  assert.deepEqual(
    written?.manifest.excludedCategories,
    visibleManifest.excludedCategories,
  );
  assert.equal(written?.diagnostics.restartRequired, true);
  assert.doesNotMatch(JSON.stringify(written), /C:\\reports/);
});

function repository(
  current: ConfiguredDiagnosticSettings,
  write: DiagnosticSettingsRepository['setLevel'] = async (request) => ({
    level: request.level,
    configurationRevision: nextRevision,
  }),
): DiagnosticSettingsRepository {
  return { read: async () => current, setLevel: write };
}
