import assert from 'node:assert/strict';
import test from 'node:test';

import { ContentFormatError } from '../../../app/application/inventory/content-format-port.ts';
import { ApplicationProblem } from '../../../app/application/problems/application-problem.ts';
import type { ChessTreeCandidate } from '../../../app/domain/inventory/chess-tree-candidate.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import {
  PgnContentFormatAdapter,
  pgnLimits,
} from '../../../app/infrastructure/adapters/content/pgn/index.ts';

async function* chunks(text: string, size = 17): AsyncIterable<string> {
  for (let index = 0; index < text.length; index += size)
    yield text.slice(index, index + size);
}

async function decode(text: string, size = 17): Promise<ChessTreeCandidate[]> {
  const candidates: ChessTreeCandidate[] = [];
  await new PgnContentFormatAdapter(new ChessJsRulesAdapter()).decode(
    chunks(text, size),
    {
      signal: new AbortController().signal,
      onCandidate: async (candidate) => {
        candidates.push(candidate);
      },
    },
  );
  return candidates;
}

test('aggregates ordered prose and branch introductions into one note per anchor', async () => {
  const [candidate] = await decode(
    '[Event "Training"] { root one\n\nroot paragraph } {\troot two\n} 1.e4 { first } $1 { second } e5 ({ before c5 } { another intro } 1...c5 $2 { branch }) { after e5 } *',
    1,
  );
  assert.equal(candidate!.status, 'ready');
  assert.deepEqual(candidate!.initialComments, [
    'Event: Training\n\nroot one\n\nroot paragraph\n\nroot two',
  ]);
  assert.deepEqual(
    candidate!.nodes.map((node) => [
      node.move.san,
      node.comments,
      node.startingComments,
    ]),
    [
      ['e4', ['first\n\nsecond\n\nbefore c5\n\nanother intro'], []],
      ['e5', ['after e5'], []],
      ['c5', ['branch'], []],
    ],
  );
});

test('filters technical directives and preserves their surrounding author text', async () => {
  const [candidate] = await decode(
    '1.e4 {Plan\n\n[%cal Ge2e4] Keep this explanation.} $1 *',
  );
  assert.deepEqual(candidate!.nodes[0]!.comments, [
    'Plan\n\n Keep this explanation.',
  ]);
  assert.ok(
    candidate!.findings.some(
      (finding) => finding.code === 'pgn_directives_omitted',
    ),
  );
});

test('filters only structured annotations without interpreting prose or creating empty notes', async () => {
  const [candidate] = await decode(
    '{[%eval 0.2][%csl Gb1]} {White is better, because the king is safe.\n\n$14 and ?! are literal prose. [reference]} 1.e4 $14 {[%cal Ge2e4]} e5?! {[%clk 0:05:00]} ({[%emt 0:00:01] intro} 1...c5 $255 {[%custom value]} 2.Nf3 {  Before[%eval #3,20]After\n\n[%csl Ge4]\nEnd  }) *',
    1,
  );
  assert.equal(candidate!.status, 'ready');
  assert.deepEqual(candidate!.initialComments, [
    'White is better, because the king is safe.\n\n$14 and ?! are literal prose. [reference]',
  ]);
  assert.deepEqual(
    candidate!.nodes.map((node) => [node.move.san, node.comments]),
    [
      ['e4', ['intro']],
      ['e5', []],
      ['c5', []],
      ['Nf3', ['BeforeAfter\n\n\nEnd']],
    ],
  );
  const [technical] = await decode('{[%eval 0.2][%csl Gb1]} *');
  assert.deepEqual(technical!.initialComments, []);
  assert.deepEqual(technical!.nodes, []);
});

test('trims fragment edges while preserving inner whitespace and paragraphs', async () => {
  const [rootOnly] = await decode(
    '[Event "Root"] { first\n\nparagraph } ; second \n*',
  );
  assert.deepEqual(rootOnly!.initialComments, [
    'Event: Root\n\nfirst\n\nparagraph\n\nsecond',
  ]);
  const [plain] = await decode(
    '1.e4 {  first  sentence\n\n  second  } e5 {} { } $0 *',
  );
  assert.deepEqual(plain!.nodes[0]!.comments, ['first  sentence\n\n  second']);
  assert.deepEqual(plain!.nodes[1]!.comments, []);
});

