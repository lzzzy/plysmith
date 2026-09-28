import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

export interface ReleaseBuildInputs {
  readonly inputs: Readonly<Record<string, unknown>>;
}

export interface CycloneDxSchemas {
  readonly bom: object;
  readonly spdx: object;
  readonly jsf: object;
}

export interface ReleaseInventoryOptions {
  /** Final unpacked payload, including Electron and the production app. */
  readonly stagingRoot: string;
  /** Source package root; only explicitly listed bundle inputs are read here. */
  readonly packageRoot: string;
  readonly productVersion: string;
  readonly buildRevision: string;
  readonly electronVersion: string;
  /** Must be inside stagingRoot and contain LICENSE plus node.exe (or node). */
  readonly nodeRuntimeDirectory: string;
  /** Input paths are absolute or relative to packageRoot. Include all JS bundles. */
  readonly rendererMetafile?: ReleaseBuildInputs;
  readonly supplementalLicenseEvidence?: Readonly<Record<string, string>>;
  readonly requireStandaloneLicenseEvidence?: boolean;
  /** Official CycloneDX 1.6 schemas, fetched/pinned by the release builder. */
  readonly cycloneDxSchemas?: CycloneDxSchemas;
}

/** Reuses Fastify's installed Ajv; no network access or additional dependency. */
export function validateReleaseInventorySchema(
  document: unknown,
  schemas: CycloneDxSchemas,
): void {
  const fromFastify = createRequire(import.meta.resolve('fastify'));
  const fromCompiler = createRequire(
    fromFastify.resolve('@fastify/ajv-compiler'),
  );
  const Ajv = fromCompiler('ajv') as new (options: object) => {
    addSchema(schema: object): void;
    compile(
      schema: object,
    ): ((document: unknown) => boolean) & { errors?: unknown };
  };
  const validator = new Ajv({ strict: false, validateFormats: false });
  validator.addSchema(schemas.spdx);
  validator.addSchema(schemas.jsf);
  const validate = validator.compile(schemas.bom);
  if (!validate(document))
    throw new Error(
      `Invalid CycloneDX document: ${JSON.stringify(validate.errors)}`,
    );
}

