import path from 'node:path';

import type { BrowserWindow } from 'electron';

import { readHostDiscovery } from '../../infrastructure/adapters/platform/windows/index.ts';
import {
  createDesktopWindow,
  DesktopHostConnectionMonitor,
} from '../../infrastructure/channels/ui/desktop/index.ts';

export interface ComposeDesktopOptions {
  readonly applicationHome: string;
  readonly installRoot: string;
}

export interface DesktopRuntime {
  readonly window: BrowserWindow;
  close(): void;
}

export async function composeDesktop(
  options: ComposeDesktopOptions,
): Promise<DesktopRuntime> {
  const hostConnections = new DesktopHostConnectionMonitor({
    discover: () => readHostDiscovery(options.applicationHome),
  });
  await hostConnections.start();

  try {
    const window = await createDesktopWindow({
      assetsRoot: path.join(
        options.installRoot,
        'build',
        'desktop',
        'renderer',
      ),
      preloadPath: path.join(
        options.installRoot,
        'build',
        'desktop',
        'preload.cjs',
      ),
      hostConnections,
    });
    return Object.freeze({
      window,
      close(): void {
        hostConnections.close();
        if (!window.isDestroyed()) {
          window.destroy();
        }
      },
    });
  } catch (error) {
    hostConnections.close();
    throw error;
  }
}
