import type Database from 'better-sqlite3';
import {
  inventoryOrganizationProblem,
  inventoryItemNotFound,
  type ChangeInventoryOrganizationRequest,
  type ChangeInventoryOrganizationResult,
  type CheckInventoryNameAvailabilityRequest,
  type ContextFolderRemovalPreview,
  type GetInventoryOrganizationRequest,
  type InventoryNameAvailability,
  type InventoryOrganization,
  type PreviewContextFolderRemovalRequest,
} from '../../../../application/inventory/index.ts';
import {
  localId,
  type InventoryFolderId,
  type InventoryItemId,
  type WorkingContextId,
} from '../../../../domain/identity/index.ts';
import {
  InventoryFolderPolicyError,
  inventoryFolderNameKey,
  inventoryFolderSubtree,
  validateInventoryFolderPlacement,
  type InventoryFolder,
} from '../../../../domain/inventory/index.ts';
import {
  requireActiveContext,
  previewContextItemRemoval,
} from './sqlite-workspace.ts';
import {
  removeContextItemUsage,
  requireContextInventoryWorkAccess,
} from './sqlite-context-item.ts';
import { inventoryDisplayNameIsAvailable } from './sqlite-inventory-display-name.ts';
import {
  incrementDataRevision,
  readDataRevision,
} from './sqlite-store-helpers.ts';

function readFolders(database: Database.Database): readonly InventoryFolder[] {
  const rows = database
    .prepare(
      'SELECT folder_id AS folderId, parent_folder_id AS parentFolderId, display_name AS displayName FROM inventory_folder ORDER BY name_key, folder_id',
    )
    .all() as {
    folderId: number;
    parentFolderId: number | null;
    displayName: string;
  }[];
  return rows.map((row) => ({
    folderId: localId('inventory-folder', row.folderId),
    displayName: row.displayName,
    ...(row.parentFolderId === null
      ? {}
      : { parentFolderId: localId('inventory-folder', row.parentFolderId) }),
  }));
}

export function readInventoryOrganization(
  database: Database.Database,
  request: GetInventoryOrganizationRequest,
): InventoryOrganization {
  if (request.contextId !== undefined)
    requireActiveContext(database, request.contextId);
  const counts = database
    .prepare(
      `SELECT folder_id AS folderId, count(*) AS itemCount,
    sum(CASE WHEN EXISTS (SELECT 1 FROM workspace_context_item AS member WHERE member.item_id = item.item_id AND member.context_id = ?) THEN 1 ELSE 0 END) AS contextItemCount
    FROM inventory_item AS item WHERE lifecycle = 'active' AND current_revision_id IS NOT NULL AND folder_id IS NOT NULL GROUP BY folder_id`,
    )
    .all(request.contextId?.value ?? null) as {
    folderId: number;
    itemCount: number;
    contextItemCount: number;
  }[];
  const byId = new Map(counts.map((row) => [row.folderId, row]));
  const linkCounts = database
    .prepare(
      'SELECT folder_id AS folderId, count(*) AS contextLinkCount FROM workspace_context_folder GROUP BY folder_id',
    )
    .all() as { folderId: number; contextLinkCount: number }[];
  const linksById = new Map(
    linkCounts.map((row) => [row.folderId, row.contextLinkCount]),
  );
  const linked = database
    .prepare(
      'SELECT folder_id AS folderId FROM workspace_context_folder WHERE context_id = ? ORDER BY folder_id',
    )
    .all(request.contextId?.value ?? null) as { folderId: number }[];
  return Object.freeze({
    folders: Object.freeze(
      readFolders(database).map((folder) =>
        Object.freeze({
          ...folder,
          itemCount: byId.get(folder.folderId.value)?.itemCount ?? 0,
          contextLinkCount: linksById.get(folder.folderId.value) ?? 0,
          ...(request.contextId === undefined
            ? {}
            : {
                contextItemCount:
                  byId.get(folder.folderId.value)?.contextItemCount ?? 0,
              }),
        }),
      ),
    ),
    linkedFolderIds: Object.freeze(
      linked.map((row) => localId('inventory-folder', row.folderId)),
    ),
    dataRevision: readDataRevision(database),
  });
}