interface PackageMetadata {
  name: string;
  version: string;
  license?: string | { type: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface LicenseEvidence {
  source: string;
  file: string;
  sha256: string;
}

interface InventoryComponent {
  ref: string;
  name: string;
  version: string;
  kind: 'application' | 'library' | 'file';
  origin: 'staged-package' | 'bundled-package' | 'runtime' | 'asset';
  location: string;
  declaredLicense: string | null;
  evidence: LicenseEvidence[];
  purl?: string;
  manifestSha256?: string;
}

interface PackageInstance {
  directory: string;
  metadata: PackageMetadata;
  component: InventoryComponent;
}

const outputNames = {
  sbom: 'sbom.cdx.json',
  inventory: 'release-license-inventory.json',
  notices: 'THIRD_PARTY_NOTICES.txt',
} as const;
const digest = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');
const slash = (value: string): string => value.split(path.sep).join('/');
const isInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
};
async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function confined(
  file: string,
  root: string,
  suppliedRoot = root,
): Promise<string> {
  const input = path.resolve(file);
  if (!isInside(root, input) && !isInside(suppliedRoot, input))
    throw new Error(`Path outside supplied root: ${file}`);
  const resolved = await realpath(file);
  if (!isInside(root, resolved))
    throw new Error(`Symlink escapes supplied root: ${file}`);
  return resolved;
}

async function packageMetadata(file: string): Promise<PackageMetadata> {
  const value = JSON.parse(await readFile(file, 'utf8')) as PackageMetadata;
  if (
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    typeof value.version !== 'string' ||
    !value.version.trim()
  ) {
    throw new Error(`Missing package name/version: ${file}`);
  }
  return value;
}

/** Inventories shipped files and selected build inputs, never the source dev tree. */
export async function buildReleaseInventory(options: ReleaseInventoryOptions) {
  const suppliedStagingRoot = path.resolve(options.stagingRoot);
  const suppliedNodeRoot = path.resolve(options.nodeRuntimeDirectory);
  if (!isInside(suppliedStagingRoot, suppliedNodeRoot))
    throw new Error(`Path outside supplied root: ${suppliedNodeRoot}`);
  const stagingRoot = await realpath(options.stagingRoot);
  const suppliedPackageRoot = path.resolve(options.packageRoot);
  const packageRoot = await realpath(options.packageRoot);
  const nodeRoot = await realpath(suppliedNodeRoot);
  if (!isInside(stagingRoot, nodeRoot))
    throw new Error(`Symlink escapes supplied root: ${suppliedNodeRoot}`);
  if (
    !options.productVersion.trim() ||
    !options.buildRevision.trim() ||
    !/^44\./.test(options.electronVersion)
  ) {
    throw new Error(
      'Product version, build revision and Electron 44 version are required.',
    );
  }
  const files: string[] = [];
  const visited = new Set<string>();
  async function walk(directory: string): Promise<void> {
    const resolved = await confined(directory, stagingRoot);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    for (const entry of await readdir(resolved, { withFileTypes: true })) {
      const entryPath = path.join(resolved, entry.name);
      if (entryPath === path.join(stagingRoot, 'licenses')) continue;
      const safe = await confined(entryPath, stagingRoot);
      if ((await stat(safe)).isDirectory()) {
        const parent = path.basename(resolved);
        const packageEntry =
          (parent === 'node_modules' &&
            !entry.name.startsWith('.') &&
            !entry.name.startsWith('@')) ||
          (parent.startsWith('@') &&
            path.basename(path.dirname(resolved)) === 'node_modules');
        if (packageEntry && !(await exists(path.join(safe, 'package.json'))))
          throw new Error(`Missing staged package metadata: ${entryPath}`);
        await walk(safe);
      } else files.push(safe);
    }
  }
  await walk(stagingRoot);
  files.sort();
  const components: InventoryComponent[] = [];
  const packages = new Map<string, PackageInstance>();
  const edges = new Map<string, Set<string>>();
  const warnings: string[] = [
    'Electron/Chromium and Node.js contain native third-party components. Their bundled notices are included verbatim; this SBOM does not claim an exhaustive component/version graph inside those runtimes.',
    'Package licenses are recorded declarations plus shipped evidence, not a legal compatibility determination.',
    'Bundle dependency edges connect resolved packages present in the supplied build inputs. Tree-shaken metadata dependencies are not assumed to be shipped; build inputs must cover every JavaScript bundle.',
  ];
  const evidenceContents = new Map<string, Buffer>();
  async function evidence(
    file: string,
    allowedRoot: string,
    source: string,
  ): Promise<LicenseEvidence> {
    const safe = await confined(file, allowedRoot);
    const bytes = await readFile(safe);
    if (!bytes.toString('utf8').trim())
      throw new Error(`Empty license evidence: ${source}`);
    const hash = digest(bytes);
    const output = `licenses/${hash.slice(0, 16)}-${path.basename(safe).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    evidenceContents.set(output, bytes);
    return { source, file: output, sha256: hash };
  }
  async function licenseFiles(
    directory: string,
    allowedRoot: string,
  ): Promise<string[]> {
    const found: string[] = [];
    async function visit(current: string, depth: number): Promise<void> {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        if (
          !/^(licen[sc]es?|notices?|copying|copyright|ofl)([._-]|$)/i.test(
            entry.name,
          ) &&
          depth === 0
        )
          continue;
        const safe = await confined(
          path.join(current, entry.name),
          allowedRoot,
        );
        if ((await stat(safe)).isDirectory()) {
          if (depth < 2) await visit(safe, depth + 1);
        } else found.push(safe);
      }
    }
    await visit(directory, 0);
    return found.sort();
  }
  async function addPackage(
    directory: string,
    origin: 'staged-package' | 'bundled-package',
  ): Promise<PackageInstance> {
    const allowedRoot = origin === 'staged-package' ? stagingRoot : packageRoot;
    const safe = await confined(directory, allowedRoot);
    const previous = packages.get(safe);
    if (previous) return previous;
    const manifestPath = await confined(
      path.join(safe, 'package.json'),
      allowedRoot,
    );
    const metadata = await packageMetadata(manifestPath);
    const location = `${origin === 'staged-package' ? 'payload' : 'build-input'}/${slash(path.relative(allowedRoot, safe))}`;
    const purl = `pkg:npm/${metadata.name.split('/').map(encodeURIComponent).join('/')}@${encodeURIComponent(metadata.version)}`;
    const declaredLicense =
      typeof metadata.license === 'string'
        ? metadata.license
        : (metadata.license?.type ?? null);
    if (!declaredLicense || declaredLicense === 'UNLICENSED')
      throw new Error(
        `Missing or unresolved license declaration: ${metadata.name}@${metadata.version}`,
      );
    const component: InventoryComponent = {
      ref: `${purl}#${digest(location).slice(0, 12)}`,
      name: metadata.name,
      version: metadata.version,
      kind: 'library',
      origin,
      location,
      declaredLicense,
      evidence: [],
      purl,
      manifestSha256: digest(await readFile(manifestPath)),
    };
    for (const file of await licenseFiles(safe, allowedRoot)) {
      component.evidence.push(
        await evidence(
          file,
          allowedRoot,
          `${location}/${slash(path.relative(safe, file))}`,
        ),
      );
    }
    if (component.evidence.length === 0) {
      const key = `${metadata.name}@${metadata.version}`;
      const supplemental = options.supplementalLicenseEvidence?.[key];
      if (supplemental) {
        const safe = await confined(
          supplemental,
          packageRoot,
          suppliedPackageRoot,
        );
        component.evidence.push(
          await evidence(
            safe,
            packageRoot,
            `build-input/${slash(path.relative(packageRoot, safe))}`,
          ),
        );
      } else if (options.requireStandaloneLicenseEvidence) {
        throw new Error(`Missing standalone license evidence: ${key}`);
      } else {
        component.evidence.push(
          await evidence(manifestPath, allowedRoot, `${location}/package.json`),
        );
        warnings.push(
          `${key}: no standalone license text was present; the package manifest supplies the license declaration.`,
        );
      }
    }
    const instance = { directory: safe, metadata, component };
    packages.set(safe, instance);
    components.push(component);
    edges.set(component.ref, new Set());
    return instance;
  }

