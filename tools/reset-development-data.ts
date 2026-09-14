import { lstat, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  acquireDevelopmentWatchLease,
  acquireHostOwnerLease,
  HostLifecycleProblem,
  type DevelopmentWatchLease,
  type HostOwnerLease,
} from '../app/infrastructure/adapters/platform/windows/index.ts';

const databaseFiles = ['plysmith.db', 'plysmith.db-wal', 'plysmith.db-shm'];

interface ResetDevelopmentDataOptions {
  readonly applicationHome: string;
  readonly acquireWatchLease?: (
    applicationHome: string,
  ) => Promise<Pick<DevelopmentWatchLease, 'release'>>;
  readonly acquireHostLease?: (
    applicationHome: string,
  ) => Promise<Pick<HostOwnerLease, 'release'>>;
}

export async function resetDevelopmentData(
  options: ResetDevelopmentDataOptions,
): Promise<readonly string[]> {
  const applicationHome = path.resolve(options.applicationHome);
  await requirePlysmithDevelopmentHome(applicationHome);
  const dataDirectory = path.join(applicationHome, 'data');
  await rejectLinkedDataDirectory(dataDirectory);

  const watchLease = await (
    options.acquireWatchLease ?? acquireDevelopmentWatchLease
  )(applicationHome);
  let hostLease: Pick<HostOwnerLease, 'release'> | undefined;
  const removed: string[] = [];
  try {
    hostLease = await (options.acquireHostLease ?? acquireHostOwnerLease)(
      applicationHome,
    );
    for (const fileName of databaseFiles) {
      const target = path.join(dataDirectory, fileName);
      if (path.dirname(target) !== dataDirectory) {
        throw new Error(
          'Development database path escaped its data directory.',
        );
      }
      try {
        await unlink(target);
        removed.push(path.relative(applicationHome, target));
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
  } finally {
    await hostLease?.release();
    await watchLease.release();
  }
  return Object.freeze(removed);
}

async function requirePlysmithDevelopmentHome(
  applicationHome: string,
): Promise<void> {
  const manifestPath = path.join(applicationHome, 'package.json');
  const defaultsPath = path.join(
    applicationHome,
    'configuration',
    'defaults',
    'plysmith.json',
  );
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await readFile(defaultsPath, 'utf8');
  } catch {
    throw new Error(
      'Development reset must run from the Plysmith repository root.',
    );
  }
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('name' in manifest) ||
    manifest.name !== 'plysmith' ||
    !('private' in manifest) ||
    manifest.private !== true
  ) {
    throw new Error(
      'Development reset must run from the Plysmith repository root.',
    );
  }
}

async function rejectLinkedDataDirectory(dataDirectory: string): Promise<void> {
  try {
    const metadata = await lstat(dataDirectory);
    if (metadata.isSymbolicLink()) {
      throw new Error('Development reset refuses a linked data directory.');
    }
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    throw new Error('Usage: pnpm dev:reset');
  }
  const removed = await resetDevelopmentData({
    applicationHome: process.cwd(),
  });
  const detail =
    removed.length === 0
      ? 'No development database files existed.'
      : `Removed ${removed.join(', ')}.`;
  process.stdout.write(
    `Plysmith development data reset. ${detail} Configuration and .env were kept.\n`,
  );
}

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(entryPoint)).href
) {
  main().catch((error: unknown) => {
    const message =
      error instanceof HostLifecycleProblem &&
      error.code === 'host.already_running'
        ? 'Development reset refused: stop pnpm dev:host and run pnpm dev:reset again.'
        : error instanceof Error
          ? error.message
          : 'Development reset failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
