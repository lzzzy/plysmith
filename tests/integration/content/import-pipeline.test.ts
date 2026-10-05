import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import {
  ActiveImportPreviews,
  CheckImportNames,
  PublishImport,
} from '../../../app/application/inventory/import-use-cases.ts';
import type { ContentFormatPort } from '../../../app/application/inventory/content-format-port.ts';
import { IMPORT_LIMITS } from '../../../app/application/inventory/import-limits.ts';
import { measureImportCandidate } from '../../../app/application/inventory/import-content-budget.ts';
import type {
  ImportPreview,
  PublishImportRequest,
} from '../../../app/application/inventory/import-models.ts';
import type { InventoryOrganizationChanged } from '../../../app/application/inventory/inventory-organization-models.ts';
import type { ChessTreeCandidate } from '../../../app/domain/inventory/chess-tree-candidate.ts';
import { LocalFileSourceAcquisition } from '../../../app/infrastructure/adapters/content/local/local-file-source-acquisition.ts';
import { PgnContentFormatAdapter } from '../../../app/infrastructure/adapters/content/pgn/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';

async function fixture(
  t: TestContext,
  additionalFormats: readonly ContentFormatPort[] = [],
) {
  const directory = await mkdtemp(join(tmpdir(), 'plysmith-import-pipeline-'));
  const databasePath = join(directory, 'store.sqlite');
  const repository = new SqlitePersistenceAdapter({ databasePath });
  const source = new LocalFileSourceAcquisition();
  const db = new Database(databasePath);
  const events: InventoryOrganizationChanged[] = [];
  let now = Date.parse('2026-10-02T12:00:00.000Z');
  const clock = { now: () => new Date(now).toISOString() };
  const dependencies = {
    source,
    formats: [
      new PgnContentFormatAdapter(new ChessJsRulesAdapter()),
      ...additionalFormats,
    ],
    repository,
    clock,
    createPreviewId: randomUUID,
  };
  const active = new ActiveImportPreviews(dependencies);
  const publish = new PublishImport({
    active,
    repository,
    clock,
    events: {
      publish: (event) => {
        events.push(event);
      },
    },
  });
  t.after(async () => {
    await active.close();
    db.close();
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function input(text: string | Uint8Array, extension = '.pgn') {
    const path = join(directory, randomUUID() + extension);
    await writeFile(path, text);
    return source.registerLocalFile(path);
  }
  async function prepare(
    text = '[Event "Study"]\n1.e4 e5 (1...c5 {Sicilian}) *',
  ) {
    return active.prepare({
      inputHandle: (await input(text)).inputHandle,
      languageTag: 'en-GB',
    });
  }
  function snapshot() {
    return db.prepare('SELECT * FROM inventory_item').all();
  }
  return {
    repository,
    source,
    active,
    publish,
    events,
    dependencies,
    input,
    prepare,
    snapshot,
    db,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test('previews include all bounded summaries and reject the next candidate without persisting anything', async (t) => {
  const f = await fixture(t);
  const source = Array.from(
    { length: IMPORT_LIMITS.maxCandidates },
    (_, index) => `[Event "Study ${index}"]\n*`,
  ).join('\n');
  const preview = await f.prepare(source);
  assert.equal(preview.candidates.length, IMPORT_LIMITS.maxCandidates);
  assert.equal(
    preview.candidates.at(-1)!.sourceOrder,
    IMPORT_LIMITS.maxCandidates - 1,
  );
  assert.deepEqual(f.snapshot(), []);
  f.active.discard(preview.previewId);
  await assert.rejects(f.prepare(source + '\n[Event "Extra"]\n*'), {
    problemCode: 'import.provider_resource_exhausted',
  });
  assert.deepEqual(f.snapshot(), []);
});

test('targeted preparation cancellation leaves no preview and permits a new import', async (t) => {
  const f = await fixture(t);
  const input = await f.input('Nf3 Nf6 Ng1 Ng8 '.repeat(250) + '*');
  const preparing = f.active.prepare({
    inputHandle: input.inputHandle,
    languageTag: 'en-GB',
  });
  const rejected = assert.rejects(preparing, {
    problemCode: 'import.interrupted',
  });
  assert.deepEqual(await f.active.cancelPreparation(input.inputHandle), {
    cancelled: true,
  });
  await rejected;
  assert.deepEqual(await f.active.cancelPreparation(input.inputHandle), {
    cancelled: false,
  });
  assert.deepEqual(f.snapshot(), []);
  assert.equal((await f.prepare()).candidates.length, 1);
});

test('publication selection is bounded without consuming the larger preview', async (t) => {
  const f = await fixture(t);
  const preview = await f.prepare(
    Array.from(
      { length: 101 },
      (_, index) => `[Event "Study ${index}"] *`,
    ).join('\n'),
  );
  await assert.rejects(f.publish.execute(selection(preview)), {
    problemCode: 'import.invalid_selection',
  });
  assert.deepEqual(f.snapshot(), []);
  const request = selection(preview);
  const result = await f.publish.execute({
    ...request,
    candidates: request.candidates.slice(0, 100),
  });
  assert.equal(result.items.length, 100);
});

test('cumulative preparation and shared retention budgets release rejected and discarded contents', async (t) => {
  const base = new PgnContentFormatAdapter(new ChessJsRulesAdapter());
  let chapter: ChessTreeCandidate | undefined;
  const line = 'Nf3 Nf6 Ng1 Ng8 '.repeat(128).trim();
  await base.decode(
    (async function* () {
      yield `Nf3 (${line}) (${line}) (${line}) ${line.slice(4)} *`;
    })(),
    {
      signal: new AbortController().signal,
      onCandidate: async (candidate) => {
        chapter = candidate;
      },
    },
  );
  assert.equal(chapter!.nodes.length, IMPORT_LIMITS.maxNodesPerCandidate);
  let count = 17;
  const repeated: ContentFormatPort = {
    descriptor: {
      ...base.descriptor,
      formatId: 'budget-test',
      fileExtensions: ['.budget'],
    },
    async decode(_chunks, request) {
      for (let sourceOrder = 0; sourceOrder < count; sourceOrder++)
        await request.onCandidate({ ...chapter!, sourceOrder });
    },
  };
  const f = await fixture(t, [repeated]);
  const prepare = async () =>
    f.active.prepare({
      inputHandle: (await f.input('budget source', '.budget')).inputHandle,
      languageTag: 'en-GB',
    });
  await assert.rejects(prepare(), {
    problemCode: 'import.provider_resource_exhausted',
  });
  count = 16;
  const first = await prepare();
  const second = await prepare();
  count = 1;
  await assert.rejects(prepare(), {
    problemCode: 'import.provider_resource_exhausted',
  });
  f.active.discard(first.previewId);
  const third = await prepare();
  assert.equal(third.candidates.length, 1);
  f.advance(IMPORT_LIMITS.previewLifetimeMs + 1);
  count = 16;
  assert.equal((await prepare()).candidates.length, 16);
  assert.deepEqual(f.active.discard(second.previewId), { discarded: false });
  assert.deepEqual(f.snapshot(), []);
});

test('preparation enforces aggregated note budgets before retaining the next candidate', async (t) => {
  const base = new PgnContentFormatAdapter(new ChessJsRulesAdapter());
  const repeated: ContentFormatPort = {
    descriptor: {
      ...base.descriptor,
      formatId: 'note-budget-test',
      fileExtensions: ['.notes'],
    },
    async decode(_chunks, request) {
      for (let sourceOrder = 0; sourceOrder < 33; sourceOrder++)
        await request.onCandidate({
          sourceOrder,
          suggestedName: `Chapter ${sourceOrder}`,
          status: 'ready',
          root: new ChessJsRulesAdapter().initialState(),
          nodes: [],
          initialComments: ['x'.repeat(IMPORT_LIMITS.maxSingleNoteCharacters)],
          findings: [],
          result: '*',
        });
    },
  };
  const f = await fixture(t, [repeated]);
  await assert.rejects(
    f.active.prepare({
      inputHandle: (await f.input('notes', '.notes')).inputHandle,
      languageTag: 'en-GB',
    }),
    { problemCode: 'import.provider_resource_exhausted' },
  );
  assert.equal((await f.prepare()).candidates.length, 1);
  assert.deepEqual(f.snapshot(), []);
});

test('independent candidate validation counts the text actually retained, including whitespace', () => {
  const candidate: ChessTreeCandidate = {
    sourceOrder: 0,
    suggestedName: 'Text',
    status: 'ready',
    nodes: [],
    initialComments: [' '.repeat(IMPORT_LIMITS.maxSingleNoteCharacters) + 'x'],
    findings: [],
    result: '*',
  };
  assert.throws(() => measureImportCandidate(candidate), {
    problemCode: 'import.provider_resource_exhausted',
  });
});

test('host shutdown aborts a running decoder and forgets provisional contents', async (t) => {
  const started = Promise.withResolvers<void>();
  const base = new PgnContentFormatAdapter(new ChessJsRulesAdapter());
  const waiting: ContentFormatPort = {
    descriptor: {
      ...base.descriptor,
      formatId: 'waiting-test',
      fileExtensions: ['.wait'],
    },
    async decode(_chunks, request) {
      started.resolve();
      await new Promise<void>((resolve) => {
        if (request.signal.aborted) resolve();
        else
          request.signal.addEventListener('abort', () => resolve(), {
            once: true,
          });
      });
    },
  };
  const f = await fixture(t, [waiting]);
  const input = await f.input('test source', '.wait');
  const preparing = f.active.prepare({
    inputHandle: input.inputHandle,
    languageTag: 'en-GB',
  });
  const rejected = assert.rejects(preparing, {
    problemCode: 'import.interrupted',
  });
  await started.promise;
  await f.active.close();
  await rejected;
  assert.deepEqual(f.snapshot(), []);
  await assert.rejects(
    f.source.acquire(input.inputHandle, 'utf-8', new AbortController().signal),
    { problemCode: 'import.input_not_found' },
  );
});

test('preparation deadline reports a resource limit and releases the input and slot', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const started = Promise.withResolvers<void>();
  const base = new PgnContentFormatAdapter(new ChessJsRulesAdapter());
  const waiting: ContentFormatPort = {
    descriptor: {
      ...base.descriptor,
      formatId: 'deadline-test',
      fileExtensions: ['.deadline'],
    },
    async decode(_chunks, request) {
      started.resolve();
      await new Promise<void>((resolve) =>
        request.signal.addEventListener('abort', () => resolve(), {
          once: true,
        }),
      );
    },
  };
  const f = await fixture(t, [waiting]);
  const input = await f.input('deadline source', '.deadline');
  const rejected = assert.rejects(
    f.active.prepare({ inputHandle: input.inputHandle, languageTag: 'en-GB' }),
    {
      problemCode: 'import.provider_resource_exhausted',
    },
  );
  await started.promise;
  t.mock.timers.tick(IMPORT_LIMITS.maxPreparationDurationMs);
  await rejected;
  await assert.rejects(
    f.source.acquire(input.inputHandle, 'utf-8', new AbortController().signal),
    { problemCode: 'import.input_not_found' },
  );
  assert.equal((await f.prepare()).candidates.length, 1);
  assert.deepEqual(f.snapshot(), []);
});

function selection(preview: ImportPreview): PublishImportRequest {
  return {
    previewId: preview.previewId,
    candidates: preview.candidates
      .filter((c) => c.status !== 'rejected')
      .map((c) => ({
        sourceOrder: c.sourceOrder,
        itemType: 'analysis',
        displayName: 'input.pgn - ' + c.suggestedName,
      })),
    folder: { kind: 'new', displayName: 'input.pgn' },
    confirmWarnings: true,
  };
}

test('preparation, cancellation and host restart leave zero database writes and return only summaries', async (t) => {
  const f = await fixture(t);
  const before = await f.repository.readStoreStatus();
  const preview = await f.prepare();
  assert.equal(preview.candidates.length, 1);
  assert.equal(preview.candidates[0]!.moveCount, 3);
  assert.equal('nodes' in preview.candidates[0]!, false);
  assert.deepEqual(f.snapshot(), []);
  assert.deepEqual(await f.repository.readStoreStatus(), before);
  assert.deepEqual(f.active.discard(preview.previewId), { discarded: true });
  assert.deepEqual(f.active.discard(preview.previewId), { discarded: false });
  const other = await f.prepare();
  await f.active.close();
  const restarted = new ActiveImportPreviews(f.dependencies);
  t.after(() => restarted.close());
  await assert.rejects(
    restarted.publish(
      selection(other),
      f.repository,
      f.dependencies.clock.now(),
    ),
    { problemCode: 'import.not_found' },
  );
  assert.deepEqual(f.snapshot(), []);
  assert.deepEqual(f.events, []);
});

test('publishes filtered PGN author text as one ordinary global note per occurrence', async (t) => {
  const f = await fixture(t);
  const preview = await f.prepare(
    '[Event "Notes"] {[%csl Gb1]} {root} 1.e4 {first\n\nparagraph} $1 {last} e5 ({intro} 1...c5 $2 {branch} {[%cal Gc7c5]}) {main} 2.Nf3 $14 {[%eval 0.2][%clk 0:05:00]} *',
  );
  await f.publish.execute(selection(preview));
  const notes = f.db
    .prepare(
      `
    SELECT c.body, c.author_role AS author, c.scope_kind AS scope,
      a.anchor_id AS anchor, a.anchor_kind AS kind
    FROM workspace_contribution c
    JOIN chess_anchor a ON a.anchor_id = c.anchor_id
    WHERE c.contribution_type = 'note' AND c.status = 'active'
    ORDER BY c.contribution_id
  `,
    )
    .all() as {
    body: string;
    author: string;
    scope: string;
    anchor: number;
    kind: string;
  }[];
  assert.deepEqual(
    notes.map((note) => note.body),
    [
      'Event: Notes\n\nroot',
      'first\n\nparagraph\n\nlast\n\nintro',
      'main',
      'branch',
    ],
  );
  assert.equal(new Set(notes.map((note) => note.anchor)).size, notes.length);
  assert.ok(
    notes.every(
      (note) =>
        note.author === 'user' &&
        note.scope === 'global' &&
        note.kind === 'occurrence',
    ),
  );
});

test('publishing concurrently consumes the preview exactly once and emits the ordinary inventory event', async (t) => {
  const f = await fixture(t);
  const preview = await f.prepare();
  const request = selection(preview);
  const results = await Promise.allSettled([
    f.publish.execute(request),
    f.publish.execute(request),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === 'rejected').length,
    1,
  );
  assert.equal(f.snapshot().length, 1);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0]!.kind, 'inventory.organization-changed');
  assert.equal(f.events[0]!.contextId, undefined);
  await assert.rejects(f.publish.execute(request), {
    problemCode: 'import.not_found',
  });
});

test('current name conflicts keep the preview so the user can change complete final names and retry', async (t) => {
  const f = await fixture(t);
  const first = await f.prepare();
  await f.publish.execute({ ...selection(first), folder: { kind: 'unfiled' } });
  const second = await f.prepare();
  const request = {
    ...selection(second),
    folder: { kind: 'unfiled' } as const,
  };
  const checks = await new CheckImportNames(f.repository).execute(request);
  assert.equal(checks.candidates[0]!.available, false);
  await assert.rejects(f.publish.execute(request), {
    problemCode: 'import.name_conflict',
  });
  const result = await f.publish.execute({
    ...request,
    candidates: request.candidates.map((c) => ({
      ...c,
      displayName: checks.candidates[0]!.suggestedDisplayName,
    })),
  });
  assert.equal(result.items.length, 1);
  assert.equal(f.snapshot().length, 2);
});

test('registration and preparation are format neutral and reject unknown formats without falling back', async (t) => {
  const content: ChessTreeCandidate = {
    sourceOrder: 0,
    status: 'ready',
    suggestedName: 'Other format',
    root: new ChessJsRulesAdapter().initialState(),
    nodes: [],
    initialComments: ['Editable note'],
    result: '*',
    findings: [],
  };
  const pgn = new PgnContentFormatAdapter(new ChessJsRulesAdapter());
  const second: ContentFormatPort = {
    descriptor: {
      ...pgn.descriptor,
      formatId: 'test-only-format',
      fileExtensions: ['.study'],
    },
    async decode(chunks, request) {
      let text = '';
      for await (const chunk of chunks) text += chunk;
      assert.equal(text, 'test source');
      await request.onCandidate(content);
      // Mutating adapter-owned objects after emission must not mutate the preview.
      (content.initialComments as string[])[0] = 'Mutated adapter data';
    },
  };
  const f = await fixture(t, [second]);
  const input = await f.input('test source', '.study');
  const preview = await f.active.prepare({
    inputHandle: input.inputHandle,
    languageTag: 'en-GB',
  });
  assert.equal(preview.formatId, 'test-only-format');
  const published = await f.publish.execute(selection(preview));
  const record = (await f.repository.readAnalysisRevision({
    scope: { kind: 'free' },
    ...published.items[0]!,
  }))!;
  assert.equal(record.contributions[0]!.body, 'Editable note');
  const explicit = await f.input('test source', '.data');
  const explicitPreview = await f.active.prepare({
    inputHandle: explicit.inputHandle,
    languageTag: 'en-GB',
    formatId: 'test-only-format',
  });
  assert.equal(explicitPreview.formatId, 'test-only-format');
  const unknown = await f.input('*', '.unknown');
  await assert.rejects(
    f.active.prepare({
      inputHandle: unknown.inputHandle,
      languageTag: 'en-GB',
    }),
    { problemCode: 'import.format_not_recognized' },
  );
  const wrong = await f.input('*');
  await assert.rejects(
    f.active.prepare({
      inputHandle: wrong.inputHandle,
      languageTag: 'en-GB',
      formatId: 'missing',
    }),
    { problemCode: 'import.format_not_recognized' },
  );
});

test('strict encoding failure retains only the intended retry handle, never partial database contents', async (t) => {
  const f = await fixture(t);
  const input = await f.input(Buffer.from('[Event "König"]\n*', 'latin1'));
  await assert.rejects(
    f.active.prepare({ inputHandle: input.inputHandle, languageTag: 'en-GB' }),
    { problemCode: 'import.encoding_choice_required' },
  );
  assert.deepEqual(f.snapshot(), []);
  const preview = await f.active.prepare({
    inputHandle: input.inputHandle,
    encoding: 'iso-8859-1',
    languageTag: 'en-GB',
  });
  assert.equal(preview.candidates[0]!.suggestedName, 'König');
  await assert.rejects(
    f.source.acquire(input.inputHandle, 'utf-8', new AbortController().signal),
    { problemCode: 'import.input_not_found' },
  );
});

test('previews are bounded, expire, and reject publication of rejected or unconfirmed warning candidates', async (t) => {
  const f = await fixture(t);
  const first = await f.prepare();
  await f.prepare();
  await f.prepare();
  await assert.rejects(f.prepare(), { problemCode: 'import.preparation_busy' });
  f.advance(30 * 60 * 1000);
  await assert.rejects(f.publish.execute(selection(first)), {
    problemCode: 'import.not_found',
  });
  const rejected = await f.prepare('[Event "Bad"]\n1.e5 *');
  await assert.rejects(
    f.publish.execute({
      ...selection(rejected),
      candidates: [
        { sourceOrder: 0, displayName: 'Bad', itemType: 'analysis' },
      ],
    }),
    { problemCode: 'import.invalid_selection' },
  );
  f.active.discard(rejected.previewId);
  const warning = await f.prepare('[Event "Warning"]\n1.e4');
  assert.equal(warning.candidates[0]!.status, 'warning');
  await assert.rejects(
    f.publish.execute({ ...selection(warning), confirmWarnings: false }),
    { problemCode: 'import.warning_confirmation_required' },
  );
  await f.publish.execute(selection(warning));
});

test('late decoder failure discards all candidates and input handles without writes', async (t) => {
  const base = new PgnContentFormatAdapter(new ChessJsRulesAdapter());
  const bad: ContentFormatPort = {
    descriptor: {
      ...base.descriptor,
      formatId: 'test-failure',
      fileExtensions: ['.fail'],
    },
    async decode(_chunks, request) {
      await request.onCandidate({
        sourceOrder: 0,
        status: 'ready',
        suggestedName: 'Provisional',
        root: new ChessJsRulesAdapter().initialState(),
        nodes: [],
        initialComments: [],
        result: '*',
        findings: [],
      });
      throw new Error('Late decoder failure');
    },
  };
  const f = await fixture(t, [bad]);
  const input = await f.input('source', '.fail');
  await assert.rejects(
    f.active.prepare({ inputHandle: input.inputHandle, languageTag: 'en-GB' }),
    /Late decoder failure/,
  );
  assert.deepEqual(f.snapshot(), []);
  await assert.rejects(
    f.source.acquire(input.inputHandle, 'utf-8', new AbortController().signal),
    { problemCode: 'import.input_not_found' },
  );
});
