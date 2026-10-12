import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { InventoryTransferService } from '../../../app/application/inventory/inventory-transfer.ts';
import type {
  InventoryBackupFilePort,
  PgnTransferCodecPort,
} from '../../../app/application/inventory/inventory-backup-ports.ts';
import type { InventoryTransferRepository } from '../../../app/application/inventory/pgn-transfer-ports.ts';
import type { PreparedInventoryRestore } from '../../../app/application/inventory/pgn-transfer-models.ts';

const id = '01234567-1234-4321-8123-123456789abc';
const fingerprint = 'f'.repeat(64);

function fixture(t: TestContext) {
  let now = '2026-10-12T12:00:00.000Z';
  let fresh = true;
  let blockers: string[] = [];
  let reads = 0;
  let decodes = 0;
  let writes = 0;
  let restores = 0;
  const events: number[] = [];
  const prepared: PreparedInventoryRestore = {
    manifest: {
      version: 1,
      pgnSha256: 'a'.repeat(64),
      carrier: true,
      folders: [],
      items: [],
      records: [],
      anchors: [],
      contributions: [],
    },
    records: [],
  };
  const files: InventoryBackupFilePort = {
    async read() {
      reads++;
      return { bytes: new Uint8Array([1]), fingerprint };
    },
    async write() {
      writes++;
      return { fileName: 'backup.pgn' };
    },
  };
  const codec: PgnTransferCodecPort = {
    async encode() {
      return new Uint8Array([1]);
    },
    async decode() {
      decodes++;
      return structuredClone(prepared);
    },
  };
  const repository: InventoryTransferRepository = {
    async inspectFreshRestoreTarget() {
      return { canRestore: fresh, blockerCodes: fresh ? [] : ['inventory'] };
    },
    async readPgnTransferSnapshot(checkBudget) {
      checkBudget();
      return { manifest: prepared.manifest, records: [], dataRevision: 7 };
    },
    async restorePgnTransfer(_package, _occurredAt, checkBudget) {
      checkBudget();
      restores++;
      return { dataRevision: 8, noOp: false };
    },
  };
  const service = new InventoryTransferService({
    repository,
    codec,
    files,
    clock: { now: () => now },
    runtimeBlockers: () => blockers,
    changed: (revision) => events.push(revision),
  });
  t.after(() => service.close());
  return {
    service,
    files,
    codec,
    repository,
    prepared,
    events,
    setFresh(value: boolean) {
      fresh = value;
    },
    setBlockers(value: string[]) {
      blockers = value;
    },
    setNow(value: string) {
      now = value;
    },
    counts: () => ({ reads, decodes, writes, restores }),
  };
}

test('backup reads saved snapshot and reports its revision without requiring a fresh source', async (t) => {
  const f = fixture(t);
  f.setFresh(false);
  const result = await f.service.createBackup({
    destinationPath: 'backup.pgn',
    formatVersion: 1,
  });
  assert.equal(result.snapshotDataRevision, 7);
  assert.equal(result.bytes, 1);
  assert.equal(f.counts().writes, 1);
  assert.deepEqual(f.events, []);
});

test('restore binds the entire input fingerprint and publishes the cached package only once', async (t) => {
  const f = fixture(t);
  const preview = await f.service.prepareRestore({
    restoreId: id,
    inputLocator: 'backup.pgn',
  });
  assert.equal(preview.fingerprint, fingerprint);
  await assert.rejects(
    f.service.restore({ restoreId: id, acceptedFingerprint: 'a'.repeat(64) }),
    { problemCode: 'inventory_transfer.stale_preview' },
  );
  const result = await f.service.restore({
    restoreId: id,
    acceptedFingerprint: fingerprint,
  });
  assert.equal(result.dataRevision, 8);
  assert.deepEqual(f.counts(), {
    reads: 1,
    decodes: 1,
    writes: 0,
    restores: 1,
  });
  assert.deepEqual(f.events, [8]);
  await assert.rejects(
    f.service.restore({ restoreId: id, acceptedFingerprint: fingerprint }),
    { problemCode: 'inventory_transfer.stale_preview' },
  );
});

test('held preview excludes another transfer until explicit cancel', async (t) => {
  const f = fixture(t);
  await f.service.prepareRestore({ restoreId: id, inputLocator: 'backup.pgn' });
  await assert.rejects(
    f.service.createBackup({ destinationPath: 'b.pgn', formatVersion: 1 }),
    { problemCode: 'inventory_transfer.transfer_busy' },
  );
  assert.equal((await f.service.getStatus()).canRestore, false);
  await f.service.cancelRestore(id);
  assert.equal((await f.service.getStatus()).canRestore, true);
});

test('DELETE before preview prevents any file read and is bounded', async (t) => {
  const f = fixture(t);
  await f.service.cancelRestore(id);
  await assert.rejects(
    f.service.prepareRestore({ restoreId: id, inputLocator: 'backup.pgn' }),
    { problemCode: 'inventory_transfer.interrupted' },
  );
  for (let n = 1; n < 16; n++)
    await f.service.cancelRestore(
      `01234567-1234-4321-8123-${String(n).padStart(12, '0')}`,
    );
  await assert.rejects(
    f.service.cancelRestore('11234567-1234-4321-8123-123456789abc'),
    { problemCode: 'inventory_transfer.transfer_busy' },
  );
  assert.equal(f.counts().reads, 0);
});

