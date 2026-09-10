import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { build } from 'esbuild';

const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), 'plysmith-host-client-browser-'),
);

try {
  const bundle = path.join(temporaryDirectory, 'host-client.mjs');
  await build({
    entryPoints: [
      path.resolve(
        'app',
        'infrastructure',
        'channels',
        'host_client',
        'index.ts',
      ),
    ],
    bundle: true,
    format: 'esm',
    logLevel: 'silent',
    outfile: bundle,
    platform: 'browser',
    target: 'es2024',
    treeShaking: false,
  });
  await promisify(execFile)(
    process.execPath,
    ['--disallow-code-generation-from-strings', bundle],
    { windowsHide: true },
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
