import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { Chess } from 'chess.js';
import type {
  InventoryTransferSnapshot,
  PgnTransferManifest,
  TransferChessRecord,
  TransferMove,
} from '../../../app/application/inventory/pgn-transfer-models.ts';
import { ApplicationProblem } from '../../../app/application/problems/application-problem.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import {
  PgnContentFormatAdapter,
  PgnInventoryTransferCodec,
  containsPgnTransferMarker,
} from '../../../app/infrastructure/adapters/content/pgn/index.ts';
import {
  playTransferMoves,
  transferCheckpoint,
} from '../../../app/infrastructure/adapters/content/pgn/pgn-transfer-graph.ts';
import { inheritedSourcePathSnapshot } from '../../fixtures/pgn-transfer-source-path.ts';

const rules = new ChessJsRulesAdapter();
const codec = new PgnInventoryTransferCodec(rules);
const signal = new AbortController().signal;
const budget = (): void => {};
const time = '2026-10-12T10:00:00.000Z';
type Mutable<T> = T extends object
  ? { -readonly [P in keyof T]: Mutable<T[P]> }
  : T;

async function* chunks(text: string): AsyncIterable<string> {
  for (const c of text) yield c;
}
async function snapshot(
  pgn = '1. e4 e5 (1... c5 2. Nf3 (2. Nc3)) 2. Nf3 *',
): Promise<Mutable<InventoryTransferSnapshot>> {
  const records: TransferChessRecord[] = [];
  await new PgnContentFormatAdapter(rules).decode(chunks(pgn), {
    signal,
    onCandidate: async (c) => {
      assert.ok(c.root);
      assert.notEqual(c.status, 'rejected');
      records.push({ root: c.root, nodes: c.nodes, result: c.result });
    },
  });
  const value: InventoryTransferSnapshot = {
    dataRevision: 3,
    records,
    manifest: {
      version: 1,
      carrier: false,
      folders: [],
      items: [
        {
          id: 'i1',
          role: 'inventory',
          itemType: 'analysis',
          originKind: 'manual',
          lifecycle: 'active',
          folder: null,
          currentRevision: 'r1',
          retainedRevision: null,
          createdAt: time,
          updatedAt: time,
        },
      ],
      records: [
        {
          id: 'r1',
          item: 'i1',
          pgnIndex: 0,
          revisionNumber: 1,
          baseRevision: null,
          changeKind: 'created',
          name: 'Test',
          summary: null,
          languageTag: 'de-DE',
          creatorRole: 'user',
          createdAt: time,
          origin: { kind: pgn.includes('FEN') ? 'fen' : 'initial_position' },
          nodes: [
            ['o1', null, 'complete'],
            ...records[0]!.nodes.map(
              (n) =>
                [
                  `o${n.nodeIndex + 2}`,
                  `m${n.nodeIndex + 1}`,
                  'partial',
                ] as const,
            ),
          ],
          game: null,
          sourcePath: null,
        },
      ],
      anchors: [],
      contributions: [],
    },
  };
  return structuredClone(value) as Mutable<InventoryTransferSnapshot>;
}

function carrier(): InventoryTransferSnapshot {
  return {
    dataRevision: 0,
    records: [],
    manifest: {
      version: 1,
      carrier: true,
      folders: [
        { id: 'f1', parent: null, name: 'Empty' },
        { id: 'f2', parent: 'f1', name: 'Child' },
      ],
      items: [],
      records: [],
      anchors: [],
      contributions: [],
    },
  };
}

function strip(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('latin1')
    .replace(/\[%plysmith 1,\n[A-Za-z0-9_\-\n]+\]/, '');
}

function rewrite(
  bytes: Uint8Array,
  mutate: (m: Mutable<PgnTransferManifest>) => void,
  raw?: (s: string) => string,
): Uint8Array {
  const text = Buffer.from(bytes).toString('latin1');
  const match = /\[%plysmith 1,\n([A-Za-z0-9_\-\n]+)\]/.exec(text)!;
  const m = JSON.parse(
    Buffer.from(match[1]!.replace(/\n/g, ''), 'base64url').toString('utf8'),
  ) as Mutable<PgnTransferManifest>;
  mutate(m);
  const json = raw ? raw(JSON.stringify(m)) : JSON.stringify(m);
  const payload = Buffer.from(json)
    .toString('base64url')
    .match(/.{1,64}/g)!
    .join('\n');
  return Buffer.from(
    text.replace(match[0], `[%plysmith 1,\n${payload}\n]`),
    'latin1',
  );
}

function invalid(error: unknown): boolean {
  return (
    error instanceof ApplicationProblem &&
    error.problemCode === 'inventory_transfer.invalid_backup'
  );
}

