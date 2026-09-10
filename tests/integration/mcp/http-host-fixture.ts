import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

import { publishHostDiscovery } from '../../../app/infrastructure/adapters/platform/windows/index.ts';
import { preferences, systemStatus } from '../../contract/mcp/helpers.ts';

export interface CapturedRequest {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export async function createHttpHostFixture(
  t: TestContext,
  options: {
    readonly writeResponse?: { status: number; body: unknown } | 'disconnect';
    readonly preferenceDisconnects?: number;
    readonly discoveryFingerprint?: string;
    readonly statusFingerprint?: string;
  } = {},
) {
  const applicationHome = await mkdtemp(
    path.join(os.tmpdir(), 'plysmith-mcp-'),
  );
  const token = 'mcp-integration-test-token-canary-12345';
  const requests: CapturedRequest[] = [];
  const status = {
    ...systemStatus,
    contractFingerprint:
      options.statusFingerprint ?? systemStatus.contractFingerprint,
  };
  const changedPreferences = {
    ...preferences,
    uiLocale: 'en-GB',
    preferenceRevision: 2,
    dataRevision: 1,
  };
  const writeResult = { changed: true, preferences: changedPreferences };
  let preferenceDisconnects = options.preferenceDisconnects ?? 0;
  let stopped = false;
  // A transport fixture only: it does not compose or launch an Application Host.
  const httpServer = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: text.length > 0 ? JSON.parse(text) : undefined,
      });
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET' && request.url === '/status') {
        response.end(JSON.stringify(status));
      } else if (request.method === 'GET' && request.url === '/preferences') {
        if (preferenceDisconnects > 0) {
          preferenceDisconnects -= 1;
          response.destroy();
          return;
        }
        response.end(JSON.stringify(preferences));
      } else if (
        request.method === 'PUT' &&
        request.url === '/preferences/ui-language'
      ) {
        if (options.writeResponse === 'disconnect') {
          response.destroy();
          return;
        }
        if (options.writeResponse !== undefined) {
          response.statusCode = options.writeResponse.status;
          response.setHeader('content-type', 'application/problem+json');
        }
        response.end(
          JSON.stringify(options.writeResponse?.body ?? writeResult),
        );
      } else {
        response.statusCode = 404;
        response.end('{}');
      }
    } catch {
      response.destroy();
    }
  });
  const stopHost = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    httpServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  };
  t.after(async () => {
    await stopHost();
    await rm(applicationHome, { force: true, recursive: true });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The test endpoint is unavailable.');
  }
  const endpoint = `http://127.0.0.1:${address.port}/`;
  const discovery = {
    ownerId: 'test-http-fixture',
    pid: process.pid,
    endpoint,
    productRelease: status.productRelease,
    contractFingerprint:
      options.discoveryFingerprint ?? systemStatus.contractFingerprint,
    token,
  };
  const discoveryPath = path.join(applicationHome, 'runtime', 'host.json');
  await publishHostDiscovery(applicationHome, discovery);
  return {
    applicationHome,
    discoveryPath,
    endpoint,
    requests,
    stopHost,
    token,
    writeResult,
  };
}
