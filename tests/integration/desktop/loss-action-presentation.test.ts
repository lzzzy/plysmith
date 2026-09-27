import assert from 'node:assert/strict';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import type {
  ContextRemovalPreviewDto,
  PendingRevisionImpactDto,
} from '../../../app/infrastructure/channels/host_client/index.ts';

type Summary = PendingRevisionImpactDto['useTargetLoss'];
let LossSummary: ComponentType<{ summary: Summary }>;
let contextRemovalSummary: (preview: ContextRemovalPreviewDto) => Summary;
let ManageView: ComponentType<{ state: unknown; store: unknown }>;
let RevisionImpactResolutionPanel: ComponentType<{
  details: unknown;
  store: unknown;
  isBusy: boolean;
}>;

before(async () => {
  const result = await build({
    stdin: {
      contents: `export { LossSummary, contextRemovalSummary } from './loss-summary.tsx';
export { ManageView } from './manage-view.tsx';
export { RevisionImpactResolutionPanel } from './revision-impact-view.tsx';`,
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
  assert.ok(result.outputFiles[0]);
  ({
    LossSummary,
    contextRemovalSummary,
    ManageView,
    RevisionImpactResolutionPanel,
  } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  ));
});

const counts: Summary = {
  referenceCount: 2,
  activeNoteCount: 3,
  noteMoveCount: 17,
  scratchCount: 1,
  scratchMoveCount: 8,
  scratchNoteCount: 1,
  managementResumeAffected: true,
  analysisResumeAffected: false,
};

function render(component: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      {
        locale: 'en-GB',
        messages: {},
        onError: () => undefined,
      },
      component,
    ),
  );
}

test('loss counters keep notes, note moves, scratch, scratch note and both resumes distinct', () => {
  const markup = render(createElement(LossSummary, { summary: counts }));
  const rows = [...markup.matchAll(/<dt>([^<]+)<\/dt><dd>([^<]+)<\/dd>/g)].map(
    (row) => [row[1], row[2]],
  );
  assert.deepEqual(rows, [
    ['loss.references', '2'],
    ['loss.notes', '3'],
    ['loss.noteMoves', '17'],
    ['loss.scratch', '1'],
    ['loss.scratchMoves', '8'],
    ['loss.scratchNotes', '1'],
    ['loss.managementResume', '1'],
  ]);
});

test('empty loss summary explains no affected work without listing zero counters', () => {
  const markup = render(
    createElement(LossSummary, {
      summary: {
        referenceCount: 0,
        activeNoteCount: 0,
        noteMoveCount: 0,
        scratchCount: 0,
        scratchMoveCount: 0,
        scratchNoteCount: 0,
        managementResumeAffected: false,
        analysisResumeAffected: false,
      },
    }),
  );
  assert.match(markup, /loss.none/);
  assert.doesNotMatch(markup, /<dl|<dd>/);
});

test('context loss projection counts a root-only draft without inventing note content', () => {
  const preview: ContextRemovalPreviewDto = {
    contextId: 'context',
    contextName: 'Preparation',
    contextVersion: 4,
    dataRevision: 7,
    items: [{ itemId: 'child', displayName: 'Child' }],
    referenceCount: 2,
    losses: {
      notes: [
        { contributionId: 'note-one', body: 'One', moveCount: 5 },
        { contributionId: 'note-two', body: 'Two', moveCount: 9 },
      ],
      scratch: {
        scratchId: 'scratch',
        scratchRevision: 1,
        stepCount: 0,
        noteBody: '  ',
        intent: 'exploration',
      },
    },
  };
  assert.deepEqual(contextRemovalSummary(preview), {
    referenceCount: 2,
    activeNoteCount: 2,
    noteMoveCount: 14,
    scratchCount: 1,
    scratchMoveCount: 0,
    scratchNoteCount: 0,
    managementResumeAffected: false,
    analysisResumeAffected: false,
  });
  assert.equal(
    contextRemovalSummary({ ...preview, losses: { notes: [] } }).scratchCount,
    0,
  );
  assert.equal(
    contextRemovalSummary({
      ...preview,
      losses: {
        ...preview.losses,
        scratch: { ...preview.losses.scratch!, noteBody: 'Draft note' },
      },
    }).scratchNoteCount,
    1,
  );
});