  // Scan the final payload, including nested/pnpm instances; no source dev package traversal.
  for (const file of files) {
    if (
      path.basename(file) === 'package.json' &&
      slash(path.relative(stagingRoot, file)).includes('node_modules/')
    ) {
      // Embedded fixture/package metadata is not a separately installed package.
      const directory = path.dirname(file);
      const parent = path.basename(path.dirname(directory));
      if (
        parent === 'node_modules' ||
        (parent.startsWith('@') &&
          path.basename(path.dirname(path.dirname(directory))) ===
            'node_modules')
      )
        await addPackage(directory, 'staged-package');
    }
  }
  async function inputPackage(input: string): Promise<void> {
    const inputPath = path.resolve(packageRoot, input);
    if (!slash(inputPath).includes('/node_modules/')) return;
    let directory = path.dirname(
      await confined(inputPath, packageRoot, suppliedPackageRoot),
    );
    while (isInside(packageRoot, directory) && directory !== packageRoot) {
      const manifest = path.join(directory, 'package.json');
      const parent = path.basename(path.dirname(directory));
      if (
        parent === 'node_modules' ||
        (parent.startsWith('@') &&
          path.basename(path.dirname(path.dirname(directory))) ===
            'node_modules')
      ) {
        if (!(await exists(manifest)))
          throw new Error(
            `Missing package metadata for bundle input: ${input}`,
          );
        await addPackage(directory, 'bundled-package');
        return;
      }
      directory = path.dirname(directory);
    }
    throw new Error(`Missing package metadata for bundle input: ${input}`);
  }
  if (options.rendererMetafile) {
    for (const input of Object.keys(options.rendererMetafile.inputs).sort())
      await inputPackage(input);
  } else
    warnings.push(
      'No bundle-input manifest supplied: renderer and bundled JavaScript package coverage is incomplete.',
    );

  async function resolveDependency(
    instance: PackageInstance,
    name: string,
  ): Promise<string | undefined> {
    if (!/^(@[^/\\]+\/)?[^/\\.][^/\\]*$/.test(name) || name.includes('..'))
      throw new Error(`Invalid dependency name: ${name}`);
    const allowedRoot =
      instance.component.origin === 'staged-package'
        ? stagingRoot
        : packageRoot;
    let directory = instance.directory;
    while (isInside(allowedRoot, directory)) {
      const candidate = path.join(directory, 'node_modules', name);
      if (await exists(candidate)) {
        const safe = await confined(candidate, allowedRoot);
        return packages.get(safe)?.component.ref;
      }
      if (directory === allowedRoot) break;
      directory = path.dirname(directory);
    }
    return undefined;
  }
  for (const instance of packages.values()) {
    const { metadata, component } = instance;
    const required = metadata.dependencies ?? {};
    const optional = metadata.optionalDependencies ?? {};
    const dependencies = {
      ...required,
      ...optional,
      ...metadata.peerDependencies,
    };
    for (const name of Object.keys(dependencies).sort()) {
      const ref = await resolveDependency(instance, name);
      if (ref) edges.get(component.ref)!.add(ref);
      else if (
        component.origin === 'staged-package' &&
        name in required &&
        !(name in optional)
      ) {
        throw new Error(
          `Missing staged dependency ${name} of ${component.name}@${component.version}`,
        );
      }
    }
  }