test('T01 carrier preserves nested empty folders, restores no records, and strips to ordinary PGN', async () => {
  const bytes = await codec.encode(carrier(), signal, budget);
  assert.ok(containsPgnTransferMarker(bytes));
  const restored = await codec.decode(bytes, signal, budget);
  assert.equal(restored.records.length, 0);
  assert.deepEqual(restored.manifest.folders, carrier().manifest.folders);
  new Chess().loadPgn(strip(bytes));
  assert.deepEqual(
    await codec.encode({ ...restored, dataRevision: 10 }, signal, budget),
    bytes,
  );
});

test('T02 T03 T14 legal complete RAV tree, null-line FEN and metadata removal', async () => {
  for (const input of [
    await snapshot(),
    await snapshot('*'),
    await snapshot('[SetUp "1"]\n[FEN "8/8/8/8/8/2k5/8/2K5 b - - 17 42"]\n*'),
  ]) {
    const bytes = await codec.encode(input, signal, budget),
      restored = await codec.decode(bytes, signal, budget);
    assert.equal(restored.records[0]!.root.fen, input.records[0]!.root.fen);
    assert.deepEqual(
      restored.records[0]!.nodes.map((n) => [
        n.move.san,
        n.parentNodeIndex,
        n.siblingOrder,
      ]),
      input.records[0]!.nodes.map((n) => [
        n.move.san,
        n.parentNodeIndex,
        n.siblingOrder,
      ]),
    );
    assert.deepEqual(restored.manifest.records, input.manifest.records);
    const projected: TransferChessRecord[] = [];
    await new PgnContentFormatAdapter(rules).decode(chunks(strip(bytes)), {
      signal,
      onCandidate: async (c) => {
        assert.notEqual(c.status, 'rejected');
        assert.ok(c.root);
        projected.push({ root: c.root, nodes: c.nodes, result: c.result });
      },
    });
    assert.equal(projected[0]!.nodes.length, restored.records[0]!.nodes.length);
  }
});

test('T04 T06 T18 exact Unicode and duplicate notes, escaped prose and note continuations beyond normal comment limit', async () => {
  const input = await snapshot('1. e4 *');
  input.manifest.records[0]!.name = 'x'.repeat(200);
  input.manifest.records[0]!.summary =
    '\\ {braces} [%plysmith 9,] \u0000 \u{1f600} \u4e2d\u6587';
  input.manifest.anchors.push({
    id: 'a1',
    kind: 'occurrence',
    item: 'i1',
    occurrence: 'o2',
  });
  const body = 'a'.repeat(9000) + '\n\nNotes';
  for (const id of ['n1', 'n2'])
    input.manifest.contributions.push({
      id,
      anchor: 'a1',
      contributionType: 'note',
      authorRole: 'user',
      body,
      rationale: 'reason',
      languageTag: 'de-DE',
      version: 7,
      createdAt: time,
      updatedAt: time,
      moves: [{ from: 'c7', to: 'c5', promotion: null }],
      movesRoot: { record: 'r1', node: 1 },
    });
  const bytes = await codec.encode(input, signal, budget),
    restored = await codec.decode(bytes, signal, budget);
  assert.deepEqual(
    restored.manifest.contributions,
    input.manifest.contributions,
  );
  assert.equal(
    restored.manifest.records[0]!.summary,
    input.manifest.records[0]!.summary,
  );
  assert.equal(restored.records[0]!.nodes.length, 1);
  const projection = strip(bytes);
  assert.ok(projection.includes('Continuation: c5'));
  assert.ok(projection.includes('\\u005b%plysmith'));
  assert.ok(projection.startsWith('[Event "?"]'));
  assert.ok(projection.split('\n').every((line) => line.length < 80));
  assert.ok(!containsPgnTransferMarker(Buffer.from(projection, 'latin1')));
});

test('own marker detection is lexical and streaming, and precedes directive omission', async () => {
  for (const text of [
    '[Event "[%plysmith 1,"]\n*',
    '[Event "x"]\n{ordinary literal [%plysmith 1, abc]} *',
    '{\\u005b%plysmith 1,} *',
    '{[%plysmithish 1,]} *',
  ])
    assert.equal(containsPgnTransferMarker(Buffer.from(text)), false);
  for (const version of ['1', '99', 'broken']) {
    const text = `[Event "x"]\n{[%plysmith ${version},\nabc\n]} *`;
    assert.equal(containsPgnTransferMarker(Buffer.from(text)), true);
    await assert.rejects(
      new PgnContentFormatAdapter(rules).decode(chunks(text), {
        signal,
        onCandidate: async () => {
          assert.fail('must not publish a candidate');
        },
      }),
      (error: unknown) =>
        error instanceof ApplicationProblem &&
        error.problemCode === 'inventory_transfer.restore_required',
    );
  }
});

