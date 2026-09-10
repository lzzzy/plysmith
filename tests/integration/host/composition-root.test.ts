import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { composeHost } from '../../../app/bootstrap/host/composition-root.ts';
import { parseHostPaths } from '../../../app/bootstrap/host/main.ts';

const defaultsDirectory = path.resolve('configuration', 'defaults');
const hostToken = 'composition-root-test-token';

test('composition root wires the real store and use cases without listening', async (context) => {
  const applicationHome = await createApplicationHome(context);
  const runtime = await composeHost({
    applicationHome,
    defaultsDirectory,
    hostToken,
    now: () => '2026-09-08T11:00:00.000Z',
    correlationIdFactory: () => 'composition-correlation',
  });
  try {
    runtime.markReady();

    const headers = {
      host: '127.0.0.1',
      authorization: `Bearer ${hostToken}`,
    };
    const before = await runtime.host.inject({
      method: 'GET',
      url: '/preferences',
      headers,
    });
    assert.deepEqual(before.json(), {
      uiLocale: 'de-DE',
      preferenceRevision: 1,
      dataRevision: 0,
      updatedAt: '2026-09-08T11:00:00.000Z',
    });

    const changed = await runtime.host.inject({
      method: 'PUT',
      url: '/preferences/ui-language',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { uiLocale: 'en-GB', expectedRevision: 1 },
    });
    assert.equal(changed.statusCode, 200);
    assert.equal(changed.json().preferences.uiLocale, 'en-GB');

    const status = await runtime.host.inject({
      method: 'GET',
      url: '/status',
      headers,
    });
    assert.deepEqual(status.json().persistence, {
      schemaVersion: 1,
      dataRevision: 1,
    });
    assert.equal(status.json().state, 'ready');
    assert.equal(
      status.json().contractFingerprint,
      runtime.contractFingerprint,
    );
  } finally {
    await runtime.close();
  }
});

test('failed composition releases the owner lease for a corrected restart', async (context) => {
  const applicationHome = await createApplicationHome(context);
  await assert.rejects(
    composeHost({
      applicationHome,
      defaultsDirectory: path.join(applicationHome, 'missing-defaults'),
      hostToken,
    }),
  );

  const runtime = await composeHost({
    applicationHome,
    defaultsDirectory,
    hostToken,
  });
  await runtime.close();
});

test('host path parsing keeps source application home and install root explicit', () => {
  const paths = parseHostPaths([
    '--application-home',
    'C:\\Users\\example\\AppData\\Local\\Plysmith',
    '--install-root',
    'C:\\Program Files\\Plysmith',
  ]);

  assert.equal(
    paths.defaultsDirectory,
    path.resolve('C:\\Program Files\\Plysmith', 'configuration', 'defaults'),
  );
  assert.equal(
    paths.applicationHome,
    path.resolve('C:\\Users\\example\\AppData\\Local\\Plysmith'),
  );
});

async function createApplicationHome(context: TestContext): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'plysmith-composed-'));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}
