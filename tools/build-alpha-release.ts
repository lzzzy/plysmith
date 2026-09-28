import { execFile } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { packager } from '@electron/packager';
import { Arch, build as buildInstaller, Platform } from 'electron-builder';
import { build as buildModule } from 'esbuild';

import { productRelease } from '../contracts/host/index.ts';
import { buildProductManifest } from './build-product-manifest.ts';
import { buildReleaseInventory } from './release-inventory.ts';
import { writeAlphaReleaseChecksums } from './release-assets.ts';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const defaultReleaseRoot = path.join(repositoryRoot, 'build', 'alpha-release');
const stagingParent = process.env.PLYSMITH_ALPHA_STAGING_PARENT;
if (stagingParent !== undefined && !path.isAbsolute(stagingParent)) {
  throw new Error('The Alpha staging parent must be an absolute directory.');
}
const releaseRoot = stagingParent
  ? await mkdtemp(path.join(stagingParent, 'plysmith-alpha-release-'))
  : defaultReleaseRoot;
const outputRoot = path.join(releaseRoot, 'output');
const appRoot = path.join(releaseRoot, 'app');
const desktopRoot = path.join(repositoryRoot, 'build', 'desktop');
const electronVersion = '44.2.0';

if (
  process.platform !== 'win32' ||
  process.arch !== 'x64' ||
  process.versions.node.split('.')[0] !== '24'
) {
  throw new Error('The Alpha release build requires Windows x64 and Node 24.');
}
if (
  stagingParent === undefined &&
  !releaseRoot.startsWith(path.join(repositoryRoot, 'build') + path.sep)
) {
  throw new Error('Release output escapes the workspace build directory.');
}
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
) as {
  version: string;
};
if (packageJson.version !== productRelease) {
  throw new Error('Package and generated Host contract releases differ.');
}

if (stagingParent === undefined) {
  await rm(releaseRoot, { recursive: true, force: true });
}
await mkdir(appRoot, { recursive: true });
await execFileAsync(
  process.execPath,
  [path.join(repositoryRoot, 'tools', 'build-desktop.ts')],
  {
    cwd: repositoryRoot,
    timeout: 180_000,
  },
);