test('misplaced, embedded, duplicated and truncated own directives never take the lossy normal import path', async () => {
  for (const text of [
    '1. e4 {[%plysmith 1,\nabc\n]} *',
    '{ordinary root prose [%plysmith 1,\nabc\n]} *',
    '1. e4 {ordinary prose [%plysmith 91,\nabc\n]} *',
    '1. e4 {ordinary prose [%plysmith broken,\nabc\n]} *',
    '{[%plysmith}',
    '{[%plysmith',
    ';[%plysmith 1,\n*',
    '{[%plysmith 1,\nabc\n][%plysmith 1,\nabc\n]} *',
  ]) {
    assert.ok(containsPgnTransferMarker(Buffer.from(text)));
    await assert.rejects(
      new PgnContentFormatAdapter(rules).decode(chunks(text), {
        signal,
        onCandidate: async () => {
          assert.fail('no candidate');
        },
      }),
      (e: unknown) =>
        e instanceof ApplicationProblem &&
        e.problemCode === 'inventory_transfer.restore_required',
    );
    await assert.rejects(
      codec.decode(Buffer.from(text), signal, budget),
      invalid,
    );
  }
});

test('T15 closed schemas, canonical JSON, duplicate keys and IDs, versions and malformed payloads', async () => {
  const bytes = await codec.encode(await snapshot(), signal, budget);
  for (const mutate of [
    (m: Mutable<PgnTransferManifest>) => {
      Object.assign(m, { unexpected: true });
    },
    (m: Mutable<PgnTransferManifest>) => {
      m.items.push(m.items[0]!);
    },
    (m: Mutable<PgnTransferManifest>) => {
      Object.assign(m.records[0]!, { name: 7 });
    },
    (m: Mutable<PgnTransferManifest>) => {
      Object.assign(m.records[0]!.origin, { item: 'i1' });
    },
    (m: Mutable<PgnTransferManifest>) => {
      m.records[0]!.nodes[1]![1] = null;
    },
  ])
    await assert.rejects(
      codec.decode(rewrite(bytes, mutate), signal, budget),
      invalid,
    );
  for (const raw of [
    (s: string) => s.replace('"version":1', '"version":1,"version":1'),
    (s: string) => s.replace('"version":1', '"version":1.0'),
    (s: string) => ' ' + s,
    (s: string) => s.replace('"version":1', '"__proto__":{},"version":1'),
  ])
    await assert.rejects(
      codec.decode(rewrite(bytes, budget, raw), signal, budget),
      invalid,
    );
  await assert.rejects(
    codec.decode(
      Buffer.from(
        Buffer.from(bytes)
          .toString('latin1')
          .replace('[%plysmith 1,', '[%plysmith 2,'),
        'latin1',
      ),
      signal,
      budget,
    ),
    (e: unknown) =>
      e instanceof ApplicationProblem &&
      e.problemCode === 'inventory_transfer.unsupported_version',
  );
});

test('T16 projection hash binds moves, prose, record order and whitespace; only CRLF is equivalent', async () => {
  const bytes = await codec.encode(await snapshot(), signal, budget),
    text = Buffer.from(bytes).toString('latin1');
  assert.deepEqual(
    await codec.decode(
      Buffer.from(text.replace(/\n/g, '\r\n'), 'latin1'),
      signal,
      budget,
    ),
    await codec.decode(bytes, signal, budget),
  );
  for (const changed of [
    text.replace('Title: Test', 'Title: Changed'),
    text.replace('1. e4', '1. d4'),
    text + '\n',
    text.replace('[Site "?"]', '[Site "x"]'),
    text.replace(']\nTitle:', ']\n[%plysmith 1,\nAAAA\n]\nTitle:'),
  ])
    await assert.rejects(
      codec.decode(Buffer.from(changed, 'latin1'), signal, budget),
      invalid,
    );
});