  const electronLicense = path.join(stagingRoot, 'LICENSE');
  const chromiumLicense = path.join(stagingRoot, 'LICENSES.chromium.html');
  const electron: InventoryComponent = {
    ref: `pkg:generic/electron@${options.electronVersion}`,
    name: 'Electron',
    version: options.electronVersion,
    kind: 'application',
    origin: 'runtime',
    location: 'payload/',
    declaredLicense: null,
    evidence: [
      await evidence(electronLicense, stagingRoot, 'payload/LICENSE'),
      await evidence(
        chromiumLicense,
        stagingRoot,
        'payload/LICENSES.chromium.html',
      ),
    ],
  };
  const electronVersionPath = path.join(stagingRoot, 'version');
  if (await exists(electronVersionPath)) {
    if (
      (await readFile(await confined(electronVersionPath, stagingRoot), 'utf8'))
        .trim()
        .replace(/^v/, '') !== options.electronVersion
    )
      throw new Error(
        'Staged Electron version differs from the release version.',
      );
  }
  components.push(electron);
  const nodeExecutable = path.join(
    nodeRoot,
    process.platform === 'win32' ? 'node.exe' : 'node',
  );
  await confined(nodeExecutable, stagingRoot);
  const nodeOutput = await promisify(execFile)(nodeExecutable, ['--version'], {
    timeout: 10_000,
    windowsHide: true,
  });
  const nodeVersion = nodeOutput.stdout.trim().replace(/^v/, '');
  if (!/^24\.\d+\.\d+$/.test(nodeVersion))
    throw new Error('The shipped Node runtime must be Node 24.');
  components.push({
    ref: `pkg:generic/node@${nodeVersion}`,
    name: 'Node.js',
    version: nodeVersion,
    kind: 'application',
    origin: 'runtime',
    location: `payload/${slash(path.relative(stagingRoot, nodeRoot))}`,
    declaredLicense: null,
    evidence: [
      await evidence(
        path.join(nodeRoot, 'LICENSE'),
        stagingRoot,
        'runtime/node/LICENSE',
      ),
    ],
  });