test('keeps incomplete directives literal within the comment bounds', async () => {
  const incomplete = '[%eval ' + ' '.repeat(8_000) + 'unfinished';
  const fragments = Array.from({ length: 7 }, () => `{${incomplete}}`).join(
    '\n',
  );
  const source = `{[reference] [%cal Ge2e4]} 1.e4 ${fragments} *`;
  const [candidate] = await decode(source, source.length);
  assert.equal(candidate!.status, 'ready');
  assert.deepEqual(candidate!.initialComments, ['[reference]']);
  assert.deepEqual(candidate!.nodes[0]!.comments, [
    Array.from({ length: 7 }, () => incomplete).join('\n\n'),
  ]);
});

test('sorts shared-anchor branch introductions by source order without merging equal positions', async () => {
  const [candidate] = await decode(
    '{root} 1.e4 ( {first branch} 1.d4 {same} ) ( {second branch} 1.d4 {same} ) {main} $1 e5 ( {before c5} 1...c5 ) {after e5} *',
  );
  assert.equal(candidate!.status, 'ready');
  assert.deepEqual(candidate!.initialComments, [
    'root\n\nfirst branch\n\nsecond branch',
  ]);
  assert.deepEqual(candidate!.nodes[0]!.comments, ['main\n\nbefore c5']);
  assert.deepEqual(candidate!.nodes[1]!.comments, ['after e5']);
  const branches = candidate!.nodes.filter((node) => node.move.san === 'd4');
  assert.equal(branches.length, 2);
  assert.ok(
    branches.every(
      (node) => node.comments.length === 1 && node.comments[0] === 'same',
    ),
  );
  assert.ok(
    candidate!.nodes.every((node) => node.startingComments.length === 0),
  );
});

test('Lichess From Position uses a validated standard chess FEN and explicit setup', async () => {
  const fen = '4k3/8/8/8/8/8/8/R3K3 b Q - 7 12';
  const [accepted] = await decode(
    `[Variant "From Position"] [SetUp "1"] [FEN "${fen}"] 12... Kf7 *`,
  );
  assert.equal(accepted!.status, 'ready');
  assert.equal(accepted!.root!.fen, fen);
  assert.equal(accepted!.nodes[0]!.move.san, 'Kf7');
  for (const source of [
    '[Variant "From Position"] *',
    `[Variant "From Position"] [FEN "${fen}"] *`,
    '[Variant "From Position"] [SetUp "1"] [FEN "bad"] *',
    `[Variant "Chess960"] [SetUp "1"] [FEN "${fen}"] *`,
  ])
    assert.equal((await decode(source))[0]!.status, 'rejected');
});

test('format failures retain their safe application problem code', () => {
  for (const code of [
    'interrupted',
    'input_too_large',
    'provider_resource_exhausted',
    'format_not_recognized',
  ] as const) {
    const error = new ContentFormatError(code);
    assert.ok(error instanceof ApplicationProblem);
    assert.equal(error.problemCode, `import.${code}`);
    assert.deepEqual(error.parameters, {});
  }
});

test('streams multiple games deterministically across every kind of chunk boundary', async () => {
  const source =
    '\uFEFF[White "Müller"] [Black "Ng"] [Result "1-0"]\r\n1. e4 e5 1-0\r\n[Event "Next"] 1. d4 *';
  const expected = await decode(source, source.length);
  assert.deepEqual(await decode(source, 1), expected);
  assert.deepEqual(
    expected.map((candidate) => [
      candidate.sourceOrder,
      candidate.status,
      candidate.nodes.length,
      candidate.result,
    ]),
    [
      [0, 'ready', 2, '1-0'],
      [1, 'ready', 1, '*'],
    ],
  );
  assert.equal(expected[0]!.suggestedName, 'Müller - Ng');
});

