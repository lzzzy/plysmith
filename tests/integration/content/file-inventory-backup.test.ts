import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fileSystem, {
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { FileInventoryBackup } from '../../../app/infrastructure/adapters/content/local/file-inventory-backup.ts';
import { LocalFileSourceAcquisition } from '../../../app/infrastructure/adapters/content/local/local-file-source-acquisition.ts';

const signal = new AbortController().signal;
const budget = () => {};

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'plysmith-backup-files-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  await mkdir(home);
  return {
    root,
    home,
    files: new FileInventoryBackup({ protectedRoots: [home] }),
  };
}

test('partial disk-full write removes its private file and never publishes a target', async (t) => {
  const { root, files } = await fixture(t);
  const probePath = join(root, 'probe.tmp');
  const probe = await open(probePath, 'wx');
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  await probe.close();
  await unlink(probePath);
  let partialBytes = 0;
  t.mock.method(prototype, 'writeFile', async function (this: FileHandle) {
    partialBytes = (await this.write(Buffer.from('partial'))).bytesWritten;
    throw Object.assign(new Error('simulated disk full'), { code: 'ENOSPC' });
  });
  await assert.rejects(
    files.write(join(root, 'backup.pgn'), new Uint8Array([1]), signal, budget),
    {
      problemCode: 'inventory_transfer.file_write_failed',
    },
  );
  assert.equal(partialBytes, 7);
  assert.deepEqual(await readdir(root), ['home']);
});

