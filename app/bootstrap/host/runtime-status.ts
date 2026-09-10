import type {
  RuntimeState,
  RuntimeStatusReader,
} from '../../application/system/index.ts';

export class RuntimeStatus implements RuntimeStatusReader {
  #state: RuntimeState = 'starting';

  getState(): RuntimeState {
    return this.#state;
  }

  setState(state: RuntimeState): void {
    this.#state = state;
  }
}