test('preserves recursive RAVs in stable main-first preorder with legal positions', async () => {
  const [candidate] = await decode(
    '1. e4 (1. d4 d5 (1... Nf6) 2. c4) e5 (1... c5 2. Nf3) 2. Nf3 *',
  );
  assert.equal(candidate!.status, 'ready');
  assert.deepEqual(
    candidate!.nodes.map((node) => [
      node.nodeIndex,
      node.parentNodeIndex,
      node.siblingOrder,
      node.move.san,
    ]),
    [
      [0, null, 0, 'e4'],
      [1, 0, 0, 'e5'],
      [2, 1, 0, 'Nf3'],
      [3, 0, 1, 'c5'],
      [4, 3, 0, 'Nf3'],
      [5, null, 1, 'd4'],
      [6, 5, 0, 'd5'],
      [7, 6, 0, 'c4'],
      [8, 5, 1, 'Nf6'],
    ],
  );
  assert.equal(candidate!.nodes[8]!.after.position.sideToMove, 'white');
  assert.ok(
    candidate!.findings.some((finding) => finding.code === 'pgn_rav_preserved'),
  );
});

test('preserves both comment forms and their owners while filtering technical annotations', async () => {
  const [candidate] = await decode(
    '{intro} [Event "Comments"] {second} 1. e4 $0 $1 { a } {} {[%clk 0:05:00] [%eval 0.20]} ;line\n( {branch} 1. d4! {branch end}) e5?! *',
  );
  assert.equal(candidate!.status, 'ready');
  assert.deepEqual(candidate!.initialComments, [
    'Event: Comments\n\nintro\n\nsecond\n\nbranch',
  ]);
  assert.deepEqual(candidate!.nodes[0]!.comments, ['a\n\nline']);
  assert.equal('nags' in candidate!.nodes[0]!, false);
  assert.deepEqual(candidate!.nodes[1]!.comments, []);
  assert.deepEqual(candidate!.nodes[2]!.startingComments, []);
  assert.deepEqual(candidate!.nodes[2]!.comments, ['branch end']);
  assert.ok(
    candidate!.findings.some(
      (finding) =>
        finding.code === 'pgn_directives_omitted' &&
        finding.feature === 'comment_directives',
    ),
  );
});

test('maps useful tags to ordinary root text and discards technical and arbitrary tags', async () => {
  const [candidate] = await decode(
    '[Date "2026.10.01"] [WhiteElo "0007"] [TimeControl "40/7200:3600"] [__proto__ "inert"] [Custom_42 "unused"] [Annotator "  a\\"b\\\\c  "] [License "technical"] [SHA "technical"] [Commit "technical"] [SourceSHA256 "technical"] *',
  );
  assert.equal(candidate!.status, 'ready');
  assert.deepEqual(candidate!.initialComments, [
    'Date: 2026.10.01\nWhiteElo: 0007\nAnnotator: a"b\\c\nTimeControl: 40/7200:3600',
  ]);
  assert.equal('headers' in candidate!, false);
  assert.equal(JSON.stringify(candidate).includes('technical'), false);
  assert.equal(
    JSON.stringify(candidate).includes('pgn_headers_preserved'),
    false,
  );
});

test('keeps game and study tags readable without unknown placeholders', async () => {
  const [candidate] = await decode(
    '[Event "Training"] [White "?"] [Black "??"] [Date "????.??.??"] [Site "?"] [Round "?"] [Result "1-0"] [ECO "C20"] [Opening "King Pawn"] [StudyName "Study"] [ChapterName "Chapter"] [Annotator "Author"] {intro} 1.e4 1-0',
  );
  assert.equal(candidate!.status, 'ready');
  assert.equal(candidate!.suggestedName, 'Chapter');
  assert.deepEqual(candidate!.initialComments, [
    'Event: Training\nResult: 1-0\nECO: C20\nOpening: King Pawn\nStudyName: Study\nChapterName: Chapter\nAnnotator: Author\n\nintro',
  ]);
  const [unknown] = await decode(
    '[White "?"] [Black "??"] [Event "?"] [Result "*"] *',
  );
  assert.equal(unknown!.suggestedName, 'PGN 1');
  assert.deepEqual(unknown!.initialComments, []);
  const [players] = await decode(
    '[white "Alpha"] [black "Beta"] [Date "2026.??.??"] *',
  );
  assert.equal(players!.suggestedName, 'Alpha - Beta');
  assert.deepEqual(players!.initialComments, [
    'Date: 2026.??.??\nWhite: Alpha\nBlack: Beta',
  ]);
});