test('T17 dangling references, cycles, mismatched witnesses and illegal note moves reject the entire backup', async () => {
  const input = await snapshot();
  input.manifest.anchors.push({
    id: 'a1',
    kind: 'occurrence',
    item: 'i1',
    occurrence: 'o2',
  });
  input.manifest.contributions.push({
    id: 'n1',
    anchor: 'a1',
    contributionType: 'note',
    authorRole: 'user',
    body: 'Note',
    rationale: null,
    languageTag: 'en',
    version: 1,
    createdAt: time,
    updatedAt: time,
    moves: [{ from: 'e7', to: 'e5', promotion: null }],
    movesRoot: { record: 'r1', node: 1 },
  });
  const bytes = await codec.encode(input, signal, budget);
  const mutations: ((m: Mutable<PgnTransferManifest>) => void)[] = [
    (m) => {
      m.items[0]!.currentRevision = 'r99';
    },
    (m) => {
      m.contributions[0]!.anchor = 'a99';
    },
    (m) => {
      m.contributions[0]!.movesRoot!.node = 0;
    },
    (m) => {
      m.contributions[0]!.moves[0]!.from = 'a1';
    },
    (m) => {
      m.folders.push({ id: 'f1', parent: 'f1', name: 'Cycle' });
    },
    (m) => {
      m.records[0]!.origin = {
        kind: 'inventory_anchor',
        item: 'i1',
        revision: 'r1',
        anchor: 'a1',
      };
    },
    (m) => {
      m.anchors.push({
        id: 'a2',
        kind: 'occurrence',
        item: 'i1',
        occurrence: 'o2',
      });
    },
  ];
  for (const mutate of mutations)
    await assert.rejects(
      codec.decode(rewrite(bytes, mutate), signal, budget),
      invalid,
    );
});

test('T18 limits and interruption reject before a completed export', async () => {
  const input = await snapshot('*');
  input.manifest.records[0]!.summary = 'a'.repeat(128001);
  await assert.rejects(
    codec.encode(input, signal, budget),
    (e: unknown) => e instanceof ApplicationProblem,
  );
  const aborted = AbortSignal.abort();
  await assert.rejects(
    codec.encode(carrier(), aborted, budget),
    (e: unknown) =>
      e instanceof ApplicationProblem &&
      e.problemCode === 'inventory_transfer.interrupted',
  );
  await assert.rejects(
    codec.encode(carrier(), signal, () => {
      throw new ApplicationProblem(
        'inventory_transfer.resource_exhausted',
        'safe',
      );
    }),
    (e: unknown) =>
      e instanceof ApplicationProblem &&
      e.problemCode === 'inventory_transfer.resource_exhausted',
  );
});

test('T12 more than 100 records preserve inventory order without normal import chapter limits', async () => {
  const input = await snapshot('*');
  const item = input.manifest.items[0]!,
    record = input.manifest.records[0]!,
    tree = input.records[0]!;
  for (let index = 2; index <= 101; index++) {
    input.manifest.items.push({
      ...item,
      id: `i${index}`,
      currentRevision: `r${index}`,
    });
    input.manifest.records.push({
      ...record,
      id: `r${index}`,
      item: `i${index}`,
      pgnIndex: index - 1,
      name: `Name ${index}`,
      nodes: [[`o${index}`, null, 'unknown']],
    });
    input.records.push(tree);
  }
  const bytes = await codec.encode(input, signal, budget);
  assert.equal((await codec.decode(bytes, signal, budget)).records.length, 101);
});

test('rehashed hostile projection still passes strict grammar and legality checks', async () => {
  const original = await codec.encode(
    await snapshot('1. e4 *'),
    signal,
    budget,
  );
  let changed = Buffer.from(
    Buffer.from(original).toString('latin1').replace('1. e4', '1. e5'),
    'latin1',
  );
  changed = Buffer.from(
    rewrite(changed, (m) => {
      m.pgnSha256 = createHash('sha256')
        .update(strip(changed), 'latin1')
        .digest('hex');
    }),
  );
  await assert.rejects(codec.decode(changed, signal, budget), invalid);
});

test('T05 four anchor kinds retain exact witnesses at repeated positions', async () => {
  const input = await snapshot('1. Nf3 Nf6 2. Ng1 Ng8 *');
  input.manifest.anchors.push(
    { id: 'a1', kind: 'item', item: 'i1' },
    { id: 'a2', kind: 'position', witness: { record: 'r1', node: 0 } },
    { id: 'a3', kind: 'occurrence', item: 'i1', occurrence: 'o5' },
    { id: 'a4', kind: 'move_node', item: 'i1', move: 'm4' },
  );
  for (let index = 1; index <= 4; index++)
    input.manifest.contributions.push({
      id: `n${index}`,
      anchor: `a${index}`,
      contributionType: 'decision',
      authorRole: 'engine',
      body: 'Same text',
      rationale: null,
      languageTag: 'en',
      version: 2,
      createdAt: time,
      updatedAt: time,
      moves: [{ from: 'e2', to: 'e4', promotion: null }],
      movesRoot: { record: 'r1', node: index < 3 ? 0 : 4 },
    });
  const bytes = await codec.encode(input, signal, budget),
    restored = await codec.decode(bytes, signal, budget);
  assert.deepEqual(
    restored.manifest.contributions,
    input.manifest.contributions,
  );
  assert.equal(
    restored.records[0]!.root.position.positionKey,
    restored.records[0]!.nodes[3]!.after.position.positionKey,
  );
  assert.notEqual(
    restored.records[0]!.root.fen,
    restored.records[0]!.nodes[3]!.after.fen,
  );
  for (const index of [2, 3])
    await assert.rejects(
      codec.decode(
        rewrite(bytes, (m) => {
          m.contributions[index]!.movesRoot!.node = 0;
        }),
        signal,
        budget,
      ),
      invalid,
    );
});

