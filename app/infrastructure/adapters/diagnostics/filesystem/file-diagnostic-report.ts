import { randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import {
  diagnosticReportTargetExists,
  invalidDiagnosticReportTarget,
  type DiagnosticReportSource,
  type DiagnosticReportWriter,
  type RedactedDiagnosticEvent,
} from '../../../../application/system/index.ts';
import {
  diagnosticEventCodes,
  diagnosticEventStatuses,
  diagnosticLogLevels,
} from '../../../../../contracts/diagnostics/index.ts';

const gzipAsync = promisify(gzip);
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const diagnosticFilePattern = /^(?:host|desktop)-[A-Za-z0-9-]+-\d+\.ndjson$/;

export interface FileDiagnosticReportOptions {
  readonly applicationHome: string;
  readonly protectedRoots?: readonly string[];
}

export class FileDiagnosticReport
  implements DiagnosticReportSource, DiagnosticReportWriter
{
  readonly #applicationHome: string;
  readonly #diagnosticsDirectory: string;
  readonly #protectedRoots: readonly string[];

  constructor(options: FileDiagnosticReportOptions) {
    this.#applicationHome = path.resolve(options.applicationHome);
    this.#diagnosticsDirectory = path.join(
      this.#applicationHome,
      'diagnostics',
    );
    this.#protectedRoots = Object.freeze([
      this.#applicationHome,
      ...(options.protectedRoots ?? []).map((entry) => path.resolve(entry)),
    ]);
  }

  async readRedactedEvents(
    request: Parameters<DiagnosticReportSource['readRedactedEvents']>[0],
  ): ReturnType<DiagnosticReportSource['readRedactedEvents']> {
    const files = await this.#diagnosticFiles();
    const selected = selectNewestFiles(files, request.maximumSourceBytes);
    const events: RedactedDiagnosticEvent[] = [];
    let discardedLineCount = 0;

    for (const file of selected.files) {
      const source = await readFile(file.filePath, 'utf8');
      for (const line of source.split('\n')) {
        if (line.length === 0) continue;
        const event = redactedEvent(line);
        if (event === undefined) {
          discardedLineCount += 1;
        } else {
          events.push(event);
        }
      }
    }

    let truncated = selected.truncated;
    if (events.length > request.maximumEvents) {
      events.splice(0, events.length - request.maximumEvents);
      truncated = true;
    }
    return Object.freeze({
      events: Object.freeze(events),
      sourceSegmentCount: selected.files.length,
      discardedLineCount,
      truncated,
    });
  }

  async write(
    request: Parameters<DiagnosticReportWriter['write']>[0],
  ): ReturnType<DiagnosticReportWriter['write']> {
    const destination = await this.#validatedDestination(
      request.destinationPath,
    );
    const source = Buffer.from(
      `${JSON.stringify(request.document, null, 2)}\n`,
    );
    const compressed = await gzipAsync(source, { level: 9 });
    if (compressed.byteLength > request.maximumBytes) {
      throw invalidDiagnosticReportTarget();
    }

    const temporaryPath = path.join(
      destination.parent,
      `.plysmith-diagnostics-${process.pid}-${randomUUID()}.tmp`,
    );
    await writeFile(temporaryPath, compressed, {
      flag: 'wx',
      mode: 0o600,
    });
    try {
      await link(temporaryPath, destination.filePath);
    } catch (error) {
      if (errorCode(error) === 'EEXIST') throw diagnosticReportTargetExists();
      throw error;
    } finally {
      await removeIfPresent(temporaryPath);
    }
    return Object.freeze({ bytesWritten: compressed.byteLength });
  }

  async #diagnosticFiles(): Promise<readonly DiagnosticFile[]> {
    try {
      await mkdir(this.#diagnosticsDirectory, { recursive: true });
      const entries = await readdir(this.#diagnosticsDirectory, {
        withFileTypes: true,
      });
      const files = (
        await Promise.all(
          entries
            .filter(
              (entry) =>
                entry.isFile() && diagnosticFilePattern.test(entry.name),
            )
            .map(async (entry) => {
              const filePath = path.join(
                this.#diagnosticsDirectory,
                entry.name,
              );
              const details = await stat(filePath);
              return {
                filePath,
                size: details.size,
                modifiedAt: details.mtimeMs,
              };
            }),
        )
      ).sort((left, right) => left.modifiedAt - right.modifiedAt);
      return files;
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
  }

  async #validatedDestination(candidate: string): Promise<{
    readonly parent: string;
    readonly filePath: string;
  }> {
    if (
      !path.isAbsolute(candidate) ||
      !candidate.toLowerCase().endsWith('.json.gz') ||
      isUnsafeWindowsPath(candidate)
    ) {
      throw invalidDiagnosticReportTarget();
    }
    const resolved = path.resolve(candidate);
    for (const protectedRoot of this.#protectedRoots) {
      if (isWithin(protectedRoot, resolved)) {
        throw invalidDiagnosticReportTarget();
      }
    }
    let parent: string;
    try {
      parent = await realpath(path.dirname(resolved));
    } catch {
      throw invalidDiagnosticReportTarget();
    }
    const filePath = path.join(parent, path.basename(resolved));
    for (const protectedRoot of this.#protectedRoots) {
      const existingRoot = await realpathIfPresent(protectedRoot);
      if (existingRoot !== undefined && isWithin(existingRoot, filePath)) {
        throw invalidDiagnosticReportTarget();
      }
    }
    try {
      await lstat(filePath);
      throw diagnosticReportTargetExists();
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
    return { parent, filePath };
  }
}