test('keeps long root metadata in one note without losing text or Unicode', async () => {
  const value = 'a'.repeat(pgnLimits.maxStringCharacters - 8) + '\u{1F600}';
  const [candidate] = await decode(`[Event "${value}"] [Opening "End"] *`);
  assert.equal(candidate!.status, 'ready');
  assert.equal(
    candidate!.initialComments.join(''),
    `Event: ${value}\nOpening: End`,
  );
  assert.equal(candidate!.initialComments.length, 1);
  assert.ok(candidate!.initialComments[0]!.isWellFormed());
});

test('rejects illegal FEN roots and king captures without exposing a usable tree', async () => {
  for (const source of [
    '[SetUp "1"] [FEN "8/8/8/8/8/8/4k3/4K3 w - - 0 1"] *',
    '[SetUp "1"] [FEN "8/8/8/8/8/8/4k3/4K3 w - - 0 1"] 1.Kxe2 *',
    '[SetUp "1"] [FEN "4k3/8/8/8/8/8/8/K3R3 w - - 0 1"] 1.Rxe8 *',
    '[SetUp "1"] [FEN "4k3/8/8/8/8/8/8/4K3 w K - 0 1"] *',
  ]) {
    const [candidate] = await decode(source);
    assert.equal(candidate!.status, 'rejected', source);
    assert.equal(candidate!.root, undefined);
    assert.deepEqual(candidate!.nodes, []);
    assert(
      candidate!.findings.some((finding) => finding.code === 'pgn_invalid_fen'),
    );
  }
});

test('keeps long comments together at each anchor without losing text or Unicode', async () => {
  const text = 'a'.repeat(7_999) + '\u{1F600}' + 'b'.repeat(99);
  const [candidate] = await decode(
    `{${text}}\n1.e4 {${text}}\ne5 ({${text}} 1...c5) *`,
  );
  assert.equal(candidate!.status, 'ready');
  assert.deepEqual(candidate!.initialComments, [text]);
  assert.deepEqual(candidate!.nodes[0]!.comments, [`${text}\n\n${text}`]);
  assert.ok(candidate!.nodes[0]!.comments[0]!.isWellFormed());
  assert.deepEqual(candidate!.nodes[2]!.startingComments, []);
});

test('retains a movetext result as ordinary root text without requiring a Result tag', async () => {
  for (const result of ['1-0', '0-1', '1/2-1/2'] as const) {
    for (const header of ['', `[Result "${result}"] `]) {
      const [candidate] = await decode(`${header}1.e4 ${result}`);
      assert.equal(candidate!.status, 'ready');
      assert.equal(candidate!.result, result);
      assert.deepEqual(candidate!.initialComments, [`Result: ${result}`]);
    }
  }
});

test('omits numeric evaluations and unknown NAGs without replacement text or warnings', async () => {
  const [candidate] = await decode('1.e4 $0 $14 e5 $255 *');
  assert.equal(candidate!.status, 'ready');
  assert.deepEqual(candidate!.nodes[0]!.comments, []);
  assert.deepEqual(candidate!.nodes[1]!.comments, []);
  assert.ok(candidate!.nodes.every((node) => !('nags' in node)));
  assert.ok(
    candidate!.findings.some(
      (finding) =>
        finding.code === 'pgn_nags_omitted' && finding.severity === 'info',
    ),
  );
});

