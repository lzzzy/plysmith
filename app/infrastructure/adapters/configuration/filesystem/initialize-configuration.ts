import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { Value } from '@sinclair/typebox/value';

import {
  EngineProviderConfigurationDocumentSchema,
  LichessProviderConfigurationSchema,
  PlysmithConfigurationSchema,
  SqliteProviderConfigurationSchema,
  validateMinimalConfigurationSet,
} from './configuration-schema.ts';
import { LICHESS_PROVIDER_INSTANCE_ID } from '../../../../../contracts/host/live-provider-configuration.ts';
import { parseLichessEnvironment } from './lichess-secret.ts';

export interface InitializeConfigurationOptions {
  applicationHome: string;
  defaultsDirectory: string;
}

export type InitializeConfigurationResult =
  | { status: 'initialized'; activeDirectory: string }
  | { status: 'already-initialized'; activeDirectory: string };

export async function initializeConfiguration(
  options: InitializeConfigurationOptions,
): Promise<InitializeConfigurationResult> {
  if (
    !path.isAbsolute(options.applicationHome) ||
    !path.isAbsolute(options.defaultsDirectory)
  ) {
    throw new Error('Configuration paths must be absolute.');
  }
  const configurationDirectory = path.join(
    path.resolve(options.applicationHome),
    'configuration',
  );
  const activeDirectory = path.join(configurationDirectory, 'active');
  const envPath = path.join(path.resolve(options.applicationHome), '.env');

  await assertSafeDirectory(activeDirectory);
  await assertSafeFile(envPath);
  const exists = await pathExists(activeDirectory);
  if (
    exists &&
    (await activeSetIsValid(activeDirectory, envPath, options.applicationHome))
  ) {
    // The host owner lease excludes live writers; validate the entire set first.
    const names = await assertActiveFiles(activeDirectory);
    for (const name of names) {
      if (isInterruptedWriteFile(name))
        await rm(path.join(activeDirectory, name));
    }
    return { status: 'already-initialized', activeDirectory };
  }

  const candidate = await readAndValidateDefaults(options.defaultsDirectory);
  assertDatabaseOutsideRemovalTargets(
    candidate.sqliteMain,
    activeDirectory,
    envPath,
    options.applicationHome,
  );
  const defaultsPath = await realpath(options.defaultsDirectory);
  if (
    isWithin(activeDirectory, defaultsPath) ||
    isWithin(defaultsPath, activeDirectory)
  ) {
    throw new Error('Defaults and active configuration must not overlap.');
  }
  await mkdir(configurationDirectory, { recursive: true });

  const stagingDirectory = path.join(
    configurationDirectory,
    `.staging-${process.pid}-${randomUUID()}`,
  );

  await mkdir(stagingDirectory, { recursive: false });

  try {
    await Promise.all([
      writeJsonFile(
        path.join(stagingDirectory, 'plysmith.json'),
        candidate.plysmith,
      ),
      writeJsonFile(
        path.join(stagingDirectory, 'sqlite-main.json'),
        candidate.sqliteMain,
      ),
    ]);

    // composeHost holds the exclusive owner lease across validation and publication.
    await assertSafeDirectory(activeDirectory);
    await assertSafeFile(envPath);
    if (exists) {
      await assertActiveFiles(activeDirectory);
      await rm(activeDirectory, { recursive: true });
    }
    await rm(envPath, { force: true });
    try {
      await rename(stagingDirectory, activeDirectory);
    } catch (error) {
      if (
        !exists &&
        (await pathExists(activeDirectory)) &&
        (await activeSetIsValid(
          activeDirectory,
          envPath,
          options.applicationHome,
        ))
      ) {
        await removeStaging(stagingDirectory);
        return { status: 'already-initialized', activeDirectory };
      }

      throw error;
    }

    return { status: 'initialized', activeDirectory };
  } catch (error) {
    await removeStaging(stagingDirectory);
    throw error;
  }
}

async function readAndValidateDefaults(defaultsDirectory: string): Promise<{
  plysmith: unknown;
  sqliteMain: unknown;
}> {
  const [plysmithText, sqliteMainText] = await Promise.all([
    readFile(path.join(defaultsDirectory, 'plysmith.json'), 'utf8'),
    readFile(path.join(defaultsDirectory, 'sqlite-main.json'), 'utf8'),
  ]);

  const candidate: unknown = {
    plysmith: JSON.parse(plysmithText),
    sqliteMain: JSON.parse(sqliteMainText),
  };

  if (!validateMinimalConfigurationSet(candidate)) {
    throw new Error('The default configuration set is invalid.');
  }

  if (
    candidate.plysmith.bindings.analysisEngines.length > 0 ||
    candidate.plysmith.bindings.playoutEngines.length > 0 ||
    candidate.plysmith.bindings.liveProviders.length > 0 ||
    !managedDatabasePath(
      candidate.sqliteMain.sqlite.databasePath,
      path.resolve(defaultsDirectory),
    )
  ) {
    throw new Error('The default configuration set is not minimal.');
  }

  return candidate;
}

