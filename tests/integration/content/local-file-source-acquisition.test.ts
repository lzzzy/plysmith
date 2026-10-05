import assert from 'node:assert/strict';
import {
  appendFile,
  mkdtemp,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { ContentFormatRegistry } from '../../../app/application/inventory/content-format-registry.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { PgnContentFormatAdapter } from '../../../app/infrastructure/adapters/content/pgn/index.ts';
import { LocalFileSourceAcquisition } from '../../../app/infrastructure/adapters/content/local/local-file-source-acquisition.ts';

async function fixture(
  t: TestContext,
  bytes: string | Uint8Array,
  fileName = 'input.pgn',
) {
  const directory = await mkdtemp(join(tmpdir(), 'plysmith-import-source-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const locator = join(directory, fileName);
  await writeFile(locator, bytes);
  const source = new LocalFileSourceAcquisition();
  return { directory, locator, source };
}

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of chunks) text += chunk;
  return text;
}

test('local input decodes bytes without exposing a checksum API', async (t) => {
  const bytes = Buffer.from(
    '\ufeff[Event "Italienisch"]\n1.e4 e5 2.Nf3 Nc6 3.Bc4 *',
  );
  const { source, locator } = await fixture(t, bytes);
  const descriptor = await source.registerLocalFile(locator);
  assert.deepEqual(Object.keys(descriptor).sort(), [
    'displayName',
    'inputHandle',
    'inputSize',
  ]);
  assert.equal(descriptor.displayName, 'input.pgn');
  assert.equal(descriptor.inputSize, bytes.length);
  const input = await source.acquire(
    descriptor.inputHandle,
    'utf-8',
    new AbortController().signal,
  );
  assert.equal('inputLocator' in input, false);
  assert.equal(await collect(input.chunks), bytes.toString('utf8').slice(1));
  assert.equal('checksum' in input, false);
  await input.close();
  await input.close();
  source.forget(descriptor.inputHandle);
  await assert.rejects(
    source.acquire(
      descriptor.inputHandle,
      'utf-8',
      new AbortController().signal,
    ),
    { problemCode: 'import.input_not_found' },
  );
});

for (const length of [205, 255]) {
  test(`long local filenames preserve all ${length} characters and their format extension`, async (t) => {
    const fileName = 'a'.repeat(length - 4) + '.pgn';
    const { source, locator } = await fixture(t, '*', fileName);
    const descriptor = await source.registerLocalFile(locator);
    assert.equal(descriptor.displayName, fileName);
    const input = await source.acquire(
      descriptor.inputHandle,
      'utf-8',
      new AbortController().signal,
    );
    try {
      assert.equal(input.displayName, fileName);
      const format = new PgnContentFormatAdapter(new ChessJsRulesAdapter());
      const formats = new ContentFormatRegistry([format]);
      assert.equal(formats.resolve(input.displayName), format);
      assert.equal(await collect(input.chunks), '*');
    } finally {
      await input.close();
      source.forget(descriptor.inputHandle);
    }
  });
}

test('invalid UTF-8 requires a deliberate Latin-1 retry, without guessing or replacement characters', async (t) => {
  const text = '[Event "König"]\n*';
  const { source, locator } = await fixture(t, Buffer.from(text, 'latin1'));
  const { inputHandle } = await source.registerLocalFile(locator);
  const utf8 = await source.acquire(
    inputHandle,
    'utf-8',
    new AbortController().signal,
  );
  await assert.rejects(collect(utf8.chunks), {
    problemCode: 'import.encoding_choice_required',
  });
  const latin1 = await source.acquire(
    inputHandle,
    'iso-8859-1',
    new AbortController().signal,
  );
  assert.equal(await collect(latin1.chunks), text);
});

test('a UTF-8 BOM cannot be overridden as Latin-1 and UTF-16 is rejected', async (t) => {
  for (const [bytes, encoding] of [
    [Buffer.from('\ufeff*'), 'iso-8859-1'],
    [Buffer.from([0xff, 0xfe, 0x2a, 0]), 'utf-8'],
  ] as const) {
    const { source, locator } = await fixture(t, bytes);
    const { inputHandle } = await source.registerLocalFile(locator);
    const input = await source.acquire(
      inputHandle,
      encoding,
      new AbortController().signal,
    );
    await assert.rejects(collect(input.chunks), {
      problemCode: 'import.encoding_unsupported',
    });
  }
});

test('empty, oversized, relative, missing and non-file inputs fail before preparation', async (t) => {
  const { source, locator, directory } = await fixture(t, '');
  await assert.rejects(source.registerLocalFile(locator), {
    problemCode: 'import.format_not_recognized',
  });
  for (const path of [
    'relative.pgn',
    directory,
    join(directory, 'missing.pgn'),
  ])
    await assert.rejects(source.registerLocalFile(path), {
      problemCode: 'import.input_not_found',
    });
  await writeFile(locator, Buffer.alloc(16 * 1024 * 1024 + 1));
  await assert.rejects(source.registerLocalFile(locator), {
    problemCode: 'import.input_too_large',
  });
});

test('file identity is checked before reading and again after the last chunk', async (t) => {
  const { source, locator } = await fixture(t, '*');
  const first = await source.registerLocalFile(locator);
  await appendFile(locator, ' ');
  await assert.rejects(
    source.acquire(first.inputHandle, 'utf-8', new AbortController().signal),
    { problemCode: 'import.input_changed' },
  );
  const next = await source.registerLocalFile(locator);
  const input = await source.acquire(
    next.inputHandle,
    'utf-8',
    new AbortController().signal,
  );
  const iterator = input.chunks[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).done, false);
  await appendFile(locator, ' ');
  await assert.rejects(
    (async () => {
      while (!(await iterator.next()).done) {
        /* Drain until identity verification. */
      }
    })(),
    { problemCode: 'import.input_changed' },
  );
});

