import assert from 'node:assert/strict';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';

import type { AnalysisRecordDto } from '../../../app/infrastructure/channels/host_client/index.ts';
import { inventoryContentPresentation } from '../../../app/infrastructure/channels/ui/renderer/inventory-content-presentation.ts';
import {
  messages,
  type UiLocale,
} from '../../../app/infrastructure/channels/ui/renderer/messages.ts';

let InventoryContentPreview: ComponentType<{ record: AnalysisRecordDto }>;

before(async () => {
  const result = await build({
    entryPoints: [
      fileURLToPath(
        new URL(
          '../../../app/infrastructure/channels/ui/renderer/inventory-content-preview.tsx',
          import.meta.url,
        ),
      ),
    ],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    loader: { '.module.css': 'empty' },
    plugins: [
      {
        name: 'shared-react-runtime',
        setup(builder) {
          builder.onResolve({ filter: /^[^./]/ }, (args) => {
            if (path.isAbsolute(args.path)) return undefined;
            return { path: import.meta.resolve(args.path), external: true };
          });
        },
      },
    ],
  });
  const output = result.outputFiles[0];
  assert.ok(output);
  ({ InventoryContentPreview } = await import(
    `data:text/javascript;base64,${Buffer.from(output.text).toString('base64')}`
  ));
});

function state(fen: string): AnalysisRecordDto['root'] {
  const [boardKey, side, , , halfmove, fullmove] = fen.split(' ');
  assert.ok(boardKey);
  return {
    fen,
    position: {
      ruleSetId: 'standardChess',
      boardKey,
      positionKey: fen,
      sideToMove: side === 'w' ? 'white' : 'black',
      castlingRights: {
        whiteKingSide: true,
        whiteQueenSide: true,
        blackKingSide: true,
        blackQueenSide: true,
      },
      effectiveEnPassantSquare: -1,
    },
    playState: {
      fullmoveNumber: Number(fullmove),
      halfmoveClock: Number(halfmove),
      historyKnowledge: 'unknown',
    },
  };
}

function record(): AnalysisRecordDto {
  const sourceRoot = state(
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 17',
  );
  const root = state(
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 17',
  );
  const next = state(
    'rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 18',
  );
  return {
    itemId: 'own-item',
    itemType: 'analysis',
    revisionId: 'own-revision',
    currentRevisionId: 'own-revision',
    revisionNumber: 1,
    displayName: 'Own continuation',
    languageTag: 'en-GB',
    contextMember: false,
    historical: false,
    origin: {
      kind: 'inventory_anchor',
      itemId: 'source-item',
      revisionId: 'source-revision',
      anchorId: 'source-end',
    },
    root,
    rootAnchorId: 'own-root',
    currentAnchorId: 'own-end',
    cursor: 1,
    contributions: [],
    steps: [
      {
        before: root,
        after: next,
        anchorId: 'own-end',
        move: { from: 'g8', to: 'f6', san: 'Nf6' },
      },
    ],
    sourceLine: {
      sourceItemId: 'source-item',
      sourceRevisionId: 'source-revision',
      sourceAnchorId: 'source-end',
      sourceDisplayName: 'French preparation',
      sourceItemType: 'analysis',
      root: sourceRoot,
      contributions: [],
      steps: [
        {
          before: sourceRoot,
          after: root,
          move: { from: 'e2', to: 'e4', san: 'e4' },
        },
      ],
    },
  };
}

function render(value: AnalysisRecordDto, locale: UiLocale = 'en-GB') {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale, messages: messages[locale], onError: () => undefined },
      createElement(InventoryContentPreview, { record: value }),
    ),
  );
}

