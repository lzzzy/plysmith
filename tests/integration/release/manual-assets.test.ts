import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { standardInitialFen } from '../../../app/domain/chess_graph/index.ts';
import type { ChessTreeCandidate } from '../../../app/domain/inventory/chess-tree-candidate.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { PgnContentFormatAdapter } from '../../../app/infrastructure/adapters/content/pgn/index.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const manual = 'docs/manual/';
const chapters = [
  'README',
  '01-import',
  '02-inventory',
  '03-analysis',
  '04-settings',
  '05-playout',
  '06-live',
  '07-opening-library',
  '08-contexts',
];

test('versioned manual has nine DE/EN pairs and valid local and release-tag documentation links', async () => {
  const files = await readdir(path.join(root, manual));
  const expected = chapters.flatMap((name) => [`${name}.md`, `${name}.en.md`]);
  assert.deepEqual(
    files.filter((name) => name.endsWith('.md')).sort(),
    expected.sort(),
  );
  const { version } = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8'),
  ) as { version: string };
  const tagRoot = `https://github.com/lzzzy/plysmith/blob/v${version}/`;
  const documents = new Set([
    ...expected.map((name) => manual + name),
    'README.md',
    'README.en.md',
    'CONTRIBUTING.md',
    'CONTRIBUTING.en.md',
    '.github/RELEASE_NOTES.md',
  ]);
  const failures: string[] = [];
  for (const source of documents) {
    const markdown = withoutCode(
      await readFile(path.join(root, source), 'utf8'),
    );
    const links = documentationLinks(markdown);
    if (source.startsWith(manual))
      assert.ok(links.length > 0, `${source}: expected documentation links`);
    for (const href of links) {
      const target = localTarget(source, href, tagRoot);
      if (!target) continue;
      const location = `${source}: ${href}`;
      try {
        const information = await stat(path.join(root, target.file));
        assert.ok(information.isFile() || information.isDirectory(), location);
        if (information.isDirectory()) continue;
        if (target.file.endsWith('.md')) {
          documents.add(target.file);
          if (target.anchor) {
            const contents = await readFile(
              path.join(root, target.file),
              'utf8',
            );
            assert.ok(
              headingAnchors(contents).has(target.anchor),
              `missing anchor #${target.anchor}`,
            );
          }
          if (
            source.startsWith(manual) &&
            source.endsWith('.en.md') &&
            !target.file.endsWith('.en.md')
          ) {
            const english = target.file.replace(/\.md$/, '.en.md');
            const neighbours = await readdir(
              path.dirname(path.join(root, english)),
            );
            assert.ok(
              !neighbours.includes(path.basename(english)),
              `English neighbour exists: ${english}`,
            );
          }
        }
      } catch (error) {
        failures.push(
          `${location}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  assert.deepEqual(
    failures,
    [],
    'Documentation links must resolve without a build or network access',
  );
});

test('manual PGN decodes all six teaching examples with default import budgets', async () => {
  const pgn = await readFile(path.join(root, manual, 'manual.pgn'), 'utf8');
  const candidates: ChessTreeCandidate[] = [];
  async function* chunks(): AsyncIterable<string> {
    for (let offset = 0; offset < pgn.length; offset += 97)
      yield pgn.slice(offset, offset + 97);
  }
  await new PgnContentFormatAdapter(new ChessJsRulesAdapter()).decode(
    chunks(),
    {
      signal: new AbortController().signal,
      onCandidate: async (candidate) => {
        candidates.push(candidate);
      },
    },
  );
  assert.equal(candidates.length, 6);
  assert.deepEqual(
    candidates.map(({ status }) => status),
    Array<string>(6).fill('ready'),
  );
  assert.deepEqual(
    candidates.map(({ sourceOrder }) => sourceOrder),
    [0, 1, 2, 3, 4, 5],
  );
  const [initial, opening, game, endgame, sketch, development] = candidates;
  assert.ok(initial && opening && game && endgame && sketch && development);
  assert.equal(initial.root?.fen, standardInitialFen);
  assert.equal(initial.nodes.length, 0);
  assert.ok(initial.initialComments.length > 0);
  assert.ok(opening.nodes.some(({ siblingOrder }) => siblingOrder > 0));
  assert.ok(opening.nodes.some(({ move }) => move.san === 'O-O'));
  assert.equal(game.result, '1-0');
  assert.equal(game.nodes.at(-1)?.move.san, 'Qxf7#');
  assert.match(game.initialComments.join('\n'), /Konstruiertes Lehrbeispiel/);
  assert.equal(endgame.root?.fen, '8/2k5/8/8/2PK4/8/8/8 w - - 0 1');
  assert.equal(endgame.nodes.length, 0);
  assert.equal(sketch.nodes.length, 1);
  assert.equal(development.nodes.length, 3);
});

function withoutCode(markdown: string): string {
  let fence: string | undefined;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker && !fence) {
        fence = marker;
        return '';
      }
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length)
          fence = undefined;
        return '';
      }
      return line;
    })
    .join('\n');
}

function documentationLinks(markdown: string): string[] {
  // Covers the inline, reference-definition and HTML links used by repository docs.
  const links: string[] = [];
  for (const match of markdown.matchAll(
    /\]\(\s*(?:<([^>]+)>|((?:[^\s()]|\([^()]*\))+))(?:\s+["'][^\n]*?["'])?\s*\)/g,
  ))
    links.push(match[1] ?? match[2]!);
  for (const match of markdown.matchAll(/^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm))
    links.push(match[1]!);
  for (const match of markdown.matchAll(/\b(?:href|src)=["']([^"']+)["']/g))
    links.push(match[1]!);
  return links;
}

function localTarget(
  source: string,
  href: string,
  tagRoot: string,
): { file: string; anchor: string } | undefined {
  let base = path.posix.dirname(source) + '/';
  if (href.startsWith(tagRoot)) {
    href = href.slice(tagRoot.length);
    base = '';
  } else if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) {
    assert.ok(
      !href.startsWith('https://github.com/lzzzy/plysmith/blob/'),
      `${source}: repository documentation must link to the current release tag: ${href}`,
    );
    return undefined;
  }
  const [pathname, anchor = ''] = href.split('#');
  const file = pathname
    ? path.posix
        .normalize(
          (pathname.startsWith('/') ? '' : base) +
            decodeURIComponent(pathname.split('?')[0]!),
        )
        .replace(/^\//, '')
    : source;
  assert.ok(
    !file.startsWith('../') && !path.isAbsolute(file),
    `${source}: link escapes repository: ${href}`,
  );
  return { file, anchor: decodeURIComponent(anchor) };
}

function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  for (const match of withoutCode(markdown).matchAll(
    /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/gm,
  )) {
    const slug = match[1]!
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, '')
      .replace(/\s/g, '-');
    let anchor = slug;
    for (let suffix = 1; anchors.has(anchor); suffix++)
      anchor = `${slug}-${suffix}`;
    anchors.add(anchor);
  }
  for (const match of markdown.matchAll(/\b(?:id|name)=["']([^"']+)["']/g))
    anchors.add(match[1]!);
  return anchors;
}