const hostBuild = await buildModule({
  entryPoints: [
    path.join(repositoryRoot, 'app', 'bootstrap', 'host', 'main.ts'),
  ],
  outfile: path.join(releaseRoot, 'host.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['better-sqlite3'],
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  metafile: true,
});
await writeFile(
  path.join(appRoot, 'package.json'),
  `${JSON.stringify(
    {
      name: 'plysmith',
      productName: 'Plysmith',
      description: 'Local-first chess workbench',
      author: 'Plysmith contributors',
      version: productRelease,
      main: 'main.mjs',
      type: 'module',
    },
    null,
    2,
  )}\n`,
);
await cp(path.join(desktopRoot, 'main.mjs'), path.join(appRoot, 'main.mjs'));

const packagedPaths = await packager({
  dir: appRoot,
  out: path.join(releaseRoot, 'packaged'),
  name: 'Plysmith',
  platform: 'win32',
  arch: 'x64',
  electronVersion,
  ...(process.env.PLYSMITH_ELECTRON_ZIP_DIR
    ? { electronZipDir: process.env.PLYSMITH_ELECTRON_ZIP_DIR }
    : {}),
  asar: true,
  overwrite: true,
  icon: path.join(
    repositoryRoot,
    'app',
    'infrastructure',
    'channels',
    'ui',
    'assets',
    'public',
    'branding',
    'plysmith-icon-black.ico',
  ),
});
const packaged = packagedPaths[0];
if (!packaged) throw new Error('Electron packager produced no application.');
const resources = path.join(packaged, 'resources');
await cp(path.join(releaseRoot, 'host.mjs'), path.join(resources, 'host.mjs'));
await cp(
  path.join(desktopRoot, 'preload.cjs'),
  path.join(resources, 'build', 'desktop', 'preload.cjs'),
);
await cp(
  path.join(desktopRoot, 'renderer'),
  path.join(resources, 'build', 'desktop', 'renderer'),
  { recursive: true },
);
await cp(
  path.join(repositoryRoot, 'configuration', 'defaults'),
  path.join(resources, 'configuration', 'defaults'),
  { recursive: true },
);
await cp(
  path.join(
    repositoryRoot,
    'app',
    'infrastructure',
    'adapters',
    'persistence',
    'sqlite',
    'migrations',
  ),
  path.join(resources, 'migrations'),
  { recursive: true },
);
await copyNodeRuntime(resources);
await copyNativeSqlite(resources);

const rendererInputs = JSON.parse(
  await readFile(path.join(desktopRoot, 'renderer-inputs.json'), 'utf8'),
) as {
  inputs: Record<string, unknown>;
};
const buildRevision = await revision();
const inventory = await buildReleaseInventory({
  stagingRoot: packaged,
  packageRoot: repositoryRoot,
  productVersion: productRelease,
  buildRevision,
  electronVersion,
  nodeRuntimeDirectory: path.join(resources, 'runtime'),
  rendererMetafile: {
    inputs: { ...rendererInputs.inputs, ...hostBuild.metafile.inputs },
  },
  supplementalLicenseEvidence: {
    'abstract-logging@2.0.1': path.join(
      repositoryRoot,
      'tools',
      'release-license-evidence',
      'abstract-logging-2.0.1-MIT.txt',
    ),
  },
  requireStandaloneLicenseEvidence: true,
});
for (const file of [inventory.sbom, inventory.inventory, inventory.notices]) {
  await cp(file, path.join(resources, path.basename(file)));
}
await cp(path.join(packaged, 'licenses'), path.join(resources, 'licenses'), {
  recursive: true,
});
await buildProductManifest({ installRoot: resources, electronVersion });

await mkdir(outputRoot, { recursive: true });
const built = await buildInstaller({
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  prepackaged: packaged,
  publish: 'never',
  config: {
    appId: 'org.plysmith.desktop',
    productName: 'Plysmith',
    directories: { output: outputRoot },
    artifactName: 'Plysmith-${version}-win-x64-Setup.${ext}',
    win: {
      target: ['nsis'],
      icon: path.join(
        repositoryRoot,
        'app',
        'infrastructure',
        'channels',
        'ui',
        'assets',
        'public',
        'branding',
        'plysmith-icon-black.ico',
      ),
      signAndEditExecutable: false,
    },
    nsis: {
      include: path.join(repositoryRoot, 'tools', 'alpha-installer.nsh'),
      oneClick: true,
      perMachine: false,
      allowElevation: false,
      createDesktopShortcut: false,
      createStartMenuShortcut: true,
      runAfterFinish: false,
      deleteAppDataOnUninstall: false,
    },
  },
});
const installer = built.find((file) => file.toLowerCase().endsWith('.exe'));
if (!installer) throw new Error('NSIS did not produce an installer.');
await rm(path.join(outputRoot, 'latest.yml'), { force: true });
await rm(`${installer}.blockmap`, { force: true });
await rm(path.join(outputRoot, 'builder-debug.yml'), { force: true });
for (const file of [inventory.sbom, inventory.inventory, inventory.notices]) {
  await cp(file, path.join(outputRoot, path.basename(file)));
}
await cp(path.join(packaged, 'licenses'), path.join(outputRoot, 'licenses'), {
  recursive: true,
});
await cp(
  path.join(repositoryRoot, 'LICENSE'),
  path.join(outputRoot, 'LICENSE'),
);
await execFileAsync('tar.exe', ['-czf', 'licenses.tar.gz', 'licenses'], {
  cwd: outputRoot,
  timeout: 60_000,
});
await writeAlphaReleaseChecksums(outputRoot, productRelease);
if (stagingParent !== undefined) {
  const pending = path.join(defaultReleaseRoot, 'output-next');
  const previous = path.join(defaultReleaseRoot, 'output-previous');
  await mkdir(defaultReleaseRoot, { recursive: true });
  await rm(pending, { recursive: true, force: true });
  await rm(previous, { recursive: true, force: true });
  await cp(outputRoot, pending, { recursive: true });
  let hadPrevious = true;
  try {
    await rename(path.join(defaultReleaseRoot, 'output'), previous);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    hadPrevious = false;
  }
  try {
    await rename(pending, path.join(defaultReleaseRoot, 'output'));
  } catch (error) {
    if (hadPrevious) {
      await rename(previous, path.join(defaultReleaseRoot, 'output'));
    }
    throw error;
  }
  if (hadPrevious) {
    await rm(previous, { recursive: true, force: true });
  }
}
console.log(
  JSON.stringify(
    {
      installer: path.join(
        defaultReleaseRoot,
        'output',
        path.basename(installer),
      ),
      packaged,
      buildRevision,
      inventory,
    },
    null,
    2,
  ),
);

async function copyNodeRuntime(resources: string): Promise<void> {
  const destination = path.join(resources, 'runtime');
  await mkdir(destination, { recursive: true });
  await cp(process.execPath, path.join(destination, 'node.exe'));
  await cp(
    path.join(path.dirname(process.execPath), 'LICENSE'),
    path.join(destination, 'LICENSE'),
  );
}

async function copyNativeSqlite(resources: string): Promise<void> {
  const packageFile = fileURLToPath(
    import.meta.resolve('better-sqlite3/package.json'),
  );
  const source = path.dirname(packageFile);
  const destination = path.join(resources, 'node_modules', 'better-sqlite3');
  await mkdir(path.join(destination, 'prebuilds'), { recursive: true });
  await cp(
    path.join(source, 'package.json'),
    path.join(destination, 'package.json'),
  );
  await cp(path.join(source, 'LICENSE'), path.join(destination, 'LICENSE'));
  await cp(path.join(source, 'lib'), path.join(destination, 'lib'), {
    recursive: true,
  });
  await cp(
    path.join(source, 'prebuilds', 'win32-x64.node'),
    path.join(destination, 'prebuilds', 'win32-x64.node'),
  );
  await mkdir(path.join(destination, 'deps', 'sqlite3'), { recursive: true });
  await cp(
    path.join(source, 'deps', 'sqlite3', 'sqlite3.h'),
    path.join(destination, 'deps', 'sqlite3', 'sqlite3.h'),
  );
  const nativeRequire = createRequire(packageFile);
  const addonSource = path.dirname(
    nativeRequire.resolve('node-addon-api/package.json'),
  );
  await cp(
    addonSource,
    path.join(resources, 'node_modules', 'node-addon-api'),
    {
      recursive: true,
      filter: (item) =>
        !path
          .relative(addonSource, item)
          .split(path.sep)
          .includes('node_modules'),
    },
  );
}

async function revision(): Promise<string> {
  const gitArgs = [
    '-c',
    `safe.directory=${repositoryRoot.replaceAll('\\', '/')}`,
  ];
  const { stdout: hash } = await execFileAsync(
    'git',
    [...gitArgs, 'rev-parse', 'HEAD'],
    { cwd: repositoryRoot },
  );
  const { stdout: status } = await execFileAsync(
    'git',
    [...gitArgs, 'status', '--porcelain'],
    { cwd: repositoryRoot },
  );
  return `${hash.trim()}${status.trim() ? '+dirty' : ''}`;
}
