import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import type {
  DiagnosticComponent,
  DiagnosticEventInput,
  DiagnosticLogLevel,
  DiagnosticSink,
} from '../../../../../contracts/diagnostics/index.ts';

const levelRank: Readonly<Record<DiagnosticLogLevel, number>> = {
  off: 0,
  error: 1,
  info: 2,
  debug: 3,
};

export interface FileDiagnosticLogOptions {
  readonly applicationHome: string;
  readonly component: DiagnosticComponent;
  readonly productRelease: string;
  readonly level: DiagnosticLogLevel;
  readonly now?: () => string;
  readonly runId?: string;
  readonly processId?: number;
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
  readonly maxAgeMilliseconds?: number;
  readonly maxLineBytes?: number;
}

export class FileDiagnosticLog implements DiagnosticSink {
  readonly #directory: string;
  readonly #component: DiagnosticComponent;
  readonly #productRelease: string;
  readonly #level: DiagnosticLogLevel;
  readonly #now: () => string;
  readonly #runId: string;
  readonly #processId: number;
  readonly #maxFileBytes: number;
  readonly #maxTotalBytes: number;
  readonly #maxAgeMilliseconds: number;
  readonly #maxLineBytes: number;
  readonly #fileStem: string;
  #segment = 0;
  #currentBytes = 0;
  #initialized = false;
  #failed = false;
  #queue: Promise<void> = Promise.resolve();

  constructor(options: FileDiagnosticLogOptions) {
    this.#directory = path.join(options.applicationHome, 'diagnostics');
    this.#component = options.component;
    this.#productRelease = boundedIdentifier(options.productRelease, 64);
    this.#level = options.level;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#runId = boundedIdentifier(options.runId ?? randomUUID(), 64);
    this.#processId = options.processId ?? process.pid;
    this.#maxFileBytes = positiveLimit(options.maxFileBytes, 5 * 1024 * 1024);
    this.#maxTotalBytes = positiveLimit(
      options.maxTotalBytes,
      50 * 1024 * 1024,
    );
    this.#maxAgeMilliseconds = positiveLimit(
      options.maxAgeMilliseconds,
      7 * 24 * 60 * 60 * 1_000,
    );
    this.#maxLineBytes = positiveLimit(options.maxLineBytes, 16 * 1024);
    this.#fileStem = `${this.#component}-${compactTimestamp(this.#now())}-${this.#runId}`;
  }

  write(event: DiagnosticEventInput): void {
    if (
      this.#failed ||
      levelRank[event.level] > levelRank[this.#level] ||
      this.#level === 'off'
    ) {
      return;
    }
    const line = this.#serialize(event);
    if (Buffer.byteLength(line, 'utf8') > this.#maxLineBytes) return;
    this.#queue = this.#queue
      .then(() => this.#append(line))
      .catch(() => {
        this.#failed = true;
      });
  }

  async close(): Promise<void> {
    await this.#queue;
  }

  #serialize(event: DiagnosticEventInput): string {
    return `${JSON.stringify({
      timestamp: this.#now(),
      level: event.level,
      eventCode: event.eventCode,
      productRelease: this.#productRelease,
      component: this.#component,
      processId: this.#processId,
      runId: this.#runId,
      ...safeOptionalFields(event),
    })}\n`;
  }

  async #append(line: string): Promise<void> {
    if (!this.#initialized) {
      await mkdir(this.#directory, { recursive: true });
      await this.#prune();
      this.#initialized = true;
    }

    const bytes = Buffer.byteLength(line, 'utf8');
    if (
      this.#currentBytes > 0 &&
      this.#currentBytes + bytes > this.#maxFileBytes
    ) {
      this.#segment += 1;
      this.#currentBytes = 0;
    }
    await appendFile(this.#currentFile(), line, 'utf8');
    this.#currentBytes += bytes;
    await this.#prune();
  }

  #currentFile(): string {
    return path.join(
      this.#directory,
      `${this.#fileStem}-${this.#segment}.ndjson`,
    );
  }

  async #prune(): Promise<void> {
    const entries = await readdir(this.#directory, { withFileTypes: true });
    const files = (
      await Promise.all(
        entries
          .filter(
            (entry) =>
              entry.isFile() &&
              /^(?:host|desktop)-[A-Za-z0-9-]+-\d+\.ndjson$/.test(entry.name),
          )
          .map((entry) =>
            readDiagnosticFileDetails(path.join(this.#directory, entry.name)),
          ),
      )
    ).filter((file) => file !== undefined);
    const cutoff = Date.parse(this.#now()) - this.#maxAgeMilliseconds;
    const retained = [];
    for (const file of files) {
      if (file.modifiedAt < cutoff) {
        await unlinkIfPresent(file.filePath);
      } else {
        retained.push(file);
      }
    }
    retained.sort((left, right) => left.modifiedAt - right.modifiedAt);
    let total = retained.reduce((sum, file) => sum + file.size, 0);
    for (const file of retained) {
      if (total <= this.#maxTotalBytes) break;
      await unlinkIfPresent(file.filePath);
      total -= file.size;
    }
  }
}

async function readDiagnosticFileDetails(filePath: string): Promise<
  | {
      readonly filePath: string;
      readonly size: number;
      readonly modifiedAt: number;
    }
  | undefined
> {
  try {
    const details = await stat(filePath);
    return { filePath, size: details.size, modifiedAt: details.mtimeMs };
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function unlinkIfPresent(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await unlink(filePath);
      return;
    } catch (error) {
      if (isNotFound(error)) return;
      if (!isWindowsDeleteRace(error) || attempt === 2) throw error;
      await delay(10);
    }
  }
}

function isNotFound(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

function isWindowsDeleteRace(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'EPERM' || code === 'EBUSY';
}

function errorCode(error: unknown): unknown {
  return (
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code) ||
    undefined
  );
}

function safeOptionalFields(event: DiagnosticEventInput): object {
  return {
    ...(event.correlationId === undefined
      ? {}
      : { correlationId: boundedIdentifier(event.correlationId, 80) }),
    ...(event.operation === undefined
      ? {}
      : { operation: boundedIdentifier(event.operation, 80) }),
    ...(event.status === undefined ? {} : { status: event.status }),
    ...(event.problemCode === undefined
      ? {}
      : { problemCode: boundedIdentifier(event.problemCode, 80) }),
    ...safeNumber('statusCode', event.statusCode),
    ...safeNumber('durationMilliseconds', event.durationMilliseconds),
    ...safeNumber('dataRevision', event.dataRevision),
    ...safeNumber('readVersion', event.readVersion),
    ...safeNumber('generation', event.generation),
    ...safeLocalId('itemId', event.itemId),
    ...safeLocalId('revisionId', event.revisionId),
    ...safeLocalId('anchorId', event.anchorId),
    ...safeLocalId('contextId', event.contextId),
    ...(event.scratchId === undefined
      ? {}
      : { scratchId: boundedIdentifier(event.scratchId, 80) }),
  };
}

function safeNumber(name: string, value: number | undefined): object {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? { [name]: value }
    : {};
}

function safeLocalId(name: string, value: string | undefined): object {
  return value !== undefined && /^\d{1,20}$/.test(value)
    ? { [name]: value }
    : {};
}

function boundedIdentifier(value: string, maxLength: number): string {
  const normalized = value.replace(/[^A-Za-z0-9._:-]/g, '_');
  return normalized.slice(0, maxLength) || 'unknown';
}

function compactTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, 17) || 'unknown-time';
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}