test('filters the entire valid NAG range without interpreting it', async () => {
  const nags = Array.from({ length: 256 }, (_, index) => `$${index}`).join(' ');
  const [candidate] = await decode(`1.e4 ${nags} *`);
  assert.equal(candidate!.status, 'ready');
  assert.deepEqual(candidate!.nodes[0]!.comments, []);
});

test('keeps nested branch introductions at their origins and aftercomments at their targets', async () => {
  const [candidate] = await decode(
    '{root} 1.e4 {after e4} e5 ({before c5} 1...c5 {[%csl Ge4] after c5} 2.Nf3 ({before Nc3} 2.Nc3 {after Nc3})) *',
    1,
  );
  assert.equal(candidate!.status, 'ready');
  const c5 = candidate!.nodes.find((node) => node.move.san === 'c5')!;
  const nc3 = candidate!.nodes.find((node) => node.move.san === 'Nc3')!;
  assert.equal(candidate!.nodes[c5.parentNodeIndex!]!.move.san, 'e4');
  assert.deepEqual(c5.startingComments, []);
  assert.deepEqual(candidate!.nodes[c5.parentNodeIndex!]!.comments, [
    'after e4\n\nbefore c5',
  ]);
  assert.deepEqual(c5.comments, ['after c5\n\nbefore Nc3']);
  assert.equal(nc3.parentNodeIndex, c5.nodeIndex);
  assert.deepEqual(nc3.startingComments, []);
  assert.deepEqual(nc3.comments, ['after Nc3']);
  assert.deepEqual(candidate!.initialComments, ['root']);
});

test('filters a numeric NAG after a move comment without changing the text or moves', async () => {
  const [candidate] = await decode('1.e4 {text} $1 e5 *');
  assert.equal(candidate!.status, 'ready');
  assert.deepEqual(candidate!.nodes[0]!.comments, ['text']);
  assert.deepEqual(
    candidate!.nodes.map((node) => node.move.san),
    ['e4', 'e5'],
  );
});

test('filters alternating NAG sequences without changing comment owners or order', async () => {
  for (const annotation of [
    '$1 {first} $2 {second} $3',
    '{first} $1 ;second\n$2 $3',
    '{first} ! {second} ? !!',
    '!{first}$2{second}$3',
    '{first}$1{second}$2$3',
  ]) {
    const source = `{initial $99} 1.e4${annotation.startsWith('!') ? '' : ' '}${annotation} e5 {black} $4 *`;
    const [candidate] = await decode(source, 1);
    assert.equal(candidate!.status, 'ready', annotation);
    assert.deepEqual(candidate!.initialComments, ['initial $99']);
    assert.deepEqual(candidate!.nodes[0]!.comments, ['first\n\nsecond']);
    assert.deepEqual(candidate!.nodes[1]!.comments, ['black']);
    assert.deepEqual(await decode(source, source.length), [candidate]);
  }
});

test('keeps annotations around RAVs on the preceding move and branch introductions inside the RAV', async () => {
  const [candidate] = await decode(
    '{initial} 1.e4 ( {branch intro} 1.d4 {branch} $2 d5) {main} $1 (1.c4 {third} $3 e5) {last} $4 e5 {black} $5 *',
  );
  assert.equal(candidate!.status, 'ready');
  assert.deepEqual(candidate!.initialComments, ['initial\n\nbranch intro']);
  assert.deepEqual(
    candidate!.nodes.map((node) => [
      node.nodeIndex,
      node.parentNodeIndex,
      node.siblingOrder,
      node.move.san,
      node.comments,
      node.startingComments,
    ]),
    [
      [0, null, 0, 'e4', ['main\n\nlast'], []],
      [1, 0, 0, 'e5', ['black'], []],
      [2, null, 1, 'd4', ['branch'], []],
      [3, 2, 0, 'd5', [], []],
      [4, null, 2, 'c4', ['third'], []],
      [5, 4, 0, 'e5', [], []],
    ],
  );
});