function buttons(markup: string) {
  return markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

test('own navigation uses stored canonical states, ignoring source prefix and workspace cursor', () => {
  const value = record();
  const initial = inventoryContentPresentation(value, 0, 'en-GB');
  assert.equal(initial.state, value.root);
  assert.deepEqual(initial.moves, [{ ply: 1, label: '17... Nf6' }]);
  assert.equal(initial.source?.displayName, 'French preparation');
  assert.deepEqual(initial.source?.moves, [{ ply: 1, label: '17. e4' }]);
  assert.equal(
    inventoryContentPresentation(value, 1, 'en-GB').state,
    value.steps[0]?.after,
  );
  assert.equal(inventoryContentPresentation(value, 99, 'en-GB').cursor, 1);
  assert.equal(
    inventoryContentPresentation(value, -1, 'en-GB').state,
    value.root,
  );
  assert.deepEqual(inventoryContentPresentation(value, 0, 'de-DE').moves, [
    { ply: 1, label: '17... Sf6' },
  ]);
});

test('SSR starts on the own board with accessible root/previous/next controls and separate origin', () => {
  const markup = render(record());
  assert.equal(
    (markup.match(/data-chess-board-square="true"/g) ?? []).length,
    64,
  );
  assert.match(markup, /aria-readonly="true"/);
  assert.match(markup, /aria-label="g8, Black knight"/);
  assert.match(markup, /aria-label="f6, empty square"/);
  for (const label of ['Starting position', 'Previous move']) {
    const button = buttons(markup).find((entry) =>
      entry.includes(`aria-label="${label}"`),
    );
    assert.ok(button);
    assert.match(button, /disabled=""/);
    assert.ok(button.includes(`aria-label="${label}"`));
    assert.ok(markup.includes(`<span title="${label}">`));
  }
  const next = buttons(markup).find((entry) =>
    entry.includes('aria-label="Next move"'),
  );
  assert.ok(next);
  assert.doesNotMatch(next, /disabled/);
  assert.ok(buttons(markup).some((entry) => entry.includes('17... Nf6')));
  assert.ok(buttons(markup).every((entry) => !entry.includes('17. e4')));
  assert.match(
    markup,
    /<details[^>]*><summary>Origin: French preparation<\/summary>/,
  );
  assert.doesNotMatch(markup, /<details[^>]*\bopen/);
  assert.doesNotMatch(markup, /aria-current="step"/);
});

test('root-only analysis always renders a board and all navigation controls disabled', () => {
  const { sourceLine: _source, ...value } = record();
  assert.ok(_source);
  const markup = render({
    ...value,
    steps: [],
    origin: { kind: 'position_setup' },
  });
  assert.match(markup, /data-inventory-content-preview/);
  assert.match(markup, /role="grid"/);
  assert.match(markup, /No moves/);
  const navigation = buttons(markup).filter((entry) =>
    /aria-label="(Starting position|Previous move|Next move)"/.test(entry),
  );
  assert.equal(navigation.length, 3);
  assert.ok(navigation.every((entry) => entry.includes('disabled=""')));
  assert.doesNotMatch(markup, /<details/);
});

test('game metadata uses player side, provider display name and localized stored outcomes', () => {
  const outcomes: readonly [
    NonNullable<AnalysisRecordDto['game']>['outcome'],
    NonNullable<AnalysisRecordDto['game']>['outcomeSource'],
    RegExp,
  ][] = [
    [{ kind: 'win', winner: 'black' }, 'manual', /Schwarz gewinnt/],
    [{ kind: 'draw', reason: 'stalemate' }, 'automatic', /Remis durch Patt/],
    [{ kind: 'draw', reason: 'insufficient_material' }, 'automatic', /Remis/],
    [{ kind: 'draw', reason: 'threefold_repetition' }, 'automatic', /Remis/],
    [{ kind: 'draw', reason: 'seventy_five_move' }, 'automatic', /Remis/],
    [{ kind: 'unfinished' }, 'manual', /Unvollständig beendet/],
  ];
  for (const [outcome, outcomeSource, expected] of outcomes) {
    const markup = render(
      {
        ...record(),
        itemType: 'game',
        game: {
          playerSide: 'black',
          policy: {
            capability: 'best_move',
            providerDisplayName: 'Training opponent',
            providerFingerprint: 'not-user-facing',
            providerInstanceId: 'engine-instance',
            providerType: 'stockfish',
          },
          outcome,
          outcomeSource,
        },
      },
      'de-DE',
    );
    assert.match(markup, /<dd>Schwarz<\/dd>/);
    assert.match(markup, /<dd>Training opponent<\/dd>/);
    assert.match(markup, expected);
    assert.match(markup, /17\.\.\. Sf6/);
    assert.doesNotMatch(markup, /not-user-facing|engine-instance/);
  }
});

test('a sourcePath without sourceLine remains separate and a named sourceLine takes precedence', () => {
  const { sourceLine, ...value } = record();
  assert.ok(sourceLine);
  const withPath = {
    ...value,
    sourcePath: {
      displayName: 'Free analysis path',
      root: sourceLine.root,
      steps: sourceLine.steps,
    },
  };
  assert.equal(
    inventoryContentPresentation(withPath, 0, 'en-GB').source?.displayName,
    'Free analysis path',
  );
  const presentation = inventoryContentPresentation(
    { ...withPath, sourceLine },
    0,
    'en-GB',
  );
  assert.equal(presentation.source?.displayName, 'French preparation');
  assert.equal(presentation.source.moves.length, 1);
  assert.equal(presentation.moves.length, 1);
  assert.equal(presentation.state, value.root);
});