function inventoryItem(itemId: string, lifecycle = 'active') {
  return {
    itemId,
    lifecycle,
    currentRevisionId: `revision-${itemId}`,
    rootAnchorId: `anchor-${itemId}`,
    itemType: 'analysis',
    originKind: 'manual',
    displayName: itemId,
    languageTag: 'en-GB',
    contextIds: ['context'],
    createdAt: '2026-09-27T10:00:00Z',
    updatedAt: '2026-09-27T10:00:00Z',
  };
}

function managementState(selected = false, deletedSource = false) {
  const context = {
    contextId: 'context',
    displayName: 'Preparation',
    purpose: 'Description',
    contextVersion: 4,
    referenceCount: 1,
    pendingRevisionImpactCount: 0,
  };
  return {
    phase: 'ready',
    scope: { kind: 'context', contextId: 'context' },
    contexts: { contexts: [context] },
    contextWorkspace: { context, references: [], pendingRevisionImpacts: [] },
    inventory: {
      items: [inventoryItem('child')],
      ancestors: deletedSource ? [inventoryItem('parent', 'trashed')] : [],
      provenanceEdges: deletedSource
        ? [
            {
              itemId: 'child',
              sourceItemId: 'parent',
              sourceRevisionId: 'historical',
              sourceAnchorId: 'historical',
            },
          ]
        : [],
    },
    inventoryQuery: '',
    inventoryContextOnly: true,
    selectedInventoryItemId: selected ? 'child' : undefined,
    analysis: {},
    refreshing: false,
  };
}

test('context deletion is outside the description form and does not submit metadata', () => {
  const markup = render(
    createElement(ManageView, { state: managementState(), store: {} }),
  );
  const forms = markup.match(/<form\b[^>]*>[\s\S]*?<\/form>/g) ?? [];
  assert.ok(forms.some((form) => form.includes('context-edit-purpose')));
  assert.ok(forms.every((form) => !form.includes('manage.deleteContext')));
  assert.match(
    markup,
    /<button[^>]*type="button"[^>]*>[\s\S]*?manage.deleteContext/,
  );
});

test('selected context member offers separate context removal and inventory deletion', () => {
  const markup = render(
    createElement(ManageView, { state: managementState(true), store: {} }),
  );
  assert.match(markup, /manage.removeFromContext/);
  assert.match(markup, /manage.deleteInventoryItem/);
  assert.doesNotMatch(markup, /manage.removeFromContextDetail/);
});

test('deleted source remains a labelled historical node with no selection action', () => {
  const markup = render(
    createElement(ManageView, {
      state: managementState(false, true),
      store: {},
    }),
  );
  assert.match(markup, /<strong>parent<\/strong>/);
  assert.match(markup, /manage.deletedSource/);
  const buttons = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  assert.ok(
    buttons.every((button) => !button.includes('<strong>parent</strong>')),
  );
  assert.ok(
    buttons.some((button) => button.includes('<strong>child</strong>')),
  );
});

test('revision options distinguish affected target work from all removed or retained work', () => {
  const revision = {
    displayName: 'Analysis',
    revisionNumber: 1,
    root: {
      position: { sideToMove: 'white' },
      playState: { fullmoveNumber: 1 },
    },
    steps: [],
  };
  const markup = render(
    createElement(RevisionImpactResolutionPanel, {
      details: {
        impact: {
          impactId: 'impact',
          impactVersion: 3,
          useTargetLoss: counts,
          removeFromContextLoss: {
            ...counts,
            activeNoteCount: 13,
            noteMoveCount: 47,
          },
        },
        pinnedRevision: revision,
        targetRevision: { ...revision, revisionNumber: 2 },
      },
      store: {},
      isBusy: false,
    }),
  );
  assert.equal(
    (markup.match(/<dt>loss.notes<\/dt><dd>3<\/dd>/g) ?? []).length,
    1,
  );
  assert.equal(
    (markup.match(/<dt>loss.notes<\/dt><dd>13<\/dd>/g) ?? []).length,
    2,
  );
  assert.match(markup, /revisionImpact.keepCopyConsequences/);
  assert.doesNotMatch(markup, /revisionImpact.confirmDetail/);
});