async function provenanceSnapshot(): Promise<
  Mutable<InventoryTransferSnapshot>
> {
  const input = await snapshot('1. e4 e5 *');
  const source = input.manifest.records[0]!,
    sourceTree = input.records[0]!;
  source.revisionNumber = 2;
  source.baseRevision = 'r3';
  const derived = await snapshot(
    `[SetUp "1"]\n[FEN "${sourceTree.nodes[0]!.after.fen}"]\n*`,
  );
  input.manifest.items.push({
    ...input.manifest.items[0]!,
    id: 'i2',
    currentRevision: 'r2',
  });
  input.manifest.records.push({
    ...derived.manifest.records[0]!,
    id: 'r2',
    item: 'i2',
    pgnIndex: 1,
    name: 'Derived',
    nodes: [['o4', null, 'unknown']],
    origin: {
      kind: 'inventory_anchor',
      item: 'i1',
      revision: 'r3',
      anchor: 'a1',
    },
  });
  input.manifest.records.push({
    ...source,
    id: 'r3',
    pgnIndex: 2,
    revisionNumber: 1,
    baseRevision: null,
    name: 'Derived',
    nodes: [
      ['o1', null, 'unknown'],
      ['o2', 'm1', 'complete'],
    ],
  });
  input.records.push(derived.records[0]!, {
    ...sourceTree,
    nodes: sourceTree.nodes.slice(0, 1),
  });
  input.manifest.anchors.push({
    id: 'a1',
    kind: 'occurrence',
    item: 'i1',
    occurrence: 'o2',
  });
  return input;
}

test('T07 old source revision, shared identities and snapshot-specific Knowledge survive roundtrip', async () => {
  const input = await provenanceSnapshot();
  const bytes = await codec.encode(input, signal, budget),
    restored = await codec.decode(bytes, signal, budget);
  assert.deepEqual(restored.manifest.records, input.manifest.records);
  assert.equal(
    restored.records[0]!.root.playState.historyKnowledge,
    'complete',
  );
  assert.equal(restored.records[2]!.root.playState.historyKnowledge, 'unknown');
  assert.equal(
    restored.records[0]!.nodes[0]!.after.playState.historyKnowledge,
    'partial',
  );
  assert.equal(
    restored.records[2]!.nodes[0]!.after.playState.historyKnowledge,
    'complete',
  );
  assert.deepEqual(
    await codec.encode({ ...restored, dataRevision: 5 }, signal, budget),
    bytes,
  );
  await assert.rejects(
    codec.decode(
      rewrite(bytes, (m) => {
        m.records[2]!.nodes[1]![0] = 'o3';
      }),
      signal,
      budget,
    ),
    invalid,
  );
});

test('T08 T09 retained provenance stays invisible and irrelevant history is rejected', async () => {
  const input = await provenanceSnapshot();
  input.manifest.items[0]!.role = 'provenanceOnly';
  input.manifest.items[0]!.lifecycle = 'trashed';
  input.manifest.items[0]!.currentRevision = null;
  input.manifest.items[0]!.retainedRevision = 'r3';
  input.manifest.items.reverse();
  input.manifest.records.shift();
  input.records.shift();
  input.manifest.records.forEach((r, index) => {
    r.pgnIndex = index;
  });
  const bytes = await codec.encode(input, signal, budget),
    restored = await codec.decode(bytes, signal, budget);
  assert.equal(restored.manifest.items[1]!.role, 'provenanceOnly');
  assert.deepEqual(
    await codec.encode({ ...restored, dataRevision: 9 }, signal, budget),
    bytes,
  );
  await assert.rejects(
    codec.decode(
      rewrite(bytes, (m) => {
        m.records[0]!.origin = { kind: 'fen' };
      }),
      signal,
      budget,
    ),
    invalid,
  );
});

