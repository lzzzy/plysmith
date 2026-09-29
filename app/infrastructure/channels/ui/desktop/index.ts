export { registerPlysmithScheme } from './app-protocol.ts';
export { createDesktopWindow } from './create-desktop-window.ts';
export { createStartupWindow } from './create-startup-window.ts';
export { configureElectronProfile } from './electron-profile.ts';
export {
  DesktopHostConnectionMonitor,
  type DesktopHostConnectionMonitorOptions,
  type DiscoverDesktopHost,
  type ValidateDesktopHost,
} from './desktop-host-connection.ts';
export {
  desktopBootstrapChannel,
  desktopDiagnosticReportDestinationChannel,
  desktopDiagnosticsChannel,
  parseDiagnosticReportSuggestedFileName,
  parseRendererDiagnosticEvent,
  type DesktopBootstrap,
  type PlysmithDesktopApi,
  type RendererDiagnosticEvent,
} from './contract.ts';
