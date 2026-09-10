import type { HostConnection } from '../../host_client/index.ts';

export const desktopBootstrapChannel = 'plysmith:desktop-bootstrap';

export type DesktopBootstrap =
  | {
      readonly kind: 'ready';
      readonly generation: number;
      readonly connection: HostConnection;
    }
  | {
      readonly kind: 'unavailable';
      readonly generation: number;
    };

export interface PlysmithDesktopApi {
  getBootstrap(): Promise<DesktopBootstrap>;
}