function subtree(
  database: Database.Database,
  folderId: InventoryFolderId,
): readonly InventoryFolderId[] {
  try {
    return inventoryFolderSubtree(readFolders(database), folderId);
  } catch (error) {
    if (error instanceof InventoryFolderPolicyError)
      throw inventoryOrganizationProblem(error.reason);
    throw error;
  }
}

function subtreeItems(
  database: Database.Database,
  folderIds: readonly InventoryFolderId[],
  contextId?: number,
): readonly InventoryItemId[] {
  const rows = database
    .prepare(
      `SELECT item_id AS itemId FROM inventory_item AS item WHERE current_revision_id IS NOT NULL AND (? IS NOT NULL OR lifecycle = 'active')
    AND folder_id IN (${folderIds.map(() => '?').join(',')})
    AND (? IS NULL OR EXISTS (SELECT 1 FROM workspace_context_item AS member WHERE member.item_id = item.item_id AND member.context_id = ?)) ORDER BY item_id`,
    )
    .all(
      contextId ?? null,
      ...folderIds.map((id) => id.value),
      contextId ?? null,
      contextId ?? null,
    ) as { itemId: number }[];
  return rows.map((row) => localId('inventory-item', row.itemId));
}

export function previewContextFolderRemoval(
  database: Database.Database,
  request: PreviewContextFolderRemovalRequest,
): ContextFolderRemovalPreview {
  requireActiveContext(database, request.contextId);
  const folderIds = subtree(database, request.folderId);
  const itemIds = subtreeItems(database, folderIds, request.contextId.value);
  const previews = itemIds.map((itemId) =>
    previewContextItemRemoval(database, {
      contextId: request.contextId,
      itemId,
    }),
  );
  const notes = [
    ...new Map(
      previews
        .flatMap((preview) => preview.losses.notes)
        .map((note) => [note.contributionId.value, note]),
    ).values(),
  ];
  const scratch = previews.find(
    (preview) => preview.losses.scratch !== undefined,
  )?.losses.scratch;
  const managementResume = previews.find(
    (preview) => preview.losses.managementResume !== undefined,
  )?.losses.managementResume;
  const analysisResume = previews.find(
    (preview) => preview.losses.analysisResume !== undefined,
  )?.losses.analysisResume;
  const linked = readInventoryOrganization(database, {
    contextId: request.contextId,
  }).linkedFolderIds;
  const ids = new Set(folderIds.map((id) => id.value));
  return Object.freeze({
    ...request,
    folderIds,
    itemIds: Object.freeze(itemIds),
    linkedFolderIds: Object.freeze(linked.filter((id) => ids.has(id.value))),
    losses: Object.freeze({
      notes: Object.freeze(notes),
      ...(scratch === undefined ? {} : { scratch }),
      ...(managementResume === undefined ? {} : { managementResume }),
      ...(analysisResume === undefined ? {} : { analysisResume }),
    }),
    loss: Object.freeze({
      referenceCount: previews.reduce(
        (sum, preview) => sum + preview.referenceCount,
        0,
      ),
      activeNoteCount: notes.length,
      noteMoveCount: notes.reduce((sum, note) => sum + note.moveCount, 0),
      scratchCount: scratch === undefined ? 0 : 1,
      changedScratchCount: Number(scratch?.hasChanges === true),
      scratchMoveCount: scratch?.stepCount ?? 0,
      scratchNoteCount: scratch?.noteBody?.trim() ? 1 : 0,
      managementResumeAffected: managementResume !== undefined,
      analysisResumeAffected: analysisResume !== undefined,
    }),
    dataRevision: readDataRevision(database),
  });
}

