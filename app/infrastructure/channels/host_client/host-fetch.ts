export interface HostConnection {
  readonly endpoint: string;
  readonly productRelease: string;
  readonly contractFingerprint: string;
  readonly token: string;
}

export interface HostFetchOptions {
  readonly origin?: 'app://plysmith';
  readonly fetch?: typeof fetch;
}

export function createHostFetch(
  connection: HostConnection,
  options: HostFetchOptions = {},
): typeof fetch {
  const endpoint = new URL(connection.endpoint);
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    endpoint.port.length === 0
  ) {
    throw new TypeError('The host endpoint must be numeric loopback HTTP.');
  }
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  return async (input, init) => {
    const inputRequest =
      input instanceof Request ? input : new Request(input, undefined);
    const headers = new Headers(inputRequest.headers);
    new Headers(init?.headers).forEach((value, name) => {
      headers.set(name, value);
    });
    headers.set('authorization', `Bearer ${connection.token}`);
    if (options.origin !== undefined) {
      headers.set('origin', options.origin);
    }

    const request = new Request(inputRequest, {
      ...init,
      headers,
      redirect: 'error',
    });
    if (new URL(request.url).origin !== endpoint.origin) {
      throw new TypeError(
        'The host client cannot leave its discovered origin.',
      );
    }
    return fetchImplementation(request);
  };
}