test('cancel while reading cannot resurrect a late preview', async (t) => {
  const f = fixture(t);
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  f.files.read = async () => {
    started.resolve();
    await finish.promise;
    return { bytes: new Uint8Array([1]), fingerprint };
  };
  const pending = f.service.prepareRestore({
    restoreId: id,
    inputLocator: 'backup.pgn',
  });
  await started.promise;
  await f.service.cancelRestore(id);
  finish.resolve();
  await assert.rejects(pending, {
    problemCode: 'inventory_transfer.interrupted',
  });
  await assert.rejects(
    f.service.restore({ restoreId: id, acceptedFingerprint: fingerprint }),
    { problemCode: 'inventory_transfer.stale_preview' },
  );
  assert.equal(f.counts().restores, 0);
});

test('a full early-cancel cache never prevents cancellation of an existing preparation', async (t) => {
  const f = fixture(t);
  for (let n = 0; n < 16; n++)
    await f.service.cancelRestore(
      `01234567-1234-4321-8123-${String(n).padStart(12, '0')}`,
    );
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  f.files.read = async () => {
    started.resolve();
    await finish.promise;
    return { bytes: new Uint8Array([1]), fingerprint };
  };
  const preparing = f.service.prepareRestore({
    restoreId: id,
    inputLocator: 'backup.pgn',
  });
  await started.promise;
  try {
    assert.deepEqual(await f.service.cancelRestore(id), { cancelled: true });
    finish.resolve();
    await assert.rejects(preparing, {
      problemCode: 'inventory_transfer.interrupted',
    });
  } finally {
    finish.resolve();
    await preparing.catch(() => {});
  }
});

test('changing target or runtime after preview blocks publication without clearing other content', async (t) => {
  const f = fixture(t);
  await f.service.prepareRestore({ restoreId: id, inputLocator: 'backup.pgn' });
  f.setFresh(false);
  await assert.rejects(
    f.service.restore({ restoreId: id, acceptedFingerprint: fingerprint }),
    { problemCode: 'inventory_transfer.target_not_empty' },
  );
  assert.equal(f.counts().restores, 0);
  f.setFresh(true);
  f.setBlockers(['import_active']);
  await assert.rejects(
    f.service.prepareRestore({
      restoreId: '11234567-1234-4321-8123-123456789abc',
      inputLocator: 'backup.pgn',
    }),
    { problemCode: 'inventory_transfer.transfer_busy' },
  );
});

test('freshness is rechecked at publication entry and a no-op emits no inventory event', async (t) => {
  const f = fixture(t);
  await f.service.prepareRestore({ restoreId: id, inputLocator: 'backup.pgn' });
  f.repository.restorePgnTransfer = async (_package, _at, checkBudget) => {
    f.setBlockers(['live_active']);
    checkBudget();
    return { dataRevision: 7, noOp: true };
  };
  await assert.rejects(
    f.service.restore({ restoreId: id, acceptedFingerprint: fingerprint }),
    { problemCode: 'inventory_transfer.transfer_busy' },
  );
  assert.deepEqual(f.events, []);
  f.setBlockers([]);
  const secondId = '11234567-1234-4321-8123-123456789abc';
  await f.service.prepareRestore({
    restoreId: secondId,
    inputLocator: 'backup.pgn',
  });
  f.repository.restorePgnTransfer = async () => ({
    dataRevision: 7,
    noOp: true,
  });
  const result = await f.service.restore({
    restoreId: secondId,
    acceptedFingerprint: fingerprint,
  });
  assert.equal(result.noOp, true);
  assert.deepEqual(f.events, []);
});

test('preview expiry and shutdown reject stale or new requests', async (t) => {
  const f = fixture(t);
  await f.service.prepareRestore({ restoreId: id, inputLocator: 'backup.pgn' });
  f.setNow('2026-10-12T12:10:00.000Z');
  await assert.rejects(
    f.service.restore({ restoreId: id, acceptedFingerprint: fingerprint }),
    { problemCode: 'inventory_transfer.stale_preview' },
  );
  await f.service.close();
  await assert.rejects(
    f.service.createBackup({ destinationPath: 'b.pgn', formatVersion: 1 }),
    { problemCode: 'inventory_transfer.transfer_busy' },
  );
});

test('publication locks cancel until transaction completes', async (t) => {
  const f = fixture(t);
  await f.service.prepareRestore({ restoreId: id, inputLocator: 'backup.pgn' });
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  f.repository.restorePgnTransfer = async () => {
    entered.resolve();
    await finish.promise;
    return { dataRevision: 8, noOp: false };
  };
  const pending = f.service.restore({
    restoreId: id,
    acceptedFingerprint: fingerprint,
  });
  await entered.promise;
  await assert.rejects(f.service.cancelRestore(id), {
    problemCode: 'inventory_transfer.transfer_busy',
  });
  finish.resolve();
  assert.equal((await pending).dataRevision, 8);
});
