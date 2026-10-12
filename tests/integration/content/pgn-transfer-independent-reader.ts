import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type {
  InventoryTransferSnapshot,
  TransferChessRecord,
} from '../../../app/application/inventory/pgn-transfer-models.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import {
  PgnContentFormatAdapter,
  PgnInventoryTransferCodec,
} from '../../../app/infrastructure/adapters/content/pgn/index.ts';

// Opt-in interoperability gate; isolated Python dependency, never an app dependency.
const pythonModules = resolve(
  process.argv[2] ?? 'build/verification/independent-pgn-reader',
);
const python = `
import io, json, sys
sys.path.insert(0, sys.argv[1])
import chess.pgn
source = io.StringIO(sys.stdin.buffer.read().decode('latin1'))
games = []
while True:
    game = chess.pgn.read_game(source)
    if game is None: break
    assert not game.errors
    nodes = []
    stack = [(child, None) for child in reversed(game.variations)]
    while stack:
        node, parent = stack.pop()
        index = len(nodes)
        nodes.append([parent, node.san(), node.board().fen(en_passant='legal')])
        stack.extend((child, index) for child in reversed(node.variations))
    games.append({'root': game.board().fen(en_passant='legal'), 'nodes': nodes, 'result': game.headers['Result'], 'comment': game.comment})
print(json.dumps(games))
`;

async function independentRead(bytes: Uint8Array): Promise<unknown> {
  return new Promise((resolveResult, reject) => {
    const child = spawn('python', ['-c', python, pythonModules], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '',
      error = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      error += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0)
        reject(new Error(`Independent PGN reader failed: ${error}`));
      else {
        try {
          resolveResult(JSON.parse(output));
        } catch (error) {
          reject(error);
        }
      }
    });
    child.stdin.end(bytes);
  });
}

const rules = new ChessJsRulesAdapter(),
  codec = new PgnInventoryTransferCodec(rules),
  signal = new AbortController().signal;
const cases = [
  '*',
  '1. e4 (1. d4 d5 (1... Nf6)) e5 (1... c5 2. Nf3 (2. Nc3)) 2. Nf3 *',
  '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. O-O *',
  '[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 1"]\n1. a8=Q+ (1. a8=N) *',
  '[SetUp "1"]\n[FEN "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1"]\n1. exd6 *',
  '[SetUp "1"]\n[FEN "8/8/8/8/8/2k5/8/2K5 b - - 17 42"]\n42... Kd3 *',
];
const records: TransferChessRecord[] = [];
for (const pgn of cases) {
  async function* input(): AsyncIterable<string> {
    yield pgn;
  }
  await new PgnContentFormatAdapter(rules).decode(input(), {
    signal,
    onCandidate: async (candidate) => {
      assert.ok(candidate.root);
      assert.notEqual(candidate.status, 'rejected');
      records.push({
        root: candidate.root,
        nodes: candidate.nodes,
        result: candidate.result,
      });
    },
  });
}
const time = '2026-10-12T10:00:00.000Z';
let occurrence = 0,
  move = 0;
const snapshot: InventoryTransferSnapshot = {
  dataRevision: 1,
  records,
  manifest: {
    version: 1,
    carrier: false,
    folders: [],
    anchors: [],
    contributions: [],
    items: records.map((_, index) => ({
      id: `i${index + 1}`,
      role: 'inventory',
      itemType: 'analysis',
      originKind: 'manual',
      lifecycle: 'active',
      folder: null,
      currentRevision: `r${index + 1}`,
      retainedRevision: null,
      createdAt: time,
      updatedAt: time,
    })),
    records: records.map((record, index) => ({
      id: `r${index + 1}`,
      item: `i${index + 1}`,
      pgnIndex: index,
      revisionNumber: 1,
      baseRevision: null,
      changeKind: 'created',
      name: `Case ${index + 1}`,
      summary: 'Independent RAV reader',
      languageTag: 'en',
      creatorRole: 'user',
      createdAt: time,
      origin: { kind: 'fen' },
      nodes: [
        [`o${++occurrence}`, null, 'unknown'],
        ...record.nodes.map(
          () => [`o${++occurrence}`, `m${++move}`, 'partial'] as const,
        ),
      ],
      game: null,
      sourcePath: null,
    })),
  },
};
const bytes = await codec.encode(snapshot, signal, () => {});
const plain = Buffer.from(
  Buffer.from(bytes)
    .toString('latin1')
    .replace(/\[%plysmith 1,\n[A-Za-z0-9_\-\n]+\]/, ''),
  'latin1',
);
for (const input of [bytes, plain]) {
  const actual = (await independentRead(input)) as {
    root: string;
    nodes: unknown[];
    result: string;
    comment: string;
  }[];
  assert.equal(actual.length, records.length);
  records.forEach((record, index) => {
    assert.equal(actual[index]!.root, record.root.fen);
    assert.equal(actual[index]!.result, record.result);
    assert.deepEqual(
      actual[index]!.nodes,
      record.nodes.map((node) => [
        node.parentNodeIndex,
        node.move.san,
        node.after.fen,
      ]),
    );
    assert.ok(actual[index]!.comment.includes('Independent RAV reader'));
  });
}
console.log(
  JSON.stringify({
    reader: 'python-chess 1.11.2',
    records: records.length,
    representations: 2,
    ravNodes: records.reduce((sum, record) => sum + record.nodes.length, 0),
    passed: true,
  }),
);
