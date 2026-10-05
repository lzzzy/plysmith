import assert from 'node:assert/strict';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import {
  messages,
  type UiLocale,
} from '../../../app/infrastructure/channels/ui/renderer/messages.ts';
import type { ImportPreview } from '../../../app/infrastructure/channels/ui/renderer/plysmith-application-store.ts';

let ImportDialog: ComponentType<{ state: object; store: object }>;
let ChessTreeMoveList: ComponentType<{
  record: object;
  anchorId: string;
  disabled: boolean;
  onSelect: (anchorId: string) => void;
  draft?: { anchorId: string; content: ReturnType<typeof createElement> };
}>;

before(async () => {
  const result = await build({
    stdin: {
      contents: `
        export { ImportDialog } from './import-dialog.tsx';
        export { ChessTreeMoveList } from './chess-tree-view.tsx';
      `,
      resolveDir: fileURLToPath(
        new URL(
          '../../../app/infrastructure/channels/ui/renderer/',
          import.meta.url,
        ),
      ),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    loader: { '.module.css': 'empty' },
    plugins: [
      {
        name: 'server-visible-modal',
        setup(builder) {
          builder.onResolve({ filter: /^react-aria-components$/ }, () => ({
            path: 'modal-shell',
            namespace: 'presentation-test',
          }));
          builder.onLoad(
            { filter: /.*/, namespace: 'presentation-test' },
            () => ({
              contents: `
        import { createElement } from 'react';
        export * from ${JSON.stringify(import.meta.resolve('react-aria-components'))};
        export function ModalOverlay(props) { return props.isOpen ? createElement('div', { 'data-keyboard-dismiss-disabled': props.isKeyboardDismissDisabled }, props.children) : null; }
        export function Modal({ children }) { return children; }
      `,
              loader: 'js',
            }),
          );
          builder.onResolve({ filter: /^[^./]/ }, (args) =>
            path.isAbsolute(args.path)
              ? undefined
              : { path: import.meta.resolve(args.path), external: true },
          );
        },
      },
    ],
  });
  const output = result.outputFiles[0];
  assert.ok(output);
  ({ ImportDialog, ChessTreeMoveList } = await import(
    `data:text/javascript;base64,${Buffer.from(output.text).toString('base64')}`
  ));
});

const preview: ImportPreview = {
  previewId: '00000000-0000-4000-8000-000000000001',
  sourceDisplayName: 'italian-game.pgn',
  inputSize: 300,
  encoding: 'utf-8',
  formatId: 'standard-chess-pgn-v1',
  candidates: [
    {
      sourceOrder: 0,
      suggestedName: 'Italienisch',
      status: 'warning',
      moveCount: 4,
      variationCount: 2,
      findings: [
        {
          code: 'pgn_result_missing',
          disposition: 'normalized',
          severity: 'warning',
          feature: 'result',
        },
      ],
    },
    {
      sourceOrder: 1,
      suggestedName: '<script>rejected</script>',
      status: 'rejected',
      moveCount: 0,
      variationCount: 0,
      findings: [
        {
          code: 'pgn_illegal_san',
          disposition: 'invalid',
          severity: 'error',
          feature: 'san',
          nodeIndex: 2,
        },
      ],
    },
  ],
};

function render(
  locale: UiLocale,
  overrides: Partial<ImportPreview> = {},
  busy = false,
  errorCode?: string,
  activity: 'choosing' | 'preparing' | 'publishing' = 'publishing',
) {
  const errors: string[] = [];
  const html = renderToStaticMarkup(
    createElement(
      IntlProvider,
      {
        locale,
        messages: messages[locale],
        onError: (error) => errors.push(error.message),
      },
      createElement(ImportDialog, {
        state: {
          phase: 'ready',
          status: { persistence: { dataRevision: 1 } },
          scope: { kind: 'context', contextId: '5' },
          contexts: {
            contexts: [{ contextId: '5', displayName: 'Repertoire' }],
          },
          inventory: { items: [] },
          inventoryOrganization: { folders: [], linkedFolderIds: [] },
          inventoryContextOnly: true,
          refreshing: false,
          ...(busy ? { busyCommand: 'import_command' } : {}),
          importSession: {
            open: true,
            ...(activity === 'preparing'
              ? {}
              : { preview: { ...preview, ...overrides } }),
            ...(busy ? { activity } : {}),
            ...(errorCode === undefined ? {} : { errorCode }),
          },
        },
        store: {},
      }),
    ),
  );
  assert.deepEqual(errors, []);
  return html;
}

test('German and English import previews offer only a folder and common prefix, not an import history or context', () => {
  for (const locale of ['de-DE', 'en-GB'] as const) {
    const html = render(locale);
    assert.match(html, /italian-game.pgn - /);
    assert.match(html, /value="italian-game.pgn"/);
    assert.match(html, /value="Italienisch"/);
    assert.match(html, /maxlength="160"/i);
    assert.match(html, /aria-describedby="import-selected-moves"/);
    assert.doesNotMatch(
      html,
      /Zielkontext|Vorbereitete Importe|Destination context|Prepared imports|SHA-256|SourceCommit|Save names|Namen speichern/,
    );
  }
  assert.match(render('de-DE'), /Zielordner/);
  assert.match(render('de-DE'), /Namenspräfix/);
  assert.match(render('de-DE'), /1 von 2 ausgewählt/);
  assert.match(render('en-GB'), /Destination folder/);
  assert.match(render('en-GB'), /Name prefix/);
  assert.match(render('en-GB'), /The termination marker is missing/);
});

test('rejected candidates cannot be selected and imported markup stays inert', () => {
  const html = render('en-GB');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;rejected&lt;\/script&gt;/);
  const checkbox = html.match(
    /<input[^>]*aria-label="Select [^"]*rejected[^>]*>/,
  )?.[0];
  assert.ok(checkbox);
  assert.match(checkbox, /disabled/);
  assert.doesNotMatch(checkbox, /checked/);
});

