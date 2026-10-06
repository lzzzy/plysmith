import { LiveProviderError } from '../../../../application/live/live-ports.ts';

const requestTimeoutMs = 15_000;
const streamIdleTimeoutMs = 45_000;
const maximumResponseBytes = 1_048_576;
const maximumLineBytes = 131_072;
const maximumResponseLines = 8_192;

export class LichessHttp {
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(token: string, fetchImplementation: typeof fetch) {
    this.#token = token;
    this.#fetch = fetchImplementation;
  }

  async json(
    path: string,
    signal: AbortSignal,
    authenticated: boolean,
    write = false,
  ): Promise<unknown> {
    if (signal.aborted)
      throw new LiveProviderError('live.provider_unavailable');
    const scope = requestScope(signal);
    const timeout = setTimeout(
      () => scope.controller.abort(),
      requestTimeoutMs,
    );
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.#request(
        path,
        scope.controller.signal,
        authenticated,
        write,
        false,
      );
      if (response.body === null)
        throw new LiveProviderError('live.protocol_error');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let text = '';
      let bytes = 0;
      let lines = 0;
      let lineBytes = 0;
      while (true) {
        const chunk = await interrupted(
          reader.read(),
          scope.controller.signal,
        ).catch(() => {
          throw new LiveProviderError('live.provider_unavailable');
        });
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maximumResponseBytes)
          throw new LiveProviderError('live.protocol_error');
        for (const byte of chunk.value) {
          if (byte === 10) {
            lineBytes = 0;
            lines += 1;
          } else lineBytes += 1;
          if (lines > maximumResponseLines || lineBytes > maximumLineBytes)
            throw new LiveProviderError('live.protocol_error');
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text) as unknown;
    } catch (error) {
      if (
        error instanceof LiveProviderError &&
        (!write ||
          [
            'live.authentication_failed',
            'live.rate_limited',
            'live.invalid_game',
            'live.move_rejected',
          ].includes(error.code))
      )
        throw error;
      throw new LiveProviderError(
        write
          ? 'live.move_uncertain'
          : scope.controller.signal.aborted
            ? 'live.provider_unavailable'
            : 'live.protocol_error',
      );
    } finally {
      clearTimeout(timeout);
      scope.close();
      release(reader);
    }
  }

  async *stream(
    path: string,
    signal: AbortSignal,
    authenticated: boolean,
  ): AsyncIterable<Record<string, unknown> | 'connected'> {
    const scope = requestScope(signal);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cancelReader = () => {
      void reader?.cancel().catch(() => undefined);
    };
    scope.controller.signal.addEventListener('abort', cancelReader, {
      once: true,
    });
    try {
      timeout = setTimeout(() => scope.controller.abort(), requestTimeoutMs);
      const response = await this.#request(
        path,
        scope.controller.signal,
        authenticated,
        false,
        true,
      );
      clearTimeout(timeout);
      if (response.body === null)
        throw new LiveProviderError('live.protocol_error');
      reader = response.body.getReader();
      if (scope.controller.signal.aborted)
        throw new LiveProviderError('live.provider_unavailable');
      // This local transport proof cannot be forged by an NDJSON object.
      yield 'connected';
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let pending = '';
      let lineBytes = 0;
      while (true) {
        timeout = setTimeout(
          () => scope.controller.abort(),
          streamIdleTimeoutMs,
        );
        const chunk = await interrupted(
          reader.read(),
          scope.controller.signal,
        ).catch(() => {
          throw new LiveProviderError('live.provider_unavailable');
        });
        clearTimeout(timeout);
        if (chunk.done) {
          pending += decoder.decode();
          if (pending.trim() !== '') yield jsonObject(pending);
          return;
        }
        if (chunk.value.byteLength > maximumResponseBytes)
          throw new LiveProviderError('live.protocol_error');
        for (const byte of chunk.value) {
          lineBytes = byte === 10 ? 0 : lineBytes + 1;
          if (lineBytes > maximumLineBytes)
            throw new LiveProviderError('live.protocol_error');
        }
        pending += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (scope.controller.signal.aborted)
            throw new LiveProviderError('live.provider_unavailable');
          if (line.trim() !== '') yield jsonObject(line);
        }
      }
    } catch (error) {
      if (error instanceof LiveProviderError) throw error;
      throw new LiveProviderError(
        scope.controller.signal.aborted
          ? 'live.provider_unavailable'
          : 'live.protocol_error',
      );
    } finally {
      clearTimeout(timeout);
      scope.controller.signal.removeEventListener('abort', cancelReader);
      scope.close();
      release(reader);
    }
  }

  async #request(
    path: string,
    signal: AbortSignal,
    authenticated: boolean,
    write: boolean,
    stream: boolean,
  ): Promise<Response> {
    if (signal.aborted)
      throw new LiveProviderError('live.provider_unavailable');
    let response: Response;
    try {
      const pending = this.#fetch(`https://lichess.org${path}`, {
        method: write ? 'POST' : 'GET',
        redirect: 'manual',
        headers: {
          Accept: stream ? 'application/x-ndjson' : 'application/json',
          ...(authenticated ? { Authorization: `Bearer ${this.#token}` } : {}),
        },
        signal,
      });
      // A late response after cancellation must not leave an unread socket body.
      void pending.then(
        (result) => {
          if (signal.aborted) void result.body?.cancel().catch(() => undefined);
        },
        () => undefined,
      );
      response = await interrupted(pending, signal);
    } catch {
      throw new LiveProviderError(
        write ? 'live.move_uncertain' : 'live.provider_unavailable',
      );
    }
    if (response.status === 200) return response;
    void response.body?.cancel().catch(() => undefined);
    if (response.status === 401 || response.status === 403)
      throw new LiveProviderError('live.authentication_failed');
    if (response.status === 429)
      throw new LiveProviderError('live.rate_limited');
    if (response.status === 404)
      throw new LiveProviderError('live.invalid_game');
    if (write && [400, 409, 422].includes(response.status))
      throw new LiveProviderError('live.move_rejected');
    throw new LiveProviderError(
      write ? 'live.move_uncertain' : 'live.provider_unavailable',
    );
  }
}

function jsonObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new LiveProviderError('live.protocol_error');
  return value as Record<string, unknown>;
}

function requestScope(parent: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent.addEventListener('abort', abort, { once: true });
  if (parent.aborted) controller.abort();
  return {
    controller,
    close() {
      parent.removeEventListener('abort', abort);
      controller.abort();
    },
  };
}

function interrupted<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(new LiveProviderError('live.provider_unavailable'));
    };
    signal.addEventListener('abort', abort, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

function release(reader: ReadableStreamDefaultReader<Uint8Array> | undefined) {
  if (reader === undefined) return;
  try {
    // Transport cancellation may never settle; local cleanup must still finish.
    void reader.cancel().catch(() => undefined);
  } catch {
    /* Cancellation must not expose transport errors. */
  } finally {
    reader.releaseLock();
  }
}
