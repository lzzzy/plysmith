import { contextBridge, ipcRenderer } from 'electron';

import {
  desktopBootstrapChannel,
  desktopDiagnosticsChannel,
  type DesktopBootstrap,
  type PlysmithDesktopApi,
  type RendererDiagnosticEvent,
} from './contract.ts';

const api: PlysmithDesktopApi = Object.freeze({
  async getBootstrap(): Promise<DesktopBootstrap> {
    const bootstrap = await ipcRenderer.invoke(desktopBootstrapChannel);
    return freezeBootstrap(bootstrap as DesktopBootstrap);
  },
  recordDiagnostic(event: RendererDiagnosticEvent): void {
    ipcRenderer.send(desktopDiagnosticsChannel, event);
  },
});

contextBridge.exposeInMainWorld('plysmithDesktop', api);

function freezeBootstrap(bootstrap: DesktopBootstrap): DesktopBootstrap {
  if (bootstrap.kind === 'unavailable') {
    return Object.freeze({ ...bootstrap });
  }
  return Object.freeze({
    ...bootstrap,
    connection: Object.freeze({ ...bootstrap.connection }),
  });
}
