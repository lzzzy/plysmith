export interface HostConnection {
  readonly endpoint: string;
  readonly productRelease: string;
  readonly contractFingerprint: string;
  readonly token: string;
}

export interface HostFetchOptions {
  readonly origin?: 'app://plysmith';
  readonly fetch?: typeof fetch;
  readonly correlationIdFactory?: () => string;
  readonly onDiagnostic?: (event: HostRequestDiagnostic) => void;
}

export type HostRequestDiagnostic =
  | {
      readonly kind: 'completed';
      readonly correlationId: string;
      readonly statusCode: number;
      readonly durationMilliseconds: number;
    }
  | {
      readonly kind: 'failed';
      readonly correlationId: string;
      readonly durationMilliseconds: number;
    };

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
    const correlationId =
      options.correlationIdFactory?.() ?? globalThis.crypto.randomUUID();
    headers.set('x-plysmith-correlation-id', correlationId);

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
    const startedAt = performance.now();
    try {
      const response = await fetchImplementation(request);
      notifyDiagnostic(options, {
        kind: 'completed',
        correlationId,
        statusCode: response.status,
        durationMilliseconds: performance.now() - startedAt,
      });
      return response;
    } catch (error) {
      notifyDiagnostic(options, {
        kind: 'failed',
        correlationId,
        durationMilliseconds: performance.now() - startedAt,
      });
      throw error;
    }
  };
}

function notifyDiagnostic(
  options: HostFetchOptions,
  event: HostRequestDiagnostic,
): void {
  try {
    options.onDiagnostic?.(event);
  } catch {
    // Diagnostics must never affect a host request.
  }
}
