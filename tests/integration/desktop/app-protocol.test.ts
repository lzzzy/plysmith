import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  createContentSecurityPolicy,
  handleAppRequest,
  isPlysmithRendererUrl,
  resolveAppAsset,
} from '../../../app/infrastructure/channels/ui/desktop/app-protocol.ts';

test('app assets remain inside the built renderer root', () => {
  const root = path.resolve('build', 'desktop', 'renderer');
  assert.equal(resolveAppAsset(root, '/'), path.join(root, 'index.html'));
  assert.equal(
    resolveAppAsset(root, '/assets/application.js'),
    path.join(root, 'assets', 'application.js'),
  );
  assert.equal(resolveAppAsset(root, '/../secret.txt'), undefined);
  assert.equal(resolveAppAsset(root, '/%2e%2e/secret.txt'), undefined);
  assert.equal(resolveAppAsset(root, '/assets%5csecret.txt'), undefined);
});

test('app protocol serves the packaged favicon with its explicit media type', async () => {
  const assetsRoot = path.resolve(
    'app',
    'infrastructure',
    'channels',
    'ui',
    'assets',
    'public',
  );
  const response = await handleAppRequest(
    new Request('app://plysmith/branding/favicon.ico'),
    assetsRoot,
    () => ({ kind: 'unavailable', generation: 0 }),
  );

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('content-type'),
    'image/vnd.microsoft.icon',
  );
  assert.ok((await response.arrayBuffer()).byteLength > 0);
});

test('renderer CSP permits only the active discovered host origin', () => {
  const policy = createContentSecurityPolicy({
    kind: 'ready',
    generation: 3,
    connection: {
      endpoint: 'http://127.0.0.1:43121/',
      productRelease: '0.0.0',
      contractFingerprint: 'sha256:test',
      token: 'not-rendered-in-policy',
    },
  });
  assert.match(policy, /connect-src http:\/\/127\.0\.0\.1:43121/);
  assert.doesNotMatch(policy, /token|unsafe-eval|unsafe-inline.*script/);
  assert.match(
    policy,
    /style-src-elem 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='/,
  );
  assert.match(
    createContentSecurityPolicy({ kind: 'unavailable', generation: 0 }),
    /connect-src 'none'/,
  );
});

test('only the fixed renderer document can request desktop bootstrap', () => {
  assert.equal(
    isPlysmithRendererUrl('app://plysmith/index.html?generation=2'),
    true,
  );
  assert.equal(isPlysmithRendererUrl('app://plysmith/assets/app.js'), false);
  assert.equal(isPlysmithRendererUrl('https://plysmith/index.html'), false);
  assert.equal(isPlysmithRendererUrl('not a url'), false);
});
