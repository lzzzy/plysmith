import path from 'node:path';

import type { BrowserWindow } from 'electron';

import type { DiagnosticLogLevel } from '../../../contracts/diagnostics/index.ts';
import { productRelease } from '../../../contracts/host/index.ts';
import { loadCentralConfiguration } from '../../infrastructure/adapters/configuration/filesystem/index.ts';
import { FileDiagnosticLog } from '../../infrastructure/adapters/diagnostics/filesystem/index.ts';
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
  const diagnostics = new FileDiagnosticLog({
    applicationHome: options.applicationHome,
    component: 'desktop',
    productRelease,
    level: await loadDesktopDiagnosticLevel(options.applicationHome),
  });
  diagnostics.write({
    level: 'info',
    eventCode: 'desktop.lifecycle.starting',
    status: 'starting',
  });
  const hostConnections = new DesktopHostConnectionMonitor({
    discover: () => readHostDiscovery(options.applicationHome),
    diagnostics,
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
      diagnostics,
    });
    diagnostics.write({
      level: 'info',
      eventCode: 'desktop.lifecycle.ready',
      status: 'ready',
    });
    return Object.freeze({
      window,
      close(): void {
        diagnostics.write({
          level: 'info',
          eventCode: 'desktop.lifecycle.stopping',
          status: 'stopping',
        });
        hostConnections.close();
        if (!window.isDestroyed()) {
          window.destroy();
        }
        void diagnostics.close();
      },
    });
  } catch (error) {
    diagnostics.write({
      level: 'error',
      eventCode: 'desktop.lifecycle.start_failed',
      status: 'failed',
    });
    hostConnections.close();
    await diagnostics.close();
    throw error;
  }
}

async function loadDesktopDiagnosticLevel(
  applicationHome: string,
): Promise<DiagnosticLogLevel> {
  try {
    const configuration = await loadCentralConfiguration(applicationHome);
    return configuration.diagnostics.logging.level;
  } catch {
    return 'off';
  }
}