test('binds a comment after a RAV to the preceding move rather than the next move', async () => {
  const [candidate] = await decode('1.e4 (1.d4) {main} e5 *');
  assert.equal(candidate!.status, 'ready');
  assert.deepEqual(candidate!.nodes[0]!.comments, ['main']);
  assert.deepEqual(candidate!.nodes[1]!.startingComments, []);
  assert.deepEqual(candidate!.nodes[2]!.comments, []);
});

test('rejects a NAG without a preceding move rather than attaching it to a later move', async () => {
  for (const source of ['{intro} $1 1.e4 *', '1.e4 ( {intro} $1 1.d4) *']) {
    const [candidate] = await decode(source);
    assert.equal(candidate!.status, 'rejected');
    assert.deepEqual(candidate!.nodes, []);
    assert.equal(candidate!.root, undefined);
  }
});

test('preserves annotations around an already recognized draw offer', async () => {
  for (const annotation of [
    '{first} $1 (=) {second} $2',
    '(=){first}$1{second}$2',
  ]) {
    const [candidate] = await decode(`1.e4 ${annotation} e5 *`);
    assert.equal(candidate!.status, 'warning');
    assert.deepEqual(candidate!.nodes[0]!.comments, ['first\n\nsecond']);
    assert.ok(
      candidate!.findings.some(
        (finding) =>
          finding.code === 'pgn_draw_offer_unsupported' &&
          finding.nodeIndex === 0,
      ),
    );
  }
});

test('keeps the annotation cap effective when NAGs and comments alternate', async () => {
  const annotation = '{x}$1 '.repeat(pgnLimits.maxCommentsPerCandidate);
  const [candidate] = await decode(`1.e4 ${annotation} e5 *`);
  assert.equal(candidate!.status, 'ready');
  assert.equal(
    candidate!.nodes[0]!.comments[0]!.split('\n\n').length,
    pgnLimits.maxCommentsPerCandidate,
  );
  await assert.rejects(
    decode(`1.e4 ${annotation}{extra} $1 e5 *`),
    (error: unknown) =>
      error instanceof ContentFormatError &&
      error.code === 'provider_resource_exhausted',
  );
});

test('supports root-only, SetUp zero and a black-to-move FEN with counters', async () => {
  const [zero] = await decode('[SetUp "0"] *');
  assert.equal(zero!.status, 'ready');
  assert.equal(zero!.root!.playState.historyKnowledge, 'complete');
  const [custom] = await decode(
    '[SetUp "1"] [FEN "4k3/8/8/8/8/8/8/R3K3 b Q - 7 12"] 12... Kf7 *',
  );
  assert.equal(custom!.status, 'ready');
  assert.equal(custom!.root!.playState.fullmoveNumber, 12);
  assert.equal(custom!.nodes[0]!.move.san, 'Kf7');
  assert.equal(custom!.nodes[0]!.after.playState.historyKnowledge, 'partial');
});

for (const [source, code] of [
  ['1. e4 e5 2. Bh6 *', 'pgn_illegal_san'],
  ['[Result "1-0"] 1. e4 0-1', 'pgn_result_mismatch'],
  ['[Result "invalid"] *', 'pgn_invalid_result'],
  ['1. e4 (1. d4 *', 'pgn_unbalanced_rav'],
  ['1. e4 ) *', 'pgn_unbalanced_rav'],
  ['[Variant "Chess960"] 1. e4 *', 'pgn_variant_unsupported'],
  ['[variant "Chess960"] 1. e4 *', 'pgn_variant_unsupported'],
  ['1. e4 (1. d4 1-0) *', 'pgn_variation_result_unsupported'],
  ['1. e4 (1. e5) e5 *', 'pgn_illegal_san'],
  ['[SetUp "0"] [FEN "bad"] *', 'pgn_invalid_setup'],
  ['[SetUp "1"] *', 'pgn_invalid_setup'],
  ['[FEN "bad"] *', 'pgn_invalid_setup'],
  ['[SetUp "1"] [FEN "bad"] *', 'pgn_invalid_fen'],
  ['[Result "*"] [Result "1-0"] *', 'pgn_duplicate_header'],
  ['1. e4 $256 *', 'pgn_invalid_nag'],
  ['1. e4 {unterminated *', 'pgn_unclosed_comment'],
  ['1. e4 garbage *', 'pgn_invalid_syntax'],
] as const) {
  test(`rejects ${code} without a usable partial tree`, async () => {
    const [candidate] = await decode(source);
    assert.equal(candidate!.status, 'rejected');
    assert.equal(candidate!.root, undefined);
    assert.deepEqual(candidate!.nodes, []);
    assert.ok(
      candidate!.findings.some((finding) => finding.code === code),
      JSON.stringify(candidate!.findings),
    );
    assert.ok(
      candidate!.findings.every((finding) =>
        Object.keys(finding).every((key) =>
          ['code', 'disposition', 'severity', 'feature', 'nodeIndex'].includes(
            key,
          ),
        ),
      ),
    );
  });
}

