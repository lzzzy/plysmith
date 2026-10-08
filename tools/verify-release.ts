import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import Database from 'better-sqlite3';

import { connectHost } from '../app/infrastructure/channels/host_client/index.ts';
import {
  readHostDiscovery,
  startProductionHost,
  verifyProductManifest,
  ProductionHostStartupProblem,
} from '../app/infrastructure/adapters/platform/windows/index.ts';
import { snapshotPreservedFiles } from './verify-release-uninstall-guard.ts';

const packaged = path.resolve(
  process.env.PLYSMITH_VERIFY_PACKAGE_ROOT ??
    'build/release/packaged/Plysmith-win32-x64',
);
const installRoot = path.join(packaged, 'resources');
const home = path.resolve('build/release-verification', `host-${randomUUID()}`);
await mkdir(home, { recursive: true });
await verifyProductManifest(installRoot, '44.2.0');

let createdContextId: string;
let previousRevision: number;
for (const iteration of [1, 2]) {
  const host = await startProductionHost({
    applicationHome: home,
    installRoot,
  });
  try {
    const client = await waitForHost(home);
    const status = await client.getSystemStatus();
    assert.equal(status.state, 'ready');
    if (iteration === 1) {
      const created = await client.createWorkingContext({
        displayName: 'Release-Pruefung',
      });
      createdContextId = created.context.contextId;
      previousRevision = created.dataRevision;
    } else {
      const contexts = await client.listWorkingContexts({});
      assert.ok(
        contexts.contexts.some((item) => item.contextId === createdContextId),
      );
      assert.ok(status.persistence.dataRevision >= previousRevision!);
    }
    console.log(
      `Host start ${iteration}: ready; revision ${status.persistence.dataRevision}`,
    );
  } finally {
    await host.close();
    if (host.pid) await waitForExit(host.pid);
  }
}

const database = new Database(path.join(home, 'data', 'plysmith.db'));
database
  .prepare(
    'UPDATE runtime_store_state SET schema_version = 999 WHERE store_state_id = 1',
  )
  .run();
database.close();
const beforeBlockedStart = await snapshotPreservedFiles(home);
await assert.rejects(
  startProductionHost({ applicationHome: home, installRoot }),
  (error: unknown) =>
    error instanceof ProductionHostStartupProblem &&
    error.code === 'incompatible_data',
);
assert.deepEqual(await snapshotPreservedFiles(home), beforeBlockedStart);
const preserved = new Database(path.join(home, 'data', 'plysmith.db'), {
  readonly: true,
});
try {
  assert.equal(
    (
      preserved
        .prepare('SELECT schema_version AS version FROM runtime_store_state')
        .get() as { version: number }
    ).version,
    999,
  );
} finally {
  preserved.close();
}
console.log(
  'Incompatible data: blocked; database and configuration bytes unchanged',
);
console.log(`Isolated home: ${home}`);

async function waitForHost(applicationHome: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const connection = await readHostDiscovery(applicationHome);
      return await connectHost(connection, { origin: 'app://plysmith' });
    } catch (error) {
      lastError = error;
      await delay(1_000);
    }
  }
  throw new Error('Bundled Host did not become ready.', { cause: lastError });
}

async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      process.kill(pid, 0);
      await delay(500);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
  }
  throw new Error('The bundled Host stayed alive after owner disconnect.');
}
