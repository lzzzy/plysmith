export type RuntimeState =
  'starting' | 'ready' | 'degraded' | 'startup_blocked' | 'shutting_down';

export interface StoreStatus {
  readonly schemaVersion: number;
  readonly dataRevision: number;
}

export interface SystemStatus {
  readonly state: RuntimeState;
  readonly persistence: StoreStatus;
}

export interface RuntimeStatusReader {
  getState(): RuntimeState;
}

export interface StoreStatusReader {
  readStoreStatus(): Promise<StoreStatus>;
}
