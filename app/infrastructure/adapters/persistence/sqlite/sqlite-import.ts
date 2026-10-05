import type Database from 'better-sqlite3';
import type { ImportRepository } from '../../../../application/inventory/import-ports.ts';
import type {
  CheckImportNamesRequest,
  ImportNameChecks,
  ImportFolderDestination,
  ImportPublished,
} from '../../../../application/inventory/import-models.ts';
import { importProblem } from '../../../../application/inventory/import-problems.ts';
import { IMPORT_LIMITS } from '../../../../application/inventory/import-limits.ts';
import { assertImportPublicationBudget } from '../../../../application/inventory/import-content-budget.ts';
import { inventoryOrganizationProblem } from '../../../../application/inventory/inventory-organization.ts';
import { localId } from '../../../../domain/identity/index.ts';
import {
  InventoryFolderPolicyError,
  inventoryFolderNameKey,
  validateInventoryFolderPlacement,
} from '../../../../domain/inventory/index.ts';
import {
  requireFolder,
  readInventoryOrganization,
} from './sqlite-inventory-organization.ts';
import {
  incrementDataRevision,
  readDataRevision,
} from './sqlite-store-helpers.ts';
import {
  importFingerprint,
  prepareImportGraph,
} from './sqlite-import-graph.ts';

function nameKey(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase();
}

export function checkImportNames(
  db: Database.Database,
  request: CheckImportNamesRequest,
): ImportNameChecks {
  if (
    request.candidates.length > IMPORT_LIMITS.maxCandidates ||
    new Set(request.candidates.map((candidate) => candidate.sourceOrder))
      .size !== request.candidates.length ||
    request.candidates.some(
      (candidate) =>
        !Number.isSafeInteger(candidate.sourceOrder) ||
        candidate.sourceOrder < 0 ||
        candidate.displayName.trim() !== candidate.displayName ||
        candidate.displayName.length < 1 ||
        candidate.displayName.length > 160,
    )
  )
    throw importProblem('invalid_selection');
  const occupied = new Set(
    (
      db
        .prepare(
          "SELECT r.display_name AS name FROM inventory_item i JOIN item_revision r ON r.revision_id = i.current_revision_id WHERE i.lifecycle = 'active'",
        )
        .all() as { name: string }[]
    ).map((row) => nameKey(row.name)),
  );
  const reserved = new Set([
    ...occupied,
    ...request.candidates.map((candidate) => nameKey(candidate.displayName)),
  ]);
  const candidates = request.candidates.map((candidate) => {
    const key = nameKey(candidate.displayName);
    const available = !occupied.has(key);
    occupied.add(key);
    let suggestedDisplayName = candidate.displayName;
    if (!available) {
      for (
        let suffix = 2;
        reserved.has(nameKey(suggestedDisplayName));
        suffix++
      ) {
        suggestedDisplayName = `${candidate.displayName} (${suffix})`;
      }
      reserved.add(nameKey(suggestedDisplayName));
    }
    return {
      sourceOrder: candidate.sourceOrder,
      displayName: candidate.displayName,
      available,
      suggestedDisplayName,
    };
  });
  return { candidates, dataRevision: readDataRevision(db) };
}

function destination(
  db: Database.Database,
  folder: ImportFolderDestination,
): number | null {
  if (folder.kind === 'unfiled') return null;
  if (folder.kind === 'existing') {
    requireFolder(db, folder.folderId);
    return folder.folderId.value;
  }
  if (folder.kind !== 'new') throw importProblem('invalid_selection');
  const displayName = folder.displayName.trim();
  try {
    validateInventoryFolderPlacement(
      readInventoryOrganization(db, {}).folders,
      { ...folder, displayName },
    );
  } catch (error) {
    if (error instanceof InventoryFolderPolicyError)
      throw inventoryOrganizationProblem(error.reason);
    throw error;
  }
  return Number(
    db
      .prepare(
        'INSERT INTO inventory_folder(parent_folder_id, display_name, name_key) VALUES (?, ?, ?)',
      )
      .run(
        folder.parentFolderId?.value ?? null,
        displayName,
        inventoryFolderNameKey(displayName),
      ).lastInsertRowid,
  );
}

