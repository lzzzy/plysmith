import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

import {
  composeHost,
  type ComposedHost,
} from '../../../app/bootstrap/host/composition-root.ts';
import { initializeConfiguration } from '../../../app/infrastructure/adapters/configuration/filesystem/index.ts';
import { publishHostDiscovery } from '../../../app/infrastructure/adapters/platform/windows/index.ts';

export async function createApplicationHostFixture(t: TestContext) {
  const applicationHome = await mkdtemp(
    path.join(os.tmpdir(), 'plysmith-mcp-application-'),
  );
  let runtime: ComposedHost | undefined = undefined;
  t.after(async () => {
    try {
      await runtime?.close();
    } finally {
      await rm(applicationHome, { recursive: true, force: true });
    }
  });
  const defaultsDirectory = path.resolve('configuration', 'defaults');
  const { activeDirectory } = await initializeConfiguration({
    applicationHome,
    defaultsDirectory,
  });
  const centralPath = path.join(activeDirectory, 'plysmith.json');
  const central = JSON.parse(await readFile(centralPath, 'utf8'));
  central.bindings.playoutEngines = ['uci-test'];
  await writeFile(centralPath, `${JSON.stringify(central)}\n`, 'utf8');
  const providerTracePath = path.join(applicationHome, 'uci-trace.txt');
  await writeFile(
    path.join(activeDirectory, 'uci-test.json'),
    `${JSON.stringify({
      schemaVersion: 2,
      provider: 'stockfish-uci',
      displayName: 'MCP test engine',
      stockfish: {
        executablePath: process.execPath,
        arguments: [
          path.resolve('tests', 'fixtures', 'uci', 'fake-uci-engine.mjs'),
          'normal',
          providerTracePath,
        ],
        threads: 1,
        hashMb: 16,
        detailLevels: { fast: 500, thorough: 10, very_deep: 5_000 },
        playoutBudget: 'thorough',
        startupTimeoutMs: 5_000,
        moveTimeoutMs: 5_000,
        stopTimeoutMs: 1_000,
        maxOutputBytes: 32_768,
      },
    })}\n`,
    'utf8',
  );
  runtime = await composeHost({ applicationHome, defaultsDirectory });
  const endpoint = await runtime.host.listen({ host: '127.0.0.1', port: 0 });
  runtime.markReady();
  await publishHostDiscovery(applicationHome, {
    ownerId: runtime.ownerId,
    pid: process.pid,
    endpoint: new URL(endpoint).toString(),
    productRelease: runtime.productRelease,
    contractFingerprint: runtime.contractFingerprint,
    token: runtime.hostToken,
  });
  return { applicationHome, providerTracePath };
}
