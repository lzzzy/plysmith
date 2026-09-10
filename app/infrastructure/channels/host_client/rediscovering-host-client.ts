import {
  connectHost,
  type PlysmithHostClient,
  type PlysmithHostClientOptions,
  type SetUiLanguageResultDto,
  type SystemStatusDto,
  type UserPreferencesDto,
} from './host-client.ts';
import { HostClientProblem, localHostProblem } from './host-client-problem.ts';
import type { HostConnection } from './host-fetch.ts';

export type DiscoverHost = () => Promise<HostConnection>;

export class RediscoveringHostClient {
  readonly #discover: DiscoverHost;
  readonly #options: PlysmithHostClientOptions;
  #connected:
    | {
        readonly connection: HostConnection;
        readonly client: PlysmithHostClient;
      }
    | undefined;

  constructor(discover: DiscoverHost, options: PlysmithHostClientOptions = {}) {
    this.#discover = discover;
    this.#options = options;
  }

  async attach(): Promise<void> {
    await this.#currentClient();
  }

  async getSystemStatus(): Promise<SystemStatusDto> {
    return this.#read((client) => client.getSystemStatus());
  }

  async getUserPreferences(): Promise<UserPreferencesDto> {
    return this.#read((client) => client.getUserPreferences());
  }

  async setUiLanguage(request: {
    readonly uiLocale: 'de-DE' | 'en-GB';
    readonly expectedRevision: number;
  }): Promise<SetUiLanguageResultDto> {
    const client = await this.#currentClient();
    return client.setUiLanguage(request);
  }

  async #read<T>(operation: (client: PlysmithHostClient) => Promise<T>) {
    try {
      return await operation(await this.#currentClient());
    } catch (error) {
      if (!isHostUnavailable(error)) {
        throw error;
      }
      return operation(await this.#currentClient(true));
    }
  }

  async #currentClient(forceReconnect = false): Promise<PlysmithHostClient> {
    const connection = await this.#discoverConnection();
    if (
      !forceReconnect &&
      this.#connected !== undefined &&
      sameConnection(this.#connected.connection, connection)
    ) {
      return this.#connected.client;
    }

    const client = await connectHost(connection, this.#options);
    this.#connected = { connection, client };
    return client;
  }

  async #discoverConnection(): Promise<HostConnection> {
    try {
      return await this.#discover();
    } catch (error) {
      if (error instanceof HostClientProblem) {
        throw error;
      }
      throw localHostProblem('host.unavailable');
    }
  }
}

export async function connectRediscoveringHost(
  discover: DiscoverHost,
  options: PlysmithHostClientOptions = {},
): Promise<RediscoveringHostClient> {
  const client = new RediscoveringHostClient(discover, options);
  await client.attach();
  return client;
}

function sameConnection(left: HostConnection, right: HostConnection): boolean {
  return (
    left.endpoint === right.endpoint &&
    left.productRelease === right.productRelease &&
    left.contractFingerprint === right.contractFingerprint &&
    left.token === right.token
  );
}

function isHostUnavailable(error: unknown): boolean {
  return (
    error instanceof HostClientProblem &&
    error.problem.code === 'host.unavailable'
  );
}
