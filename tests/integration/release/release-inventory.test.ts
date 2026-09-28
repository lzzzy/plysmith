import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  buildReleaseInventory,
  type ReleaseInventoryOptions,
} from '../../../tools/release-inventory.ts';

async function write(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function fixture(context: TestContext) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'plysmith-release-inventory-'),
  );
  context.after(() => rm(root, { recursive: true, force: true }));
  const stagingRoot = path.join(root, 'payload');
  const packageRoot = path.join(root, 'source');
  const nodeRuntimeDirectory = path.join(stagingRoot, 'runtime/node');
  await mkdir(packageRoot);
  await mkdir(nodeRuntimeDirectory, { recursive: true });
  const binary = path.join(
    nodeRuntimeDirectory,
    process.platform === 'win32' ? 'node.exe' : 'node',
  );
  try {
    await link(process.execPath, binary);
  } catch {
    await copyFile(process.execPath, binary);
  }
  await write(
    path.join(nodeRuntimeDirectory, 'LICENSE'),
    'Node runtime license and bundled notices fixture.',
  );
  await write(path.join(stagingRoot, 'LICENSE'), 'Electron license fixture.');
  await write(
    path.join(stagingRoot, 'LICENSES.chromium.html'),
    '<html>Chromium bundled notices fixture.</html>',
  );
  await write(path.join(stagingRoot, 'version'), '44.2.0');
  const options: ReleaseInventoryOptions = {
    stagingRoot,
    packageRoot,
    nodeRuntimeDirectory,
    productVersion: '0.1.0',
    buildRevision: 'abc123',
    electronVersion: '44.2.0',
  };
  return { root, ...options, options };
}

async function install(
  directory: string,
  name: string,
  version: string,
  dependencies: Record<string, string> = {},
) {
  await write(
    path.join(directory, 'package.json'),
    JSON.stringify({ name, version, license: 'MIT', dependencies }),
  );
  await write(
    path.join(directory, 'LICENSE'),
    `Copyright ${name} authors. Permission is hereby granted (fixture ${version}).`,
  );
  await write(path.join(directory, 'index.js'), 'export const fixture = true;');
  return directory;
}

interface Report {
  components: {
    ref: string;
    name: string;
    version: string;
    origin: string;
    location: string;
    evidence: { source: string; file: string; sha256: string }[];
  }[];
  dependencies: { ref: string; dependsOn: string[] }[];
  coverage: { warnings: string[]; aggregate: string };
  duplicateVersions: { name: string; versions: string[] }[];
}