test('publication stays disabled until names and selected warnings are reviewed; active commands block dismissal', () => {
  const html = render('en-GB');
  const publish = html
    .match(/<button[^>]*>[^]*?<\/button>/g)
    ?.find((button) => button.includes('Import selection'));
  assert.ok(publish);
  assert.match(publish, /disabled/);
  assert.match(html, /I have reviewed the warnings/);
  assert.match(
    render('en-GB', {}, true),
    /data-keyboard-dismiss-disabled="true"/,
  );
  assert.match(render('de-DE', {}, true), /Auswahl wird gespeichert/);
});

test('preparation exposes the existing cancel action and permits keyboard dismissal', () => {
  const html = render('en-GB', {}, true, undefined, 'preparing');
  assert.match(html, /data-keyboard-dismiss-disabled="false"/);
  assert.match(html, /Preparing/);
  const cancel = html
    .match(/<button[^>]*>[^]*?<\/button>/g)
    ?.find((button) => button.includes('Cancel import'));
  assert.ok(cancel);
  assert.doesNotMatch(cancel, /disabled/);
});

test('preselection accepts exact publication budgets and never picks a hidden subset above either limit', () => {
  for (const [count, moveCount, expected] of [
    [100, 1, 100],
    [101, 1, 0],
    [8, 2048, 8],
    [9, 2048, 0],
    [1, 0, 1],
    [1, 1, 1],
    [63, 132, 63],
  ]) {
    const candidates: ImportPreview['candidates'] = Array.from(
      { length: count! },
      (_, sourceOrder) => ({
        sourceOrder,
        suggestedName: 'Chapter ' + sourceOrder,
        status: 'ready',
        moveCount: moveCount!,
        variationCount: 0,
        findings: [],
      }),
    );
    const html = render('en-GB', { candidates });
    assert.match(html, new RegExp(`${expected} of ${count} selected`));
    assert.equal(
      (html.match(/type="checkbox"[^>]*checked/g) ?? []).length,
      expected,
    );
    const moves = expected! * moveCount!;
    assert.match(
      html,
      new RegExp(
        `<p id="import-selected-moves"[^>]*>${new Intl.NumberFormat('en-GB').format(moves)} half-move${moves === 1 ? '' : 's'} including variations</p>`,
      ),
    );
    assert.doesNotMatch(html, /100 chapters|\/ 16,384/);
    const german = render('de-DE', { candidates });
    assert.match(german, new RegExp(`${expected} von ${count} ausgewählt`));
    assert.match(
      german,
      new RegExp(
        `<p id="import-selected-moves"[^>]*>${new Intl.NumberFormat('de-DE').format(moves)} ${moves === 1 ? 'Halbzug' : 'Halbzüge'} einschließlich Varianten</p>`,
      ),
    );
    assert.doesNotMatch(german, /100 Kapitel|\/ 16\.384/);
    if (expected === 0) assert.match(html, /No chapters selected yet/);
  }
});

