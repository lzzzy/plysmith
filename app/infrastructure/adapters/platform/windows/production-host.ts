import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import {
  ProductionHostStartupProblem,
  type ProductionHostStartupCode,
  type ProductionHostStartupMessage,
} from './production-host-startup.ts';

export interface OwnedProductionHost {
  readonly pid: number | undefined;
  close(): Promise<void>;
}

export async function startProductionHost(options: {
  readonly applicationHome: string;
  readonly installRoot: string;
}): Promise<OwnedProductionHost> {
  const child = spawn(
    path.join(options.installRoot, 'runtime', 'node.exe'),
    [
      path.join(options.installRoot, 'host.mjs'),
      '--application-home',
      options.applicationHome,
      '--install-root',
      options.installRoot,
    ],
    {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  child.stderr?.resume();
  try {
    await waitForStartup(child);
  } catch (error) {
    if (child.pid !== undefined) await stopOwnedHost(child);
    throw error;
  }
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    pid: child.pid,
    close(): Promise<void> {
      closePromise ??= stopOwnedHost(child);
      return closePromise;
    },
  });
}

async function stopOwnedHost(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => resolve()),
  );
  if (child.connected) child.disconnect();
  const timeout = setTimeout(() => child.kill(), 10_000);
  try {
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}

function waitForStartup(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new ProductionHostStartupProblem('timeout')),
      60_000,
    );
    const finish = (error?: Error): void => {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onMessage = (candidate: unknown): void => {
      if (!candidate || typeof candidate !== 'object') return;
      const message = candidate as Partial<ProductionHostStartupMessage>;
      if (message.type === 'ready') finish();
      if (message.type === 'startup_blocked') {
        const codes: readonly ProductionHostStartupCode[] = [
          'already_running',
          'incompatible_data',
          'invalid_configuration',
          'startup_failed',
        ];
        finish(
          new ProductionHostStartupProblem(
            codes.includes(message.code as ProductionHostStartupCode)
              ? (message.code as ProductionHostStartupCode)
              : 'startup_failed',
          ),
        );
      }
    };
    const onExit = (): void =>
      finish(new ProductionHostStartupProblem('startup_failed'));
    const onError = (): void =>
      finish(new ProductionHostStartupProblem('startup_failed'));
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}