test('close failure prevents publication and removes the completed private file', async (t) => {
  const { root, files } = await fixture(t);
  const originalOpen = fileSystem.open;
  t.mock.method(
    fileSystem,
    'open',
    async (...args: Parameters<typeof originalOpen>) => {
      const handle = await originalOpen(...args);
      const close = handle.close;
      handle.close = async () => {
        await close.call(handle);
        throw Object.assign(new Error('simulated close failure'), {
          code: 'EIO',
        });
      };
      return handle;
    },
  );
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      files.write(
        join(root, 'backup.pgn'),
        new Uint8Array([1]),
        signal,
        budget,
      ),
      {
        problemCode: 'inventory_transfer.file_write_failed',
      },
    );
    assert.deepEqual(await readdir(root), ['home']);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('a competing destination at the publication point remains byte-identical', async (t) => {
  const { root, files } = await fixture(t);
  const destination = join(root, 'backup.pgn');
  const originalLink = fileSystem.link;
  t.mock.method(fileSystem, 'link', async (source: string, target: string) => {
    await writeFile(target, 'competing writer', { flag: 'wx' });
    await originalLink(source, target);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      files.write(destination, new Uint8Array([1]), signal, budget),
      {
        problemCode: 'inventory_transfer.destination_exists',
      },
    );
    assert.equal(await readFile(destination, 'utf8'), 'competing writer');
    assert.deepEqual((await readdir(root)).sort(), ['backup.pgn', 'home']);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('temporary cleanup failure after publication does not invalidate the backup', async (t) => {
  const { root, files } = await fixture(t);
  const destination = join(root, 'backup.pgn');
  const bytes = new Uint8Array([1, 2, 3]);
  t.mock.method(fileSystem, 'unlink', async () => {
    throw Object.assign(new Error('simulated cleanup failure'), {
      code: 'EIO',
    });
  });
  syncBuiltinESMExports();
  try {
    assert.deepEqual(await files.write(destination, bytes, signal, budget), {
      fileName: 'backup.pgn',
    });
    assert.deepEqual(await readFile(destination), Buffer.from(bytes));
    assert.equal(
      (await readdir(root)).filter((name) =>
        name.startsWith('.plysmith-backup-'),
      ).length,
      1,
    );
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('backup file publishes exact bytes, never replaces existing targets and removes private temporary files', async (t) => {
  const { root, files } = await fixture(t);
  const destination = join(root, 'backup.pgn');
  const bytes = Buffer.from('[Event "König"]\n\n*\n', 'latin1');
  assert.deepEqual(await files.write(destination, bytes, signal, budget), {
    fileName: 'backup.pgn',
  });
  assert.deepEqual(await readFile(destination), bytes);
  await assert.rejects(
    files.write(destination, new Uint8Array([0]), signal, budget),
    { problemCode: 'inventory_transfer.destination_exists' },
  );
  assert.deepEqual(await readFile(destination), bytes);
  assert.deepEqual((await readdir(root)).sort(), ['backup.pgn', 'home']);
});

test('backup read preserves Latin1 and CRLF bytes and fingerprints the entire original input', async (t) => {
  const { root, files } = await fixture(t);
  const input = join(root, 'input.pgn');
  const bytes = Buffer.from('[Event "König"]\r\n\r\n*\r\n', 'latin1');
  await writeFile(input, bytes);
  const result = await files.read(input, signal, budget);
  assert.deepEqual(result.bytes, bytes);
  assert.equal(
    result.fingerprint,
    createHash('sha256').update(bytes).digest('hex'),
  );
});

test('unsafe, protected and missing-parent destinations fail without writes or raw paths', async (t) => {
  const { root, home, files } = await fixture(t);
  for (const path of [
    'relative.pgn',
    join(home, 'backup.pgn'),
    join(root, 'missing', 'backup.pgn'),
    join(root, 'wrong.txt'),
  ])
    await assert.rejects(
      files.write(path, new Uint8Array([1]), signal, budget),
      (error: unknown) => {
        assert(error instanceof Error);
        assert(!error.message.includes(root));
        return true;
      },
    );
  assert.deepEqual(await readdir(home), []);
  assert.deepEqual(await readdir(root), ['home']);
});

test('reparse parent cannot bypass protected destination checks', async (t) => {
  const { root, home, files } = await fixture(t);
  const alias = join(root, 'alias');
  await symlink(home, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    files.write(join(alias, 'backup.pgn'), new Uint8Array([1]), signal, budget),
    { problemCode: 'inventory_transfer.invalid_request' },
  );
  assert.deepEqual(await readdir(home), []);
});

test('deadline or cancellation before publication leaves no visible or private partial backup', async (t) => {
  const { root, files } = await fixture(t);
  const destination = join(root, 'backup.pgn');
  let checks = 0;
  await assert.rejects(
    files.write(destination, new Uint8Array([1, 2, 3]), signal, () => {
      if (++checks === 3) throw new Error('test deadline');
    }),
    { problemCode: 'inventory_transfer.file_write_failed' },
  );
  assert.deepEqual(await readdir(root), ['home']);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    files.write(destination, new Uint8Array([1]), cancelled.signal, budget),
    { problemCode: 'inventory_transfer.interrupted' },
  );
  assert.deepEqual(await readdir(root), ['home']);
});

test('read errors are closed and never expose the source locator', async (t) => {
  const { root, files } = await fixture(t);
  const path = join(root, 'secret-name.pgn');
  await assert.rejects(files.read(path, signal, budget), {
    problemCode: 'inventory_transfer.file_read_failed',
  });
});

test('ordinary source detects own Latin1 backup before its import size limit', async (t) => {
  const { root } = await fixture(t);
  const input = join(root, 'large.pgn');
  const prefix = Buffer.from(
    '[Event "König"]\n\n{[%plysmith 1,\ne30\n]\n}\n*\n',
    'latin1',
  );
  const bytes = Buffer.alloc(16 * 1024 * 1024 + 1, 32);
  prefix.copy(bytes);
  await writeFile(input, bytes);
  await assert.rejects(
    new LocalFileSourceAcquisition().registerLocalFile(input),
    { problemCode: 'inventory_transfer.restore_required' },
  );
  const source = new LocalFileSourceAcquisition({
    purpose: 'inventory_backup',
  });
  const registered = await source.registerLocalFile(input);
  assert.equal(registered.inputSize, bytes.byteLength);
  source.forget(registered.inputHandle);
});