test('accepts a staged runtime through the same directory alias', async (context) => {
  const { root, options, stagingRoot } = await fixture(context);
  const alias = path.join(root, 'payload-alias');
  await symlink(
    stagingRoot,
    alias,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const result = await buildReleaseInventory({
    ...options,
    stagingRoot: alias,
    nodeRuntimeDirectory: path.join(alias, 'runtime/node'),
  });
  assert.equal(
    result.inventory,
    path.join(stagingRoot, 'release-license-inventory.json'),
  );
});

test('inventories staged and bundled packages with actual dependency versions, license evidence and runtime notices', async (context) => {
  const { options, stagingRoot, packageRoot } = await fixture(context);
  const modules = path.join(stagingRoot, 'resources/app/node_modules');
  await install(path.join(modules, 'host'), 'host', '1.0.0', { shared: '^1' });
  await install(path.join(modules, 'shared'), 'shared', '1.2.0');
  await install(
    path.join(modules, 'host/node_modules/shared'),
    'shared',
    '1.1.0',
  );
  const renderer = await install(
    path.join(packageRoot, 'node_modules/renderer'),
    'renderer',
    '2.0.0',
    { shared: '^2', treeshaken: '^1' },
  );
  const shared = await install(
    path.join(packageRoot, 'node_modules/shared'),
    'shared',
    '2.0.0',
  );
  await install(
    path.join(packageRoot, 'node_modules/treeshaken'),
    'treeshaken',
    '1.0.0',
  );
  await install(
    path.join(packageRoot, 'node_modules/typescript'),
    'typescript',
    '5.9.3',
  );
  await install(
    path.join(packageRoot, 'node_modules/@modelcontextprotocol/sdk'),
    '@modelcontextprotocol/sdk',
    '1.30.0',
  );
  const result = await buildReleaseInventory({
    ...options,
    rendererMetafile: {
      inputs: {
        [path.join(renderer, 'index.js')]: {},
        [path.join(shared, 'index.js')]: {},
      },
    },
  });
  const report = JSON.parse(await readFile(result.inventory, 'utf8')) as Report;
  assert.deepEqual(report.components.map((item) => item.name).sort(), [
    'Electron',
    'Node.js',
    'host',
    'renderer',
    'shared',
    'shared',
    'shared',
  ]);
  assert.deepEqual(report.duplicateVersions, [
    { name: 'shared', versions: ['1.1.0', '1.2.0', '2.0.0'] },
  ]);
  const host = report.components.find((item) => item.name === 'host')!;
  const nested = report.components.find(
    (item) => item.name === 'shared' && item.version === '1.1.0',
  )!;
  assert.deepEqual(
    report.dependencies.find((item) => item.ref === host.ref)?.dependsOn,
    [nested.ref],
  );
  const refs = new Set(report.components.map((item) => item.ref));
  assert.equal(refs.size, report.components.length);
  for (const component of report.components) {
    assert.ok(component.evidence.length > 0);
    for (const evidence of component.evidence) {
      assert.equal(
        createHash('sha256')
          .update(await readFile(path.join(stagingRoot, evidence.file)))
          .digest('hex'),
        evidence.sha256,
      );
      assert.ok(!evidence.source.includes(options.packageRoot));
    }
  }
  assert.equal(
    report.components.find((item) => item.name === 'Electron')?.evidence.length,
    2,
  );
  assert.equal(report.coverage.aggregate, 'incomplete');
  assert.ok(
    report.coverage.warnings.some((warning) =>
      warning.includes('native third-party'),
    ),
  );
  const bom = JSON.parse(await readFile(result.sbom, 'utf8')) as {
    bomFormat: string;
    specVersion: string;
    dependencies: Report['dependencies'];
    compositions: { aggregate: string }[];
  };
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.equal(bom.specVersion, '1.6');
  assert.equal(bom.compositions[0]?.aggregate, 'incomplete');
  assert.ok(
    bom.dependencies
      .flatMap((item) => item.dependsOn)
      .every((ref) => refs.has(ref)),
  );
  assert.match(
    await readFile(result.notices, 'utf8'),
    /LICENSES.chromium.html/,
  );
});

test('resolves pnpm links only inside supplied roots and preserves separately installed package instances', async (context) => {
  const { options, stagingRoot, packageRoot } = await fixture(context);
  const modules = path.join(stagingRoot, 'resources/app/node_modules');
  const physical = await install(
    path.join(modules, '.pnpm/host@1/node_modules/host'),
    'host',
    '1.0.0',
  );
  await symlink(physical, path.join(modules, 'host'), 'junction');
  const source = await install(
    path.join(packageRoot, 'node_modules/.pnpm/view@1/node_modules/view'),
    'view',
    '1.0.0',
  );
  await symlink(
    source,
    path.join(packageRoot, 'node_modules/view'),
    'junction',
  );
  const result = await buildReleaseInventory({
    ...options,
    rendererMetafile: { inputs: { 'node_modules/view/index.js': {} } },
  });
  const report = JSON.parse(await readFile(result.inventory, 'utf8')) as Report;
  assert.equal(
    report.components.filter((item) => item.name === 'host').length,
    1,
  );
  assert.equal(
    report.components.filter((item) => item.name === 'view').length,
    1,
  );
  assert.match(
    report.components.find((item) => item.name === 'view')!.location,
    /\.pnpm\/view@1/,
  );
});

test('fails before writing reports when metadata or required dependencies are absent', async (context) => {
  const { options, stagingRoot } = await fixture(context);
  const pkg = path.join(stagingRoot, 'resources/app/node_modules/incomplete');
  await mkdir(pkg, { recursive: true });
  await assert.rejects(
    buildReleaseInventory(options),
    /Missing staged package metadata/,
  );
  await write(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: 'incomplete', license: 'MIT' }),
  );
  await assert.rejects(
    buildReleaseInventory(options),
    /Missing package name\/version/,
  );
  await write(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: 'incomplete', version: '1', license: 'MIT' }),
  );
  await assert.rejects(
    buildReleaseInventory({
      ...options,
      requireStandaloneLicenseEvidence: true,
    }),
    /Missing standalone license evidence: incomplete@1/,
  );
  const supplemental = path.join(
    options.packageRoot,
    'supplemental-license.txt',
  );
  await write(supplemental, 'Complete license text for the fixture.');
  const withEvidence = await buildReleaseInventory({
    ...options,
    requireStandaloneLicenseEvidence: true,
    supplementalLicenseEvidence: { 'incomplete@1': supplemental },
  });
  assert.ok(
    !withEvidence.warnings.some((warning) => warning.includes('incomplete@1')),
  );
  const metadataOnly = await buildReleaseInventory(options);
  assert.ok(
    metadataOnly.warnings.some((warning) =>
      warning.includes('incomplete@1: no standalone license text'),
    ),
  );
  const earlierReport = await readFile(
    path.join(stagingRoot, 'sbom.cdx.json'),
    'utf8',
  );
  await install(pkg, 'incomplete', '1', { absent: '^1' });
  await assert.rejects(
    buildReleaseInventory(options),
    /Missing staged dependency absent/,
  );
  assert.equal(
    await readFile(path.join(stagingRoot, 'sbom.cdx.json'), 'utf8'),
    earlierReport,
  );
});