test('T10 closed game facts preserve unknown values and reject inconsistent outcomes', async () => {
  const input = await snapshot('*');
  input.manifest.items[0]!.itemType = 'game';
  const facts = {
    playerSide: 'white' as const,
    result: {
      kind: 'unfinished' as const,
      source: 'manual' as const,
      reason: null,
    },
    policy: {
      capability: 'human_profile' as const,
      providerInstanceId: 'historical',
      providerFingerprint: 'fingerprint',
      providerType: 'maia',
      providerDisplayName: 'Historical provider',
      profile: {
        modelName: 'model',
        selectionMode: 'sampled' as const,
        historyMode: 'position_only' as const,
        reproducibility: 'stochastic' as const,
      },
    },
  };
  for (const game of [null, facts]) {
    input.manifest.records[0]!.game = game;
    const bytes = await codec.encode(input, signal, budget);
    assert.deepEqual(
      (await codec.decode(bytes, signal, budget)).manifest.records[0]!.game,
      game,
    );
  }
  const bytes = await codec.encode(input, signal, budget);
  await assert.rejects(
    codec.decode(
      rewrite(bytes, (m) => {
        m.records[0]!.game!.result.source = 'automatic';
      }),
      signal,
      budget,
    ),
    invalid,
  );
  await assert.rejects(
    codec.decode(
      rewrite(bytes, (m) => {
        m.records[0]!.game!.policy.profile = null;
      }),
      signal,
      budget,
    ),
    invalid,
  );
  await assert.rejects(
    codec.decode(
      rewrite(bytes, (m) => {
        m.records[0]!.game!.result.kind = 'white_win';
      }),
      signal,
      budget,
    ),
    invalid,
  );
});

test('T11 source path extends the explicit origin prefix and preserves root/before/after Knowledge separately', async () => {
  const input = await provenanceSnapshot();
  const target = input.manifest.records[1]!;
  input.manifest.items[1]!.itemType = 'game';
  input.records[1]!.root = input.records[0]!.nodes[1]!.after;
  target.sourcePath = {
    title: 'Former scratch',
    rootFen: rules.initialState().fen,
    moves: [
      { from: 'e2', to: 'e4', promotion: null },
      { from: 'e7', to: 'e5', promotion: null },
    ],
    historyKnowledge: {
      root: 'unknown',
      before: ['unknown', 'complete'],
      after: ['partial', 'partial'],
    },
  };
  const bytes = await codec.encode(input, signal, budget),
    restored = await codec.decode(bytes, signal, budget);
  assert.deepEqual(restored.manifest.records[1]!.sourcePath, target.sourcePath);
  assert.equal(restored.records[1]!.nodes.length, 0);
  assert.ok(strip(bytes).includes('Source path: Former scratch'));
  await assert.rejects(
    codec.decode(
      rewrite(bytes, (m) => {
        m.records[1]!.sourcePath!.moves[0]!.to = 'e3';
      }),
      signal,
      budget,
    ),
    invalid,
  );
  await assert.rejects(
    codec.decode(
      rewrite(bytes, (m) => {
        m.records[1]!.sourcePath!.historyKnowledge.before.pop();
      }),
      signal,
      budget,
    ),
    invalid,
  );
});

test('T11 initial-position origin binds the source root, not the later game root', async () => {
  const moved = rules.applyMove(rules.initialState(), [], {
    kind: 'coordinates',
    value: 'e2e4',
  });
  assert(moved.ok);
  const input = await snapshot(
    `[SetUp "1"]\n[FEN "${moved.value.after.fen}"]\n*`,
  );
  input.manifest.items[0]!.itemType = 'game';
  const record = input.manifest.records[0]!;
  record.origin = { kind: 'initial_position' };
  record.sourcePath = {
    title: 'Free exploration',
    rootFen: rules.initialState().fen,
    moves: [{ from: 'e2', to: 'e4', promotion: null }],
    historyKnowledge: {
      root: 'complete',
      before: ['complete'],
      after: ['partial'],
    },
  };
  const bytes = await codec.encode(input, signal, budget);
  const restored = await codec.decode(bytes, signal, budget);
  assert.deepEqual(restored.manifest.records, input.manifest.records);
  assert.equal(restored.records[0]!.root.fen, moved.value.after.fen);
  assert.deepEqual(
    await codec.encode({ ...restored, dataRevision: 4 }, signal, budget),
    bytes,
  );
  await assert.rejects(
    codec.decode(
      rewrite(bytes, (manifest) => {
        manifest.records[0]!.sourcePath = null;
      }),
      signal,
      budget,
    ),
    invalid,
  );
  await assert.rejects(
    codec.decode(
      rewrite(bytes, (manifest) => {
        const path = manifest.records[0]!.sourcePath!;
        path.rootFen = moved.value.after.fen;
        path.moves = [];
        path.historyKnowledge.before = [];
        path.historyKnowledge.after = [];
      }),
      signal,
      budget,
    ),
    invalid,
  );
});

