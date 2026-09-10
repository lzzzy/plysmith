import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { HostLifecycleProblem } from './host-lifecycle-problem.ts';
import {
  readPrivateWindowsRuntimeFile,
  withPrivateWindowsRuntime,
} from './private-runtime.ts';

export interface HostDiscoveryRecord {
  readonly ownerId: string;
  readonly pid: number;
  readonly endpoint: string;
  readonly productRelease: string;
  readonly contractFingerprint: string;
  readonly token: string;
}

export async function publishHostDiscovery(
  applicationHome: string,
  record: HostDiscoveryRecord,
): Promise<void> {
  assertValidDiscovery(record);
  const runtimeDirectory = path.resolve(applicationHome, 'runtime');
  const discoveryPath = path.join(runtimeDirectory, 'host.json');
  const temporaryPath = path.join(
    runtimeDirectory,
    `.host-${randomUUID()}.tmp`,
  );
  try {
    await withPrivateWindowsRuntime(
      applicationHome,
      `
      $discoveryPath = [IO.Path]::Combine($runtimePath, 'host.json')
      if (Test-Path -LiteralPath $discoveryPath) {
        $existing = Open-PrivateFile $discoveryPath Open
        $existing.Dispose()
      }
      $temporary = Open-PrivateFile $inputData.temporaryPath CreateNew
      $temporary.Dispose()
      `,
      { temporaryPath },
    );
    await writeFile(temporaryPath, `${JSON.stringify(record)}\n`, {
      encoding: 'utf8',
      flag: 'r+',
    });
    await rename(temporaryPath, discoveryPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function readHostDiscovery(
  applicationHome: string,
): Promise<HostDiscoveryRecord> {
  let serialized: string;
  try {
    serialized = await readPrivateWindowsRuntimeFile(
      applicationHome,
      'host.json',
    );
  } catch (error) {
    if (error instanceof HostLifecycleProblem) {
      throw error;
    }
    throw new HostLifecycleProblem('host.discovery_missing');
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized);
  } catch {
    throw new HostLifecycleProblem('host.discovery_invalid');
  }

  assertValidDiscovery(candidate);
  return Object.freeze({ ...candidate });
}

export async function clearHostDiscovery(
  applicationHome: string,
  ownerId: string,
): Promise<void> {
  try {
    const discovery = await readHostDiscovery(applicationHome);
    if (discovery.ownerId === ownerId) {
      await rm(path.join(applicationHome, 'runtime', 'host.json'), {
        force: true,
      });
    }
  } catch (error) {
    if (
      !(error instanceof HostLifecycleProblem) ||
      error.code !== 'host.discovery_missing'
    ) {
      throw error;
    }
  }
}

function assertValidDiscovery(
  candidate: unknown,
): asserts candidate is HostDiscoveryRecord {
  if (!isRecord(candidate)) {
    throw new HostLifecycleProblem('host.discovery_invalid');
  }

  const endpoint = candidate.endpoint;
  let url: URL;
  try {
    url = new URL(typeof endpoint === 'string' ? endpoint : '');
  } catch {
    throw new HostLifecycleProblem('host.discovery_invalid');
  }

  if (
    typeof candidate.ownerId !== 'string' ||
    candidate.ownerId.length === 0 ||
    !Number.isSafeInteger(candidate.pid) ||
    Number(candidate.pid) < 1 ||
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.port.length === 0 ||
    url.pathname !== '/' ||
    typeof candidate.productRelease !== 'string' ||
    candidate.productRelease.length === 0 ||
    typeof candidate.contractFingerprint !== 'string' ||
    candidate.contractFingerprint.length === 0 ||
    typeof candidate.token !== 'string' ||
    candidate.token.length < 32
  ) {
    throw new HostLifecycleProblem('host.discovery_invalid');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
