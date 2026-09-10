import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { validateMinimalConfigurationSet } from './configuration-schema.ts';

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
  const configurationDirectory = path.join(
    options.applicationHome,
    'configuration',
  );
  const activeDirectory = path.join(configurationDirectory, 'active');

  if (await pathExists(activeDirectory)) {
    return { status: 'already-initialized', activeDirectory };
  }

  await mkdir(configurationDirectory, { recursive: true });

  const stagingDirectory = path.join(
    configurationDirectory,
    `.staging-${process.pid}-${randomUUID()}`,
  );

  await mkdir(stagingDirectory, { recursive: false });

  try {
    const candidate = await readAndValidateDefaults(options.defaultsDirectory);

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

    try {
      await rename(stagingDirectory, activeDirectory);
    } catch (error) {
      if (await pathExists(activeDirectory)) {
        await rm(stagingDirectory, { recursive: true, force: true });
        return { status: 'already-initialized', activeDirectory };
      }

      throw error;
    }

    return { status: 'initialized', activeDirectory };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
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

  return candidate;
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
