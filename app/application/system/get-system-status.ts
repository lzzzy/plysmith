import type {
  RuntimeStatusReader,
  StoreStatusReader,
  SystemStatus,
} from './system-status.ts';

export interface GetSystemStatusUseCase {
  execute(): Promise<SystemStatus>;
}

export class GetSystemStatus implements GetSystemStatusUseCase {
  readonly #runtime: RuntimeStatusReader;
  readonly #store: StoreStatusReader;

  constructor(dependencies: {
    readonly runtime: RuntimeStatusReader;
    readonly store: StoreStatusReader;
  }) {
    this.#runtime = dependencies.runtime;
    this.#store = dependencies.store;
  }

  async execute(): Promise<SystemStatus> {
    const persistence = await this.#store.readStoreStatus();
    return Object.freeze({
      state: this.#runtime.getState(),
      persistence: Object.freeze({ ...persistence }),
    });
  }
}
