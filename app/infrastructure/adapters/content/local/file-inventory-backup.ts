import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { InventoryBackupFilePort } from '../../../../application/inventory/inventory-backup-ports.ts';
import { inventoryTransferProblem } from '../../../../application/inventory/inventory-transfer.ts';
import { ApplicationProblem } from '../../../../application/problems/application-problem.ts';
import { LocalFileSourceAcquisition } from './local-file-source-acquisition.ts';

export class FileInventoryBackup implements InventoryBackupFilePort {
  readonly #source = new LocalFileSourceAcquisition({
    purpose: 'inventory_backup',
  });
  readonly #protectedRoots: readonly string[];

  constructor(options: { readonly protectedRoots: readonly string[] }) {
    this.#protectedRoots = options.protectedRoots.map((root) =>
      path.resolve(root),
    );
  }

  async read(
    inputLocator: string,
    signal: AbortSignal,
    checkBudget: () => void,
  ): Promise<{ readonly bytes: Uint8Array; readonly fingerprint: string }> {
    let handle: string | undefined;
    try {
      checkBudget();
      const registered = await this.#source.registerLocalFile(inputLocator);
      handle = registered.inputHandle;
      checkBudget();
      const input = await this.#source.acquire(handle, 'iso-8859-1', signal);
      const parts: Buffer[] = [];
      const hash = createHash('sha256');
      try {
        for await (const chunk of input.chunks) {
          checkBudget();
          const part = Buffer.from(chunk, 'latin1');
          hash.update(part);
          parts.push(part);
        }
        checkBudget();
        return { bytes: Buffer.concat(parts), fingerprint: hash.digest('hex') };
      } finally {
        await input.close();
      }
    } catch (error) {
      if (
        error instanceof ApplicationProblem &&
        error.problemCode.startsWith('inventory_transfer.')
      )
        throw error;
      if (signal.aborted) throw inventoryTransferProblem('interrupted');
      if (
        error instanceof ApplicationProblem &&
        error.problemCode === 'import.input_too_large'
      )
        throw inventoryTransferProblem('resource_exhausted');
      throw inventoryTransferProblem('file_read_failed');
    } finally {
      if (handle !== undefined) this.#source.forget(handle);
    }
  }

  async write(
    destinationPath: string,
    bytes: Uint8Array,
    signal: AbortSignal,
    checkBudget: () => void,
  ): Promise<{ readonly fileName: string }> {
    let temporary: string | undefined;
    try {
      checkBudget();
      if (signal.aborted) throw inventoryTransferProblem('interrupted');
      if (bytes.byteLength > 64 * 1024 * 1024)
        throw inventoryTransferProblem('resource_exhausted');
      const destination = await this.#destination(destinationPath);
      checkBudget();
      const temporaryPath = path.join(
        destination.parent,
        `.plysmith-backup-${process.pid}-${randomUUID()}.tmp`,
      );
      const file = await open(temporaryPath, 'wx', 0o600);
      temporary = temporaryPath;
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      checkBudget();
      // Recheck the real parent just before the no-replace publication.
      if (
        (await realpath(path.dirname(path.resolve(destinationPath)))) !==
        destination.parent
      )
        throw inventoryTransferProblem('file_write_failed');
      if (signal.aborted) throw inventoryTransferProblem('interrupted');
      await link(temporaryPath, destination.filePath);
      return { fileName: path.basename(destination.filePath) };
    } catch (error) {
      if (error instanceof ApplicationProblem) throw error;
      if (errorCode(error) === 'EEXIST')
        throw inventoryTransferProblem('destination_exists');
      throw inventoryTransferProblem('file_write_failed');
    } finally {
      // Cleanup is best effort after publication; a complete backup stays valid.
      if (temporary !== undefined) await unlink(temporary).catch(() => {});
    }
  }

  async #destination(
    candidate: string,
  ): Promise<{ readonly parent: string; readonly filePath: string }> {
    if (
      !path.isAbsolute(candidate) ||
      !candidate.toLowerCase().endsWith('.pgn') ||
      unsafePath(candidate)
    )
      throw inventoryTransferProblem('invalid_request');
    const resolved = path.resolve(candidate);
    for (const root of this.#protectedRoots)
      if (within(root, resolved))
        throw inventoryTransferProblem('invalid_request');
    const parent = await realpath(path.dirname(resolved));
    const filePath = path.join(parent, path.basename(resolved));
    for (const root of this.#protectedRoots) {
      const actual = await realpath(root).catch(() => root);
      if (within(actual, filePath))
        throw inventoryTransferProblem('invalid_request');
    }
    try {
      await lstat(filePath);
      throw inventoryTransferProblem('destination_exists');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
    return { parent, filePath };
  }
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function unsafePath(candidate: string): boolean {
  if (/[\u0000-\u001f]/.test(candidate)) return true;
  if (process.platform !== 'win32') return false;
  if (candidate.startsWith('\\\\?\\') || candidate.startsWith('\\\\.\\'))
    return true;
  return candidate
    .slice(2)
    .split(/[\\/]/)
    .some(
      (part) =>
        part.includes(':') ||
        /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    );
}

function errorCode(error: unknown): string | undefined {
  return error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}
