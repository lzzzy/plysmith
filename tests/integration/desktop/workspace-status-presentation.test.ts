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
    notes?: boolean;
    normalizedRevision?: boolean;
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
        messages: { 'inventory.moveCount': '{count} added moves' },
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
            scope: { kind: 'free' },
            currentState: root,
            legalMoves: [],
            allowedActions: ['start_scratch'],
            ...(options.notes
              ? {
                  record: {
                    itemType: 'analysis',
                    itemId: '2',
                    revisionId: '3',
                    currentRevisionId: '3',
                    revisionNumber: 1,
                    historical: false,
                    displayName: 'Opening',
                    rootAnchorId: '4',
                    currentAnchorId: '4',
                    root,
                    steps: [],
                    cursor: 0,
                    origin: { kind: 'initial_position' },
                    contextMember: true,
                    contributions: ['global', 'context'].map((scopeKind) => ({
                      contributionId: scopeKind,
                      contributionVersion: 1,
                      anchorId: '4',
                      scopeKind,
                      body: scopeKind + ' note body',
                      moves: [],
                      languageTag: 'en-GB',
                      createdAt: '2026-10-02T10:00:00Z',
                      updatedAt: '2026-10-02T10:00:00Z',
                    })),
                  },
                }
              : {}),
            ...(options.normalizedRevision
              ? {
                  record: {
                    itemType: 'analysis',
                    itemId: '2',
                    revisionId: '3',
                    currentRevisionId: '3',
                    revisionNumber: 1,
                    historical: false,
                    displayName: 'Opening',
                    rootAnchorId: '4',
                    currentAnchorId: '5',
                    root,
                    origin: { kind: 'initial_position' },
                    contextMember: false,
                    contributions: [],
                    cursor: 1,
                    steps: [
                      {
                        anchorId: '5',
                        before: root,
                        after: root,
                        move: { from: 'e2', to: 'e4', san: 'e4' },
                      },
                    ],
                  },
                  scratch: {
                    scratchId: 'scratch',
                    scratchRevision: 1,
                    root,
                    cursor: 2,
                    origin: {
                      kind: 'inventory_anchor',
                      itemId: '2',
                      revisionId: '3',
                      anchorId: '4',
                    },
                    intent: {
                      kind: 'inventory_revision',
                      mode: 'truncate_after',
                      itemId: '2',
                      baseRevisionId: '3',
                      cutAnchorId: '4',
                      returnAnchorId: '5',
                      displayName: 'Opening',
                    },
                    steps: [
                      {
                        before: root,
                        after: root,
                        move: { from: 'e2', to: 'e4', san: 'e4' },
                      },
                      {
                        before: root,
                        after: root,
                        move: { from: 'e7', to: 'e5', san: 'e5' },
                      },
                    ],
                  },
                }
              : {}),
          },
          ...(options.normalizedRevision
            ? {
                inventoryRevisionPreview: {
                  mode: 'extend',
                  displayName: 'Opening',
                  preservedMoveCount: 1,
                  addedSteps: [
                    {
                      before: root,
                      after: root,
                      move: { from: 'e7', to: 'e5', san: 'e5' },
                    },
                  ],
                  removedSteps: [],
                  historicalGlobalContributionCount: 0,
                  affectedContexts: [],
                  followingContexts: [],
                  noOp: false,
                },
              }
            : {}),
          analysisProviders: { providers: [], dataRevision: 1 },
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
        store: {
          canWorkWithInventoryItem: () => true,
          getPlayoutCompletionForm: () => undefined,
          setPlayoutCompletionForm: () => undefined,
          getPositionAnalysisBudget: () => 'fast',
          getPositionAnalysisHumanSelection: () => [],
          getPositionAnalysisObjectiveProvider: () => undefined,
          getPositionAnalysisSort: () => 'stockfish',
        },
      }),
    ),
  );
}

test('revision UI uses normalized mode, added count and preserved prefix instead of raw scratch intent', () => {
  const markup = render('analysis', { normalizedRevision: true });
  assert.match(markup, /inventory.mode.extend/);
  assert.match(markup, /1 added moves/);
  assert.doesNotMatch(markup, /2 added moves/);
  assert.doesNotMatch(
    markup,
    /inventory.mode.truncate_after|inventory.globalNotesAffected|<del/,
  );
  assert.equal((markup.match(/<ins\b/g) ?? []).length, 1);
  assert.match(markup, /1\.\.\. e5<\/ins>/);
  assert.doesNotMatch(markup, /2\. e5/);
  const moveButtons = (
    markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []
  ).filter(
    (button) => button.includes('data-path-position') && />e4</.test(button),
  );
  assert.equal(
    moveButtons.length,
    1,
    'An unchanged reentered move appears only once in the move list.',
  );
});

test('empty analysis explains only a proven removed assignment at its own action location', () => {
  assert.doesNotMatch(render('analysis'), /analysis.removedFromContext/);
  const markup = render('analysis', { removed: true });
  assert.match(markup, /role="status"/);
  assert.match(markup, /analysis.removedFromContext/);
  assert.match(markup, /activity.manage/);
});

test('note scope remains accessible without interrupting the reading text', () => {
  const markup = render('analysis', { notes: true });
  assert.doesNotMatch(markup, /<time|2026-10-02|analysis.createVariation/);
  for (const [scope, label] of [
    ['global', 'analysis.generalNote'],
    ['context', 'analysis.contextNote'],
  ] as const) {
    const article = markup.match(
      new RegExp(
        `<article[^>]*data-note-scope="${scope}"[^>]*>[\\s\\S]*?</article>`,
      ),
    )?.[0];
    assert.ok(article);
    assert.match(article, new RegExp(`aria-label="${label}"`));
    assert.ok(article.includes(scope + ' note body'));
    assert.ok(!article.replace(/<[^>]*>/g, '').includes(label));
  }
});

test('panel divider describes its orientation, limits and controlled panes only when an engine panel exists', () => {
  assert.doesNotMatch(render('analysis'), /role="separator"/);
  const markup = render('analysis', { notes: true });
  const divider = markup.match(/<div[^>]*role="separator"[^>]*>/)?.[0];
  assert.ok(divider);
  assert.match(divider, /aria-orientation="horizontal"/);
  assert.match(divider, /tabindex="0"/);
  assert.match(divider, /aria-valuenow="55"/);
  assert.match(divider, /aria-controls="[^"]+-moves [^"]+-engine"/);
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