for (const sourceHasPath of [false, true]) {
  for (const sourcesAfter of [false, true]) {
    test(`T11 inherited source path survives codec roundtrip: sourcePath=${sourceHasPath}, laterSources=${sourcesAfter}`, async () => {
      const input = inheritedSourcePathSnapshot(sourceHasPath, sourcesAfter);
      const bytes = await codec.encode(input, signal, budget);
      const restored = await codec.decode(bytes, signal, budget);
      assert.deepEqual(restored.manifest.records, input.manifest.records);
      assert.deepEqual(
        await codec.encode({ ...restored, dataRevision: 2 }, signal, budget),
        bytes,
      );
    });
  }

  test(`T11 inherited prefix rejects another legal route to the same final FEN: sourcePath=${sourceHasPath}`, async () => {
    const input = inheritedSourcePathSnapshot(sourceHasPath, true);
    const bytes = await codec.encode(input, signal, budget);
    const alternate = ['b1c3', 'b8c6', 'c3b1', 'c6b8'].map((move) => ({
      from: move.slice(0, 2),
      to: move.slice(2),
      promotion: null,
    }));
    const path = input.manifest.records[0]!.sourcePath!;
    const replay = await playTransferMoves(
      rules,
      rules.initialState(),
      [...alternate, ...path.moves.slice(4)],
      budget,
    );
    assert.equal(replay.states.at(-1)!.fen, input.records[0]!.root.fen);
    await assert.rejects(
      codec.decode(
        rewrite(bytes, (manifest) => {
          manifest.records[0]!.sourcePath!.moves.splice(0, 4, ...alternate);
        }),
        signal,
        budget,
      ),
      invalid,
    );
    if (sourceHasPath) {
      await assert.rejects(
        codec.decode(
          rewrite(bytes, (manifest) => {
            // Mutually consistent stored paths must still preserve the ancestor's exact line.
            for (const record of manifest.records) {
              record.sourcePath?.moves.splice(0, 4, ...alternate);
            }
          }),
          signal,
          budget,
        ),
        invalid,
      );
    }
    await assert.rejects(
      codec.decode(
        rewrite(bytes, (manifest) => {
          const shortened = manifest.records[0]!.sourcePath!;
          shortened.rootFen = input.records[1]!.root.fen;
          shortened.moves.splice(0, 4);
          shortened.historyKnowledge.before.splice(0, 4);
          shortened.historyKnowledge.after.splice(0, 4);
        }),
        signal,
        budget,
      ),
      invalid,
    );
  });
}

test('T18 larger tree and aggregated notes keep cooperative checkpoints measurable', async (t) => {
  const input = await snapshot('Nf3 Nf6 Ng1 Ng8 '.repeat(64) + '*');
  const line = input.records[0]!.nodes;
  input.records[0]!.nodes = Array.from({ length: 16 }, (_, branch) =>
    line.map((node) => ({
      ...node,
      nodeIndex: node.nodeIndex + branch * line.length,
      parentNodeIndex:
        node.parentNodeIndex === null
          ? null
          : node.parentNodeIndex + branch * line.length,
      siblingOrder: node.parentNodeIndex === null ? branch : node.siblingOrder,
    })),
  ).flat();
  input.manifest.records[0]!.nodes = [
    ['o1', null, 'complete'],
    ...input.records[0]!.nodes.map(
      (node) =>
        [`o${node.nodeIndex + 2}`, `m${node.nodeIndex + 1}`, 'partial'] as [
          string,
          string,
          'partial',
        ],
    ),
  ];
  input.manifest.anchors.push({ id: 'a1', kind: 'item', item: 'i1' });
  for (let index = 1; index <= 16; index++)
    input.manifest.contributions.push({
      id: `n${index}`,
      anchor: 'a1',
      contributionType: 'note',
      authorRole: 'user',
      body: 'a'.repeat(128000),
      rationale: null,
      languageTag: 'en',
      version: 1,
      createdAt: time,
      updatedAt: time,
      moves: [],
      movesRoot: null,
    });
  const start = performance.now();
  let lastTick = start,
    longestGap = 0,
    ticks = 0,
    checks = 0;
  const maximumGapMs = 1000;
  const sample = (): void => {
    const now = performance.now();
    longestGap = Math.max(longestGap, now - lastTick);
    lastTick = now;
    ticks++;
  };
  const timer = setInterval(sample, 5);
  const check = (): void => {
    checks++;
    assert.ok(
      performance.now() - start < 120000,
      'Codec exceeded the existing preparation deadline.',
    );
  };
  try {
    const bytes = await codec.encode(input, signal, check);
    const restored = await codec.decode(bytes, signal, check);
    await yieldImmediate();
    sample();
    const operationMs = Math.round(performance.now() - start);
    clearInterval(timer);
    t.diagnostic(
      JSON.stringify({
        nodes: 4096,
        originalText: 2048000,
        bytes: bytes.length,
        encodeAndDecodeMs: operationMs,
        maximumEventLoopGapMs: Math.round(longestGap),
        maximumAllowedGapMs: maximumGapMs,
        checkpoints: checks,
      }),
    );
    assert.ok(
      longestGap <= maximumGapMs,
      `Codec blocked the event loop for ${Math.round(longestGap)} ms (budget ${maximumGapMs} ms).`,
    );
    assert.equal(restored.records[0]!.nodes.length, 4096);
    assert.deepEqual(
      restored.manifest.contributions,
      input.manifest.contributions,
    );
    assert.ok(ticks > 10 && checks > 100);
  } finally {
    clearInterval(timer);
  }
});

