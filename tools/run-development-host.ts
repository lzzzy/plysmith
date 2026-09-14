import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  acquireDevelopmentWatchLease,
  HostLifecycleProblem,
} from '../app/infrastructure/adapters/platform/windows/index.ts';

export async function runDevelopmentHost(
  applicationHome: string,
): Promise<number> {
  const resolvedHome = path.resolve(applicationHome);
  const lease = await acquireDevelopmentWatchLease(resolvedHome);
  try {
    return await runWatchProcess(resolvedHome);
  } finally {
    await lease.release();
  }
}

function runWatchProcess(applicationHome: string): Promise<number> {
  const child = spawn(
    process.execPath,
    developmentHostArguments(applicationHome),
    {
      cwd: applicationHome,
      stdio: 'inherit',
    },
  );

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal === 'SIGINT' || signal === 'SIGTERM') resolve(0);
      else resolve(code ?? 1);
    });
  });
}

export function developmentHostArguments(
  applicationHome: string,
): readonly string[] {
  const hostEntryPoint = path.join(
    applicationHome,
    'app',
    'bootstrap',
    'host',
    'main.ts',
  );
  const watchRoots = ['app', 'contracts'].map((directory) =>
    path.join(applicationHome, directory),
  );
  return [
    '--watch',
    ...watchRoots.map((watchRoot) => `--watch-path=${watchRoot}`),
    '--enable-source-maps',
    hostEntryPoint,
  ];
}

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    throw new Error('Usage: pnpm dev:host');
  }
  process.exitCode = await runDevelopmentHost(process.cwd());
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
        ? 'Plysmith development host is already running.'
        : error instanceof Error
          ? error.message
          : 'Plysmith development host could not start.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
