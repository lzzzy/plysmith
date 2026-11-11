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
import type { InventoryFolderState } from '../../../app/infrastructure/channels/ui/renderer/plysmith-application-store.ts';

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
    scopePending?: boolean;
    query?: string;
    itemCount?: number;
    folders?: boolean;
    linkedFolders?: boolean;
    contextOnly?: boolean;
    folderContextItemCount?: number;
    folderItemCount?: number;
    unfiledItemCount?: number;
    unfiledContextItemCount?: number;
    inventoryTotalCount?: number;
    collapsedInventoryFolders?: ReadonlySet<string>;
    inventoryFolderStates?: ReadonlyMap<string, InventoryFolderState>;
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
  const inventory = options.inventory ?? {
    items: [item('child', options.member ? ['context'] : [])],
    ancestors: [item('parent', options.ancestorMember ? ['context'] : [])],
    provenanceEdges: [
      {
        itemId: 'child',
        sourceItemId: 'parent',
        sourceRevisionId: 'historical-revision',
        sourceAnchorId: 'historical-anchor',
      },
    ],
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
          useWorkingContexts: true,
          fairPlayBlocked: options.fairPlayBlocked ?? false,
          scope: options.free
            ? { kind: 'free' }
            : { kind: 'context', contextId: 'context' },
          scopePending: options.scopePending,
          contexts: { contexts: [context] },
          contextWorkspace: {
            context,
            members: [],
            references: [],
            pendingRevisionImpacts: [],
          },
          inventory,
          inventoryTotalCount:
            options.inventoryTotalCount ?? inventory.items.length,
          collapsedInventoryFolders:
            options.collapsedInventoryFolders ?? new Set<string>(),
          inventoryFolderStates:
            options.inventoryFolderStates ??
            new Map<string, InventoryFolderState>(
              options.folders && !options.query
                ? [
                    ['folder', { status: 'ready' }],
                    ['unfiled', { status: 'ready' }],
                  ]
                : [],
            ),
          inventoryQuery: options.query ?? '',
          inventoryOrganization: {
            folders: options.folders
              ? [
                  {
                    folderId: 'folder',
                    displayName: 'Openings',
                    itemCount: options.folderItemCount ?? 1,
                    contextItemCount: options.folderContextItemCount ?? 0,
                    contextLinkCount: 0,
                  },
                ]
              : [],
            linkedFolderIds: options.linkedFolders ? ['folder'] : [],
            unfiledItemCount:
              options.unfiledItemCount ??
              inventory.items.filter((entry) => entry.folderId === undefined)
                .length,
            unfiledContextItemCount:
              options.unfiledContextItemCount ??
              inventory.items.filter(
                (entry) =>
                  entry.folderId === undefined &&
                  entry.contextIds.includes('context'),
              ).length,
            dataRevision: 0,
          },
          inventoryPresentation: options.folders ? 'folders' : 'origins',
          inspectedInventoryFolderId: options.inspectedFolderId,
          inventoryContextOnly: options.contextOnly ?? true,
          selectedInventoryItemId: options.selected ? 'child' : undefined,
          analysis: {},
          refreshing: options.scopePending ?? false,
        },
        store: {},
      }),
    ),
  );
}

