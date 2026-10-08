import { app, dialog, protocol, type BrowserWindow } from 'electron';

import {
  configureElectronProfile,
  registerPlysmithScheme,
  createStartupWindow,
} from '../../infrastructure/channels/ui/desktop/index.ts';
import {
  resolveWindowsApplicationHome,
  startProductionHost,
  verifyProductManifest,
  type OwnedProductionHost,
  ProductionHostStartupProblem,
} from '../../infrastructure/adapters/platform/windows/index.ts';
import { composeDesktop, type DesktopRuntime } from './composition-root.ts';
import { parseDesktopPaths, selectDesktopArguments } from './desktop-paths.ts';

export async function runDesktop(arguments_: readonly string[]): Promise<void> {
  const paths = parseDesktopPaths(arguments_);
  const packagedPaths = app.isPackaged
    ? {
        applicationHome: arguments_.includes('--application-home')
          ? paths.applicationHome
          : await resolveWindowsApplicationHome(),
        installRoot: process.resourcesPath,
      }
    : paths;
  await configureElectronProfile(app, packagedPaths.applicationHome);
  let activeWindow: BrowserWindow | undefined;
  if (app.isPackaged && !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  if (app.isPackaged) {
    app.on('second-instance', () => {
      if (activeWindow === undefined || activeWindow.isDestroyed()) return;
      if (activeWindow.isMinimized()) activeWindow.restore();
      activeWindow.focus();
    });
  }
  await app.whenReady();
  const startupWindow = app.isPackaged
    ? createStartupWindow(app.getLocale())
    : undefined;
  activeWindow = startupWindow;
  let ownedHost: OwnedProductionHost | undefined;
  try {
    if (app.isPackaged) {
      await verifyProductManifest(
        packagedPaths.installRoot,
        process.versions.electron ?? '',
      );
      ownedHost = await startProductionHost(packagedPaths);
    }
    const runtime = await composeDesktop({
      ...packagedPaths,
      ...(startupWindow === undefined ? {} : { startupWindow }),
    });
    activeWindow = runtime.window;
    installDesktopLifecycle(runtime, ownedHost);
  } catch (error) {
    startupWindow?.destroy();
    await ownedHost?.close();
    throw error;
  }
}

function installDesktopLifecycle(
  runtime: DesktopRuntime,
  ownedHost?: OwnedProductionHost,
): void {
  let shuttingDown = false;
  let readyToQuit = false;
  app.on('before-quit', (event) => {
    if (readyToQuit) return;
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    runtime.close();
    void (async () => {
      try {
        await ownedHost?.close();
      } catch {
        process.exitCode = 1;
      } finally {
        readyToQuit = true;
        app.quit();
      }
    })();
  });
  app.once('window-all-closed', () => app.quit());
  process.once('SIGINT', () => app.quit());
  process.once('SIGTERM', () => app.quit());
}

registerPlysmithScheme(protocol);
runDesktop(selectDesktopArguments(process.argv)).catch((error: unknown) => {
  if (app.isPackaged) {
    const reason =
      error instanceof ProductionHostStartupProblem
        ? {
            already_running:
              'Ein anderer Host verwendet bereits diesen Datenbestand.',
            incompatible_data:
              'Der vorhandene Datenbestand ist mit dieser Version nicht kompatibel. Er wurde nicht veraendert.',
            invalid_configuration: 'Die lokale Konfiguration ist ungueltig.',
            startup_failed: 'Der lokale Host konnte nicht gestartet werden.',
            timeout: 'Der lokale Host hat nicht rechtzeitig geantwortet.',
          }[error.code]
        : 'Die Installation konnte nicht geprueft oder gestartet werden.';
    dialog.showErrorBox(
      'Plysmith konnte nicht starten',
      `${reason}\n\nBitte melden Sie den Fehler mit einem Screenshot ueber GitHub Issues.`,
    );
  }
  console.error(
    'Plysmith Desktop could not start. Keep the Application Host running and check application-home.',
  );
  app.quit();
  process.exitCode = 1;
});
