import assert from 'node:assert/strict';
import path from 'node:path';
import test, { before } from 'node:test';
import { build } from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';

let AnalysisView: ComponentType<{ state: unknown; store: unknown }>;
let PlayoutView: ComponentType<{ state: unknown; store: unknown }>;

before(async () => {
  for (const name of ['analysis', 'playout'] as const) {
    const result = await build({
      entryPoints: [
        path.resolve(
          `app/infrastructure/channels/ui/renderer/${name}-view.tsx`,
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
    const component = await import(
      `data:text/javascript;base64,${Buffer.from(output.text).toString('base64')}`
    );
    if (name === 'analysis') AnalysisView = component.AnalysisView;
    else PlayoutView = component.PlayoutView;
  }
});

const root = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  position: {
    sideToMove: 'white',
    castlingRights: {
      whiteKingSide: true,
      whiteQueenSide: true,
      blackKingSide: true,
      blackQueenSide: true,
    },
  },
  playState: { fullmoveNumber: 1, halfmoveClock: 0 },
};

function render(
  view: 'analysis' | 'playout',
  options: {
    removed?: boolean;
    status?: 'stopped' | 'paused' | 'terminal';
    busy?: boolean;
    saved?: boolean;
    winner?: 'white' | 'black';
    drawReason?:
      | 'stalemate'
      | 'insufficient_material'
      | 'threefold_repetition'
      | 'seventy_five_move';
  } = {},
) {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      {
        locale: 'en-GB',
        messages: {},
        onError: () => undefined,
      },
      createElement(view === 'analysis' ? AnalysisView : PlayoutView, {
        state: {
          phase: 'ready',
          scope: { kind: 'context', contextId: '1' },
          preferences: { uiLocale: 'en-GB' },
          refreshing: false,
          inventory: {
            items: [],
            ancestors: [],
            provenanceEdges: [],
            dataRevision: 1,
          },
          inventoryOrganization: {
            folders: [],
            linkedFolderIds: [],
            dataRevision: 1,
          },
          ...(options.busy ? { busyCommand: 'cancel_playout_completion' } : {}),
          analysis: {
            currentState: root,
            legalMoves: [],
            allowedActions: ['start_scratch'],
          },
          ...(options.removed
            ? {
                analysisUnavailable: {
                  reason: 'removed_from_context',
                  itemId: '2',
                  displayName: 'Italian preparation',
                },
              }
            : {}),
          playout: {
            dataRevision: 1,
            legalMoves: [],
            draft: {
              draftId: '3',
              draftRevision: 1,
              origin: { kind: 'initial_position' },
              root,
              steps: [],
              playerSide: 'white',
              policy: { providerDisplayName: 'Engine' },
              status:
                options.status === 'terminal'
                  ? {
                      kind: 'terminal',
                      reason: 'checkmate',
                      outcome:
                        options.drawReason === undefined
                          ? { kind: 'win', winner: options.winner ?? 'white' }
                          : { kind: 'draw', reason: options.drawReason },
                    }
                  : options.status === 'paused'
                    ? { kind: 'paused' }
                    : { kind: 'stopped', outcome: { kind: 'unfinished' } },
            },
          },
          ...(options.saved
            ? {
                completedPlayout: {
                  itemId: '9',
                  displayName: 'Saved practice',
                  outcome:
                    options.status === 'terminal'
                      ? options.drawReason === undefined
                        ? { kind: 'win', winner: options.winner ?? 'white' }
                        : { kind: 'draw', reason: options.drawReason }
                      : { kind: 'unfinished' },
                  outcomeSource:
                    options.status === 'terminal' ? 'automatic' : 'manual',
                },
                completedPlayoutView: {
                  dataRevision: 1,
                  legalMoves: [],
                  draft: {
                    draftId: '3',
                    draftRevision: 1,
                    origin: { kind: 'initial_position' },
                    root,
                    steps: [],
                    playerSide: 'black',
                    policy: { providerDisplayName: 'Maia 1500' },
                    status:
                      options.status === 'terminal'
                        ? {
                            kind: 'terminal',
                            outcome:
                              options.drawReason === undefined
                                ? {
                                    kind: 'win',
                                    winner: options.winner ?? 'white',
                                  }
                                : { kind: 'draw', reason: options.drawReason },
                          }
                        : { kind: 'stopped', outcome: { kind: 'unfinished' } },
                  },
                },
              }
            : {}),
        },
        store: { canWorkWithInventoryItem: () => true },
      }),
    ),
  );
}

test('empty analysis explains only a proven removed assignment at its own action location', () => {
  assert.doesNotMatch(render('analysis'), /analysis.removedFromContext/);
  const markup = render('analysis', { removed: true });
  assert.match(markup, /role="status"/);
  assert.match(markup, /analysis.removedFromContext/);
  assert.match(markup, /activity.manage/);
});

test('manual completion has a return action, terminal completion never does', () => {
  const manual = render('playout');
  assert.match(manual, /playout.cancelCompletion/);
  assert.doesNotMatch(manual, /playout.reviewDetail/);
  assert.doesNotMatch(
    render('playout', { status: 'terminal' }),
    /playout.cancelCompletion/,
  );
  const paused = render('playout', { status: 'paused' });
  assert.match(paused, /playout.resume/);
  assert.doesNotMatch(paused, /playout.cancelCompletion/);
});

test('busy completion cannot return to play or save twice', () => {
  const buttons =
    render('playout', { busy: true }).match(
      /<button\b[^>]*>[\s\S]*?<\/button>/g,
    ) ?? [];
  for (const label of ['playout.cancelCompletion', 'playout.save']) {
    const button = buttons.find((entry) => entry.includes(label));
    assert.ok(button);
    assert.match(button, /disabled/);
  }
});

test('saved game shows its name, opponent, side and unfinished result with one save status', () => {
  const markup = render('playout', { saved: true });
  assert.match(markup, /Saved practice/);
  assert.match(markup, /Maia 1500/);
  assert.match(markup, /inventory.content.playerSide/);
  assert.match(markup, /Black/);
  assert.match(markup, /inventory.content.outcome/);
  assert.match(markup, /playout.result.unfinished/);
  assert.equal(markup.match(/playout.saved/g)?.length, 1);
  assert.doesNotMatch(markup, /playout.savedDetail|playout.cancelCompletion/);
});

test('saved terminal game retains its actual result rather than claiming it was unfinished', () => {
  for (const winner of ['white', 'black'] as const) {
    const markup = render('playout', {
      saved: true,
      status: 'terminal',
      winner,
    });
    assert.match(markup, /playout.result.win/);
    assert.doesNotMatch(markup, /playout.result.unfinished/);
  }
  for (const drawReason of [
    'stalemate',
    'insufficient_material',
    'threefold_repetition',
    'seventy_five_move',
  ] as const) {
    assert.match(
      render('playout', { saved: true, status: 'terminal', drawReason }),
      new RegExp(`playout.result.draw.${drawReason}`),
    );
  }
});