/** Called inside the writer transaction: names, folder, objects and notes commit together. */
export function publishImport(
  db: Database.Database,
  request: Parameters<ImportRepository['publishImport']>[0],
): ImportPublished {
  const deadline = performance.now() + IMPORT_LIMITS.maxPublicationDurationMs;
  const checkBudget = () => {
    if (performance.now() >= deadline)
      throw importProblem('provider_resource_exhausted');
  };
  if (request.candidates.length === 0) throw importProblem('invalid_selection');
  assertImportPublicationBudget(
    request.candidates.map(({ content }) => content),
  );
  if (
    checkImportNames(db, request).candidates.some(
      (candidate) => !candidate.available,
    )
  )
    throw importProblem('name_conflict');
  const folder = destination(db, request.folder);
  const time = request.occurredAt;
  const insertImportGraph = prepareImportGraph(db, checkBudget);
  const insertItem = db.prepare(
    "INSERT INTO inventory_item(item_type, origin_kind, lifecycle, folder_id, created_at_utc, updated_at_utc) VALUES (?, 'structured_import', 'active', ?, ?, ?)",
  );
  const insertRevision = db.prepare(
    "INSERT INTO item_revision(item_id, revision_number, display_name, language_tag, content_fingerprint, creator_role, created_at_utc) VALUES (?, 1, ?, ?, ?, 'importer', ?)",
  );
  const insertGame = db.prepare(
    'INSERT INTO inventory_game_revision(revision_id, item_id, root_occurrence_id, origin_mode) SELECT revision_id, item_id, root_occurrence_id, origin_mode FROM inventory_analysis_revision WHERE revision_id = ?',
  );
  const deleteAnalysis = db.prepare(
    'DELETE FROM inventory_analysis_revision WHERE revision_id = ?',
  );
  const setCurrentRevision = db.prepare(
    'UPDATE inventory_item SET current_revision_id = ? WHERE item_id = ?',
  );
  const selectRoot = db.prepare(
    "SELECT a.anchor_id AS id FROM inventory_chess_revision r JOIN chess_anchor a ON a.occurrence_id = r.root_occurrence_id AND a.anchor_kind = 'occurrence' WHERE r.revision_id = ?",
  );
  const insertSearch = db.prepare(
    `INSERT INTO search_document(projection_version, subject_kind, item_id, item_revision_id, anchor_id, language_tag,
      evidence_class, scope_kind, stable_sort_value, title, aliases_concepts, metadata, body)
      VALUES (1, 'item_revision', ?, ?, ?, ?, 'source', 'global', ?, ?, '', ?, '')`,
  );
  const items = request.candidates.map((candidate) => {
    checkBudget();
    const { content, itemType, displayName, sourceOrder } = candidate;
    if (
      content.status === 'rejected' ||
      content.root === undefined ||
      content.sourceOrder !== sourceOrder ||
      !['analysis', 'game'].includes(itemType)
    )
      throw importProblem('invalid_candidate');
    const item = Number(
      insertItem.run(itemType, folder, time, time).lastInsertRowid,
    );
    const revision = Number(
      insertRevision.run(
        item,
        displayName,
        request.languageTag,
        importFingerprint(content),
        time,
      ).lastInsertRowid,
    );
    insertImportGraph(
      item,
      revision,
      content,
      request.languageTag,
      time,
      displayName,
    );
    if (itemType === 'game') {
      insertGame.run(revision);
      deleteAnalysis.run(revision);
    }
    setCurrentRevision.run(revision, item);
    const root = selectRoot.get(revision) as { id: number };
    insertSearch.run(
      item,
      revision,
      root.id,
      request.languageTag,
      time,
      displayName,
      `${itemType} structured_import`,
    );
    return {
      itemId: localId('inventory-item', item),
      revisionId: localId('item-revision', revision),
      sourceOrder,
    };
  });
  const dataRevision = incrementDataRevision(db, time);
  checkBudget();
  return {
    items,
    ...(folder === null
      ? {}
      : { folderId: localId('inventory-folder', folder) }),
    dataRevision,
  };
}