test('new import findings are localized without raw technical codes', () => {
  const candidates: ImportPreview['candidates'] = [
    {
      ...preview.candidates[1]!,
      findings: [
        {
          code: 'pgn_resource_limit',
          disposition: 'invalid',
          severity: 'error',
          feature: 'structure',
        },
      ],
    },
    {
      ...preview.candidates[0]!,
      findings: [
        {
          code: 'pgn_duplicate_fen_normalized',
          disposition: 'normalized',
          severity: 'info',
          feature: 'metadata',
        },
      ],
    },
  ];
  assert.match(
    render('de-DE', { candidates }),
    /zulässige Größe oder Komplexität/,
  );
  assert.match(render('en-GB', { candidates }), /allowed size or complexity/);
  assert.doesNotMatch(render('en-GB', { candidates }), /pgn_resource_limit/);
  assert.match(
    render('de-DE', { candidates }),
    /Identische Angaben zur Ausgangsstellung/,
  );
  assert.match(
    render('en-GB', { candidates }),
    /Identical starting-position tags/,
  );
  assert.doesNotMatch(
    render('de-DE', { candidates }),
    /pgn_duplicate_fen_normalized/,
  );
});

test('namespaced import problems remain specific and localized', () => {
  assert.match(
    render('de-DE', {}, false, 'import.name_conflict'),
    /Ein Name ist bereits vergeben/,
  );
  assert.match(
    render('en-GB', {}, false, 'import.provider_resource_exhausted'),
    /resource limits/,
  );
});

test('variants start collapsed with icon-only localized toggles and the main line visible', () => {
  const record = {
    itemId: '1',
    revisionId: '2',
    rootAnchorId: '10',
    steps: [],
    root: {
      playState: { fullmoveNumber: 1 },
      position: { sideToMove: 'white' },
    },
    tree: {
      nodes: [
        {
          nodeIndex: 1,
          parentNodeIndex: null,
          siblingOrder: 1,
          anchorId: '12',
          move: { from: 'g1', to: 'f3', san: 'Nf3' },
          after: {},
        },
        {
          nodeIndex: 0,
          parentNodeIndex: null,
          siblingOrder: 0,
          anchorId: '11',
          move: { from: 'e2', to: 'e4', san: 'e4' },
          after: {},
        },
      ],
    },
  };
  const renderTree = (locale: UiLocale, anchorId: string, disabled: boolean) =>
    renderToStaticMarkup(
      createElement(
        IntlProvider,
        { locale, messages: messages[locale] },
        createElement(ChessTreeMoveList, {
          record,
          anchorId,
          disabled,
          onSelect: () => {},
        }),
      ),
    );
  const de = renderTree('de-DE', '10', false);
  assert.doesNotMatch(de, /<select|Fortsetzung wählen/);
  assert.match(de, /1\. e4/);
  assert.match(de, /aria-label="Variante ausklappen: 1\. Sf3"/);
  assert.ok(
    de.indexOf('data-tree-anchor="11"') < de.indexOf('data-tree-line="12"'),
  );
  assert.doesNotMatch(de, /Quellkommentare|Quellannotationen|NAG|disabled/);
  const en = renderTree('en-GB', '10', true);
  assert.match(en, /aria-label="Expand variation: 1\. Nf3"/);
  assert.match(en, /<button[^>]*disabled/);
  assert.doesNotMatch(
    renderTree('en-GB', '11', false),
    /data-tree-anchor="12"|Branch point|>Variation/,
  );
});

