import {
  HostClientProblem,
  HostEventClient,
  PlysmithHostClient,
  type HostConnection,
  type SetUiLanguageResultDto,
  type SystemStatusDto,
  type UserPreferencesDto,
} from '../../host_client/index.ts';
import type { DesktopBootstrap } from '../desktop/contract.ts';
import type { UiLocale } from './messages.ts';

export interface HostReadClient {
  getSystemStatus(): Promise<SystemStatusDto>;
  getUserPreferences(): Promise<UserPreferencesDto>;
  setUiLanguage(request: {
    readonly uiLocale: UiLocale;
    readonly expectedRevision: number;
  }): Promise<SetUiLanguageResultDto>;
}

export interface HostEventSubscription {
  readonly ready: Promise<void>;
  close(): void;
}

export interface HostReadModelStoreOptions {
  readonly getBootstrap: () => Promise<DesktopBootstrap>;
  readonly createClient?: (connection: HostConnection) => HostReadClient;
  readonly createEventSubscription?: (
    connection: HostConnection,
    onChange: () => void,
    onReconnect: () => void,
    onInvalidEvent: () => void,
  ) => HostEventSubscription;
}

export type HostReadModelState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'unavailable'; readonly errorCode?: string }
  | {
      readonly phase: 'ready';
      readonly status: SystemStatusDto;
      readonly preferences: UserPreferencesDto;
      readonly saving: boolean;
      readonly errorCode?: string;
    };

export class HostReadModelStore {
  readonly #options: HostReadModelStoreOptions;
  readonly #listeners = new Set<() => void>();
  #state: HostReadModelState = Object.freeze({ phase: 'loading' });
  #client: HostReadClient | undefined;
  #events: HostEventSubscription | undefined;
  #generation = -1;
  #lifecycle = 0;
  #readVersion = 0;
  #committedReadVersion = 0;
  #refreshPromise: Promise<void> | undefined;
  #refreshAgain = false;

  constructor(options: HostReadModelStoreOptions) {
    this.#options = options;
  }

  getSnapshot = (): HostReadModelState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  async start(): Promise<void> {
    const lifecycle = ++this.#lifecycle;
    this.#events?.close();
    this.#events = undefined;
    this.#client = undefined;
    this.#setState(Object.freeze({ phase: 'loading' }));

    let bootstrap: DesktopBootstrap;
    try {
      bootstrap = await this.#options.getBootstrap();
    } catch {
      this.#setUnavailable(lifecycle, 'host.unavailable');
      return;
    }
    if (lifecycle !== this.#lifecycle) {
      return;
    }
    if (bootstrap.kind === 'unavailable') {
      this.#generation = bootstrap.generation;
      this.#setUnavailable(lifecycle);
      return;
    }

    this.#generation = bootstrap.generation;
    this.#client = this.#createClient(bootstrap.connection);
    const events = this.#createEventSubscription(
      bootstrap.connection,
      () => void this.refresh(),
      () => void this.refresh(),
      () => this.#setReadyError('host.invalid_event'),
    );
    this.#events = events;
    try {
      await events.ready;
    } catch {
      events.close();
      if (this.#events === events) {
        this.#events = undefined;
      }
      this.#client = undefined;
      this.#setUnavailable(lifecycle, 'host.unavailable');
      return;
    }
    if (lifecycle !== this.#lifecycle || this.#events !== events) {
      return;
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.#client === undefined) {
      return this.start();
    }
    if (this.#refreshPromise !== undefined) {
      this.#refreshAgain = true;
      return this.#refreshPromise;
    }

