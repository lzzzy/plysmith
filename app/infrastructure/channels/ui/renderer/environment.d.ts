import type { PlysmithDesktopApi } from '../desktop/contract.ts';

declare global {
  interface Window {
    readonly plysmithDesktop: PlysmithDesktopApi;
  }
}

export {};