test('rejects external package links and preexisting evidence output links', async (context) => {
  const { options, root, stagingRoot } = await fixture(context);
  const outside = await install(path.join(root, 'outside'), 'external', '1');
  const modules = path.join(stagingRoot, 'node_modules');
  await mkdir(modules);
  await symlink(outside, path.join(modules, 'external'), 'junction');
  await assert.rejects(
    buildReleaseInventory(options),
    /Symlink escapes supplied root/,
  );
  await rm(path.join(modules, 'external'));
  await symlink(outside, path.join(stagingRoot, 'licenses'), 'junction');
  await assert.rejects(
    buildReleaseInventory(options),
    /Symlink escapes supplied root/,
  );
  assert.equal(
    await readFile(path.join(outside, 'LICENSE'), 'utf8'),
    'Copyright external authors. Permission is hereby granted (fixture 1).',
  );
});

test('includes the shipped chess font and embedded SQLite evidence without inferring runtime licenses', async (context) => {
  const { options, stagingRoot, packageRoot } = await fixture(context);
  const pkg = await install(
    path.join(stagingRoot, 'node_modules/better-sqlite3'),
    'better-sqlite3',
    '13.0.3',
  );
  await write(
    path.join(pkg, 'deps/sqlite3/sqlite3.h'),
    '/* Copyright disclaimer and blessing fixture. */\n#define SQLITE_VERSION "3.53.0"\n',
  );
  await write(
    path.join(
      stagingRoot,
      'resources/app/renderer/PlysmithChess-Regular-abc.woff2',
    ),
    'font fixture',
  );
  await write(
    path.join(packageRoot, 'assets/fonts/plysmith-chess/source/src/font.json'),
    JSON.stringify({
      family: 'Plysmith Chess',
      version: '1.000',
      license: 'OFL-1.1',
    }),
  );
  await write(
    path.join(packageRoot, 'assets/fonts/plysmith-chess/source/OFL.txt'),
    'SIL Open Font License fixture.',
  );
  const result = await buildReleaseInventory(options);
  const report = JSON.parse(await readFile(result.inventory, 'utf8')) as Report;
  assert.equal(
    report.components.find((item) => item.name === 'SQLite')?.version,
    '3.53.0',
  );
  assert.equal(
    report.components.find((item) => item.name === 'Plysmith Chess')?.version,
    '1.000',
  );
  assert.ok(
    report.coverage.warnings.some((warning) =>
      warning.includes('No bundle-input manifest'),
    ),
  );
  await rm(path.join(stagingRoot, 'LICENSES.chromium.html'));
  await assert.rejects(buildReleaseInventory(options), /ENOENT/);
});
