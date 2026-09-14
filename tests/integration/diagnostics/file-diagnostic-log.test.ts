import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import type { DiagnosticEventInput } from '../../../contracts/diagnostics/index.ts';
import { FileDiagnosticLog } from '../../../app/infrastructure/adapters/diagnostics/filesystem/index.ts';

test('writes bounded structured events without serializing unknown content', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const log = new FileDiagnosticLog({
    applicationHome,
    component: 'host',
    productRelease: '0.0.0',
    level: 'debug',
    now: () => '2026-09-14T12:00:00.000Z',
    runId: 'run-1',
    processId: 42,
  });
  const unsafeCandidate = {
    level: 'error',
    eventCode: 'host.request.completed',
    correlationId: 'correlation-1',
    operation: 'GetAnalysisWorkspace',
    status: 'failed',
    problemCode: 'request.invalid',
    statusCode: 400,
    body: 'private note text',
    request: { fen: 'private position' },
  } as DiagnosticEventInput;

  log.write(unsafeCandidate);
  await log.close();

  const files = await readdir(path.join(applicationHome, 'diagnostics'));
  assert.equal(files.length, 1);
  const line = await readFile(
    path.join(applicationHome, 'diagnostics', files[0]!),
    'utf8',
  );
  assert.deepEqual(JSON.parse(line), {
    timestamp: '2026-09-14T12:00:00.000Z',
    level: 'error',
    eventCode: 'host.request.completed',
    productRelease: '0.0.0',
    component: 'host',
    processId: 42,
    runId: 'run-1',
    correlationId: 'correlation-1',
    operation: 'GetAnalysisWorkspace',
    status: 'failed',
    problemCode: 'request.invalid',
    statusCode: 400,
  });
  assert.doesNotMatch(line, /private/);
});

test('respects off and severity thresholds', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const off = new FileDiagnosticLog({
    applicationHome,
    component: 'desktop',
    productRelease: '0.0.0',
    level: 'off',
  });
  off.write({
    level: 'error',
    eventCode: 'desktop.lifecycle.start_failed',
  });
  await off.close();
  await assert.rejects(readdir(path.join(applicationHome, 'diagnostics')));

  const errorsOnly = new FileDiagnosticLog({
    applicationHome,
    component: 'desktop',
    productRelease: '0.0.0',
    level: 'error',
    now: () => '2026-09-14T12:00:00.000Z',
    runId: 'run-2',
  });
  errorsOnly.write({
    level: 'debug',
    eventCode: 'renderer.refresh.completed',
  });
  errorsOnly.write({
    level: 'error',
    eventCode: 'renderer.refresh.failed',
    problemCode: 'host.unavailable',
  });
  await errorsOnly.close();

  const files = await readdir(path.join(applicationHome, 'diagnostics'));
  const line = await readFile(
    path.join(applicationHome, 'diagnostics', files[0]!),
    'utf8',
  );
  assert.equal(JSON.parse(line).eventCode, 'renderer.refresh.failed');
});

test('segments and prunes only Plysmith diagnostic files within the total budget', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const log = new FileDiagnosticLog({
    applicationHome,
    component: 'host',
    productRelease: '0.0.0',
    level: 'debug',
    now: () => '2026-09-14T12:00:00.000Z',
    runId: 'rotation',
    maxFileBytes: 500,
    maxTotalBytes: 1_000,
  });
  for (let index = 0; index < 8; index += 1) {
    log.write({
      level: 'debug',
      eventCode: 'host.request.completed',
      correlationId: `correlation-${index}`,
      operation: 'GetAnalysisWorkspace',
      status: 'succeeded',
      statusCode: 200,
      durationMilliseconds: index,
    });
  }
  await log.close();

  const directory = path.join(applicationHome, 'diagnostics');
  const files = await readdir(directory);
  const sizes = await Promise.all(
    files.map(async (file) => (await stat(path.join(directory, file))).size),
  );
  assert.ok(files.length >= 1);
  assert.ok(files.every((file) => /^host-.*\.ndjson$/.test(file)));
  assert.ok(sizes.reduce((sum, size) => sum + size, 0) <= 1_000);
});

test('host and desktop can prune the same stale diagnostic concurrently', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const directory = path.join(applicationHome, 'diagnostics');
  await mkdir(directory);
  const staleFile = path.join(
    directory,
    'host-20000101000000000-stale-0.ndjson',
  );
  await writeFile(staleFile, 'stale\n', 'utf8');
  await utimes(staleFile, new Date(0), new Date(0));

  const common = {
    applicationHome,
    productRelease: '0.0.0',
    level: 'debug' as const,
    maxAgeMilliseconds: 24 * 60 * 60 * 1_000,
  };
  const host = new FileDiagnosticLog({
    ...common,
    component: 'host',
    runId: 'host-run',
  });
  const desktop = new FileDiagnosticLog({
    ...common,
    component: 'desktop',
    runId: 'desktop-run',
  });

  host.write({ level: 'debug', eventCode: 'host.request.completed' });
  desktop.write({ level: 'debug', eventCode: 'renderer.refresh.completed' });
  await Promise.all([host.close(), desktop.close()]);

  const files = await readdir(directory);
  assert.ok(files.some((file) => file.includes('-host-run-')));
  assert.ok(files.some((file) => file.includes('-desktop-run-')));
});

async function createApplicationHome(context: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'plysmith-log-'));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
