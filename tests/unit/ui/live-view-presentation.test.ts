import assert from 'node:assert/strict';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { messages } from '../../../app/infrastructure/channels/ui/renderer/messages.ts';

let LiveView: ComponentType<{ state: unknown; store: unknown }>;

before(async () => {
  const bundle = await build({
    stdin: {
      contents: "export { LiveView } from './live-view.tsx';",
      resolveDir: fileURLToPath(
        new URL(
          '../../../app/infrastructure/channels/ui/renderer',
          import.meta.url,
        ),
      ),
    },
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
          builder.onResolve({ filter: /^[^./]/ }, (args) =>
            path.isAbsolute(args.path)
              ? undefined
              : { path: import.meta.resolve(args.path), external: true },
          );
        },
      },
    ],
  });
  assert.ok(bundle.outputFiles[0]);
  ({ LiveView } = (await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
  )) as { LiveView: ComponentType<{ state: unknown; store: unknown }> });
});

test('live assistance stays hidden while the latest fair-play state is unverified', () => {
  const chess = new ChessJsRulesAdapter().initialState();
  const store = {
    getPositionAnalysisObjectiveProvider: () => undefined,
    getPositionAnalysisBudget: () => 'fast',
    getPositionAnalysisHumanSelection: () => [],
    getPositionAnalysisSort: () => 'stockfish',
  };
  const state = {
    scope: { kind: 'free' },
    status: { persistence: { dataRevision: 0 } },
    preferences: { uiLocale: 'en-GB' },
    analysisProviders: { providers: [] },
    live: {
      configured: true,
      online: true,
      connection: 'connected',
      fairPlayBlocked: false,
      games: [],
      session: {
        gameId: 'abcdefgh',
        role: 'observe',
        white: { name: 'White' },
        black: { name: 'Black' },
        root: chess,
        current: chess,
        steps: [],
        selectedPly: 0,
        legalMoves: [],
        status: 'ongoing',
        connected: true,
        analysisRevision: 1,
        focus: { focusKey: 'initial', root: chess, current: chess, moves: [] },
      },
    },
  };
  const render = (fairPlayBlocked: boolean) =>
    renderToStaticMarkup(
      createElement(
        IntlProvider,
        { locale: 'en-GB', messages: {}, onError: () => undefined },
        createElement(LiveView, {
          state: { ...state, fairPlayBlocked },
          store,
        }),
      ),
    );
  assert.match(render(false), /id="engine-analysis-title"/);
  assert.doesNotMatch(render(true), /id="engine-analysis-title"/);
});

for (const locale of ['de-DE', 'en-GB'] as const) {
  for (const empty of [true, false]) {
    test(`live ${empty ? 'zero-move aborted' : 'nonempty ended'} move list is a named keyboard region in ${locale}`, () => {
      const chess = new ChessJsRulesAdapter().initialState();
      const markup = renderToStaticMarkup(
        createElement(
          IntlProvider,
          { locale, messages: messages[locale] },
          createElement(LiveView, {
            state: {
              scope: { kind: 'free' },
              status: { persistence: { dataRevision: 0 } },
              preferences: { uiLocale: locale },
              inventoryOrganization: { folders: [], linkedFolderIds: [] },
              inventory: { items: [] },
              analysisProviders: { providers: [] },
              fairPlayBlocked: false,
              live: {
                configured: true,
                online: true,
                connection: 'connected',
                fairPlayBlocked: false,
                games: [],
                session: {
                  gameId: 'abcdefgh',
                  role: 'play',
                  playerSide: 'white',
                  white: { name: 'White' },
                  black: { name: 'Black' },
                  root: chess,
                  current: chess,
                  steps: empty
                    ? []
                    : [
                        {
                          move: { san: 'e4', from: 'e2', to: 'e4' },
                          after: chess,
                        },
                      ],
                  selectedPly: empty ? 0 : 1,
                  legalMoves: [],
                  status: 'ended',
                  connected: false,
                  pendingMove: false,
                  outcome: empty ? 'unfinished' : 'draw',
                },
              },
            },
            store: {},
          }),
        ),
      );
      const label = messages[locale]['playout.moves'];
      const lists = [
        ...markup.matchAll(
          new RegExp(`<div\\b[^>]*aria-label="${label}"[^>]*>`, 'g'),
        ),
      ];
      assert.equal(lists.length, 1);
      assert.match(lists[0]![0], /\brole="region"/);
      assert.match(lists[0]![0], /\btabindex="0"/);
      if (empty) assert.ok(markup.includes(`${lists[0]![0]}</div>`));
      else assert.match(markup, /aria-current="step"[^>]*>e4<\/button>/);
    });
  }
}