interface DiagnosticFile {
  readonly filePath: string;
  readonly size: number;
  readonly modifiedAt: number;
}

function selectNewestFiles(
  files: readonly DiagnosticFile[],
  maximumBytes: number,
): { readonly files: readonly DiagnosticFile[]; readonly truncated: boolean } {
  const selected: DiagnosticFile[] = [];
  let bytes = 0;
  for (const file of [...files].reverse()) {
    if (bytes + file.size > maximumBytes) continue;
    selected.push(file);
    bytes += file.size;
  }
  selected.reverse();
  return { files: selected, truncated: selected.length < files.length };
}

function redactedEvent(line: string): RedactedDiagnosticEvent | undefined {
  let candidate: unknown;
  try {
    candidate = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(candidate)) return undefined;
  if (
    typeof candidate.timestamp !== 'string' ||
    !timestampPattern.test(candidate.timestamp) ||
    !isEventLevel(candidate.level) ||
    typeof candidate.eventCode !== 'string' ||
    !diagnosticEventCodes.includes(
      candidate.eventCode as (typeof diagnosticEventCodes)[number],
    ) ||
    (candidate.component !== 'host' && candidate.component !== 'desktop') ||
    !isOptionalStatus(candidate.status)
  ) {
    return undefined;
  }
  return Object.freeze({
    timestamp: candidate.timestamp,
    level: candidate.level,
    eventCode: candidate.eventCode,
    component: candidate.component,
    ...(candidate.status === undefined ? {} : { status: candidate.status }),
    ...safeNumber(candidate, 'statusCode'),
    ...safeNumber(candidate, 'durationMilliseconds'),
    ...safeNumber(candidate, 'dataRevision'),
    ...safeNumber(candidate, 'readVersion'),
    ...safeNumber(candidate, 'generation'),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEventLevel(value: unknown): value is 'error' | 'info' | 'debug' {
  return (
    value !== 'off' &&
    diagnosticLogLevels.includes(value as (typeof diagnosticLogLevels)[number])
  );
}

function isOptionalStatus(
  value: unknown,
): value is RedactedDiagnosticEvent['status'] {
  return (
    value === undefined ||
    diagnosticEventStatuses.includes(
      value as (typeof diagnosticEventStatuses)[number],
    )
  );
}

function safeNumber(
  source: Record<string, unknown>,
  key: string,
): Record<string, number> {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? { [key]: value }
    : {};
}

function isUnsafeWindowsPath(candidate: string): boolean {
  if (process.platform !== 'win32') return false;
  return (
    candidate.startsWith('\\\\') ||
    candidate.startsWith('//') ||
    candidate.startsWith('\\\\?\\') ||
    candidate.startsWith('\\\\.\\') ||
    candidate.slice(2).includes(':')
  );
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length === 0 ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

async function realpathIfPresent(
  candidate: string,
): Promise<string | undefined> {
  try {
    return await realpath(candidate);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
}
