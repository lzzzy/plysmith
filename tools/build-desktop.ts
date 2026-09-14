import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { build as buildModule } from 'esbuild';
import { build as buildRenderer } from 'vite';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const outputRoot = path.join(repositoryRoot, 'build', 'desktop');
const uiRoot = path.join(
  repositoryRoot,
  'app',
  'infrastructure',
  'channels',
  'ui',
);
const rendererRoot = path.join(uiRoot, 'renderer');
const rendererPublicRoot = path.join(uiRoot, 'assets', 'public');

await rm(outputRoot, { recursive: true, force: true });

await Promise.all([
  buildRenderer({
    root: rendererRoot,
    base: './',
    publicDir: rendererPublicRoot,
    plugins: [react()],
    build: {
      outDir: path.join(outputRoot, 'renderer'),
      emptyOutDir: true,
      sourcemap: true,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{ name: 'vendor', test: /[\\/]node_modules[\\/]/ }],
          },
        },
      },
    },
  }),
  buildModule({
    entryPoints: [
      path.join(repositoryRoot, 'app', 'bootstrap', 'desktop', 'main.ts'),
    ],
    outfile: path.join(outputRoot, 'main.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    external: ['electron'],
    sourcemap: true,
  }),
  buildModule({
    entryPoints: [
      path.join(
        repositoryRoot,
        'app',
        'infrastructure',
        'channels',
        'ui',
        'desktop',
        'preload.ts',
      ),
    ],
    outfile: path.join(outputRoot, 'preload.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
    sourcemap: true,
  }),
]);