test('cancelled reads fail and registered inputs remain bounded', async (t) => {
  const { source, locator } = await fixture(t, '*');
  const controller = new AbortController();
  const { inputHandle } = await source.registerLocalFile(locator);
  const input = await source.acquire(inputHandle, 'utf-8', controller.signal);
  controller.abort();
  await assert.rejects(collect(input.chunks), {
    problemCode: 'import.interrupted',
  });
  for (let index = 1; index < 16; index++)
    await source.registerLocalFile(locator);
  await assert.rejects(source.registerLocalFile(locator), {
    problemCode: 'import.input_limit',
  });
});

for (const phase of ['before acquire', 'after first chunk'] as const) {
  test(`same-size mtime changes are rejected ${phase}`, async (t) => {
    const { source, locator } = await fixture(t, '*');
    const before = await stat(locator);
    const { inputHandle } = await source.registerLocalFile(locator);
    const signal = new AbortController().signal;
    const input =
      phase === 'after first chunk'
        ? await source.acquire(inputHandle, 'utf-8', signal)
        : undefined;
    const iterator = input?.chunks[Symbol.asyncIterator]();
    if (iterator) assert.equal((await iterator.next()).done, false);
    await utimes(locator, before.atime, new Date(before.mtimeMs + 60_000));
    assert.equal((await stat(locator)).size, before.size);
    if (iterator) {
      await assert.rejects(iterator.next(), {
        problemCode: 'import.input_changed',
      });
    } else {
      await assert.rejects(source.acquire(inputHandle, 'utf-8', signal), {
        problemCode: 'import.input_changed',
      });
    }
  });

  test(`replaced file identity is rejected ${phase} even with identical size and mtime`, async (t) => {
    const { source, locator } = await fixture(t, '*');
    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    await utimes(locator, timestamp, timestamp);
    const before = await stat(locator);
    const { inputHandle } = await source.registerLocalFile(locator);
    const signal = new AbortController().signal;
    const input =
      phase === 'after first chunk'
        ? await source.acquire(inputHandle, 'utf-8', signal)
        : undefined;
    const iterator = input?.chunks[Symbol.asyncIterator]();
    if (iterator) assert.equal((await iterator.next()).done, false);
    await rename(locator, `${locator}.old`);
    await writeFile(locator, '*');
    await utimes(locator, timestamp, timestamp);
    const replacement = await stat(locator);
    assert.equal(replacement.size, before.size);
    assert.equal(replacement.mtimeMs, before.mtimeMs);
    assert.notEqual(replacement.ino, before.ino);
    if (iterator) {
      await assert.rejects(iterator.next(), {
        problemCode: 'import.input_changed',
      });
    } else {
      await assert.rejects(source.acquire(inputHandle, 'utf-8', signal), {
        problemCode: 'import.input_changed',
      });
    }
  });
}

test('a growing stream cannot exceed the input byte limit', async (t) => {
  const { source, locator } = await fixture(t, '*');
  const { inputHandle } = await source.registerLocalFile(locator);
  const input = await source.acquire(
    inputHandle,
    'utf-8',
    new AbortController().signal,
  );
  const iterator = input.chunks[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).done, false);
  await appendFile(locator, Buffer.alloc(16 * 1024 * 1024, 32));
  await assert.rejects(
    (async () => {
      while (!(await iterator.next()).done) {
        /* Drain through the size boundary. */
      }
    })(),
    { problemCode: 'import.input_too_large' },
  );
});

test('parallel registrations reserve their slots before file operations', async (t) => {
  const { source, locator } = await fixture(t, '*');
  const results = await Promise.allSettled(
    Array.from({ length: 40 }, () => source.registerLocalFile(locator)),
  );
  assert.equal(
    results.filter((entry) => entry.status === 'fulfilled').length,
    16,
  );
  for (const result of results) {
    if (result.status === 'rejected')
      assert.equal(result.reason.problemCode, 'import.input_limit');
  }
});

test('damaged BOM-marked UTF-8 does not offer an impossible Latin-1 retry, including a truncated final sequence', async (t) => {
  for (const tail of [Buffer.from([0xff]), Buffer.from([0xc3])]) {
    const { source, locator } = await fixture(
      t,
      Buffer.concat([Buffer.from('\ufeff[Event "'), tail]),
    );
    const { inputHandle } = await source.registerLocalFile(locator);
    const input = await source.acquire(
      inputHandle,
      'utf-8',
      new AbortController().signal,
    );
    await assert.rejects(collect(input.chunks), {
      problemCode: 'import.encoding_unsupported',
    });
  }
});
