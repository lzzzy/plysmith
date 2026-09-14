import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFixture, headers } from './fixtures.ts';

test('buildHost is ready for inject without opening a port', async (t) => {
  const { host } = await buildFixture(t);
  assert.equal(host.server.listening, false);
  for (const origin of [undefined, 'app://plysmith']) {
    const response = await host.inject({
      url: '/status',
      headers: { ...headers, ...(origin ? { origin } : {}) },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['access-control-allow-origin'], origin);
    assert.equal(
      response.headers['access-control-allow-credentials'],
      undefined,
    );
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
  }
});

test('every route checks authentication before body validation or use cases', async (t) => {
  const { host, published } = await buildFixture(t);
  for (const [method, url] of [
    ['GET', '/status'],
    ['GET', '/preferences'],
    ['PUT', '/preferences/ui-language'],
    ['GET', '/events'],
  ] as const) {
    const response = await host.inject({
      method,
      url,
      headers: { host: headers.host, 'content-type': 'application/json' },
      ...(method === 'PUT' ? { payload: '{invalid' } : {}),
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().code, 'host.unauthorized');
    assert.match(
      String(response.headers['content-type']),
      /^application\/problem\+json/,
    );
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  }
  assert.equal(published.length, 0);
});

test('rejects non-canonical hosts, DNS aliases and forwarded-host bypasses', async (t) => {
  const { host } = await buildFixture(t);
  for (const authority of [
    'localhost:43210',
    'evil.example',
    '0.0.0.0:43210',
    '127.0.0.2:43210',
    '[::1]:43210',
    '127.1:43210',
    '2130706433:43210',
    '127.0.0.1.evil:43210',
    '127.0.0.1:99999',
    '127.0.0.1:0',
    '127.0.0.1:043210',
    '127.0.0.1.',
    'user@127.0.0.1:43210',
  ]) {
    const response = await host.inject({
      url: '/status',
      headers: {
        ...headers,
        host: authority,
        'x-forwarded-host': headers.host,
      },
    });
    assert.equal(response.statusCode, 403, authority);
    assert.equal(response.json().code, 'host.invalid_host');
  }
});

test('rejects foreign and null origins even with a valid bearer token', async (t) => {
  const { host } = await buildFixture(t);
  for (const origin of [
    'null',
    'https://plysmith',
    'app://plysmith.evil',
    'app://plysmith/',
    '',
  ]) {
    const response = await host.inject({
      url: '/status',
      headers: { ...headers, origin },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, 'host.invalid_origin');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
});

test('does not accept tokens from query strings or malformed authorization', async (t) => {
  const { host } = await buildFixture(t);
  for (const authorization of [
    '',
    'Basic test-only-host-token',
    'Bearer wrong',
    'Bearer test-only-host-token extra',
  ]) {
    const response = await host.inject({
      url: '/status?token=test-only-host-token',
      headers: { ...headers, authorization },
    });
    assert.equal(response.statusCode, 401);
    assert.ok(!response.body.includes('test-only-host-token'));
  }
});

test('valid browser preflight needs no token and grants only the route method and required headers', async (t) => {
  const { host } = await buildFixture(t);
  const response = await host.inject({
    method: 'OPTIONS',
    url: '/preferences/ui-language',
    headers: {
      host: headers.host,
      origin: 'app://plysmith',
      'access-control-request-method': 'PUT',
      'access-control-request-headers': 'Authorization, Content-Type',
    },
  });
  assert.equal(response.statusCode, 204);
  assert.equal(response.body, '');
  assert.equal(
    response.headers['access-control-allow-origin'],
    'app://plysmith',
  );
  assert.equal(response.headers['access-control-allow-methods'], 'PUT');
  assert.equal(
    response.headers['access-control-allow-headers'],
    'authorization, content-type, last-event-id, x-plysmith-correlation-id',
  );
  assert.equal(response.headers['access-control-allow-credentials'], undefined);
});

test('browser preflight covers every public use-case route including queries and context paths', async (t) => {
  const { host } = await buildFixture(t);
  const cases = [
    ['/status', 'GET', 'GET'],
    ['/preferences', 'GET', 'GET'],
    ['/preferences/ui-language', 'PUT', 'PUT'],
    ['/events', 'GET', 'GET'],
    ['/analysis/workspace?scopeKind=free', 'GET', 'GET'],
    ['/analysis/scratch', 'PUT', 'PUT'],
    ['/analysis/notes', 'POST', 'POST'],
    ['/analysis/position-notes', 'POST', 'POST'],
    ['/analysis/notes/1', 'PATCH', 'PATCH, DELETE'],
    ['/analysis/notes/1', 'DELETE', 'PATCH, DELETE'],
    ['/inventory?pageSize=50', 'GET', 'GET'],
    ['/inventory/analysis-records', 'POST', 'POST'],
    ['/working-contexts?pageSize=100', 'GET', 'GET, POST'],
    ['/working-contexts', 'POST', 'GET, POST'],
    ['/working-contexts/1', 'GET', 'GET'],
    ['/working-contexts/1/references', 'POST', 'POST'],
    ['/working-contexts/1/resume', 'PUT', 'PUT'],
  ] as const;

  for (const [url, method, allowedMethods] of cases) {
    const response = await host.inject({
      method: 'OPTIONS',
      url,
      headers: {
        host: headers.host,
        origin: 'app://plysmith',
        'access-control-request-method': method,
        'access-control-request-headers':
          method === 'GET' ? 'Authorization' : 'Authorization, Content-Type',
      },
    });
    assert.equal(response.statusCode, 204, `${method} ${url}`);
    assert.equal(
      response.headers['access-control-allow-methods'],
      allowedMethods,
      `${method} ${url}`,
    );
  }
});

test('preflight rejects invalid host, origin, method, header and unknown routes', async (t) => {
  const { host } = await buildFixture(t);
  const base = {
    host: headers.host,
    origin: 'app://plysmith',
    'access-control-request-method': 'GET',
  };
  for (const override of [
    { host: 'localhost' },
    { origin: 'https://evil.example' },
    { origin: '' },
    { 'access-control-request-method': 'DELETE' },
    { 'access-control-request-headers': 'x-private-header' },
  ]) {
    const response = await host.inject({
      method: 'OPTIONS',
      url: '/status',
      headers: { ...base, ...override },
    });
    assert.equal(response.statusCode, 403);
    assert.match(
      String(response.headers['content-type']),
      /^application\/problem\+json/,
    );
    assert.equal(response.headers['access-control-allow-methods'], undefined);
  }
  const unknown = await host.inject({
    method: 'OPTIONS',
    url: '/unknown',
    headers: base,
  });
  assert.equal(unknown.statusCode, 403);

  for (const url of [
    '/working-contexts/1/unknown',
    '/working-contexts/1/references/extra',
    '/analysis/workspace/extra',
    '/analysis/notes/1/extra',
  ]) {
    const response = await host.inject({
      method: 'OPTIONS',
      url,
      headers: base,
    });
    assert.equal(response.statusCode, 403, url);
  }
});
