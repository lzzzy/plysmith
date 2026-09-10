import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Protocol } from 'electron';

import type { DesktopBootstrap } from './contract.ts';

export function registerPlysmithScheme(protocol: Protocol): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export async function handleAppRequest(
  request: Request,
  assetsRoot: string,
  getBootstrap: () => DesktopBootstrap,
): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405 });
  }

  const requestUrl = new URL(request.url);
  if (requestUrl.protocol !== 'app:' || requestUrl.hostname !== 'plysmith') {
    return new Response(null, { status: 404 });
  }

  const assetPath = resolveAppAsset(assetsRoot, requestUrl.pathname);
  if (assetPath === undefined) {
    return new Response(null, { status: 404 });
  }

  let content: Uint8Array;
  try {
    content = await readFile(assetPath);
  } catch {
    return new Response(null, { status: 404 });
  }

  const headers = new Headers({
    'content-type': contentTypeFor(assetPath),
    'content-security-policy': createContentSecurityPolicy(getBootstrap()),
    'cross-origin-opener-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  return new Response(content, { status: 200, headers });
}

export function resolveAppAsset(
  assetsRoot: string,
  pathname: string,
): string | undefined {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decodedPath.includes('\\') || decodedPath.includes('\0')) {
    return undefined;
  }

  const relativePath =
    decodedPath === '/' ? 'index.html' : decodedPath.slice(1);
  if (relativePath.length === 0 || path.isAbsolute(relativePath)) {
    return undefined;
  }

  const root = path.resolve(assetsRoot);
  const candidate = path.resolve(root, relativePath);
  const relativeCandidate = path.relative(root, candidate);
  if (
    relativeCandidate.length === 0 ||
    relativeCandidate.startsWith(`..${path.sep}`) ||
    relativeCandidate === '..' ||
    path.isAbsolute(relativeCandidate)
  ) {
    return undefined;
  }
  return candidate;
}

export function createContentSecurityPolicy(
  bootstrap: DesktopBootstrap,
): string {
  const connectSource =
    bootstrap.kind === 'ready'
      ? new URL(bootstrap.connection.endpoint).origin
      : "'none'";
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src-elem 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSource}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function isPlysmithRendererUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'app:' &&
      url.hostname === 'plysmith' &&
      url.pathname === '/index.html'
    );
  } catch {
    return false;
  }
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}
