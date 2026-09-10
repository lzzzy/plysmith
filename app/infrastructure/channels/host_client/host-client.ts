import createClient, { type Client } from 'openapi-fetch';

import {
  contractFingerprint,
  productRelease,
  type components,
  type paths,
} from '../../../../contracts/host/index.ts';
import { createHostFetch, type HostConnection } from './host-fetch.ts';
import {
  HostClientProblem,
  localHostProblem,
  type SafeHostProblem,
} from './host-client-problem.ts';

export type SystemStatusDto = components['schemas']['SystemStatus'];
export type UserPreferencesDto = components['schemas']['UserPreferences'];
export type SetUiLanguageResultDto =
  components['schemas']['SetUiLanguageResult'];

export interface PlysmithHostClientOptions {
  readonly fetch?: typeof fetch;
  readonly origin?: 'app://plysmith';
}

export class PlysmithHostClient {
  readonly #client: Client<paths>;

  constructor(
    connection: HostConnection,
    options: PlysmithHostClientOptions = {},
  ) {
    this.#client = createClient<paths>({
      baseUrl: connection.endpoint,
      fetch: createHostFetch(connection, options),
    });
  }

  async getSystemStatus(): Promise<SystemStatusDto> {
    try {
      const result = await this.#client.GET('/status');
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async getUserPreferences(): Promise<UserPreferencesDto> {
    try {
      const result = await this.#client.GET('/preferences');
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }

  async setUiLanguage(request: {
    readonly uiLocale: 'de-DE' | 'en-GB';
    readonly expectedRevision: number;
  }): Promise<SetUiLanguageResultDto> {
    try {
      const result = await this.#client.PUT('/preferences/ui-language', {
        body: request,
      });
      return unwrap(result.data, result.error);
    } catch (error) {
      throw normalizeClientError(error);
    }
  }
}

export async function connectHost(
  connection: HostConnection,
  options: PlysmithHostClientOptions = {},
): Promise<PlysmithHostClient> {
  if (
    connection.productRelease !== productRelease ||
    connection.contractFingerprint !== contractFingerprint
  ) {
    throw localHostProblem('host.contract_mismatch');
  }
  const client = new PlysmithHostClient(connection, options);
  const status = await client.getSystemStatus();
  if (
    status.productRelease !== productRelease ||
    status.contractFingerprint !== contractFingerprint
  ) {
    throw localHostProblem('host.contract_mismatch');
  }
  return client;
}

function unwrap<T>(data: T | undefined, error: SafeHostProblem | undefined): T {
  if (data !== undefined) {
    return data;
  }
  if (error !== undefined) {
    throw new HostClientProblem(error);
  }
  throw localHostProblem('host.unavailable');
}

function normalizeClientError(error: unknown): HostClientProblem {
  return error instanceof HostClientProblem
    ? error
    : localHostProblem('host.unavailable');
}