  const fonts = files.filter((file) =>
    /^PlysmithChess.*\.woff2$/i.test(path.basename(file)),
  );
  if (fonts.length > 0) {
    const source = path.join(packageRoot, 'assets/fonts/plysmith-chess/source');
    const metadata = JSON.parse(
      await readFile(
        await confined(path.join(source, 'src/font.json'), packageRoot),
        'utf8',
      ),
    ) as { family: string; version: string; license: string };
    if (!metadata.family || !metadata.version || !metadata.license)
      throw new Error('Missing chess font identity/license metadata.');
    components.push({
      ref: `pkg:generic/plysmith-chess@${metadata.version}`,
      name: metadata.family,
      version: metadata.version,
      kind: 'file',
      origin: 'asset',
      location: `payload/${slash(path.relative(stagingRoot, fonts[0]!))}`,
      declaredLicense: metadata.license,
      evidence: [
        await evidence(
          path.join(source, 'OFL.txt'),
          packageRoot,
          'assets/fonts/plysmith-chess/source/OFL.txt',
        ),
      ],
    });
  }
  for (const instance of packages.values()) {
    if (instance.metadata.name !== 'better-sqlite3') continue;
    const header = path.join(instance.directory, 'deps/sqlite3/sqlite3.h');
    const root =
      instance.component.origin === 'staged-package'
        ? stagingRoot
        : packageRoot;
    if (!(await exists(header))) {
      warnings.push(
        `${instance.component.ref}: embedded SQLite source/version evidence is absent; wrapper identity does not identify the embedded SQLite release.`,
      );
      continue;
    }
    const content = await readFile(await confined(header, root), 'utf8');
    const version = /^#define SQLITE_VERSION\s+"([^"]+)"/m.exec(content)?.[1];
    if (!version) throw new Error('SQLite header has no version declaration.');
    const ref = `pkg:generic/sqlite@${version}#${digest(instance.component.location).slice(0, 12)}`;
    components.push({
      ref,
      name: 'SQLite',
      version,
      kind: 'library',
      origin: 'runtime',
      location: `${instance.component.location}/deps/sqlite3/sqlite3.h`,
      declaredLicense: null,
      evidence: [
        await evidence(
          header,
          root,
          `${instance.component.location}/deps/sqlite3/sqlite3.h`,
        ),
      ],
    });
    edges.get(instance.component.ref)!.add(ref);
    warnings.push(
      `${ref}: version comes from the package's shipped source header; binary/source equivalence is not independently attested.`,
    );
  }
  components.sort((a, b) => a.ref.localeCompare(b.ref));
  const rootRef = `pkg:generic/plysmith@${encodeURIComponent(options.productVersion)}`;
  const dependencies = [
    { ref: rootRef, dependsOn: components.map((component) => component.ref) },
    ...components.map((component) => ({
      ref: component.ref,
      dependsOn: [...(edges.get(component.ref) ?? [])].sort(),
    })),
  ];
  const versions = new Map<string, Set<string>>();
  for (const component of components.filter((item) => item.purl)) {
    const known = versions.get(component.name) ?? new Set<string>();
    known.add(component.version);
    versions.set(component.name, known);
  }
  const duplicateVersions = [...versions]
    .filter(([, values]) => values.size > 1)
    .map(([name, values]) => ({ name, versions: [...values].sort() }));
  const inventory = {
    product: {
      name: 'Plysmith',
      version: options.productVersion,
      buildRevision: options.buildRevision,
    },
    coverage: {
      aggregate: 'incomplete',
      warnings,
      bundleInputsProvided: !!options.rendererMetafile,
    },
    components,
    duplicateVersions,
    dependencies,
  };
  const sbom = {
    $schema: 'http://cyclonedx.org/schema/bom-1.6.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        'bom-ref': rootRef,
        name: 'Plysmith',
        version: options.productVersion,
      },
      properties: [
        { name: 'plysmith:build-revision', value: options.buildRevision },
        ...warnings.map((value) => ({ name: 'plysmith:coverage-note', value })),
      ],
    },
    components: components.map((component) => ({
      type: component.kind,
      'bom-ref': component.ref,
      name: component.name,
      version: component.version,
      ...(component.purl ? { purl: component.purl } : {}),
      ...(component.declaredLicense
        ? { licenses: [{ license: { name: component.declaredLicense } }] }
        : {}),
      properties: [
        { name: 'plysmith:origin', value: component.origin },
        { name: 'plysmith:location', value: component.location },
        ...(component.manifestSha256
          ? [
              {
                name: 'plysmith:package-json-sha256',
                value: component.manifestSha256,
              },
            ]
          : []),
        ...component.evidence.map((item) => ({
          name: 'plysmith:license-evidence',
          value: `${item.file} (SHA-256 ${item.sha256}; source ${item.source})`,
        })),
      ],
    })),
    dependencies,
    compositions: [{ aggregate: 'incomplete', assemblies: [rootRef] }],
  };
  const notices = [
    `Plysmith ${options.productVersion} - shipped component notices`,
    `Build: ${options.buildRevision}`,
    '',
    ...warnings,
    '',
    ...components.flatMap((component) => [
      `${component.name} ${component.version}`,
      `Included as: ${component.origin}; ${component.location}`,
      `Declared license: ${component.declaredLicense ?? 'See bundled authoritative license text (not inferred)'}`,
      ...component.evidence.map(
        (item) =>
          `License evidence: ${item.file}\nSource: ${item.source}\nSHA-256: ${item.sha256}`,
      ),
      '',
    ]),
  ].join('\n');
  if (options.cycloneDxSchemas)
    validateReleaseInventorySchema(sbom, options.cycloneDxSchemas);
  // All validation precedes output: failed inventory creation cannot publish partial reports.
  if (await exists(path.join(stagingRoot, 'licenses')))
    await confined(path.join(stagingRoot, 'licenses'), stagingRoot);
  await mkdir(path.join(stagingRoot, 'licenses'), { recursive: true });
  for (const [relative, bytes] of evidenceContents) {
    const output = path.join(stagingRoot, relative);
    if (await exists(output)) await confined(output, stagingRoot);
    await writeFile(output, bytes);
  }
  const outputs = {
    sbom: path.join(stagingRoot, outputNames.sbom),
    inventory: path.join(stagingRoot, outputNames.inventory),
    notices: path.join(stagingRoot, outputNames.notices),
  };
  for (const [key, output] of Object.entries(outputs)) {
    if (await exists(output)) await confined(output, stagingRoot);
    await writeFile(
      output,
      key === 'notices'
        ? notices
        : `${JSON.stringify(key === 'sbom' ? sbom : inventory, null, 2)}\n`,
      'utf8',
    );
  }
  return {
    ...outputs,
    components: components.length,
    warnings,
    duplicateVersions,
  };
}
