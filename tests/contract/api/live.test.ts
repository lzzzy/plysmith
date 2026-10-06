import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApplicationProblem } from '../../../app/application/problems/application-problem.ts';
import { buildFixture, createFixture, headers } from './fixtures.ts';

test('Live is unconfigured on first setup and exposes no secrets', async (t) => {
  const { host } = await buildFixture(t);
  const state = await host.inject({ method: 'GET', url: '/live', headers });
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.json(), {
    revision: 0,
    configured: false,
    online: false,
    connection: 'unconfigured',
    fairPlayBlocked: false,
    games: [],
  });
  const config = await host.inject({
    method: 'GET',
    url: '/configuration/live',
    headers,
  });
  assert.equal(config.statusCode, 200);
  assert.deepEqual(config.json(), {
    configured: false,
    tokenConfigured: false,
    configurationRevision: null,
    restartRequired: false,
  });
});

test('disconnect forwards the expected revision and returns offline state without invoking another live action', async (t) => {
  const revisions: number[] = [];
  const state = {
    revision: 8,
    configured: true,
    online: false,
    connection: 'disconnected' as const,
    fairPlayBlocked: true,
    games: [],
  };
  const { host } = await buildFixture(t, {
    live: {
      ...createFixture().dependencies.live,
      disconnect: async (expectedRevision) => {
        revisions.push(expectedRevision);
        return state;
      },
    },
  });
  const response = await host.inject({
    method: 'POST',
    url: '/live/commands',
    headers,
    payload: { kind: 'disconnect', expectedRevision: 7 },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), state);
  assert.deepEqual(revisions, [7]);
  for (const payload of [
    { kind: 'disconnect' },
    { kind: 'disconnect', expectedRevision: -1 },
    { kind: 'disconnect', expectedRevision: 7, action: 'abort' },
  ]) {
    const invalid = await host.inject({
      method: 'POST',
      url: '/live/commands',
      headers,
      payload,
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
  }
  assert.deepEqual(revisions, [7]);
});

test('direct settings accept a token write-only and report restart without echoing it', async (t) => {
  const canary = 'lip_TEST_PRIVATE_SECRET_CANARY';
  let received = '';
  const { host } = await buildFixture(t, {
    saveLiveProviderConfiguration: {
      execute: async (request) => {
        received = request.token;
        return {
          configured: true,
          tokenConfigured: true,
          configurationRevision: 'test-revision',
          restartRequired: true,
        };
      },
    },
  });
  const response = await host.inject({
    method: 'PUT',
    url: '/configuration/live',
    headers,
    payload: { token: canary, expectedConfigurationRevision: null },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(received, canary);
  assert.equal(response.body.includes(canary), false);
  assert.equal(response.json().restartRequired, true);
});

test('invalid token input and internal failures never echo credentials', async (t) => {
  const canary = 'lip_PRIVATE_SECRET_MUST_NOT_LEAK';
  const { host } = await buildFixture(t, {
    saveLiveProviderConfiguration: {
      execute: async () => {
        throw new Error(canary);
      },
    },
  });
  for (const token of [canary, `${canary}\nBAD`]) {
    const response = await host.inject({
      method: 'PUT',
      url: '/configuration/live',
      headers,
      payload: { token, expectedConfigurationRevision: null },
    });
    assert.ok(response.statusCode >= 400);
    assert.equal(response.body.includes(canary), false);
  }
});

test('safe live conflicts retain a useful code rather than a generic internal failure', async (t) => {
  const { host } = await buildFixture(t, {
    live: {
      ...createFixture().dependencies.live,
      observe: async () => {
        throw new ApplicationProblem('live.own_game', 'private provider data');
      },
    },
  });
  const response = await host.inject({
    method: 'POST',
    url: '/live/commands',
    headers,
    payload: {
      kind: 'observe',
      url: 'https://lichess.org/abcdefgh',
      expectedRevision: 0,
    },
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, 'live.own_game');
  assert.equal(response.body.includes('private provider data'), false);
});
