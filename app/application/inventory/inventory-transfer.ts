import { ApplicationProblem } from '../problems/application-problem.ts';
import type { InventoryClock } from './inventory-ports.ts';
import type { InventoryTransferRepository } from './pgn-transfer-ports.ts';
import type {
  InventoryTransferSnapshot,
  PreparedInventoryRestore,
} from './pgn-transfer-models.ts';
import type {
  InventoryBackupCounts,
  InventoryBackupCreated,
  InventoryBackupStatus,
  InventoryRestored,
  InventoryRestorePreview,
} from './inventory-backup-models.ts';
import type {
  InventoryBackupFilePort,
  PgnTransferCodecPort,
} from './inventory-backup-ports.ts';

const lifetimeMs = 10 * 60 * 1000;
const preparationMs = 120_000;
const publicationMs = 30_000;
const restoreIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function inventoryTransferProblem(code: string): ApplicationProblem {
  return new ApplicationProblem(
    `inventory_transfer.${code}`,
    `Inventory transfer: ${code}.`,
  );
}

interface PreparedRestore {
  readonly preview: InventoryRestorePreview;
  readonly package: PreparedInventoryRestore;
}

export class InventoryTransferService {
  readonly #repository: InventoryTransferRepository;
  readonly #codec: PgnTransferCodecPort;
  readonly #files: InventoryBackupFilePort;
  readonly #clock: InventoryClock;
  readonly #runtimeBlockers: () => readonly string[];
  readonly #changed: (dataRevision: number, occurredAt: string) => void;
  readonly #cancelled = new Map<string, number>();
  readonly #used = new Map<string, number>();
  #prepared: PreparedRestore | undefined;
  #active:
    | {
        readonly id: string | undefined;
        readonly controller: AbortController;
        publishing: boolean;
      }
    | undefined;
  #closing = false;
  #pending: Promise<unknown> | undefined;

  constructor(dependencies: {
    readonly repository: InventoryTransferRepository;
    readonly codec: PgnTransferCodecPort;
    readonly files: InventoryBackupFilePort;
    readonly clock: InventoryClock;
    readonly runtimeBlockers?: () => readonly string[];
    readonly changed?: (dataRevision: number, occurredAt: string) => void;
  }) {
    this.#repository = dependencies.repository;
    this.#codec = dependencies.codec;
    this.#files = dependencies.files;
    this.#clock = dependencies.clock;
    this.#runtimeBlockers = dependencies.runtimeBlockers ?? (() => []);
    this.#changed = dependencies.changed ?? (() => {});
  }