test('reports an omitted termination and preserves an unknown result', async () => {
  const [candidate] = await decode('1. e4 e5');
  assert.equal(candidate!.status, 'warning');
  assert.equal(candidate!.result, '*');
  assert.equal(candidate!.nodes.length, 2);
  assert.ok(
    candidate!.findings.some(
      (finding) => finding.code === 'pgn_result_missing',
    ),
  );
});

test('frames an adjacent asterisk without inventing a missing result', async () => {
  const candidates = await decode('1.e4*\n1.d4*', 1);
  assert.deepEqual(
    candidates.map((candidate) => [
      candidate.status,
      candidate.result,
      candidate.nodes.length,
    ]),
    [
      ['ready', '*', 1],
      ['ready', '*', 1],
    ],
  );
});

test('result markers and brackets in comments or tag strings never split a game', async () => {
  const [candidate] = await decode(
    '[Event "a * 1-0 ( ] \\\" b"] {0-1 ( [header]} 1. e4 {1/2-1/2} *',
    1,
  );
  assert.equal(candidate!.status, 'ready');
  assert.deepEqual(candidate!.initialComments, [
    'Event: a * 1-0 ( ] " b\n\n0-1 ( [header]',
  ]);
  assert.deepEqual(candidate!.nodes[0]!.comments, ['1/2-1/2']);
});

test('draw offers have an explicit unsupported finding instead of silent loss', async () => {
  const [candidate] = await decode('1. e4 (=) e5 *');
  assert.equal(candidate!.status, 'warning');
  assert.ok(
    candidate!.findings.some(
      (finding) =>
        finding.code === 'pgn_draw_offer_unsupported' &&
        finding.nodeIndex === 0,
    ),
  );
});

test('propagates acquisition or candidate callback failure instead of declaring success', async () => {
  const failure = new Error('test source failure');
  async function* failingSource(): AsyncIterable<string> {
    yield '1. e4 * ';
    throw failure;
  }
  const adapter = new PgnContentFormatAdapter(new ChessJsRulesAdapter());
  const candidates: ChessTreeCandidate[] = [];
  await assert.rejects(
    adapter.decode(failingSource(), {
      signal: new AbortController().signal,
      onCandidate: async (candidate) => {
        candidates.push(candidate);
      },
    }),
    (error: unknown) => error === failure,
  );
  assert.equal(candidates.length, 1);
  await assert.rejects(
    adapter.decode(chunks('1. e4 *'), {
      signal: new AbortController().signal,
      onCandidate: async () => {
        throw failure;
      },
    }),
    (error: unknown) => error === failure,
  );
});

test('continues after a rejected candidate only at a proven result boundary', async () => {
  const candidates = await decode('1. e5 *\n[Event "Valid"] 1. d4 *');
  assert.deepEqual(
    candidates.map((candidate) => candidate.status),
    ['rejected', 'ready'],
  );
});