test('a sole remaining variation stays selectable without promoting it to the main line', () => {
  const renderContinuation = (siblingOrder: number, disabled = false) =>
    renderToStaticMarkup(
      createElement(
        IntlProvider,
        { locale: 'en-GB', messages: messages['en-GB'] },
        createElement(ChessTreeMoveList, {
          record: {
            itemId: '1',
            revisionId: '2',
            rootAnchorId: '10',
            steps: [],
            root: {
              playState: { fullmoveNumber: 1 },
              position: { sideToMove: 'white' },
            },
            tree: {
              nodes: [
                {
                  nodeIndex: 0,
                  parentNodeIndex: null,
                  siblingOrder: 0,
                  anchorId: '11',
                  move: { san: 'd4' },
                  after: {
                    playState: { fullmoveNumber: 1 },
                    position: { sideToMove: 'black' },
                  },
                },
                {
                  nodeIndex: 1,
                  parentNodeIndex: 0,
                  siblingOrder,
                  anchorId: '12',
                  move: { san: 'Nf6' },
                },
              ],
            },
          },
          anchorId: '11',
          disabled,
          onSelect: () => {},
        }),
      ),
    );
  const branch = renderContinuation(1);
  assert.doesNotMatch(branch, /<select/);
  assert.match(branch, /aria-label="Expand variation: 1\.\.\. Nf6"/);
  assert.match(branch, /data-tree-line="12"/);
  assert.doesNotMatch(branch, /data-tree-anchor="12"/);
  assert.doesNotMatch(branch, /disabled|Main line/);
  assert.match(renderContinuation(1, true), /<button[^>]*disabled/);
  assert.match(renderContinuation(0), /data-tree-anchor="12"/);
  assert.doesNotMatch(renderContinuation(0), /Variation/);
});

test('inline branches interrupt the owning line and compact pairs preserve every selectable half-move', () => {
  const state = (sideToMove: string, fullmoveNumber: number) => ({
    position: { sideToMove },
    playState: { fullmoveNumber },
  });
  const node = (
    nodeIndex: number,
    parentNodeIndex: number | null,
    siblingOrder: number,
    san: string,
    side: string,
    number: number,
  ) => ({
    nodeIndex,
    parentNodeIndex,
    siblingOrder,
    anchorId: String(nodeIndex),
    move: { san },
    after: state(side, number),
  });
  const markup = renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en-GB', messages: messages['en-GB'] },
      createElement(ChessTreeMoveList, {
        record: {
          itemId: 'record',
          revisionId: 'revision',
          rootAnchorId: 'root',
          steps: [],
          root: state('white', 1),
          tree: {
            nodes: [
              node(0, null, 0, 'e4', 'black', 1),
              node(1, 0, 0, 'e5', 'white', 2),
              node(2, 1, 0, 'Nf3', 'black', 2),
              node(3, 2, 0, 'Nc6', 'white', 3),
              node(4, 0, 1, 'c5', 'white', 2),
              node(5, 4, 0, 'Nf3', 'black', 2),
              node(6, 4, 1, 'Nc3', 'black', 2),
            ],
          },
        },
        anchorId: '6',
        disabled: false,
        onSelect: () => {},
        draft: {
          anchorId: '4',
          content: createElement('li', { 'data-test-draft': true }, 'Draft'),
        },
      }),
    ),
  );
  assert.deepEqual(
    [...markup.matchAll(/data-tree-anchor="([^"]+)"/g)].map(
      (match) => match[1],
    ),
    ['0', '1', '4', '5', '2', '3'],
  );
  assert.equal((markup.match(/data-test-draft/g) ?? []).length, 1);
  assert.ok(
    markup.indexOf('data-test-draft') > markup.indexOf('data-tree-line="6"'),
  );
  assert.ok(
    markup.indexOf('data-test-draft') < markup.indexOf('data-tree-anchor="2"'),
  );
  const pairs = [
    ...markup.matchAll(/<li[^>]*data-tree-move-pair[^>]*>(.*?)<\/li>/g),
  ].map((match) => match[1]!);
  assert.equal(pairs.length, 4);
  assert.equal((pairs[0]!.match(/data-tree-anchor/g) ?? []).length, 2);
  assert.equal((pairs.at(-1)!.match(/data-tree-anchor/g) ?? []).length, 2);
  assert.match(pairs[0]!, /aria-label="1\.\.\. e5"/);
});
