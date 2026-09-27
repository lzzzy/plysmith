import assert from 'node:assert/strict';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import type { SearchInventoryResultDto } from '../../../app/infrastructure/channels/host_client/index.ts';

let ManageView: ComponentType<{ state: unknown; store: unknown }>;

before(async () => {
  const result = await build({
    entryPoints: [
      fileURLToPath(
        new URL(
          '../../../app/infrastructure/channels/ui/renderer/manage-view.tsx',
          import.meta.url,
        ),
      ),
    ],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    footer: { js: '//# sourceURL=manage-view-presentation.mjs' },
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
  ({ ManageView } = await import(
    `data:text/javascript;base64,${Buffer.from(output.text).toString('base64')}`
  ));
});

function item(
  itemId: string,
  contextIds: readonly string[] = [],
): SearchInventoryResultDto['items'][number] {
  return {
    lifecycle: 'active',
    itemId,
    currentRevisionId: `revision-${itemId}`,
    rootAnchorId: `anchor-${itemId}`,
    itemType: 'analysis',
    originKind: 'manual',
    displayName: `Record ${itemId}`,
    languageTag: 'de-DE',
    contextIds,
    createdAt: '2026-09-27T10:00:00Z',
    updatedAt: '2026-09-27T10:00:00Z',
  };
}

function render(
  options: {
    selected?: boolean;
    member?: boolean;
    free?: boolean;
    ancestorMember?: boolean;
    query?: string;
    inventory?: Pick<
      SearchInventoryResultDto,
      'items' | 'ancestors' | 'provenanceEdges'
    >;
  } = {},
) {
  const context = {
    contextId: 'context',
    displayName: 'Preparation',
    purpose: 'Existing description',
    contextVersion: 7,
    referenceCount: 1,
    pendingRevisionImpactCount: 0,
  };
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      {
        locale: 'en-GB',
        messages: {},
        onError: () => undefined,
      },
      createElement(ManageView, {
        state: {
          phase: 'ready',
          scope: options.free
            ? { kind: 'free' }
            : { kind: 'context', contextId: 'context' },
          contexts: { contexts: [context] },
          contextWorkspace: {
            context,
            references: [],
            pendingRevisionImpacts: [],
          },
          inventory: options.inventory ?? {
            items: [item('child', options.member ? ['context'] : [])],
            ancestors: [
              item('parent', options.ancestorMember ? ['context'] : []),
            ],
            provenanceEdges: [
              {
                itemId: 'child',
                sourceItemId: 'parent',
                sourceRevisionId: 'historical-revision',
                sourceAnchorId: 'historical-anchor',
              },
            ],
          },
          inventoryQuery: options.query ?? '',
          inventoryContextOnly: true,
          selectedInventoryItemId: options.selected ? 'child' : undefined,
          analysis: {},
          refreshing: false,
        },
        store: {},
      }),
    ),
  );
}

function buttons(markup: string): readonly string[] {
  return markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

test('empty inventory, context and search are distinct with relevant actions', () => {
  const empty = { items: [], ancestors: [], provenanceEdges: [] };
  const base = render({ free: true, inventory: empty });
  assert.match(base, /manage.empty.inventory/);
  assert.doesNotMatch(base, /manage.clearSearch|manage.showAllInventory/);
  const context = render({ inventory: empty });
  assert.match(context, /manage.empty.context/);
  assert.match(context, /manage.showAllInventory/);
  const search = render({ inventory: empty, query: 'missing' });
  assert.match(search, /manage.empty.search/);
  assert.match(search, /manage.clearSearch/);
  assert.doesNotMatch(search, /manage.showAllInventory|manage.empty.context/);
});

test('inventory scope is the single page heading without a redundant activity title', () => {
  const markup = render();
  assert.match(markup, /<h1 id="inventory-title">Preparation<\/h1>/);
  assert.equal((markup.match(/<h1\b/g) ?? []).length, 1);
});

test('context inspector immediately exposes name and description with save and cancel', () => {
  const markup = render();
  assert.match(markup, /id="context-edit-name"[^>]*value="Preparation"/);
  assert.match(
    markup,
    /<textarea[^>]*id="context-edit-purpose"[^>]*>Existing description<\/textarea>/,
  );
  assert.ok(
    buttons(markup).some(
      (button) =>
        button.includes('manage.saveContext') && button.includes('disabled'),
    ),
  );
  assert.ok(buttons(markup).some((button) => button.includes('action.cancel')));
  assert.doesNotMatch(
    markup,
    /manage\.(eyebrow|title|selection|workScope|contextBoundary|nextStep)/,
  );
});

test('named-context nonmembers retain global rename but cannot start analysis', () => {
  const markup = render({ selected: true });
  assert.ok(
    buttons(markup).some((button) => button.includes('inventory.rename')),
  );
  assert.ok(
    buttons(markup).some((button) => button.includes('manage.useInContext')),
  );
  assert.ok(
    buttons(markup).every((button) => !button.includes('activity.analyze')),
  );
  assert.doesNotMatch(markup, /manage\.(revision|language)/);
});

test('context members and base inventory items retain the analysis action', () => {
  for (const options of [
    { selected: true, member: true },
    { selected: true, free: true },
  ]) {
    assert.ok(
      buttons(render(options)).some((button) =>
        button.includes('activity.analyze'),
      ),
    );
  }
});

test('source-only ancestors have no selection button even when context members', () => {
  for (const ancestorMember of [false, true]) {
    const markup = render({ ancestorMember });
    assert.match(markup, /Record parent/);
    assert.ok(
      buttons(markup).every(
        (button) => !button.includes('<strong>Record parent</strong>'),
      ),
    );
    assert.ok(
      buttons(markup).some((button) =>
        button.includes('<strong>Record child</strong>'),
      ),
    );
    assert.match(markup, /aria-expanded="true"/);
    assert.match(markup, /manage.sourceContext/);
  }
});

test('deep ancestry retains every visible level inside a keyboard-focusable scroll region', () => {
  const ancestors = Array.from({ length: 9 }, (_, depth) =>
    item(`level-${depth}`),
  );
  const markup = render({
    inventory: {
      items: [item('level-9')],
      ancestors,
      provenanceEdges: Array.from({ length: 9 }, (_, depth) => ({
        itemId: `level-${depth + 1}`,
        sourceItemId: `level-${depth}`,
        sourceRevisionId: `revision-level-${depth}`,
        sourceAnchorId: `anchor-level-${depth}`,
      })),
    },
  });
  const offsets = [...markup.matchAll(/margin-inline-start:(\d+)(?:px)?/g)].map(
    (match) => Number(match[1]),
  );
  assert.deepEqual(offsets, [0, 14, 28, 42, 56, 70, 84, 98, 112, 126]);
  const scrollRegion = markup.match(/<div\b[^>]*role="region"[^>]*>/)?.[0];
  assert.ok(scrollRegion);
  assert.match(scrollRegion, /tabindex="0"/i);
  assert.match(scrollRegion, /aria-labelledby="inventory-title"/);
  assert.equal((markup.match(/aria-expanded="true"/g) ?? []).length, 9);
  assert.equal(
    buttons(markup).filter((button) => /<strong>Record level-/.test(button))
      .length,
    1,
  );
});