export function changeInventoryOrganization(
  database: Database.Database,
  request: ChangeInventoryOrganizationRequest,
  occurredAt: string,
): ChangeInventoryOrganizationResult {
  if (
    !Number.isSafeInteger(request.expectedDataRevision) ||
    request.expectedDataRevision < 0
  )
    throw inventoryOrganizationProblem('invalid_organization');
  if (readDataRevision(database) !== request.expectedDataRevision)
    throw inventoryOrganizationProblem('organization_conflict');
  const change = request.change;
  let folderId = 'folderId' in change ? change.folderId : undefined;
  if ('contextId' in change && change.contextId !== undefined)
    requireActiveContext(database, change.contextId);
  if (folderId !== undefined) requireFolder(database, folderId);
  if (
    change.kind === 'create_folder' ||
    change.kind === 'rename_folder' ||
    change.kind === 'move_folder'
  ) {
    const folders = readFolders(database);
    const current = folders.find(
      (folder) => folder.folderId.value === folderId?.value,
    );
    const displayName =
      change.kind === 'move_folder'
        ? current!.displayName
        : change.displayName.trim();
    const parentFolderId =
      change.kind === 'rename_folder'
        ? current?.parentFolderId
        : change.parentFolderId;
    try {
      validateInventoryFolderPlacement(folders, {
        displayName,
        ...(folderId === undefined ? {} : { folderId }),
        ...(parentFolderId === undefined ? {} : { parentFolderId }),
      });
    } catch (error) {
      if (error instanceof InventoryFolderPolicyError)
        throw inventoryOrganizationProblem(error.reason);
      throw error;
    }
    if (change.kind === 'create_folder') {
      const inserted = database
        .prepare(
          'INSERT INTO inventory_folder (parent_folder_id, display_name, name_key) VALUES (?, ?, ?)',
        )
        .run(
          parentFolderId?.value ?? null,
          displayName,
          inventoryFolderNameKey(displayName),
        );
      folderId = localId('inventory-folder', Number(inserted.lastInsertRowid));
    } else {
      database
        .prepare(
          'UPDATE inventory_folder SET parent_folder_id = ?, display_name = ?, name_key = ? WHERE folder_id = ?',
        )
        .run(
          parentFolderId?.value ?? null,
          displayName,
          inventoryFolderNameKey(displayName),
          change.folderId.value,
        );
    }
  } else if (change.kind === 'delete_folder') {
    // Explicit leaf-first deletion avoids SQLite's cascade recursion limit.
    for (const id of [...subtree(database, change.folderId)].reverse())
      database
        .prepare('DELETE FROM inventory_folder WHERE folder_id = ?')
        .run(id.value);
  } else if (change.kind === 'move_items') {
    if (
      change.itemIds.length === 0 ||
      new Set(change.itemIds.map((id) => id.value)).size !==
        change.itemIds.length
    )
      throw inventoryOrganizationProblem('invalid_organization');
    if (
      change.workContextId !== undefined &&
      change.contextId !== undefined &&
      change.workContextId.value !== change.contextId.value
    )
      throw inventoryOrganizationProblem('invalid_organization');
    const targetContextId = change.contextId ?? change.workContextId;
    if (targetContextId !== undefined)
      requireContextFolderDestination(
        database,
        change.folderId?.value ?? null,
        targetContextId,
      );
    for (const itemId of change.itemIds) {
      if (
        database
          .prepare(
            "SELECT 1 FROM inventory_item WHERE item_id = ? AND lifecycle = 'active' AND current_revision_id IS NOT NULL",
          )
          .get(itemId.value) === undefined
      )
        throw inventoryItemNotFound();
      if (change.workContextId !== undefined)
        requireContextInventoryWorkAccess(
          database,
          { kind: 'context', contextId: change.workContextId },
          itemId,
        );
    }
    for (const itemId of change.itemIds) {
      database
        .prepare(
          'UPDATE inventory_item SET folder_id = ?, updated_at_utc = ? WHERE item_id = ?',
        )
        .run(change.folderId?.value ?? null, occurredAt, itemId.value);
      if (change.contextId !== undefined)
        addMembership(
          database,
          change.contextId.value,
          itemId.value,
          occurredAt,
        );
    }
  } else if (change.kind === 'include_folder') {
    const folderIds = subtree(database, change.folderId);
    for (const id of folderIds)
      database
        .prepare(
          'INSERT OR IGNORE INTO workspace_context_folder (context_id, folder_id) VALUES (?, ?)',
        )
        .run(change.contextId.value, id.value);
    if (change.includeItems)
      for (const itemId of subtreeItems(database, folderIds))
        addMembership(
          database,
          change.contextId.value,
          itemId.value,
          occurredAt,
        );
  } else if (change.kind === 'remove_context_folder') {
    const preview = previewContextFolderRemoval(database, change);
    for (const itemId of preview.itemIds) {
      removeContextItemUsage(database, {
        contextId: change.contextId.value,
        itemId: itemId.value,
        occurredAt,
      });
      database
        .prepare(
          'DELETE FROM workspace_revision_impact_entry WHERE impact_id IN (SELECT impact_id FROM workspace_pending_revision_impact WHERE context_id = ? AND item_id = ?)',
        )
        .run(change.contextId.value, itemId.value);
      database
        .prepare(
          'DELETE FROM workspace_pending_revision_impact WHERE context_id = ? AND item_id = ?',
        )
        .run(change.contextId.value, itemId.value);
      database
        .prepare(
          'DELETE FROM workspace_context_item WHERE context_id = ? AND item_id = ?',
        )
        .run(change.contextId.value, itemId.value);
    }
    for (const id of preview.folderIds)
      database
        .prepare(
          'DELETE FROM workspace_context_folder WHERE context_id = ? AND folder_id = ?',
        )
        .run(change.contextId.value, id.value);
  } else {
    throw inventoryOrganizationProblem('invalid_organization');
  }
  if ('contextId' in change && change.contextId !== undefined)
    database
      .prepare(
        'UPDATE workspace_working_context SET updated_at_utc = ? WHERE context_id = ?',
      )
      .run(occurredAt, change.contextId.value);
  return Object.freeze({
    dataRevision: incrementDataRevision(database, occurredAt),
    ...(folderId === undefined ? {} : { folderId }),
  });
}

