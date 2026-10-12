// Opt-in: python-chess is isolated in an ignored verification directory, not an app dependency.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ChessJsRulesAdapter } from '../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { PgnInventoryTransferCodec } from '../app/infrastructure/adapters/content/pgn/index.ts';
import type { TransferChessRecord } from '../app/application/inventory/pgn-transfer-models.ts';

const input = process.argv[2];
assert(input, 'Pass a generated backup PGN path.');
const pythonModules = path.resolve(
  process.argv[3] ?? 'build/verification/independent-pgn-reader',
);
const source = await readFile(input);
const prepared = await new PgnInventoryTransferCodec(
  new ChessJsRulesAdapter(),
).decode(source, new AbortController().signal, () => {});
const original = source.toString('latin1');
const start = original.indexOf('[%plysmith');
const end = original.indexOf(']', start);
assert(start >= 0 && end > start);
const projection = original.slice(0, start) + original.slice(end + 1);
const promotion = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' } as const;
function expected(record: TransferChessRecord) {
  return {
    rootFen: record.root.fen,
    result: record.result,
    nodes: record.nodes.map((node) => ({
      parent: node.parentNodeIndex,
      sibling: node.siblingOrder,
      uci:
        node.move.from +
        node.move.to +
        (node.move.promotion ? promotion[node.move.promotion] : ''),
      san: node.move.san,
      fen: node.after.fen,
    })),
  };
}
const program = `import sys, io, json
sys.path.insert(0, sys.argv[1])
import chess, chess.pgn
source = io.StringIO(sys.stdin.read())
games = []
while True:
    game = chess.pgn.read_game(source)
    if game is None:
        break
    if game.errors:
        raise ValueError('Independent PGN reader reported errors')
    nodes = []
    stack = [(child, None, n) for n, child in reversed(list(enumerate(game.variations)))]
    while stack:
        node, parent, sibling = stack.pop()
        index = len(nodes)
        if not node.parent.board().is_legal(node.move):
            raise ValueError('Illegal independent move')
        nodes.append({'parent': parent, 'sibling': sibling, 'uci': node.move.uci(), 'san': node.san(), 'fen': node.board().fen()})
        stack.extend((child, index, n) for n, child in reversed(list(enumerate(node.variations))))
    games.append({'rootFen': game.board().fen(), 'result': game.headers['Result'], 'nodes': nodes})
print(json.dumps({'version': chess.__version__, 'games': games}))
`;
async function parse(text: string) {
  const child = spawn(
    process.env.PYTHON ?? 'python',
    ['-c', program, pythonModules],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  let output = '';
  let errors = '';
  child.stdout.on('data', (part: Buffer) => {
    output += part.toString();
  });
  child.stderr.on('data', (part: Buffer) => {
    errors += part.toString();
  });
  const finished = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Independent reader exited ${code}: ${errors}`)),
    );
  });
  child.stdin.end(text, 'utf8');
  await finished;
  return JSON.parse(output) as {
    version: string;
    games: ReturnType<typeof expected>[];
  };
}
const expectedGames = prepared.manifest.carrier
  ? [
      {
        rootFen: new ChessJsRulesAdapter().initialState().fen,
        result: '*',
        nodes: [],
      },
    ]
  : prepared.records.map(expected);
for (const [name, text] of [
  ['original', original],
  ['metadata removed', projection],
  ['CRLF', original.replace(/\r?\n/g, '\r\n')],
] as const) {
  const result = await parse(text);
  assert.deepEqual(
    result.games,
    expectedGames,
    name + ': full RAV, legal SAN, all FEN counters and result',
  );
  console.log(
    `PASS ${name}: python-chess ${result.version}, ${result.games.length} records, ${result.games.reduce((sum, game) => sum + game.nodes.length, 0)} move nodes`,
  );
}
