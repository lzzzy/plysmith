import assert from 'node:assert/strict';
import path from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IntlProvider } from 'react-intl';
import type { SearchInventoryResultDto } from '../../../app/infrastructure/channels/host_client/index.ts';
import { messages } from '../../../app/infrastructure/channels/ui/renderer/messages.ts';

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
    fairPlayBlocked?: boolean;
    member?: boolean;
    free?: boolean;
    ancestorMember?: boolean;
    query?: string;
    itemCount?: number;
    folders?: boolean;
    linkedFolders?: boolean;
    contextOnly?: boolean;
    folderContextItemCount?: number;
    inspectedFolderId?: string | null;
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
    referenceCount: 0,
    itemCount: options.itemCount ?? 1,
    pendingRevisionImpactCount: 0,
  };
  return renderToStaticMarkup(
    createElement(
      IntlProvider,
      {
        locale: 'en-GB',
        messages: options.itemCount === undefined ? {} : messages['en-GB'],
        onError: () => undefined,
      },
      createElement(ManageView, {
        state: {
          phase: 'ready',
          fairPlayBlocked: options.fairPlayBlocked ?? false,
          scope: options.free
            ? { kind: 'free' }
            : { kind: 'context', contextId: 'context' },
          contexts: { contexts: [context] },
          contextWorkspace: {
            context,
            members: [],
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
          inventoryOrganization: {
            folders: options.folders
              ? [
                  {
                    folderId: 'folder',
                    displayName: 'Openings',
                    itemCount: 1,
                    contextItemCount: options.folderContextItemCount ?? 0,
                    contextLinkCount: 0,
                  },
                ]
              : [],
            linkedFolderIds: options.linkedFolders ? ['folder'] : [],
            dataRevision: 0,
          },
          inventoryPresentation: options.folders ? 'folders' : 'origins',
          inspectedInventoryFolderId: options.inspectedFolderId,
          inventoryContextOnly: options.contextOnly ?? true,
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

test('context sidebar and inspector count canonical items without anchor references', () => {
  const markup = render({ itemCount: 3 });
  assert.equal((markup.match(/3 items/g) ?? []).length, 2);
  assert.doesNotMatch(markup, /No references|No items/);
});

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

test('context inspector is read-only and editing is exposed on the active context row', () => {
  const markup = render();
  assert.match(markup, /Existing description/);
  assert.doesNotMatch(markup, /context-edit-name|context-edit-purpose/);
  assert.ok(
    buttons(markup).some((button) => button.includes('manage.editContext')),
  );
  assert.doesNotMatch(
    markup,
    /manage\.(eyebrow|title|selection|workScope|contextBoundary|nextStep)/,
  );
});

test('folder inspection replaces the item preview and never exposes global actions on the right', () => {
  const markup = render({
    selected: true,
    free: true,
    folders: true,
    inspectedFolderId: 'folder',
    itemCount: 1,
  });
  const inspector = markup.match(
    /<aside\b[^>]*aria-labelledby="inspector-title"[^>]*>([\s\S]*?)<\/aside>/,
  )?.[1];
  assert.ok(inspector);
  assert.match(inspector, /Openings|Path/);
  assert.doesNotMatch(inspector, /Record child|<button|<input|<textarea/);
  assert.match(markup, /aria-pressed="true"[^>]*>[\s\S]*?Openings/);
});

test('item row retains rename and deletion but no move command or inspector management buttons', () => {
  const markup = render({ selected: true, free: true, itemCount: 1 });
  const inspector = markup.match(
    /<aside\b[^>]*aria-labelledby="inspector-title"[^>]*>([\s\S]*?)<\/aside>/,
  )?.[1];
  assert.ok(inspector);
  assert.doesNotMatch(
    inspector,
    /Rename|Delete from inventory|Move|<input|<textarea/,
  );
  for (const label of ['Rename', 'Delete from inventory'])
    assert.ok(buttons(markup).some((button) => button.includes(label)));
  assert.doesNotMatch(markup, /aria-label="Move"|lucide-folder-input/);
  assert.ok(
    markup.indexOf('<strong>Record child</strong>') <
      markup.indexOf('aria-label="Rename"'),
  );
});

test('folder and item context removal use minus while inventory deletion alone uses trash', () => {
  const markup = render({ member: true, folders: true, linkedFolders: true });
  const removalButtons = buttons(markup).filter((button) =>
    /folders.removeContext|manage.removeFromContext/.test(button),
  );
  assert.equal(removalButtons.length, 2);
  for (const button of removalButtons) {
    assert.match(button, /lucide-minus/);
    assert.doesNotMatch(button, /lucide-trash/);
  }
  const deleteButton = buttons(markup).find((button) =>
    button.includes('manage.deleteInventoryItem'),
  );
  assert.ok(deleteButton);
  assert.match(deleteButton, /lucide-trash/);
});

test('global folder and item rows expose no move action', () => {
  const markup = render({ free: true, folders: true });
  assert.doesNotMatch(markup, /folders.move|lucide-folder-input/);
  assert.match(markup, /draggable="true"/);
});

test('all-inventory folder actions reflect context links and member locations, not the view', () => {
  for (const [linkedFolders, folderContextItemCount, action] of [
    [true, 0, 'folders.removeContext'],
    [false, 1, 'folders.removeContext'],
    [false, 0, 'folders.include'],
  ] as const) {
    const markup = render({
      folders: true,
      contextOnly: false,
      linkedFolders,
      folderContextItemCount,
    });
    const folderActions = buttons(markup).filter((button) =>
      /folders.removeContext|folders.include/.test(button),
    );
    assert.equal(folderActions.length, 1);
    assert.match(folderActions[0]!, new RegExp(action));
    assert.match(
      folderActions[0]!,
      action === 'folders.removeContext' ? /lucide-minus/ : /lucide-plus/,
    );
  }
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

test('fair-play blocks knowledge and revision actions but retains inventory metadata management', () => {
  const markup = render({
    selected: true,
    member: true,
    fairPlayBlocked: true,
  });
  assert.match(markup, /Record child/);
  assert.match(markup, /manage.removeFromContext|manage.deleteInventoryItem/);
  assert.doesNotMatch(
    markup,
    /activity.analyze|inventory.rename|revisionImpact.review|manage.previewLoading/,
  );
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
