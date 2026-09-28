import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
const rendererInputs = new Set<string>();
const viteRequire = createRequire(import.meta.resolve('vite/package.json'));

await rm(outputRoot, { recursive: true, force: true });

await Promise.all([
  buildRenderer({
    root: rendererRoot,
    base: './',
    publicDir: rendererPublicRoot,
    plugins: [
      react(),
      {
        name: 'release-inputs',
        generateBundle(_options, bundle) {
          for (const output of Object.values(bundle)) {
            if (output.type !== 'chunk') continue;
            if (/(^|\/)rolldown-runtime-[^/]+\.js$/.test(output.fileName)) {
              rendererInputs.add(viteRequire.resolve('rolldown/package.json'));
            }
            for (const [id, contribution] of Object.entries(output.modules)) {
              if (
                contribution.renderedLength > 0 &&
                path.isAbsolute(id) &&
                existsSync(id)
              ) {
                rendererInputs.add(id);
              }
            }
          }
        },
      },
    ],
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

await writeFile(
  path.join(outputRoot, 'renderer-inputs.json'),
  `${JSON.stringify({ inputs: Object.fromEntries([...rendererInputs].map((id) => [id, {}])) }, null, 2)}\n`,
);
