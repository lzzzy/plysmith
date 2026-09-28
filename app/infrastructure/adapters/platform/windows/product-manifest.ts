import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
  contractFingerprint,
  productRelease,
} from '../../../../../contracts/host/index.ts';

export interface ProductManifest {
  readonly schemaVersion: 1;
  readonly productRelease: string;
  readonly contractFingerprint: string;
  readonly electronVersion: string;
  readonly files: Readonly<Record<string, string>>;
}

const physicalFs: typeof fs = process.versions.electron
  ? (createRequire(import.meta.url)('original-fs') as typeof fs)
  : fs;

export async function verifyProductManifest(
  installRoot: string,
  electronVersion: string,
): Promise<void> {
  const serialized = await readFile(
    path.join(installRoot, 'product-manifest.json'),
    'utf8',
  );
  const manifest: unknown = JSON.parse(serialized);
  if (
    !isProductManifest(manifest) ||
    manifest.productRelease !== productRelease ||
    manifest.contractFingerprint !== contractFingerprint ||
    manifest.electronVersion !== electronVersion
  ) {
    throw new Error('The installed Plysmith release is incompatible.');
  }
  for (const required of [
    'host.mjs',
    'runtime/node.exe',
    'build/desktop/preload.cjs',
    'build/desktop/renderer/index.html',
    'configuration/defaults/plysmith.json',
    'configuration/defaults/sqlite-main.json',
  ]) {
    if (!(required in manifest.files)) {
      throw new Error('The installed Plysmith release is incomplete.');
    }
  }
  for (const [relative, expected] of Object.entries(manifest.files)) {
    if (!isSafeRelativePath(relative) || !/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error('The installed Plysmith release manifest is invalid.');
    }
    const absolute = path.join(installRoot, ...relative.split('/'));
    const info = await physicalFs.promises.lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error('The installed Plysmith release is invalid.');
    }
    if ((await sha256File(absolute)) !== expected) {
      throw new Error('The installed Plysmith release has changed.');
    }
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of physicalFs.createReadStream(filePath))
    hash.update(chunk);
  return hash.digest('hex');
}

function isProductManifest(value: unknown): value is ProductManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.productRelease === 'string' &&
    typeof candidate.contractFingerprint === 'string' &&
    typeof candidate.electronVersion === 'string' &&
    typeof candidate.files === 'object' &&
    candidate.files !== null &&
    !Array.isArray(candidate.files)
  );
}

function isSafeRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    value
      .split('/')
      .every(
        (part) =>
          part.length > 0 &&
          part !== '.' &&
          part !== '..' &&
          !part.includes('\\') &&
          !part.includes(':'),
      )
  );
}