test('enforces parser resource bounds before invoking chess rules', async () => {
  const rules = new ChessJsRulesAdapter();
  rules.applyMove = () => {
    assert.fail('rules must not be reached');
  };
  const adapter = new PgnContentFormatAdapter(rules);
  for (const source of [
    '1. e4 ' + '('.repeat(pgnLimits.maxVariationDepth + 1),
    '{' + 'a'.repeat(pgnLimits.maxStringCharacters + 1) + '} *',
    ' '.repeat(pgnLimits.maxLineCharacters + 1),
    '[Custom "' + 'x'.repeat(pgnLimits.maxStringCharacters + 1) + '"] *',
    '1. e4 ' + '$1 '.repeat(1025) + '*',
    '1. e4 ' + '!'.repeat(2049) + '*',
    Array.from({ length: 65 }, (_, index) => `[Tag${index} "x"]`).join(' ') +
      '*',
  ]) {
    await assert.rejects(
      adapter.decode(chunks(source, 4096), {
        signal: new AbortController().signal,
        onCandidate: async () => {
          assert.fail('candidate must not be emitted');
        },
      }),
      (error: unknown) =>
        error instanceof ContentFormatError &&
        error.code === 'provider_resource_exhausted',
    );
  }
});

test('enforces the candidate cap and awaits each writer callback', async () => {
  let received = 0;
  let writing = false;
  await assert.rejects(
    new PgnContentFormatAdapter(new ChessJsRulesAdapter()).decode(
      chunks('* '.repeat(1001), 2002),
      {
        signal: new AbortController().signal,
        onCandidate: async (candidate) => {
          assert.equal(writing, false);
          writing = true;
          assert.equal(candidate.sourceOrder, received++);
          await Promise.resolve();
          writing = false;
        },
      },
    ),
    (error: unknown) =>
      error instanceof ContentFormatError &&
      error.code === 'provider_resource_exhausted',
  );
  assert.equal(received, 1000);
});

test('accepts the depth boundary and rejects a move beyond the node boundary', async () => {
  const [deep] = await decode(
    'e4 ('.repeat(pgnLimits.maxVariationDepth) +
      'e4' +
      ')'.repeat(pgnLimits.maxVariationDepth) +
      ' *',
  );
  assert.equal(deep!.status, 'ready');
  assert.equal(deep!.nodes.length, pgnLimits.maxVariationDepth + 1);
  const line = 'Nf3 Nf6 Ng1 Ng8 '.repeat(pgnLimits.maxNodesPerCandidate / 4);
  const [full] = await decode(line + '*');
  assert.equal(full!.status, 'ready');
  assert.equal(full!.nodes.length, pgnLimits.maxNodesPerCandidate);
  await assert.rejects(
    decode(line + 'Nf3*'),
    (error: unknown) =>
      error instanceof ContentFormatError &&
      error.code === 'provider_resource_exhausted',
  );
});

test('cancels before input, during CPU work and between emitted candidates', async () => {
  for (const phase of ['before', 'during', 'after'] as const) {
    const controller = new AbortController();
    let received = 0;
    if (phase === 'before') controller.abort();
    if (phase === 'during') setTimeout(() => controller.abort(), 0);
    await assert.rejects(
      new PgnContentFormatAdapter(new ChessJsRulesAdapter()).decode(
        chunks(
          phase === 'during'
            ? '1. e4 {' + 'a'.repeat(8000) + '} *'
            : '1. e4 * 1. d4 *',
          20000,
        ),
        {
          signal: controller.signal,
          onCandidate: async () => {
            received += 1;
            controller.abort();
          },
        },
      ),
      (error: unknown) =>
        error instanceof ContentFormatError && error.code === 'interrupted',
    );
    assert.equal(received, phase === 'after' ? 1 : 0);
  }
});

test('does not echo parser diagnostics and never drops malformed trailing content', async () => {
  const candidates = await decode('1. e4 *\n<script>private-path</script>');
  assert.deepEqual(
    candidates.map((candidate) => candidate.status),
    ['ready', 'rejected'],
  );
  assert.equal(JSON.stringify(candidates[1]).includes('private-path'), false);
  await assert.rejects(
    decode('  \n'),
    (error: unknown) =>
      error instanceof ContentFormatError &&
      error.code === 'format_not_recognized',
  );
});
