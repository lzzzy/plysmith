import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { composeHost } from './composition-root.ts';
import { publishHostDiscovery } from '../../infrastructure/adapters/platform/windows/index.ts';

export async function runHost(arguments_: readonly string[]): Promise<void> {
  const paths = parseHostPaths(arguments_);
  const runtime = await composeHost(paths);

  try {
    const endpoint = await runtime.host.listen({
      host: '127.0.0.1',
      port: 0,
    });
    runtime.markReady();
    await publishHostDiscovery(runtime.applicationHome, {
      ownerId: runtime.ownerId,
      pid: process.pid,
      endpoint: new URL(endpoint).toString(),
      productRelease: runtime.productRelease,
      contractFingerprint: runtime.contractFingerprint,
      token: runtime.hostToken,
    });

    const close = (): void => {
      void runtime.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
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
  runHost(process.argv.slice(2)).catch(() => {
    console.error('Plysmith Application Host could not start.');
    process.exitCode = 1;
  });
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return (
    entryPoint !== undefined &&
    path.resolve(entryPoint) === fileURLToPath(import.meta.url)
  );
}