    const lifecycle = this.#lifecycle;
    this.#refreshPromise = (async () => {
      do {
        this.#refreshAgain = false;
        const readVersion = ++this.#readVersion;
        try {
          const client = this.#client;
          if (client === undefined) {
            return;
          }
          const [status, preferences] = await Promise.all([
            client.getSystemStatus(),
            client.getUserPreferences(),
          ]);
          if (status.persistence.dataRevision !== preferences.dataRevision) {
            this.#refreshAgain = true;
            continue;
          }
          if (
            lifecycle !== this.#lifecycle ||
            readVersion < this.#committedReadVersion ||
            !isCurrentOrNewerRead(this.#state, status, preferences)
          ) {
            continue;
          }
          this.#committedReadVersion = readVersion;
          this.#setState(
            Object.freeze({
              phase: 'ready',
              status,
              preferences,
              saving:
                this.#state.phase === 'ready' ? this.#state.saving : false,
            }),
          );
        } catch (error) {
          if (lifecycle !== this.#lifecycle) {
            return;
          }
          const errorCode = hostErrorCode(error);
          if (this.#state.phase === 'ready') {
            this.#setReadyError(errorCode);
          } else {
            this.#setUnavailable(lifecycle, errorCode);
          }
        }
      } while (this.#refreshAgain && lifecycle === this.#lifecycle);
    })().finally(() => {
      this.#refreshPromise = undefined;
    });
    return this.#refreshPromise;
  }

  async setUiLanguage(uiLocale: UiLocale): Promise<void> {
    if (this.#state.phase !== 'ready' || this.#state.saving) {
      return;
    }
    const client = this.#client;
    if (client === undefined) {
      return;
    }

    const lifecycle = this.#lifecycle;
    const expectedRevision = this.#state.preferences.preferenceRevision;
    this.#setState(Object.freeze({ ...this.#state, saving: true }));
    try {
      const result = await client.setUiLanguage({
        uiLocale,
        expectedRevision,
      });
      if (lifecycle !== this.#lifecycle || this.#state.phase !== 'ready') {
        return;
      }
      const currentPreferences = this.#state.preferences;
      const preferences = isCurrentOrNewerPreferences(
        currentPreferences,
        result.preferences,
      )
        ? result.preferences
        : currentPreferences;
      this.#setState(
        Object.freeze({
          ...this.#state,
          preferences,
          saving: false,
        }),
      );
      await this.refresh();
    } catch (error) {
      if (lifecycle !== this.#lifecycle || this.#state.phase !== 'ready') {
        return;
      }
      const errorCode = hostErrorCode(error);
      this.#setState(
        Object.freeze({ ...this.#state, saving: false, errorCode }),
      );
      if (errorCode === 'preference.revision_conflict') {
        await this.refresh();
        if (this.#state.phase === 'ready') {
          this.#setReadyError(errorCode);
        }
      }
    }
  }

  close(): void {
    this.#lifecycle += 1;
    this.#events?.close();
    this.#events = undefined;
    this.#client = undefined;
    this.#listeners.clear();
  }

  #createClient(connection: HostConnection): HostReadClient {
    return (
      this.#options.createClient?.(connection) ??
      new PlysmithHostClient(connection, { origin: 'app://plysmith' })
    );
  }

  #createEventSubscription(
    connection: HostConnection,
    onChange: () => void,
    onReconnect: () => void,
    onInvalidEvent: () => void,
  ): HostEventSubscription {
    return (
      this.#options.createEventSubscription?.(
        connection,
        onChange,
        onReconnect,
        onInvalidEvent,
      ) ??
      new HostEventClient(connection, {
        origin: 'app://plysmith',
        onEvent: onChange,
        onGap: () => undefined,
        onReconnect,
        onInvalidEvent,
      })
    );
  }

  #setUnavailable(lifecycle: number, errorCode?: string): void {
    if (lifecycle !== this.#lifecycle) {
      return;
    }
    this.#setState(
      errorCode === undefined
        ? Object.freeze({ phase: 'unavailable' })
        : Object.freeze({ phase: 'unavailable', errorCode }),
    );
  }

  #setReadyError(errorCode: string): void {
    if (this.#state.phase !== 'ready') {
      return;
    }
    this.#setState(Object.freeze({ ...this.#state, errorCode }));
  }

  #setState(state: HostReadModelState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

function hostErrorCode(error: unknown): string {
  return error instanceof HostClientProblem
    ? error.problem.code
    : 'host.unavailable';
}

function isCurrentOrNewerRead(
  state: HostReadModelState,
  status: SystemStatusDto,
  preferences: UserPreferencesDto,
): boolean {
  if (state.phase !== 'ready') {
    return true;
  }
  return (
    status.persistence.dataRevision >= state.status.persistence.dataRevision &&
    preferences.dataRevision >= state.preferences.dataRevision &&
    preferences.preferenceRevision >= state.preferences.preferenceRevision
  );
}

function isCurrentOrNewerPreferences(
  current: UserPreferencesDto,
  candidate: UserPreferencesDto,
): boolean {
  return (
    candidate.dataRevision >= current.dataRevision &&
    candidate.preferenceRevision >= current.preferenceRevision
  );
}
