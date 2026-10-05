import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { open, realpath, stat, type FileHandle } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import type {
  AcquiredImportInput,
  SourceAcquisitionPort,
} from '../../../../application/inventory/import-ports.ts';
import type {
  ImportEncoding,
  ImportInputDescriptor,
} from '../../../../application/inventory/import-models.ts';
import { importProblem } from '../../../../application/inventory/import-problems.ts';

const maximumInputBytes = 16 * 1024 * 1024;
const maximumRegisteredInputs = 16;
const inputLifetimeMs = 30 * 60 * 1000;

interface RegisteredInput {
  readonly locator: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ino: number;
  readonly dev: number;
  readonly registeredAt: number;
}

export class LocalFileSourceAcquisition implements SourceAcquisitionPort {
  readonly #inputs = new Map<string, RegisteredInput>();
  #registrations = 0;

  async registerLocalFile(
    inputLocator: string,
  ): Promise<ImportInputDescriptor> {
    this.#pruneExpired();
    if (!isAbsolute(inputLocator) || inputLocator.includes('\0'))
      throw importProblem('input_not_found');
    if (this.#inputs.size + this.#registrations >= maximumRegisteredInputs)
      throw importProblem('input_limit');
    this.#registrations += 1;
    try {
      let locator: string;
      let details: Stats;
      try {
        locator = await realpath(inputLocator);
        details = await stat(locator);
      } catch {
        throw importProblem('input_not_found');
      }
      if (!details.isFile()) throw importProblem('input_not_found');
      if (details.size === 0) throw importProblem('format_not_recognized');
      if (details.size > maximumInputBytes)
        throw importProblem('input_too_large');
      const inputHandle = randomUUID();
      this.#inputs.set(inputHandle, {
        locator,
        size: details.size,
        mtimeMs: details.mtimeMs,
        ino: details.ino,
        dev: details.dev,
        registeredAt: Date.now(),
      });
      return {
        inputHandle,
        displayName: basename(locator),
        inputSize: details.size,
      };
    } finally {
      this.#registrations -= 1;
    }
  }

  async acquire(
    inputHandle: string,
    encoding: ImportEncoding,
    signal: AbortSignal,
  ): Promise<AcquiredImportInput> {
    this.#pruneExpired();
    const registered = this.#inputs.get(inputHandle);
    if (registered === undefined) throw importProblem('input_not_found');
    if (signal.aborted) throw importProblem('interrupted');
    let file: FileHandle;
    try {
      file = await open(registered.locator, 'r');
    } catch {
      throw importProblem('input_not_found');
    }
    let initial: Stats;
    try {
      initial = await file.stat();
    } catch {
      await file.close();
      throw importProblem('input_not_found');
    }
    if (!initial.isFile() || !sameFile(registered, initial)) {
      await file.close();
      throw importProblem('input_changed');
    }
    let closed = false;
    const close = async () => {
      if (!closed) {
        closed = true;
        await file.close();
      }
    };
    const chunks = (async function* () {
      const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
      let bytesReadTotal = 0;
      let hasUtf8Bom = false;
      try {
        while (true) {
          if (signal.aborted) throw importProblem('interrupted');
          const buffer = Buffer.alloc(64 * 1024);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
          if (bytesRead === 0) break;
          bytesReadTotal += bytesRead;
          if (bytesReadTotal > maximumInputBytes)
            throw importProblem('input_too_large');
          const part = buffer.subarray(0, bytesRead);
          if (bytesReadTotal === bytesRead) {
            hasUtf8Bom =
              part[0] === 0xef && part[1] === 0xbb && part[2] === 0xbf;
          }
          if (
            bytesReadTotal === bytesRead &&
            part.length >= 2 &&
            ((part[0] === 0xff && part[1] === 0xfe) ||
              (part[0] === 0xfe && part[1] === 0xff))
          ) {
            throw importProblem('encoding_unsupported');
          }
          if (
            bytesReadTotal === bytesRead &&
            encoding === 'iso-8859-1' &&
            part[0] === 0xef &&
            part[1] === 0xbb &&
            part[2] === 0xbf
          ) {
            throw importProblem('encoding_unsupported');
          }
          let text: string;
          try {
            text =
              encoding === 'iso-8859-1'
                ? part.toString('latin1')
                : utf8.decode(part, { stream: true });
          } catch {
            throw importProblem(
              hasUtf8Bom ? 'encoding_unsupported' : 'encoding_choice_required',
            );
          }
          yield text;
        }
        if (encoding === 'utf-8') {
          try {
            const tail = utf8.decode();
            if (tail.length > 0) yield tail;
          } catch {
            throw importProblem(
              hasUtf8Bom ? 'encoding_unsupported' : 'encoding_choice_required',
            );
          }
        }
        const final = await file.stat();
        let pathname: Stats;
        try {
          pathname = await stat(registered.locator);
        } catch {
          throw importProblem('input_changed');
        }
        if (
          bytesReadTotal !== registered.size ||
          !sameFile(registered, final) ||
          !sameFile(registered, pathname)
        ) {
          throw importProblem('input_changed');
        }
      } finally {
        await close();
      }
    })();
    return {
      inputHandle,
      displayName: basename(registered.locator),
      inputSize: registered.size,
      chunks,
      close,
    };
  }

  forget(inputHandle: string): void {
    this.#inputs.delete(inputHandle);
  }

  #pruneExpired(): void {
    for (const [handle, input] of this.#inputs) {
      if (Date.now() - input.registeredAt > inputLifetimeMs)
        this.#inputs.delete(handle);
    }
  }
}

function sameFile(expected: RegisteredInput, actual: Stats): boolean {
  return (
    expected.size === actual.size &&
    expected.mtimeMs === actual.mtimeMs &&
    expected.ino === actual.ino &&
    expected.dev === actual.dev
  );
}
