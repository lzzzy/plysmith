import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { ApplicationProblem } from '../../../app/application/problems/application-problem.ts';
import type { DiagnosticReportDocument } from '../../../app/application/system/index.ts';
import { FileDiagnosticReport } from '../../../app/infrastructure/adapters/diagnostics/filesystem/index.ts';

const gunzipAsync = promisify(gunzip);
const timestamp = '2026-09-14T16:30:00.000Z';

test('diagnostic report reconstructs only closed safe event fields', async (t) => {
  const { home, output } = await fixture(t);
  const diagnostics = path.join(home, 'diagnostics');
  await mkdir(diagnostics, { recursive: true });
  await writeFile(
    path.join(diagnostics, 'host-20260914-run-0.ndjson'),
    [
      JSON.stringify({
        timestamp,
        level: 'error',
        eventCode: 'host.request.completed',
        productRelease: 'secret-canary',
        component: 'host',
        processId: 42,
        runId: 'secret-canary',
        correlationId: 'secret-canary',
        operation: 'secret-canary',
        problemCode: 'secret-canary',
        itemId: '123',
        scratchId: 'secret-canary',
        status: 'failed',
        statusCode: 500,
        durationMilliseconds: 12,
      }),
      '{invalid-json',
      JSON.stringify({
        timestamp,
        level: 'debug',
        eventCode: 'secret-canary',
        component: 'desktop',
      }),
      '',
    ].join('\n'),
  );
  const adapter = new FileDiagnosticReport({ applicationHome: home });
  const events = await adapter.readRedactedEvents({
    maximumSourceBytes: 1_000_000,
    maximumEvents: 100,
  });

  assert.deepEqual(events, {
    events: [
      {
        timestamp,
        level: 'error',
        eventCode: 'host.request.completed',
        component: 'host',
        status: 'failed',
        statusCode: 500,
        durationMilliseconds: 12,
      },
    ],
    sourceSegmentCount: 1,
    discardedLineCount: 2,
    truncated: false,
  });
  assert.doesNotMatch(JSON.stringify(events), /secret-canary|123/);

  const destinationPath = path.join(output, 'report.json.gz');
  const written = await adapter.write({
    destinationPath,
    maximumBytes: 1_000_000,
    document: document(events),
  });
  assert.ok(written.bytesWritten > 0);
  const restored = JSON.parse(
    (await gunzipAsync(await readFile(destinationPath))).toString('utf8'),
  ) as unknown;
  assert.deepEqual(restored, document(events));
  assert.doesNotMatch(JSON.stringify(restored), /secret-canary|123/);
});

test('diagnostic report refuses protected and existing targets', async (t) => {
  const { home, output } = await fixture(t);
  const adapter = new FileDiagnosticReport({ applicationHome: home });
  const existing = path.join(output, 'existing.json.gz');
  await writeFile(existing, 'untouched');

  for (const [candidate, code] of [
    [
      path.join(home, 'diagnostics', 'inside.json.gz'),
      'diagnostics.invalid_report_target',
    ],
    [existing, 'diagnostics.report_target_exists'],
    [path.join(output, 'wrong.zip'), 'diagnostics.invalid_report_target'],
  ] as const) {
    await assert.rejects(
      adapter.write({
        destinationPath: candidate,
        maximumBytes: 1_000_000,
        document: document({
          events: [],
          sourceSegmentCount: 0,
          discardedLineCount: 0,
          truncated: false,
        }),
      }),
      (error: unknown) =>
        error instanceof ApplicationProblem && error.problemCode === code,
    );
  }
  assert.equal(await readFile(existing, 'utf8'), 'untouched');
});

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plysmith-report-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const output = path.join(root, 'output');
  await mkdir(home, { recursive: true });
  await mkdir(output, { recursive: true });
  return { home, output };
}

function document(
  events: DiagnosticReportDocument['diagnostics']['events'],
): DiagnosticReportDocument {
  return {
    schemaVersion: 1,
    generatedAt: timestamp,
    manifest: {
      manifestVersion: 1,
      format: 'plysmith-diagnostics-json-gzip-v1',
      maximumBytes: 10_485_760,
      includedCategories: ['redacted_diagnostic_events'],
      excludedCategories: ['chess_and_user_content'],
    },
    product: { release: '0.0.0', contractFingerprint: 'sha256:safe' },
    runtime: { platform: 'win32', architecture: 'x64', nodeVersion: '24.0.0' },
    diagnostics: {
      configuredLevel: 'debug',
      activeLevel: 'debug',
      restartRequired: false,
      events,
    },
  };
}
