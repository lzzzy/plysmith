import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeHost } from './composition-root.ts';
import {
  publishHostDiscovery,
  HostLifecycleProblem,
} from '../../infrastructure/adapters/platform/windows/index.ts';
import type {
  ProductionHostStartupCode,
  ProductionHostStartupMessage,
} from '../../infrastructure/adapters/platform/windows/production-host-startup.ts';
import { ConfigurationProblem } from '../../infrastructure/adapters/configuration/filesystem/configuration-problem.ts';
import { SqlitePersistenceProblem } from '../../infrastructure/adapters/persistence/sqlite/index.ts';

export async function runHost(arguments_: readonly string[]): Promise<void> {
  const paths = parseHostPaths(arguments_);
  let disconnected = false;
  let closeRuntime: (() => void) | undefined;
  if (process.connected) {
    process.once('disconnect', () => {
      disconnected = true;
      closeRuntime?.();
    });
  }
  const runtime = await composeHost(paths);

  try {
    if (disconnected) {
      await runtime.close();
      return;
    }
    const endpoint = await runtime.host.listen({
      host: '127.0.0.1',
      port: 0,
    });
    if (disconnected) {
      await runtime.close();
      return;
    }
    runtime.markReady();
    await publishHostDiscovery(runtime.applicationHome, {
      ownerId: runtime.ownerId,
      pid: process.pid,
      endpoint: new URL(endpoint).toString(),
      productRelease: runtime.productRelease,
      contractFingerprint: runtime.contractFingerprint,
      token: runtime.hostToken,
    });
    notifyDesktop({ type: 'ready' });

    const close = (): void => {
      void runtime.close().catch(() => {
        process.exitCode = 1;
      });
    };
    closeRuntime = close;
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    if (disconnected) close();
  } catch (error) {
    await runtime.close();
    throw error;
  }
}

export function parseHostPaths(arguments_: readonly string[]): {
  applicationHome: string;
  defaultsDirectory: string;
} {
  let applicationHome = path.resolve('.');
  let installRoot = path.resolve('.');

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (
      (argument === '--application-home' || argument === '--install-root') &&
      value !== undefined
    ) {
      if (argument === '--application-home') {
        applicationHome = path.resolve(value);
      } else {
        installRoot = path.resolve(value);
      }
      index += 1;
      continue;
    }
    throw new Error(`Unsupported host argument: ${argument ?? ''}`);
  }

  return {
    applicationHome,
    defaultsDirectory: path.join(installRoot, 'configuration', 'defaults'),
  };
}

if (isMainModule()) {
  runHost(process.argv.slice(2)).catch((error: unknown) => {
    notifyDesktop({ type: 'startup_blocked', code: startupCode(error) });
    console.error(formatHostStartupFailure(error));
    process.exitCode = 1;
  });
}

function notifyDesktop(message: ProductionHostStartupMessage): void {
  if (process.connected) process.send?.(message);
}

function startupCode(error: unknown): ProductionHostStartupCode {
  if (
    error instanceof HostLifecycleProblem &&
    error.code === 'host.already_running'
  )
    return 'already_running';
  if (
    error instanceof SqlitePersistenceProblem &&
    error.problemCode === 'persistence.incompatible_store'
  )
    return 'incompatible_data';
  if (error instanceof ConfigurationProblem) return 'invalid_configuration';
  return 'startup_failed';
}

export function formatHostStartupFailure(error: unknown): string {
  return [
    'Plysmith Application Host could not start.',
    formatFailureCause(error),
  ].join('\n');
}

function formatFailureCause(error: unknown): string {
  if (!(error instanceof Error)) {
    return `Unknown startup failure: ${String(error)}`;
  }

  const description = error.stack ?? `${error.name}: ${error.message}`;
  return error.cause === undefined
    ? description
    : `${description}\nCaused by: ${formatFailureCause(error.cause)}`;
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return (
    entryPoint !== undefined &&
    path.resolve(entryPoint) === fileURLToPath(import.meta.url)
  );
}
