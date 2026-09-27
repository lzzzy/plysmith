import assert from 'node:assert/strict';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';

let AnalysisSetupDialog: ComponentType<{
  isOpen: boolean;
  requestedStart: 'initial' | 'setup';
  hasScratch: boolean;
  isBusy: boolean;
  store: unknown;
  onOpenChange: (open: boolean) => void;
}>;

before(async () => {
  const result = await build({
    entryPoints: [
      fileURLToPath(
        new URL(
          '../../../app/infrastructure/channels/ui/renderer/analysis-setup-dialog.tsx',
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
        name: 'server-visible-modal-content',
        setup(builder) {
          // Portals are absent during SSR. Keep real dialog, board and button
          // rendering; this adapter tests presentation, not browser events.
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
              export function ModalOverlay(props) {
                return props.isOpen ? createElement('div', {
                  'data-dismissable': props.isDismissable,
                  'data-keyboard-dismiss-disabled': props.isKeyboardDismissDisabled
                }, props.children) : null;
              }
              export function Modal({ children }) { return children; }
            `,
              loader: 'js',
            }),
          );
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
  ({ AnalysisSetupDialog } = await import(
    `data:text/javascript;base64,${Buffer.from(output.text).toString('base64')}`
  ));
});

function render(
  requestedStart: 'initial' | 'setup',
  { hasScratch = false, isBusy = false, isOpen = true } = {},
) {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      { locale: 'en-GB', messages: {}, onError: () => undefined },
      createElement(AnalysisSetupDialog, {
        isOpen,
        requestedStart,
        hasScratch,
        isBusy,
        store: {},
        onOpenChange: () =>
          assert.fail('rendering must not dismiss the dialog'),
      }),
    ),
  );
}

function assertNoInterstitial(markup: string) {
  assert.doesNotMatch(
    markup,
    /analysisSetup\.(eyebrow|intro|fromInitial|fromInitialDetail|buildPositionDetail)/,
  );
}

test('setup opens the builder directly with its title, board and position rights', () => {
  const markup = render('setup');
  assert.match(
    markup,
    /<h2 id="new-analysis-title">analysisSetup.buildPosition<\/h2>/,
  );
  assert.match(
    markup,
    /<section\b[^>]*aria-labelledby="new-analysis-title"[^>]*role="dialog"/,
  );
  assert.match(markup, /aria-label="analysisSetup.board"/);
  assert.match(markup, /analysisSetup.sideToMove/);
  assert.match(markup, /analysisSetup.enPassant/);
  assert.equal((markup.match(/type="checkbox"/g) ?? []).length, 4);
  assert.match(markup, /analysisSetup.importFen/);
  assert.match(markup, /analysisSetup.halfmove/);
  assert.match(markup, /analysisSetup.fullmove/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /analysisSetup.start/);
  assert.doesNotMatch(markup, /analysisSetup.existingDraft/);
  assertNoInterstitial(markup);
});

for (const requestedStart of ['initial', 'setup'] as const) {
  test(`${requestedStart} protects an existing scratch before offering any new start`, () => {
    const markup = render(requestedStart, { hasScratch: true });
    const title =
      requestedStart === 'setup'
        ? 'analysisSetup.buildPosition'
        : 'manage.newAnalysis';
    assert.ok(markup.includes(`<h2 id="new-analysis-title">${title}</h2>`));
    assert.match(markup, /analysisSetup.existingDraftDetail/);
    assert.match(markup, /analysisSetup.continueDraft/);
    assert.match(markup, /analysisSetup.discardDraft/);
    assert.match(markup, /aria-label="action.cancel"/);
    assert.doesNotMatch(
      markup,
      /analysisSetup.board|analysisSetup.start|action.retry/,
    );
    assertNoInterstitial(markup);
  });

  test(`${requestedStart} disables every decision action and dismissal while busy`, () => {
    const markup = render(requestedStart, { hasScratch: true, isBusy: true });
    const buttons = markup.match(/<button\b[^>]*>/g) ?? [];
    assert.equal(buttons.length, 3);
    assert.ok(buttons.every((button) => button.includes('disabled')));
    assert.match(markup, /data-dismissable="false"/);
    assert.match(markup, /data-keyboard-dismiss-disabled="true"/);
  });
}

test('initial start without a remaining scratch exposes retry and cancel, never choices', () => {
  const markup = render('initial');
  assert.doesNotMatch(markup, /role="alert"|analysisSetup.startFailed/);
  assert.match(markup, /<h2 id="new-analysis-title">manage.newAnalysis<\/h2>/);
  assert.match(markup, /action.retry/);
  assert.match(markup, /action.cancel/);
  assert.doesNotMatch(markup, /analysisSetup.board|analysisSetup.discardDraft/);
  assertNoInterstitial(markup);
});

test('busy setup disables editing and starting while preserving board accessibility', () => {
  const markup = render('setup', { isBusy: true });
  const controls = (
    markup.match(/<(?:button|input|select)\b[^>]*>/g) ?? []
  ).filter((control) => !control.includes('role="gridcell"'));
  assert.ok(controls.length > 10);
  assert.ok(controls.every((control) => control.includes('disabled')));
  assert.match(markup, /aria-readonly="true"/);
  assert.match(markup, /data-keyboard-dismiss-disabled="true"/);
});

test('a closed dialog renders no setup or scratch actions', () => {
  assert.equal(render('setup', { isOpen: false }), '');
  assert.equal(render('initial', { hasScratch: true, isOpen: false }), '');
});