async function activeSetIsValid(
  activeDirectory: string,
  envPath: string,
  home: string,
): Promise<boolean> {
  const names = await assertActiveFiles(activeDirectory);
  const documents = new Map<string, unknown>();
  for (const name of names) {
    if (isInterruptedWriteFile(name)) continue;
    const source = await readFile(path.join(activeDirectory, name), 'utf8');
    let document: unknown;
    try {
      document = JSON.parse(source);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    documents.set(name, document);
  }
  let valid = !names.includes('.live-settings.lock');
  for (const [name, document] of documents) {
    assertDatabaseOutsideRemovalTargets(
      document,
      activeDirectory,
      envPath,
      home,
    );
    if (name === 'plysmith.json') continue;
    if (!/^[a-z0-9][a-z0-9-]*\.json$/u.test(name)) valid = false;
    if (Value.Check(SqliteProviderConfigurationSchema, document)) {
      const database = managedDatabasePath(document.sqlite.databasePath, home);
      valid = Boolean(database) && valid;
    } else if (
      Value.Check(EngineProviderConfigurationDocumentSchema, document)
    ) {
      const paths =
        document.provider === 'stockfish-uci'
          ? [document.stockfish.executablePath]
          : [document.maia.executablePath, document.maia.weightsPath];
      for (const enginePath of paths) {
        valid = (await availableFile(enginePath)) && valid;
      }
    } else if (Value.Check(LichessProviderConfigurationSchema, document)) {
      if (name !== `${LICHESS_PROVIDER_INSTANCE_ID}.json`) valid = false;
    } else {
      valid = false;
    }
  }
  const central = documents.get('plysmith.json');
  if (!Value.Check(PlysmithConfigurationSchema, central)) return false;
  const persistence = documents.get(`${central.bindings.persistence}.json`);
  if (
    !Value.Check(SqliteProviderConfigurationSchema, persistence) ||
    !persistence.enabled
  )
    valid = false;
  for (const id of [
    ...central.bindings.analysisEngines,
    ...central.bindings.playoutEngines,
  ]) {
    if (
      !Value.Check(
        EngineProviderConfigurationDocumentSchema,
        documents.get(`${id}.json`),
      )
    )
      valid = false;
  }
  for (const id of central.bindings.liveProviders) {
    if (
      id !== LICHESS_PROVIDER_INSTANCE_ID ||
      !Value.Check(
        LichessProviderConfigurationSchema,
        documents.get(`${id}.json`),
      )
    )
      valid = false;
  }
  if (await pathExists(envPath)) {
    const source = await readFile(envPath, 'utf8');
    if (parseLichessEnvironment(source) === undefined) valid = false;
  }
  return valid;
}

function assertDatabaseOutsideRemovalTargets(
  document: unknown,
  active: string,
  env: string,
  home: string,
): void {
  if (
    typeof document !== 'object' ||
    document === null ||
    !('sqlite' in document)
  )
    return;
  const sqlite = document.sqlite;
  if (
    typeof sqlite !== 'object' ||
    sqlite === null ||
    !('databasePath' in sqlite) ||
    typeof sqlite.databasePath !== 'string'
  )
    return;
  const database = path.resolve(home, sqlite.databasePath);
  if (isWithin(active, database) || path.relative(env, database) === '') {
    throw new Error('Configuration recovery cannot remove a database path.');
  }
}

async function removeStaging(directory: string): Promise<void> {
  await assertSafeDirectory(directory);
  if (await pathExists(directory)) {
    await assertActiveFiles(directory);
    await rm(directory, { recursive: true });
  }
}

function managedDatabasePath(
  configured: string,
  home: string,
): string | undefined {
  if (path.isAbsolute(configured)) return undefined;
  const resolved = path.resolve(home, configured);
  return resolved !== path.resolve(home) &&
    isWithin(path.resolve(home), resolved)
    ? resolved
    : undefined;
}

function isWithin(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function availableFile(filePath: string): Promise<boolean> {
  if (!path.isAbsolute(filePath)) return false;
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    )
      return false;
    throw error;
  }
}

async function assertSafeDirectory(directory: string): Promise<void> {
  const parent = path.dirname(directory);
  if (parent !== directory) await assertSafeDirectory(parent);
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error('Unsafe configuration directory.');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
}

async function assertSafeFile(filePath: string): Promise<void> {
  await assertSafeDirectory(path.dirname(filePath));
  try {
    const info = await lstat(filePath);
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1)
      throw new Error('Unsafe configuration file.');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
}

async function assertActiveFiles(activeDirectory: string): Promise<string[]> {
  const names = await readdir(activeDirectory);
  for (const name of names) {
    if (!name.endsWith('.json') && !isInterruptedWriteFile(name))
      throw new Error('Unexpected file in active configuration.');
    await assertSafeFile(path.join(activeDirectory, name));
  }
  return names;
}

function isInterruptedWriteFile(name: string): boolean {
  return (
    name === '.engine-settings.lock' ||
    name === '.live-settings.lock' ||
    /^\.(?:plysmith|[a-z0-9][a-z0-9-]*\.json)-[1-9]\d*-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/u.test(
      name,
    )
  );
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
}

async function pathExists(candidatePath: string): Promise<boolean> {
  try {
    await stat(candidatePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