function addMembership(
  database: Database.Database,
  contextId: number,
  itemId: number,
  occurredAt: string,
): void {
  database
    .prepare(
      'INSERT OR IGNORE INTO workspace_context_item (context_id, item_id, relationship_version, created_at_utc) VALUES (?, ?, 1, ?)',
    )
    .run(contextId, itemId, occurredAt);
}

export function requireFolder(
  database: Database.Database,
  folderId: InventoryFolderId,
): void {
  if (
    database
      .prepare('SELECT 1 FROM inventory_folder WHERE folder_id = ?')
      .get(folderId.value) === undefined
  )
    throw inventoryOrganizationProblem('folder_not_found');
}

export function requireContextFolderDestination(
  database: Database.Database,
  folderId: number | null,
  contextId: WorkingContextId,
): void {
  requireActiveContext(database, contextId);
  if (folderId === null) return;
  if (
    database
      .prepare(
        `SELECT 1 FROM workspace_context_folder WHERE context_id = ? AND folder_id = ?
    UNION ALL SELECT 1 FROM workspace_context_item AS member JOIN inventory_item AS item ON item.item_id = member.item_id
      WHERE member.context_id = ? AND item.folder_id = ? AND item.lifecycle = 'active' LIMIT 1`,
      )
      .get(contextId.value, folderId, contextId.value, folderId) === undefined
  ) {
    throw inventoryOrganizationProblem('folder_not_in_context');
  }
}

export function creationFolder(
  database: Database.Database,
  explicitFolderId?: InventoryFolderId | null,
  sourceItemId?: InventoryItemId,
  targetContextId?: WorkingContextId,
): number | null {
  let folderId: number | null;
  if (explicitFolderId === null) folderId = null;
  else if (explicitFolderId !== undefined) {
    requireFolder(database, explicitFolderId);
    folderId = explicitFolderId.value;
  } else if (sourceItemId === undefined) folderId = null;
  else {
    const source = database
      .prepare(
        'SELECT folder_id AS folderId FROM inventory_item WHERE item_id = ?',
      )
      .get(sourceItemId.value) as { folderId: number | null } | undefined;
    if (source === undefined) throw inventoryItemNotFound();
    folderId = source.folderId;
  }
  if (targetContextId !== undefined)
    requireContextFolderDestination(database, folderId, targetContextId);
  return folderId;
}

export function checkInventoryNameAvailability(
  database: Database.Database,
  request: CheckInventoryNameAvailabilityRequest,
): InventoryNameAvailability {
  const available = inventoryDisplayNameIsAvailable(
    database,
    request.displayName,
    request.excludingItemId?.value,
  );
  let suggestedDisplayName = request.displayName;
  const maxLength = 160;
  for (
    let suffix = 2;
    !inventoryDisplayNameIsAvailable(
      database,
      suggestedDisplayName,
      request.excludingItemId?.value,
    );
    suffix++
  ) {
    const ending = ` (${suffix})`;
    suggestedDisplayName =
      request.displayName
        .slice(0, maxLength - ending.length)
        .replace(/[\uD800-\uDBFF]$/u, '')
        .trimEnd() + ending;
  }
  return Object.freeze({
    displayName: request.displayName,
    available,
    suggestedDisplayName,
    dataRevision: readDataRevision(database),
  });
}
