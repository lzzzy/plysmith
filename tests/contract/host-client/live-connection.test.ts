import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HostClientProblem,
  PlysmithHostClient,
  RediscoveringHostClient,
  contractFingerprint,
  productRelease,
} from '../../../app/infrastructure/channels/host_client/testing.ts';

const connection = {
  endpoint: 'http://127.0.0.1:43121/',
  token: 'host-client-test-only',
  productRelease,
  contractFingerprint,
};
const state = {
  revision: 8,
  configured: true,
  online: false,
  connection: 'disconnected',
  fairPlayBlocked: true,
  games: [],
};

for (const rediscovering of [false, true]) {
  for (const outcome of ['offline', 'stale', 'lost'] as const) {
    test(`${rediscovering ? 'rediscovering' : 'host'} client sends disconnect once on ${outcome}`, async () => {
      const calls: { path: string; method: string; body: unknown }[] = [];
      const options = {
        fetch: async (input: Request | string | URL) => {
          const request = input instanceof Request ? input : new Request(input);
          const path = new URL(request.url).pathname;
          if (path === '/status')
            return Response.json({
              state: 'ready',
              persistence: { schemaVersion: 10, dataRevision: 0 },
              productRelease,
              contractFingerprint,
            });
          calls.push({
            path,
            method: request.method,
            body: await request.json(),
          });
          if (outcome === 'lost')
            throw new TypeError('Connection lost after sending');
          if (outcome === 'stale')
            return Response.json(
              {
                type: 'about:blank',
                title: 'Stale live state',
                status: 409,
                detail: 'Read live state before retrying.',
                instance: 'urn:plysmith:problem:live-stale-test',
                code: 'live.stale_state',
                correlationId: 'live-stale-test',
                retryable: false,
                parameters: {},
              },
              { status: 409 },
            );
          return Response.json(state);
        },
      };
      const client = rediscovering
        ? new RediscoveringHostClient(async () => connection, options)
        : new PlysmithHostClient(connection, options);
      const request = { expectedRevision: 7 };
      if (outcome === 'offline')
        assert.deepEqual(await client.disconnectLiveGame(request), state);
      else
        await assert.rejects(
          client.disconnectLiveGame(request),
          (error: unknown) => {
            assert.ok(error instanceof HostClientProblem);
            assert.equal(
              error.problem.code,
              outcome === 'stale' ? 'live.stale_state' : 'host.unavailable',
            );
            return true;
          },
        );
      assert.deepEqual(calls, [
        {
          path: '/live/commands',
          method: 'POST',
          body: { ...request, kind: 'disconnect' },
        },
      ]);
    });
  }
}
