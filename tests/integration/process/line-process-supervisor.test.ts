import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  LineProcessProblem,
  LineProcessSupervisor,
} from '../../../app/infrastructure/adapters/process/index.ts';

const owner = fileURLToPath(
  new URL('../../fixtures/process/line-process-owner.ts', import.meta.url),
);
const fakeEngine = fileURLToPath(
  new URL('../../fixtures/uci/fake-uci-engine.mjs', import.meta.url),
);

test('guardian exit while writing fails the session without crashing its owner', async () => {
  const handle = await new LineProcessSupervisor().open({
    executablePath: process.execPath,
    arguments: [fakeEngine, 'timeout'],
    startupTimeoutMs: 2_000,
    stopTimeoutMs: 500,
    maxOutputBytes: 64_000,
  });
  try {
    handle.session.writeLine('uci');
    while ((await handle.session.readLine(2_000)) !== 'uciok') {
      // Wait for the fake engine to complete its handshake.
    }
    process.kill(handle.processId, 'SIGKILL');
    try {
      handle.session.writeLine('x'.repeat(100_000));
    } catch (error) {
      assert.ok(error instanceof LineProcessProblem);
    }
    await assert.rejects(
      handle.session.readLine(2_000),
      (error: unknown) =>
        error instanceof LineProcessProblem &&
        (error.code === 'process_write_failed' ||
          error.code === 'process_exited'),
    );
  } finally {
    await handle.terminate(2_000);
  }
});

test('terminates the guarded engine when its owning process disappears', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'plysmith-process-owner-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tracePath = path.join(directory, 'engine.trace');
  const child = spawn(
    process.execPath,
    [owner, process.execPath, fakeEngine, tracePath],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });

  await waitForLine(child.stdout, 'ready');
  await waitUntil(async () => {
    const trace = await readFile(tracePath, 'utf8').catch(() => '');
    return /^pid \d+$/m.test(trace);
  });
  const trace = await readFile(tracePath, 'utf8');
  const enginePid = Number(/^pid (\d+)$/m.exec(trace)?.[1]);
  assert.equal(Number.isSafeInteger(enginePid), true);
  assert.equal(processExists(enginePid), true);

  child.kill('SIGKILL');
  await waitUntil(() => !processExists(enginePid));
});

test('terminates the engine when its guardian process disappears', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'plysmith-guardian-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tracePath = path.join(directory, 'engine.trace');
  const child = spawn(
    process.execPath,
    [owner, process.execPath, fakeEngine, tracePath],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });

  const guardianLine = await waitForPattern(child.stdout, /^guardian (\d+)$/m);
  const guardianPid = Number(/^guardian (\d+)$/m.exec(guardianLine)?.[1]);
  await waitUntil(async () => {
    const trace = await readFile(tracePath, 'utf8').catch(() => '');
    return /^pid \d+$/m.test(trace);
  });
  const trace = await readFile(tracePath, 'utf8');
  const enginePid = Number(/^pid (\d+)$/m.exec(trace)?.[1]);
  assert.equal(processExists(guardianPid), true);
  assert.equal(processExists(enginePid), true);

  process.kill(guardianPid, 'SIGKILL');
  await waitUntil(() => !processExists(enginePid));
});

async function waitForLine(
  output: NodeJS.ReadableStream,
  expected: string,
): Promise<void> {
  output.setEncoding('utf8');
  let buffer = '';
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${expected}.`)),
      5_000,
    );
    output.on('data', (chunk: string) => {
      buffer += chunk;
      if (!buffer.split(/\r?\n/).includes(expected)) return;
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitForPattern(
  output: NodeJS.ReadableStream,
  expected: RegExp,
): Promise<string> {
  output.setEncoding('utf8');
  let buffer = '';
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${String(expected)}.`)),
      5_000,
    );
    output.on('data', (chunk: string) => {
      buffer += chunk;
      if (!expected.test(buffer)) return;
      clearTimeout(timeout);
      resolve(buffer);
    });
  });
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for the guarded engine to exit.');
}

function processExists(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}