function buttons(markup: string): readonly string[] {
  return markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

function folderMarkup(markup: string, folderId: string): string {
  const section = markup.match(
    new RegExp(
      `<section\\b[^>]*data-folder-id="${folderId}"[^>]*>([\\s\\S]*?)<\\/section>`,
    ),
  )?.[1];
  assert.ok(section, `Missing folder section: ${folderId || 'unfiled'}`);
  return section;
}

test('a context switch hides the previous inventory while the target is loading', () => {
  const options = { folders: true, member: true, itemCount: 1 };
  const pending = render({ ...options, scopePending: true });
  assert.match(pending, /<h1[^>]*>Preparation<\/h1>/);
  assert.match(pending, /aria-busy="true"/);
  assert.doesNotMatch(pending, /data-folder-id=|Record child/);
  const createAnalysis = buttons(pending).find((button) =>
    button.includes('New analysis'),
  );
  assert.match(createAnalysis ?? '', /\bdisabled(?:=""|\s|>)/);
  assert.match(render(options), /data-folder-id=|Record child/);
});

test('folder collapse follows controlled state in each scope and search', () => {
  const fixture = { folders: true, linkedFolders: true, itemCount: 1 };
  for (const free of [false, true]) {
    for (const query of ['', 'Record']) {
      const collapsed = render({
        ...fixture,
        free,
        query,
        collapsedInventoryFolders: new Set(['folder']),
      });
      assert.match(
        collapsed,
        /aria-expanded="false" aria-label="Expand “Openings”"/,
      );
      assert.match(
        collapsed,
        /aria-expanded="true" aria-label="Collapse “Unfiled”"/,
      );
      const expanded = render({
        ...fixture,
        free,
        query,
        collapsedInventoryFolders: new Set(['unfiled']),
      });
      assert.match(
        expanded,
        /aria-expanded="true" aria-label="Collapse “Openings”"/,
      );
      assert.match(
        expanded,
        /aria-expanded="false" aria-label="Expand “Unfiled”"/,
      );
    }
  }
});

test('pending and loading folders hide partial metadata while ready siblings remain usable', () => {
  for (const status of [undefined, 'loading', 'ready'] as const) {
    const inventoryFolderStates = new Map<string, InventoryFolderState>([
      ['unfiled', { status: 'ready' }],
    ]);
    if (status !== undefined) inventoryFolderStates.set('folder', { status });
    const markup = render({
      free: true,
      folders: true,
      itemCount: 2,
      folderItemCount: 5,
      inventoryTotalCount: 6,
      inventoryFolderStates,
      inventory: {
        items: [{ ...item('child'), folderId: 'folder' }, item('sibling')],
        ancestors: [],
        provenanceEdges: [],
      },
    });
    const folder = folderMarkup(markup, 'folder');
    assert.match(folder, /Openings/);
    assert.match(folder, /<small>5<\/small>/);
    if (status === 'ready') {
      assert.match(folder, /Record child/);
      assert.doesNotMatch(folder, /Loading records/);
    } else {
      assert.match(folder, /aria-busy="true"/);
      assert.match(folder, /role="status"[^>]*>Loading records/);
      assert.doesNotMatch(
        folder,
        /Record child|No records|No matching records/,
      );
    }
    const sibling = folderMarkup(markup, '');
    assert.match(sibling, /Record sibling/);
    assert.ok(
      buttons(sibling).some(
        (button) => button.includes('Rename') && !/\bdisabled\b/.test(button),
      ),
    );
    assert.doesNotMatch(sibling, /Loading records|could not be loaded/);
  }
});

test('empty folder messaging waits for its completed load', () => {
  for (const status of ['loading', 'ready'] as const) {
    const folder = folderMarkup(
      render({
        free: true,
        folders: true,
        itemCount: 1,
        folderItemCount: 0,
        inventoryFolderStates: new Map([
          ['folder', { status }],
          ['unfiled', { status: 'ready' }],
        ]),
      }),
      'folder',
    );
    if (status === 'loading') {
      assert.match(folder, /Loading records/);
      assert.doesNotMatch(folder, /No records/);
    } else {
      assert.match(folder, /No records/);
      assert.doesNotMatch(folder, /Loading records/);
    }
  }
});

test('folder and unfiled failures expose a local enabled retry without partial rows', () => {
  for (const failedKey of ['folder', 'unfiled']) {
    const markup = render({
      free: true,
      folders: true,
      itemCount: 2,
      inventoryFolderStates: new Map(
        ['folder', 'unfiled'].map((key) => [
          key,
          key === failedKey
            ? { status: 'failed', errorCode: 'host.unavailable' }
            : { status: 'ready' },
        ]),
      ),
      inventory: {
        items: [{ ...item('child'), folderId: 'folder' }, item('sibling')],
        ancestors: [],
        provenanceEdges: [],
      },
    });
    const failed = folderMarkup(
      markup,
      failedKey === 'unfiled' ? '' : 'folder',
    );
    assert.match(failed, /role="alert"[^>]*>The records could not be loaded/);
    assert.doesNotMatch(
      failed,
      /Record child|Record sibling|No records|Loading records/,
    );
    const retry = buttons(failed).filter((button) =>
      button.includes('Try again'),
    );
    assert.equal(retry.length, 1);
    assert.doesNotMatch(retry[0]!, /\bdisabled\b/);
    const sibling = folderMarkup(
      markup,
      failedKey === 'unfiled' ? 'folder' : '',
    );
    assert.match(
      sibling,
      failedKey === 'unfiled' ? /Record child/ : /Record sibling/,
    );
    assert.doesNotMatch(sibling, /Try again|could not be loaded/);
  }
});

test('directory counts use authoritative totals even before any rows are loaded', () => {
  for (const free of [false, true]) {
    const markup = render({
      free,
      contextOnly: !free,
      folders: true,
      linkedFolders: true,
      itemCount: 1,
      folderItemCount: 4,
      folderContextItemCount: 2,
      unfiledItemCount: 13,
      unfiledContextItemCount: 7,
      inventoryTotalCount: free ? 17 : 9,
      inventoryFolderStates: new Map([
        ['folder', { status: 'loading' }],
        ['unfiled', { status: 'loading' }],
      ]),
      inventory: { items: [], ancestors: [], provenanceEdges: [] },
    });
    assert.match(markup, free ? /17 results/ : /9 results/);
    assert.match(
      folderMarkup(markup, 'folder'),
      free ? /<small>4<\/small>/ : /<small>2<\/small>/,
    );
    assert.match(
      folderMarkup(markup, ''),
      free ? /<small>13<\/small>/ : /<small>7<\/small>/,
    );
    assert.doesNotMatch(markup, /No results|No records/);
    assert.ok(!markup.includes(messages['en-GB']['manage.empty.inventory']));
    assert.ok(!markup.includes(messages['en-GB']['manage.empty.context']));
  }
});

test('selected metadata keeps the inspector visible when its folder is closed', () => {
  const markup = render({
    free: true,
    folders: true,
    selected: true,
    itemCount: 1,
    collapsedInventoryFolders: new Set(['folder']),
    inventoryFolderStates: new Map([['unfiled', { status: 'ready' }]]),
    inventory: {
      items: [{ ...item('child'), folderId: 'folder' }],
      ancestors: [],
      provenanceEdges: [],
    },
  });
  const folder = folderMarkup(markup, 'folder');
  assert.match(folder, /aria-expanded="false"/);
  assert.doesNotMatch(folder, /Record child|Loading records|type="checkbox"/);
  const inspector = markup.match(
    /<aside\b[^>]*aria-labelledby="inspector-title"[^>]*>([\s\S]*?)<\/aside>/,
  )?.[1];
  assert.ok(inspector);
  assert.match(inspector, /<strong>Record child<\/strong>/);
});

test('search and origins render complete rows without folder load states', () => {
  for (const folders of [false, true]) {
    const markup = render({
      free: true,
      folders,
      query: folders ? 'Record' : '',
      itemCount: 2,
      inventoryFolderStates: new Map(),
      inventory: {
        items: [{ ...item('child'), folderId: 'folder' }, item('sibling')],
        ancestors: [],
        provenanceEdges: [],
      },
    });
    for (const name of ['child', 'sibling'])
      assert.ok(
        buttons(markup).some((button) =>
          button.includes(`<strong>Record ${name}</strong>`),
        ),
      );
    assert.match(markup, /2 results/);
    assert.doesNotMatch(
      markup,
      /Loading records|could not be loaded|No records/,
    );
  }
});

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