test('cooperative note and source replay yields after at most eight legal moves and accepts cancellation', async () => {
  const tracked = new ChessJsRulesAdapter();
  const apply = tracked.applyMove.bind(tracked);
  let applied = 0,
    previous = 0,
    largestBatch = 0,
    observations = 0;
  tracked.applyMove = (...args) => {
    applied++;
    return apply(...args);
  };
  const cycle: TransferMove[] = [
    { from: 'g1', to: 'f3', promotion: null },
    { from: 'g8', to: 'f6', promotion: null },
    { from: 'f3', to: 'g1', promotion: null },
    { from: 'f6', to: 'g8', promotion: null },
  ];
  const moves = Array.from({ length: 64 }, (_, index) => cycle[index % 4]!);
  let observing = true;
  const observe = (): void => {
    largestBatch = Math.max(largestBatch, applied - previous);
    previous = applied;
    observations++;
    if (observing) setImmediate(observe);
  };
  setImmediate(observe);
  try {
    const played = await playTransferMoves(
      tracked,
      tracked.initialState(),
      moves,
      budget,
    );
    await yieldImmediate();
    assert.equal(played.san.length, 64);
    assert.ok(observations > 4 && largestBatch <= 8);
  } finally {
    observing = false;
  }
  const controller = new AbortController();
  setImmediate(() => controller.abort());
  await assert.rejects(
    playTransferMoves(tracked, tracked.initialState(), moves, () =>
      transferCheckpoint(controller.signal, budget),
    ),
    (e: unknown) =>
      e instanceof ApplicationProblem &&
      e.problemCode === 'inventory_transfer.interrupted',
  );
});

test('comment chunk boundaries preserve reserved prose, Unicode, control escapes and blank lines', async () => {
  const input = await snapshot('*');
  const body =
    'a'.repeat(8191) + '[%plysmith 1,]\n\n' + '\\{}\u4e2d\u{1f600}\u0000';
  input.manifest.anchors.push({ id: 'a1', kind: 'item', item: 'i1' });
  input.manifest.contributions.push({
    id: 'n1',
    anchor: 'a1',
    contributionType: 'note',
    authorRole: 'user',
    body,
    rationale: null,
    languageTag: 'en',
    version: 1,
    createdAt: time,
    updatedAt: time,
    moves: [],
    movesRoot: null,
  });
  const bytes = await codec.encode(input, signal, budget);
  assert.equal(
    (await codec.decode(bytes, signal, budget)).manifest.contributions[0]!.body,
    body,
  );
  const projection = strip(bytes);
  assert.ok(projection.replace(/\n/g, '').includes('\\u005b%plysmith 1,]'));
  assert.ok(
    projection.includes('\\u005c\\u007b\\u007d\\u4e2d\\ud83d\\ude00\\u0000'),
  );
  assert.ok(projection.includes('\n\n\\u005c'));
  assert.equal(
    containsPgnTransferMarker(Buffer.from(projection, 'latin1')),
    false,
  );
});

test('T18 expanded shared prose fails the completed byte budget without a partial export', async () => {
  const input = await snapshot('Nf3 Nf6 Ng1 Ng8 '.repeat(128) + '*');
  input.manifest.anchors.push({
    id: 'a1',
    kind: 'position',
    witness: { record: 'r1', node: 0 },
  });
  input.manifest.contributions.push({
    id: 'n1',
    anchor: 'a1',
    contributionType: 'note',
    authorRole: 'user',
    body: '\u4e2d'.repeat(128000),
    rationale: null,
    languageTag: 'en',
    version: 1,
    createdAt: time,
    updatedAt: time,
    moves: [],
    movesRoot: null,
  });
  await assert.rejects(
    codec.encode(input, signal, budget),
    (e: unknown) =>
      e instanceof ApplicationProblem &&
      e.problemCode === 'inventory_transfer.resource_exhausted',
  );
  await assert.rejects(
    codec.decode(new Uint8Array(64 * 1024 * 1024 + 1), signal, budget),
    (e: unknown) =>
      e instanceof ApplicationProblem &&
      e.problemCode === 'inventory_transfer.resource_exhausted',
  );
});
