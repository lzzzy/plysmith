import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  contractFingerprint,
  productRelease,
} from '../contracts/host/index.ts';
import {
  sha256File,
  type ProductManifest,
} from '../app/infrastructure/adapters/platform/windows/product-manifest.ts';

export async function buildProductManifest(options: {
  readonly installRoot: string;
  readonly electronVersion: string;
}): Promise<string> {
  const files: Record<string, string> = {};
  for (const file of await walk(options.installRoot)) {
    const relative = path
      .relative(options.installRoot, file)
      .split(path.sep)
      .join('/');
    if (relative === 'product-manifest.json') continue;
    files[relative] = await sha256File(file);
  }
  const manifest: ProductManifest = {
    schemaVersion: 1,
    productRelease,
    contractFingerprint,
    electronVersion: options.electronVersion,
    files,
  };
  const output = path.join(options.installRoot, 'product-manifest.json');
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  return output;
}

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error('Release payload contains a symlink.');
    if (entry.isDirectory()) files.push(...(await walk(item)));
    else if (entry.isFile()) files.push(item);
    else throw new Error('Release payload contains an unsupported file.');
  }
  return files.sort();
}