  async getStatus(): Promise<InventoryBackupStatus> {
    this.#prune();
    const target = await this.#repository.inspectFreshRestoreTarget();
    const blockerCodes = [...target.blockerCodes, ...this.#runtimeBlockers()];
    if (
      this.#active !== undefined ||
      this.#prepared !== undefined ||
      this.#closing
    )
      blockerCodes.push('transfer_busy');
    const stamp = this.#clock.now().replace(/[-:]/g, '');
    return {
      canRestore: target.canRestore && blockerCodes.length === 0,
      blockerCodes: [...new Set(blockerCodes)],
      suggestedFileName: `plysmith-backup-${stamp.slice(0, 8)}-${stamp.slice(9, 15)}.pgn`,
    };
  }

  createBackup(request: {
    readonly destinationPath: string;
    readonly formatVersion: 1;
  }): Promise<InventoryBackupCreated> {
    if (request.formatVersion !== 1 || !request.destinationPath)
      return Promise.reject(inventoryTransferProblem('invalid_request'));
    return this.#run(
      undefined,
      false,
      preparationMs,
      async (signal, checkBudget) => {
        const snapshot =
          await this.#repository.readPgnTransferSnapshot(checkBudget);
        checkBudget();
        const bytes = await this.#codec.encode(snapshot, signal, checkBudget);
        checkBudget();
        const result = await this.#files.write(
          request.destinationPath,
          bytes,
          signal,
          checkBudget,
        );
        return {
          fileName: result.fileName,
          bytes: bytes.byteLength,
          counts: backupCounts(snapshot.manifest),
          snapshotDataRevision: snapshot.dataRevision,
        };
      },
    );
  }

  prepareRestore(request: {
    readonly restoreId: string;
    readonly inputLocator: string;
  }): Promise<InventoryRestorePreview> {
    if (!restoreIdPattern.test(request.restoreId) || !request.inputLocator)
      return Promise.reject(inventoryTransferProblem('invalid_request'));
    this.#prune();
    if (this.#cancelled.has(request.restoreId))
      return Promise.reject(inventoryTransferProblem('interrupted'));
    if (this.#used.has(request.restoreId))
      return Promise.reject(inventoryTransferProblem('stale_preview'));
    if (this.#used.size >= 256)
      return Promise.reject(inventoryTransferProblem('transfer_busy'));
    return this.#run(
      request.restoreId,
      false,
      preparationMs,
      async (signal, checkBudget) => {
        this.#used.set(request.restoreId, this.#now() + lifetimeMs);
        await this.#assertFresh();
        checkBudget();
        const input = await this.#files.read(
          request.inputLocator,
          signal,
          checkBudget,
        );
        const prepared = await this.#codec.decode(
          input.bytes,
          signal,
          checkBudget,
        );
        checkBudget();
        await this.#assertFresh();
        checkBudget();
        const preview: InventoryRestorePreview = {
          restoreId: request.restoreId,
          fingerprint: input.fingerprint,
          counts: backupCounts(prepared.manifest),
          expiresAt: new Date(this.#now() + lifetimeMs).toISOString(),
        };
        this.#prepared = {
          preview: freezePackage(preview),
          package: freezePackage(prepared),
        };
        return preview;
      },
    );
  }

  restore(request: {
    readonly restoreId: string;
    readonly acceptedFingerprint: string;
  }): Promise<InventoryRestored> {
    this.#prune();
    const prepared = this.#prepared;
    if (
      prepared === undefined ||
      prepared.preview.restoreId !== request.restoreId ||
      prepared.preview.fingerprint !== request.acceptedFingerprint
    )
      return Promise.reject(inventoryTransferProblem('stale_preview'));
    // Consume before yielding; publishing can never be mistaken for a held preview.
    this.#prepared = undefined;
    return this.#run(
      request.restoreId,
      true,
      publicationMs,
      async (_signal, checkBudget) => {
        await this.#assertFresh();
        checkBudget();
        const occurredAt = this.#clock.now();
        const result = await this.#repository.restorePgnTransfer(
          prepared.package,
          occurredAt,
          () => {
            checkBudget();
            this.#assertRuntime();
          },
        );
        if (!result.noOp) this.#changed(result.dataRevision, occurredAt);
        return { ...result, counts: prepared.preview.counts };
      },
    );
  }

  async cancelRestore(
    restoreId: string,
  ): Promise<{ readonly cancelled: boolean }> {
    if (!restoreIdPattern.test(restoreId))
      throw inventoryTransferProblem('invalid_request');
    this.#prune();
    if (this.#active?.id === restoreId && this.#active.publishing)
      throw inventoryTransferProblem('transfer_busy');
    const knownRequest =
      this.#active?.id === restoreId ||
      this.#prepared?.preview.restoreId === restoreId ||
      this.#used.has(restoreId);
    if (!knownRequest) {
      if (!this.#cancelled.has(restoreId) && this.#cancelled.size >= 16)
        throw inventoryTransferProblem('transfer_busy');
      this.#cancelled.set(restoreId, this.#now() + lifetimeMs);
    }
    if (this.#active?.id === restoreId)
      this.#active.controller.abort(inventoryTransferProblem('interrupted'));
    if (this.#prepared?.preview.restoreId === restoreId)
      this.#prepared = undefined;
    return { cancelled: true };
  }

  async close(): Promise<void> {
    this.#closing = true;
    this.#prepared = undefined;
    if (this.#active !== undefined && !this.#active.publishing)
      this.#active.controller.abort(inventoryTransferProblem('interrupted'));
    await this.#pending?.catch(() => {});
    this.#cancelled.clear();
    this.#used.clear();
  }

  #run<T>(
    id: string | undefined,
    publishing: boolean,
    duration: number,
    work: (signal: AbortSignal, checkBudget: () => void) => Promise<T>,
  ): Promise<T> {
    this.#prune();
    if (
      this.#closing ||
      this.#active !== undefined ||
      this.#prepared !== undefined
    )
      return Promise.reject(inventoryTransferProblem('transfer_busy'));
    if (id !== undefined && this.#cancelled.has(id))
      return Promise.reject(inventoryTransferProblem('interrupted'));
    const controller = new AbortController();
    const deadline = Date.now() + duration;
    this.#active = { id, controller, publishing };
    const timer = setTimeout(
      () => controller.abort(inventoryTransferProblem('resource_exhausted')),
      duration,
    );
    const checkBudget = () => {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (Date.now() >= deadline)
        throw inventoryTransferProblem('resource_exhausted');
    };
    const promise = Promise.resolve()
      .then(() => work(controller.signal, checkBudget))
      .finally(() => {
        clearTimeout(timer);
        this.#active = undefined;
        this.#pending = undefined;
      });
    this.#pending = promise;
    return promise;
  }

  async #assertFresh(): Promise<void> {
    this.#assertRuntime();
    const target = await this.#repository.inspectFreshRestoreTarget();
    if (!target.canRestore) throw inventoryTransferProblem('target_not_empty');
    this.#assertRuntime();
  }

  #assertRuntime(): void {
    if (this.#runtimeBlockers().length > 0)
      throw inventoryTransferProblem('transfer_busy');
  }

  #now(): number {
    return Date.parse(this.#clock.now());
  }

  #prune(): void {
    const now = this.#now();
    if (
      this.#prepared !== undefined &&
      Date.parse(this.#prepared.preview.expiresAt) <= now
    )
      this.#prepared = undefined;
    for (const values of [this.#cancelled, this.#used])
      for (const [key, expiry] of values) if (expiry <= now) values.delete(key);
  }
}

function backupCounts(
  manifest: InventoryTransferSnapshot['manifest'],
): InventoryBackupCounts {
  const current = manifest.items.filter((item) => item.role === 'inventory');
  return {
    analyses: current.filter((item) => item.itemType === 'analysis').length,
    games: current.filter((item) => item.itemType === 'game').length,
    folders: manifest.folders.length,
    provenanceRecords: manifest.records.length - current.length,
    contributions: manifest.contributions.length,
  };
}

function freezePackage<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezePackage(child);
  }
  return value;
}
