import path from 'node:path';

import {
  BrowserWindow,
  ipcMain,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';

import type { DiagnosticSink } from '../../../../../contracts/diagnostics/index.ts';
import {
  desktopBootstrapChannel,
  desktopDiagnosticsChannel,
  parseRendererDiagnosticEvent,
  type DesktopBootstrap,
} from './contract.ts';
import { handleAppRequest, isPlysmithRendererUrl } from './app-protocol.ts';
import type { DesktopHostConnectionMonitor } from './desktop-host-connection.ts';

export interface CreateDesktopWindowOptions {
  readonly assetsRoot: string;
  readonly preloadPath: string;
  readonly hostConnections: DesktopHostConnectionMonitor;
  readonly diagnostics: DiagnosticSink;
}

export async function createDesktopWindow(
  options: CreateDesktopWindowOptions,
): Promise<BrowserWindow> {
  const { hostConnections } = options;
  await session.defaultSession.protocol.handle('app', (request) =>
    handleAppRequest(request, options.assetsRoot, () =>
      hostConnections.getSnapshot(),
    ),
  );

  const window = new BrowserWindow({
    width: 1_100,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#f5f6f8',
    autoHideMenuBar: true,
    show: true,
    title: 'Plysmith',
    icon: path.join(options.assetsRoot, 'branding', 'plysmith-icon-black.ico'),
    webPreferences: {
      preload: path.resolve(options.preloadPath),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  const bootstrapHandler = (event: IpcMainInvokeEvent): DesktopBootstrap => {
    const senderFrame = event.senderFrame;
    if (!isTrustedRendererSender(event, window) || senderFrame === null) {
      return Object.freeze({ kind: 'unavailable', generation: 0 });
    }

    const expectedGeneration = Number(
      new URL(senderFrame.url).searchParams.get('generation'),
    );
    const snapshot = hostConnections.getSnapshot();
    if (
      !Number.isSafeInteger(expectedGeneration) ||
      expectedGeneration !== snapshot.generation
    ) {
      return Object.freeze({
        kind: 'unavailable',
        generation: snapshot.generation,
      });
    }
    return snapshot;
  };
  ipcMain.handle(desktopBootstrapChannel, bootstrapHandler);
  const diagnosticHandler = (event: IpcMainEvent, candidate: unknown): void => {
    if (!isTrustedRendererSender(event, window)) return;
    const diagnostic = parseRendererDiagnosticEvent(candidate);
    if (diagnostic !== undefined) options.diagnostics.write(diagnostic);
  };
  ipcMain.on(desktopDiagnosticsChannel, diagnosticHandler);

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) =>
    event.preventDefault(),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  window.webContents.session.on('will-download', (event) =>
    event.preventDefault(),
  );

  const loadSnapshot = (snapshot: DesktopBootstrap): void => {
    if (window.isDestroyed()) {
      return;
    }
    const url = new URL('app://plysmith/index.html');
    url.searchParams.set('generation', String(snapshot.generation));
    void window.loadURL(url.toString()).catch(() => {
      options.diagnostics.write({
        level: 'error',
        eventCode: 'desktop.renderer.load_failed',
        status: 'failed',
        generation: snapshot.generation,
      });
      console.error('Plysmith Desktop renderer could not load.');
    });
  };
  const unsubscribe = hostConnections.subscribe(loadSnapshot);

  window.once('closed', () => {
    unsubscribe();
    ipcMain.removeHandler(desktopBootstrapChannel);
    ipcMain.removeListener(desktopDiagnosticsChannel, diagnosticHandler);
    void session.defaultSession.protocol.unhandle('app');
  });

  loadSnapshot(hostConnections.getSnapshot());
  return window;
}

function isTrustedRendererSender(
  event: IpcMainEvent | IpcMainInvokeEvent,
  window: BrowserWindow,
): boolean {
  const senderFrame = event.senderFrame;
  return (
    senderFrame !== null &&
    event.sender === window.webContents &&
    senderFrame === window.webContents.mainFrame &&
    isPlysmithRendererUrl(senderFrame.url)
  );
}
