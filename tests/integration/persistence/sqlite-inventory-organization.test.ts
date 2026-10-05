import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import Database from 'better-sqlite3';
import {
  localId,
  type InventoryFolderId,
} from '../../../app/domain/identity/index.ts';
import type { InventoryOrganizationChange } from '../../../app/application/inventory/index.ts';
import { requireInventoryWorkAccess } from '../../../app/application/workspace/inventory-work-access.ts';
import {
  startAnalysisScratch,
  prepareAnalysisNote,
  appendAnalysisMove,
} from '../../../app/domain/analysis/index.ts';
import { ChessJsRulesAdapter } from '../../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';
import { SqlitePersistenceAdapter } from '../../../app/infrastructure/adapters/persistence/sqlite/index.ts';
import { migrateStore } from '../../../app/infrastructure/adapters/persistence/sqlite/migrate.ts';
import {
  createAnalysisRecord,
  readAnalysisRecordView,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-analysis-record.ts';
import {
  changeInventoryOrganization,
  readInventoryOrganization,
  previewContextFolderRemoval,
  checkInventoryNameAvailability,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-inventory-organization.ts';
import { searchInventory } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-inventory.ts';
import { readDataRevision } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-store-helpers.ts';
import {
  createWorkingContext,
  addContextReference,
  readWorkingContextWorkspace,
  listWorkingContexts,
  setWorkScopeResume,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-workspace.ts';
import { insertAnalysisNoteContribution } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-analysis-note.ts';
import { replaceContextAnalysisScratch } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-analysis-scratch.ts';
import { readContextScratch } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-analysis-scratch-state.ts';
import { deleteInventoryItem } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-inventory-lifecycle.ts';
import {
  createPlayout,
  replacePlayout,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-playout.ts';
import {
  completePlayout,
  readPlayoutCompletion,
} from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-game-record.ts';
import { resolvePendingRevisionImpact } from '../../../app/infrastructure/adapters/persistence/sqlite/sqlite-revision-impact.ts';
import { createGameRecordDraft } from '../../../app/domain/inventory/index.ts';
import { stopPlayoutDraft } from '../../../app/domain/playout/index.ts';
import { freeWorkScope } from '../../../app/domain/workspace/index.ts';

const timestamp = '2026-09-30T12:00:00.000Z';
const rules = new ChessJsRulesAdapter();

function fixture(t: TestContext) {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  migrateStore(database, true, timestamp);
  t.after(() => database.close());
  const change = (
    change: InventoryOrganizationChange,
    revision = readDataRevision(database),
  ) =>
    database
      .transaction(() =>
        changeInventoryOrganization(
          database,
          { change, expectedDataRevision: revision },
          timestamp,
        ),
      )
      .immediate();
  const folder = (displayName: string, parentFolderId?: InventoryFolderId) =>
    change({
      kind: 'create_folder',
      displayName,
      ...(parentFolderId === undefined ? {} : { parentFolderId }),
    }).folderId!;
  const item = (displayName: string, folderId?: InventoryFolderId | null) =>
    createAnalysisRecord(database, {
      displayName,
      languageTag: 'en-GB',
      origin: { kind: 'initial_position' },
      root: rules.initialState(),
      steps: [],
      occurredAt: timestamp,
      ...(folderId === undefined ? {} : { folderId }),
    });
  const context = (displayName: string) =>
    createWorkingContext(database, { displayName }, timestamp).context
      .contextId;
  return { database, change, folder, item, context };
}

test('global folder projection reports empty targets linked in other work contexts', (t) => {
  const { database, change, folder, context } = fixture(t);
  const leaf = folder('Empty target');
  const other = context('Other context');
  const selected = context('Selected context');
  assert.equal(
    readInventoryOrganization(database, {}).folders[0]?.contextLinkCount,
    0,
  );
  change({
    kind: 'include_folder',
    folderId: leaf,
    contextId: other,
    includeItems: true,
  });
  for (const request of [{}, { contextId: selected }, { contextId: other }]) {
    const organization = readInventoryOrganization(database, request);
    assert.equal(organization.folders[0]?.itemCount, 0);
    assert.equal(organization.folders[0]?.contextLinkCount, 1);
  }
  change({ kind: 'remove_context_folder', folderId: leaf, contextId: other });
  assert.equal(
    readInventoryOrganization(database, {}).folders[0]?.contextLinkCount,
    0,
  );
});

test('folder membership authorizes work without manufacturing anchor references', async (t) => {
  const { database, change, folder, item, context } = fixture(t);
  const folderId = folder('Members');
  const member = item('Member', folderId);
  const outsider = item('Outside');
  const contextId = context('Study');
  change({ kind: 'include_folder', folderId, contextId, includeItems: true });
  const workspace = readWorkingContextWorkspace(database, contextId)!;
  assert.deepEqual(workspace.members, [
    {
      itemId: member.itemId,
      currentRevisionId: member.revisionId,
      itemType: 'analysis',
      displayName: 'Member',
    },
  ]);
  assert.deepEqual(workspace.references, []);
  assert.equal(workspace.context.itemCount, 1);
  assert.equal(workspace.context.referenceCount, 0);
  assert.equal(
    listWorkingContexts(database, { pageSize: 10 }).contexts[0]?.itemCount,
    1,
  );
  const reader = {
    readWorkingContextWorkspace: async () =>
      readWorkingContextWorkspace(database, contextId),
  };
  const scope = { kind: 'context', contextId } as const;
  await requireInventoryWorkAccess(reader, scope, member.itemId);
  const selection = {
    scope,
    area: 'manage' as const,
    expectedResumeVersion: null,
    presentation: 'folders' as const,
    selectedItemId: member.itemId,
    selectedAnchorId: member.rootAnchorId,
  };
  for (const invalid of [
    {
      selectedItemId: outsider.itemId,
      selectedAnchorId: outsider.rootAnchorId,
    },
    { selectedAnchorId: outsider.rootAnchorId },
    { selectedAnchorId: localId('anchor', 999_999) },
  ]) {
    assert.throws(
      () =>
        setWorkScopeResume(database, { ...selection, ...invalid }, timestamp),
      { problemCode: 'workspace.reference_target_not_found' },
    );
  }
  const saved = setWorkScopeResume(database, selection, timestamp);
  assert.ok(saved.area === 'manage');
  assert.equal(saved.resume.selectedItemId?.value, member.itemId.value);
  assert.equal(saved.resume.selectedAnchorId?.value, member.rootAnchorId.value);
  assert.deepEqual(
    readWorkingContextWorkspace(database, contextId)?.references,
    [],
  );
  database
    .prepare(
      "UPDATE inventory_item SET lifecycle = 'trashed' WHERE item_id = ?",
    )
    .run(member.itemId.value);
  assert.throws(
    () =>
      setWorkScopeResume(
        database,
        {
          ...selection,
          expectedResumeVersion: saved.resume.resumeVersion,
        },
        timestamp,
      ),
    { problemCode: 'workspace.reference_target_not_found' },
  );
  database
    .prepare("UPDATE inventory_item SET lifecycle = 'active' WHERE item_id = ?")
    .run(member.itemId.value);
  await assert.rejects(
    requireInventoryWorkAccess(reader, scope, outsider.itemId),
    {
      problemCode: 'workspace.inventory_work_not_allowed',
    },
  );
  change({ kind: 'remove_context_folder', folderId, contextId });
  assert.equal(
    listWorkingContexts(database, { pageSize: 10 }).contexts[0]?.itemCount,
    0,
  );
  await assert.rejects(
    requireInventoryWorkAccess(reader, scope, member.itemId),
    {
      problemCode: 'workspace.inventory_work_not_allowed',
    },
  );
});

test('canonical membership exposes pinned revision metadata without anchor references', (t) => {
  const { database, change, folder, item, context } = fixture(t);
  const folderId = folder('Members');
  const member = item('Original', folderId);
  const contextId = context('Study');
  change({ kind: 'include_folder', folderId, contextId, includeItems: true });
  const inserted = database
    .prepare(
      `
    INSERT INTO item_revision
      (item_id, revision_number, base_revision_id, display_name, language_tag,
       content_fingerprint, creator_role, created_at_utc, revision_change_kind)
    SELECT item_id, 2, revision_id, 'Renamed', language_tag,
           content_fingerprint, creator_role, created_at_utc, 'metadata'
      FROM item_revision WHERE revision_id = ?
  `,
    )
    .run(member.revisionId.value);
  const revisionId = localId('item-revision', Number(inserted.lastInsertRowid));
  database
    .prepare(
      'UPDATE inventory_item SET current_revision_id = ? WHERE item_id = ?',
    )
    .run(revisionId.value, member.itemId.value);
  assert.deepEqual(readWorkingContextWorkspace(database, contextId)?.members, [
    {
      itemId: member.itemId,
      currentRevisionId: revisionId,
      displayName: 'Renamed',
      itemType: 'analysis',
    },
  ]);
  const selection = {
    scope: { kind: 'context' as const, contextId },
    area: 'manage' as const,
    expectedResumeVersion: null,
    presentation: 'folders' as const,
    selectedItemId: member.itemId,
    selectedAnchorId: member.rootAnchorId,
  };
  assert.throws(() => setWorkScopeResume(database, selection, timestamp), {
    problemCode: 'workspace.reference_target_not_found',
  });
  database
    .prepare(
      "UPDATE workspace_context_item SET pinned_revision_id = ?, pin_reason = 'pending_revision_impact' WHERE context_id = ? AND item_id = ?",
    )
    .run(member.revisionId.value, contextId.value, member.itemId.value);
  const saved = setWorkScopeResume(database, selection, timestamp);
  assert.ok(saved.area === 'manage');
  assert.equal(saved.resume.selectedAnchorId?.value, member.rootAnchorId.value);
  assert.throws(
    () =>
      addContextReference(
        database,
        {
          contextId,
          itemId: member.itemId,
          anchorId: member.rootAnchorId,
        },
        timestamp,
      ),
    { problemCode: 'workspace.reference_target_not_found' },
  );
  assert.deepEqual(readWorkingContextWorkspace(database, contextId)?.members, [
    {
      itemId: member.itemId,
      currentRevisionId: member.revisionId,
      displayName: 'Original',
      itemType: 'analysis',
    },
  ]);
  assert.deepEqual(
    readWorkingContextWorkspace(database, contextId)?.references,
    [],
  );
  assert.deepEqual(database.pragma('foreign_key_check'), []);
});

test('rename and creation suggestions respect the shared inventory name limit', (t) => {
  const { database, item } = fixture(t);
  const name = 'A'.repeat(160);
  item(name);
  const renamed = item('Rename me');
  const suggestion = checkInventoryNameAvailability(database, {
    displayName: name,
    excludingItemId: renamed.itemId,
  });
  assert.equal(suggestion.available, false);
  assert.equal(suggestion.suggestedDisplayName, `${'A'.repeat(156)} (2)`);
  item(suggestion.suggestedDisplayName);
  assert.equal(
    checkInventoryNameAvailability(database, {
      displayName: name,
      excludingItemId: renamed.itemId,
    }).suggestedDisplayName,
    `${'A'.repeat(156)} (3)`,
  );
  const creationName = 'B'.repeat(160);
  item(creationName);
  assert.equal(
    checkInventoryNameAvailability(database, {
      displayName: creationName,
    }).suggestedDisplayName,
    `${'B'.repeat(156)} (2)`,
  );
});

test('folder include is a recursive snapshot with independent empty targets and implicit groups', (t) => {
  const { database, change, folder, item, context } = fixture(t);
  const parent = folder('Openings');
  const child = folder('White', parent);
  const first = item('First', child);
  const contextId = context('Study');
  change({
    kind: 'include_folder',
    folderId: parent,
    contextId,
    includeItems: false,
  });
  let organization = readInventoryOrganization(database, { contextId });
  assert.deepEqual(organization.linkedFolderIds, [parent, child]);
  assert.equal(
    organization.folders.find((entry) => entry.folderId.value === child.value)
      ?.contextItemCount,
    0,
  );
  change({
    kind: 'include_folder',
    folderId: parent,
    contextId,
    includeItems: true,
  });
  const laterFolder = folder('Later', parent);
  const later = item('Later item', child);
  organization = readInventoryOrganization(database, { contextId });
  assert.deepEqual(organization.linkedFolderIds, [parent, child]);
  assert.deepEqual(
    searchInventory(database, { contextId, pageSize: 100 }).items.map(
      (entry) => entry.itemId,
    ),
    [first.itemId],
  );
  change({
    kind: 'move_items',
    itemIds: [first.itemId],
    folderId: laterFolder,
  });
  organization = readInventoryOrganization(database, { contextId });
  assert.equal(
    organization.folders.find(
      (entry) => entry.folderId.value === laterFolder.value,
    )?.contextItemCount,
    1,
  );
  assert.equal(
    organization.linkedFolderIds.some((id) => id.value === laterFolder.value),
    false,
  );
  change({
    kind: 'move_items',
    itemIds: [later.itemId],
    folderId: laterFolder,
  });
  assert.equal(
    searchInventory(database, { contextId, pageSize: 100 }).items.length,
    1,
  );
  change({
    kind: 'move_items',
    itemIds: [later.itemId],
    folderId: laterFolder,
    contextId,
  });
  assert.equal(
    searchInventory(database, { contextId, pageSize: 100 }).items.length,
    2,
  );
});

test('moving a folder preserves its links and members while subtree removal follows the current tree', (t) => {
  const { database, change, folder, item, context } = fixture(t);
  const parent = folder('Parent');
  const destination = folder('Destination');
  const child = folder('Child', parent);
  const source = item('Source', child);
  const contextId = context('Study');
  change({
    kind: 'include_folder',
    folderId: parent,
    contextId,
    includeItems: true,
  });
  change({ kind: 'move_folder', folderId: child, parentFolderId: destination });
  change({
    kind: 'rename_folder',
    folderId: destination,
    displayName: 'Renamed',
  });
  const current = readInventoryOrganization(database, { contextId });
  assert.deepEqual(
    current.folders.find((entry) => entry.folderId.value === child.value)
      ?.parentFolderId,
    destination,
  );
  assert.deepEqual(current.linkedFolderIds, [parent, child]);
  const preview = previewContextFolderRemoval(database, {
    folderId: parent,
    contextId,
  });
  assert.deepEqual(preview.folderIds, [parent]);
  assert.deepEqual(preview.itemIds, []);
  change({ kind: 'remove_context_folder', folderId: parent, contextId });
  assert.deepEqual(
    readInventoryOrganization(database, { contextId }).linkedFolderIds,
    [child],
  );
  assert.deepEqual(
    searchInventory(database, { contextId, pageSize: 100 }).items.map(
      (entry) => entry.itemId,
    ),
    [source.itemId],
  );
  change({ kind: 'delete_folder', folderId: destination });
  const replacement = folder('Replacement');
  assert.notEqual(replacement.value, child.value);
  assert.notEqual(replacement.value, destination.value);
});

test('context subtree removal previews actual work, commits atomically and leaves other contexts intact', (t) => {
  const { database, change, folder, item, context } = fixture(t);
  const parent = folder('Parent');
  const child = folder('Child', parent);
  const first = item('First', parent);
  const second = item('Second', child);
  const contextId = context('Study');
  const other = context('Other');
  const move = rules.applyMove(rules.initialState(), [], {
    kind: 'coordinates',
    value: 'e2e4',
  });
  assert.ok(move.ok);
  for (const id of [contextId, other]) {
    change({
      kind: 'include_folder',
      folderId: parent,
      contextId: id,
      includeItems: true,
    });
    addContextReference(
      database,
      { contextId: id, itemId: first.itemId, anchorId: first.rootAnchorId },
      timestamp,
    );
    insertAnalysisNoteContribution(database, {
      itemId: first.itemId,
      anchorId: first.rootAnchorId,
      note: { body: `Note ${id.value}`, moves: [] },
      noteScope: { kind: 'context', contextId: id },
      languageTag: 'en-GB',
      occurredAt: timestamp,
    });
    replaceContextAnalysisScratch(database, {
      contextId: id,
      expectedScratchId: null,
      expectedScratchRevision: null,
      scratch: prepareAnalysisNote(
        appendAnalysisMove(
          startAnalysisScratch(`scratch-${id.value}`, rules.initialState(), {
            kind: 'inventory_anchor',
            itemId: second.itemId,
            revisionId: second.revisionId,
            anchorId: second.rootAnchorId,
          }),
          move.value,
        ),
        'Draft note',
      ),
      occurredAt: timestamp,
    });
  }
  const preview = previewContextFolderRemoval(database, {
    contextId,
    folderId: parent,
  });
  assert.deepEqual(preview.itemIds, [first.itemId, second.itemId]);
  assert.equal(preview.loss.activeNoteCount, 1);
  assert.equal(preview.loss.scratchCount, 1);
  assert.equal(preview.loss.scratchNoteCount, 1);
  assert.equal(preview.losses.notes[0]?.body, `Note ${contextId.value}`);
  assert.equal(preview.losses.scratch?.noteBody, 'Draft note');
  database.exec(
    "CREATE TRIGGER reject_folder_removal BEFORE DELETE ON workspace_context_folder BEGIN SELECT RAISE(ABORT, 'injected'); END",
  );
  assert.throws(() =>
    change({ kind: 'remove_context_folder', contextId, folderId: parent }),
  );
  assert.deepEqual(
    previewContextFolderRemoval(database, { contextId, folderId: parent }),
    preview,
  );
  database.exec('DROP TRIGGER reject_folder_removal');
  const otherBefore = previewContextFolderRemoval(database, {
    contextId: other,
    folderId: parent,
  });
  change({ kind: 'remove_context_folder', contextId, folderId: parent });
  assert.equal(
    searchInventory(database, { contextId, pageSize: 100 }).items.length,
    0,
  );
  assert.equal(readContextScratch(database, contextId), undefined);
  const otherAfter = previewContextFolderRemoval(database, {
    contextId: other,
    folderId: parent,
  });
  assert.deepEqual(otherAfter.losses, otherBefore.losses);
  assert.equal(
    searchInventory(database, { contextId: other, pageSize: 100 }).items.length,
    2,
  );
  change({
    kind: 'include_folder',
    contextId,
    folderId: parent,
    includeItems: true,
  });
  const restored = previewContextFolderRemoval(database, {
    contextId,
    folderId: parent,
  });
  assert.equal(restored.loss.activeNoteCount, 0);
  assert.equal(restored.loss.scratchCount, 0);
  assert.deepEqual(database.pragma('foreign_key_check'), []);
});

test('global subtree deletion only unfiles items and preserves membership, notes, drafts and provenance', (t) => {
  const { database, change, folder, item, context } = fixture(t);
  const parent = folder('Parent');
  const child = folder('Child', parent);
  const source = item('Source', child);
  const derived = createAnalysisRecord(database, {
    displayName: 'Derived',
    languageTag: 'en-GB',
    origin: {
      kind: 'inventory_anchor',
      itemId: source.itemId,
      revisionId: source.revisionId,
      anchorId: source.rootAnchorId,
    },
    root: rules.initialState(),
    steps: [],
    occurredAt: timestamp,
  });
  const contextId = context('Study');
  change({
    kind: 'include_folder',
    folderId: parent,
    contextId,
    includeItems: true,
  });
  insertAnalysisNoteContribution(database, {
    itemId: source.itemId,
    anchorId: source.rootAnchorId,
    note: { body: 'Preserved', moves: [] },
    noteScope: { kind: 'context', contextId },
    languageTag: 'en-GB',
    occurredAt: timestamp,
  });
  const before = previewContextFolderRemoval(database, {
    contextId,
    folderId: parent,
  });
  const scratch = startAnalysisScratch(
    'preserved-draft',
    rules.initialState(),
    {
      kind: 'inventory_anchor',
      itemId: source.itemId,
      revisionId: source.revisionId,
      anchorId: source.rootAnchorId,
    },
  );
  replaceContextAnalysisScratch(database, {
    contextId,
    expectedScratchId: null,
    expectedScratchRevision: null,
    scratch,
    occurredAt: timestamp,
  });
  change({
    kind: 'move_items',
    itemIds: [source.itemId, derived.itemId],
    folderId: parent,
  });
  assert.deepEqual(readContextScratch(database, contextId), scratch);
  change({ kind: 'delete_folder', folderId: parent });
  assert.deepEqual(readContextScratch(database, contextId), scratch);
  assert.equal(
    readInventoryOrganization(database, { contextId }).folders.length,
    0,
  );
  const items = searchInventory(database, { pageSize: 100, contextId }).items;
  assert.equal(items.length, 2);
  assert.ok(items.every((entry) => entry.folderId === undefined));
  assert.deepEqual(
    database
      .prepare(
        "SELECT contribution_id AS id FROM workspace_contribution WHERE status = 'active'",
      )
      .all(),
    before.losses.notes.map((note) => ({ id: note.contributionId.value })),
  );
  database
    .transaction(() =>
      deleteInventoryItem(
        database,
        {
          itemId: source.itemId,
          expectedCurrentRevisionId: source.revisionId,
          expectedDataRevision: readDataRevision(database),
        },
        timestamp,
      ),
    )
    .immediate();
  assert.equal(
    readAnalysisRecordView(database, {
      itemId: derived.itemId,
      revisionId: derived.revisionId,
      anchorId: derived.rootAnchorId,
    })?.sourceLine?.sourceItemId.value,
    source.itemId.value,
  );
  assert.deepEqual(database.pragma('foreign_key_check'), []);
});

test('folder writes revalidate names, cycles, revisions and every item before any move', (t) => {
  const { database, change, folder, item } = fixture(t);
  const parent = folder('Parent');
  const child = folder('Child', parent);
  const root = item('Root');
  const before = readDataRevision(database);
  for (const invalid of [
    { kind: 'create_folder', displayName: 'PARENT' },
    { kind: 'move_folder', folderId: parent, parentFolderId: child },
    {
      kind: 'move_items',
      folderId: parent,
      itemIds: [root.itemId, localId('inventory-item', 999)],
    },
    {
      kind: 'move_items',
      folderId: localId('inventory-folder', 999),
      itemIds: [root.itemId],
    },
  ] satisfies InventoryOrganizationChange[])
    assert.throws(() => change(invalid));
  assert.equal(readDataRevision(database), before);
  assert.equal(
    searchInventory(database, { pageSize: 100 }).items[0]?.folderId,
    undefined,
  );
  change({ kind: 'rename_folder', folderId: parent, displayName: 'Renamed' });
  assert.throws(
    () => change({ kind: 'delete_folder', folderId: parent }, before),
    { problemCode: 'inventory.organization_conflict' },
  );
  assert.equal(readInventoryOrganization(database, {}).folders.length, 2);
});

test('creation inherits source placement once, accepts explicit overrides, and suggestions respect global names', (t) => {
  const { database, change, folder, item } = fixture(t);
  const first = folder('First');
  const second = folder('Second');
  const source = item('Source', first);
  const create = (displayName: string, folderId?: InventoryFolderId | null) =>
    createAnalysisRecord(database, {
      displayName,
      languageTag: 'en-GB',
      origin: {
        kind: 'inventory_anchor',
        itemId: source.itemId,
        revisionId: source.revisionId,
        anchorId: source.rootAnchorId,
      },
      root: rules.initialState(),
      steps: [],
      occurredAt: timestamp,
      ...(folderId === undefined ? {} : { folderId }),
    });
  const derived = create('Derived');
  const explicit = create('Explicit', second);
  const unfiled = create('Unfiled', null);
  change({ kind: 'move_items', itemIds: [source.itemId], folderId: second });
  const items = searchInventory(database, { pageSize: 100 }).items;
  assert.deepEqual(
    items.find((entry) => entry.itemId.value === derived.itemId.value)
      ?.folderId,
    first,
  );
  assert.deepEqual(
    items.find((entry) => entry.itemId.value === explicit.itemId.value)
      ?.folderId,
    second,
  );
  assert.equal(
    items.find((entry) => entry.itemId.value === unfiled.itemId.value)
      ?.folderId,
    undefined,
  );
  assert.equal(item('Independent').itemId.kind, 'inventory-item');
  assert.throws(() => create('Missing', localId('inventory-folder', 999)), {
    problemCode: 'inventory.folder_not_found',
  });
  const name = checkInventoryNameAvailability(database, {
    displayName: 'SOURCE',
  });
  assert.equal(name.available, false);
  assert.equal(name.suggestedDisplayName, 'SOURCE (2)');
  assert.equal(
    checkInventoryNameAvailability(database, {
      displayName: 'SOURCE',
      excludingItemId: source.itemId,
    }).available,
    true,
  );
  item('SOURCE (2)');
  assert.equal(
    checkInventoryNameAvailability(database, { displayName: 'SOURCE' })
      .suggestedDisplayName,
    'SOURCE (3)',
  );
});

test('context destinations require a linked target or actual current member and guarded moves never add membership', (t) => {
  const { database, change, folder, item, context } = fixture(t);
  const linked = folder('Linked');
  const implicit = folder('Implicit');
  const outside = folder('Outside');
  const first = item('Member', implicit);
  const nonmember = item('Not a member');
  const contextId = context('Study');
  addContextReference(
    database,
    { contextId, itemId: first.itemId, anchorId: first.rootAnchorId },
    timestamp,
  );
  change({
    kind: 'include_folder',
    folderId: linked,
    contextId,
    includeItems: false,
  });
  assert.throws(
    () =>
      change({
        kind: 'move_items',
        folderId: outside,
        itemIds: [first.itemId],
        workContextId: contextId,
      }),
    { problemCode: 'inventory.folder_not_in_context' },
  );
  assert.throws(() =>
    change({
      kind: 'move_items',
      folderId: linked,
      itemIds: [nonmember.itemId],
      workContextId: contextId,
    }),
  );
  assert.throws(
    () =>
      change({
        kind: 'move_items',
        folderId: outside,
        itemIds: [nonmember.itemId],
        contextId,
      }),
    { problemCode: 'inventory.folder_not_in_context' },
  );
  assert.equal(
    searchInventory(database, { contextId, pageSize: 100 }).items.length,
    1,
  );
  change({
    kind: 'move_items',
    folderId: implicit,
    itemIds: [nonmember.itemId],
    contextId,
  });
  change({
    kind: 'move_items',
    folderId: linked,
    itemIds: [first.itemId, nonmember.itemId],
    workContextId: contextId,
  });
  assert.throws(
    () =>
      change({
        kind: 'move_items',
        folderId: implicit,
        itemIds: [first.itemId],
        workContextId: contextId,
      }),
    { problemCode: 'inventory.folder_not_in_context' },
  );
  change({
    kind: 'move_items',
    itemIds: [first.itemId],
    workContextId: contextId,
  });
  assert.equal(
    searchInventory(database, { contextId, pageSize: 100 }).items.length,
    2,
  );
  const create = (displayName: string, folderId: InventoryFolderId | null) =>
    database
      .transaction(() =>
        createAnalysisRecord(database, {
          displayName,
          languageTag: 'en-GB',
          origin: { kind: 'initial_position' },
          root: rules.initialState(),
          steps: [],
          occurredAt: timestamp,
          targetContextId: contextId,
          folderId,
        }),
      )
      .immediate();
  assert.throws(() => create('Invalid target', outside), {
    problemCode: 'inventory.folder_not_in_context',
  });
  create('Linked target', linked);
  create('Unfiled target', null);
});

test('playout completion inherits once and receipts distinguish explicit unfiled from inherited placement', (t) => {
  const { database, change, folder, item } = fixture(t);
  const sourceFolder = folder('Source folder');
  const source = item('Source', sourceFolder);
  const origin = {
    kind: 'inventory_anchor' as const,
    itemId: source.itemId,
    revisionId: source.revisionId,
    anchorId: source.rootAnchorId,
  };
  for (const destination of [undefined, null, sourceFolder] as const) {
    const scope = freeWorkScope();
    const started = createPlayout(database, {
      scope,
      origin,
      root: rules.initialState(),
      playerSide: 'white',
      policy: {
        capability: 'best_move',
        providerInstanceId: 'test',
        providerFingerprint: 'test:v1',
        providerType: 'test',
        providerDisplayName: 'Test',
      },
      occurredAt: timestamp,
    });
    const stopped = replacePlayout(database, {
      scope,
      expectedDraftRevision: started.draft.draftRevision,
      draft: stopPlayoutDraft(started.draft),
      occurredAt: timestamp,
    });
    const request = {
      scope,
      draftId: stopped.draft.draftId,
      expectedDraftRevision: stopped.draft.draftRevision,
      completionId: `completion-${String(destination?.value ?? destination)}`,
      displayName: `Game name ${String(destination?.value ?? destination)}`,
      languageTag: 'en-GB',
      manualResult: 'unfinished' as const,
      ...(destination === undefined ? {} : { folderId: destination }),
    };
    const game = createGameRecordDraft({
      displayName: request.displayName,
      languageTag: request.languageTag,
      origin,
      root: stopped.draft.root,
      steps: stopped.draft.steps,
      playerSide: stopped.draft.playerSide,
      outcome: { kind: 'unfinished' },
      outcomeSource: 'manual',
      policy: stopped.draft.policy,
      provider: { providerType: 'test', providerDisplayName: 'Test' },
    });
    const completed = database
      .transaction(() =>
        completePlayout(database, { ...request, game, occurredAt: timestamp }),
      )
      .immediate();
    assert.deepEqual(readPlayoutCompletion(database, request), completed);
    const actual = searchInventory(database, { pageSize: 100 }).items.find(
      (entry) => entry.itemId.value === completed.itemId.value,
    );
    assert.deepEqual(
      actual?.folderId,
      destination === null ? undefined : sourceFolder,
    );
    assert.throws(
      () =>
        readPlayoutCompletion(database, {
          ...request,
          folderId: destination === null ? sourceFolder : null,
        }),
      { problemCode: 'playout.invalid' },
    );
    assert.equal(
      checkInventoryNameAvailability(database, {
        displayName: request.displayName,
      }).available,
      false,
    );
    if (destination !== undefined) {
      change({ kind: 'move_items', itemIds: [completed.itemId] });
      assert.deepEqual(readPlayoutCompletion(database, request), completed);
    }
  }
});

test('keep_copy inherits the source folder while redirecting existing context work', (t) => {
  const { database, change, folder, item, context } = fixture(t);
  const folderId = folder('Copies');
  const source = item('Source', folderId);
  const contextId = context('Study');
  change({ kind: 'include_folder', folderId, contextId, includeItems: true });
  const reference = addContextReference(
    database,
    { contextId, itemId: source.itemId, anchorId: source.rootAnchorId },
    timestamp,
  );
  const note = insertAnalysisNoteContribution(database, {
    itemId: source.itemId,
    anchorId: source.rootAnchorId,
    note: { body: 'My work', moves: [] },
    noteScope: { kind: 'context', contextId },
    languageTag: 'en-GB',
    occurredAt: timestamp,
  });
  database
    .prepare(
      "UPDATE workspace_context_item SET pinned_revision_id = ?, pin_reason = 'pending_revision_impact' WHERE context_id = ? AND item_id = ?",
    )
    .run(source.revisionId.value, contextId.value, source.itemId.value);
  const inserted = database
    .prepare(
      `INSERT INTO workspace_pending_revision_impact (context_id, item_id, pinned_revision_id, target_revision_id, target_anchor_id, impact_version, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      contextId.value,
      source.itemId.value,
      source.revisionId.value,
      source.revisionId.value,
      source.rootAnchorId.value,
      timestamp,
      timestamp,
    );
  const impactId = localId('revision-impact', Number(inserted.lastInsertRowid));
  database
    .prepare(
      "INSERT INTO workspace_revision_impact_entry (impact_id, entry_kind, subject_id, old_anchor_id) VALUES (?, 'contribution', ?, ?)",
    )
    .run(impactId.value, note.value, source.rootAnchorId.value);
  const result = database
    .transaction(() =>
      resolvePendingRevisionImpact(
        database,
        {
          impactId,
          expectedImpactVersion: 1,
          expectedDataRevision: readDataRevision(database),
          resolution: { kind: 'keep_copy', displayName: 'Kept copy' },
        },
        timestamp,
      ),
    )
    .immediate();
  assert.ok(result.contextItemId);
  assert.deepEqual(
    searchInventory(database, { contextId, pageSize: 100 }).items.map(
      (entry) => ({ itemId: entry.itemId, folderId: entry.folderId }),
    ),
    [{ itemId: result.contextItemId, folderId }],
  );
  const preview = previewContextFolderRemoval(database, {
    contextId,
    folderId,
  });
  assert.equal(preview.loss.activeNoteCount, 1);
  assert.equal(preview.losses.notes[0]?.body, 'My work');
  assert.ok(reference);
  assert.deepEqual(database.pragma('foreign_key_check'), []);
});

test('public persistence serializes competing writes and retains organization across reopen', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'plysmith-organization-'));
  const databasePath = join(directory, 'store.sqlite');
  const stores: SqlitePersistenceAdapter[] = [];
  t.after(async () => {
    for (const store of stores) await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const open = () => {
    const store = new SqlitePersistenceAdapter({
      databasePath,
      now: () => timestamp,
    });
    stores.push(store);
    return store;
  };
  const store = open();
  const results = await Promise.allSettled(
    ['A', 'B'].map((displayName) =>
      store.changeInventoryOrganization(
        {
          expectedDataRevision: 0,
          change: { kind: 'create_folder', displayName },
        },
        timestamp,
      ),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === 'rejected').length,
    1,
  );
  const before = await store.readInventoryOrganization({});
  await store.close();
  assert.deepEqual(await open().readInventoryOrganization({}), before);
});

test('schema seven fails fast without changing its data or migration history', (t) => {
  const database = new Database(':memory:');
  t.after(() => database.close());
  database.pragma('foreign_keys = ON');
  const files = [
    '001-user-preferences',
    '002-analysis-workspace',
    '003-analysis-contributions',
    '004-stable-analysis-scratch-identity',
    '005-inventory-revisions',
    '006-playout-drafts',
    '007-game-source-path',
  ];
  for (const [index, file] of files.entries()) {
    const sql = readFileSync(
      new URL(
        `../../../app/infrastructure/adapters/persistence/sqlite/migrations/${file}.sql`,
        import.meta.url,
      ),
      'utf8',
    );
    database.exec(sql);
    if (index === 0) {
      database
        .prepare(
          "INSERT INTO runtime_store_state VALUES (1, 7, 3, 0, 'ready', ?)",
        )
        .run(timestamp);
      database
        .prepare("INSERT INTO preference_state VALUES (1, 'de-DE', 1, ?)")
        .run(timestamp);
    }
    database
      .prepare('INSERT INTO runtime_schema_migration VALUES (?, ?, ?)')
      .run(
        index + 1,
        createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest(),
        timestamp,
      );
  }
  assert.throws(() => migrateStore(database, false, timestamp), {
    problemCode: 'persistence.incompatible_store',
  });
  assert.equal(readDataRevision(database), 3);
  assert.equal(
    (
      database
        .prepare('SELECT schema_version AS version FROM runtime_store_state')
        .get() as { version: number }
    ).version,
    7,
  );
  assert.equal(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE name = 'inventory_folder'")
      .get(),
    undefined,
  );
  assert.deepEqual(database.pragma('foreign_key_check'), []);
});
