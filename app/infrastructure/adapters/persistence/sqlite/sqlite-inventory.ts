import type Database from 'better-sqlite3';

import {
  invalidInventorySearch,
  type InventorySearchItem,
  type SearchInventoryRequest,
  type SearchInventoryResult,
} from '../../../../application/inventory/index.ts';
import { localId } from '../../../../domain/identity/index.ts';
import {
  decodeCursor,
  encodeCursor,
  readDataRevision,
} from './sqlite-store-helpers.ts';

interface InventoryRow {
  readonly folderId: number | null;
  readonly lifecycle: InventorySearchItem['lifecycle'];
  readonly itemId: number;
  readonly currentRevisionId: number;
  readonly rootAnchorId: number;
  readonly itemType: InventorySearchItem['itemType'];
  readonly originKind: InventorySearchItem['originKind'];
  readonly displayName: string;
  readonly summary: string | null;
  readonly languageTag: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface InventoryCursor {
  readonly version: 1;
  readonly dataRevision: number;
  readonly query: string | null;
  readonly contextId: number | null;
  readonly updatedAt: string;
  readonly itemId: number;
}

export function searchInventory(
  database: Database.Database,
  request: Required<Pick<SearchInventoryRequest, 'pageSize'>> &
    Omit<SearchInventoryRequest, 'pageSize'>,
): SearchInventoryResult {
  const expectedQuery = request.query ?? null;
  const expectedContextId = request.contextId?.value ?? null;
  const dataRevision = readDataRevision(database);
  const cursor =
    request.cursor === undefined
      ? undefined
      : decodeInventoryCursor(request.cursor);
  if (
    request.cursor !== undefined &&
    (cursor === undefined ||
      cursor.query !== expectedQuery ||
      cursor.dataRevision !== dataRevision ||
      cursor.contextId !== expectedContextId)
  ) {
    throw invalidInventorySearch();
  }

  const rows = database
    .prepare(inventorySql(request.query !== undefined))
    .all(
      ...(request.query === undefined ? [] : [literalFtsQuery(request.query)]),
      expectedContextId,
      expectedContextId,
      cursor?.updatedAt ?? null,
      cursor?.updatedAt ?? '',
      cursor?.updatedAt ?? '',
      cursor?.itemId ?? 0,
      request.pageSize + 1,
    ) as InventoryRow[];
  const hasMore = rows.length > request.pageSize;
  const page = rows.slice(0, request.pageSize);
  const contextsByItem = readContextMemberships(
    database,
    page.map((row) => row.itemId),
  );
  const items = Object.freeze(
    page.map((row) => mapInventoryItem(row, contextsByItem.get(row.itemId))),
  );
  const last = page.at(-1);
  const family = readProvenanceFamily(database, page);
  return Object.freeze({
    items,
    ...family,
    ...(hasMore && last !== undefined
      ? {
          nextCursor: encodeCursor({
            version: 1,
            dataRevision,
            query: expectedQuery,
            contextId: expectedContextId,
            updatedAt: last.updatedAt,
            itemId: last.itemId,
          } satisfies InventoryCursor),
        }
      : {}),
    dataRevision,
  });
}

function inventorySql(withTextQuery: boolean, byId = false): string {
  return `
    SELECT i.item_id AS itemId,
           i.folder_id AS folderId,
           i.lifecycle AS lifecycle,
           i.current_revision_id AS currentRevisionId,
           COALESCE(root_anchor.anchor_id, item_anchor.anchor_id) AS rootAnchorId,
           i.item_type AS itemType,
           i.origin_kind AS originKind,
           revision.display_name AS displayName,
           revision.summary_text AS summary,
           revision.language_tag AS languageTag,
           i.created_at_utc AS createdAt,
           i.updated_at_utc AS updatedAt
      FROM inventory_item AS i
      JOIN item_revision AS revision
        ON revision.item_id = i.item_id
       AND revision.revision_id = i.current_revision_id
      LEFT JOIN inventory_analysis_revision AS analysis
        ON analysis.item_id = i.item_id
       AND analysis.revision_id = i.current_revision_id
      LEFT JOIN inventory_game_revision AS game
        ON game.item_id = i.item_id
       AND game.revision_id = i.current_revision_id
      LEFT JOIN chess_anchor AS root_anchor
        ON root_anchor.anchor_kind = 'occurrence'
       AND root_anchor.owner_item_id = i.item_id
       AND root_anchor.occurrence_id = COALESCE(
             analysis.root_occurrence_id,
             game.root_occurrence_id
           )
      LEFT JOIN chess_anchor AS item_anchor
        ON item_anchor.anchor_kind = 'item'
       AND item_anchor.item_id = i.item_id
      ${
        withTextQuery
          ? `JOIN search_document AS document
               ON document.subject_kind = 'item_revision'
              AND document.item_id = i.item_id
              AND document.item_revision_id = i.current_revision_id
             JOIN search_document_fts
               ON search_document_fts.rowid = document.search_document_id`
          : ''
      }
     WHERE ${byId ? "i.lifecycle <> 'tombstone'" : "i.lifecycle = 'active'"}
       AND i.current_revision_id IS NOT NULL
       ${withTextQuery ? 'AND search_document_fts MATCH ?' : ''}
       AND (? IS NULL OR EXISTS (
         SELECT 1 FROM workspace_context_item AS membership
          WHERE membership.item_id = i.item_id
            AND membership.context_id = ?
       ))
       AND (? IS NULL OR i.updated_at_utc < ?
            OR (i.updated_at_utc = ? AND i.item_id < ?))
       ${byId ? 'AND i.item_id = ?' : ''}
     ORDER BY i.updated_at_utc DESC, i.item_id DESC
     LIMIT ?`;
}

function readProvenanceFamily(
  database: Database.Database,
  page: readonly InventoryRow[],
): Pick<SearchInventoryResult, 'ancestors' | 'provenanceEdges'> {
  const rows = new Map(page.map((row) => [row.itemId, row]));
  const matches = new Set(rows.keys());
  const edges = new Map<
    number,
    SearchInventoryResult['provenanceEdges'][number]
  >();
  const origin = database.prepare(`
    SELECT source_item_id AS sourceItemId, source_revision_id AS sourceRevisionId,
           source_anchor_id AS sourceAnchorId
      FROM inventory_analysis_origin WHERE analysis_revision_id = ?
    UNION ALL
    SELECT source_item_id AS sourceItemId, source_revision_id AS sourceRevisionId,
           source_anchor_id AS sourceAnchorId
      FROM inventory_game_origin WHERE game_revision_id = ?`);
  const item = database.prepare(inventorySql(false, true));
  const resolved = new Set<number>();
  for (const match of page) {
    let current: InventoryRow | undefined = match;
    const path = new Set<number>();
    while (current !== undefined) {
      if (path.has(current.itemId))
        throw new Error('Inventory provenance contains a cycle.');
      path.add(current.itemId);
      if (resolved.has(current.itemId)) break;
      const sources = origin.all(
        current.currentRevisionId,
        current.currentRevisionId,
      ) as {
        sourceItemId: number;
        sourceRevisionId: number;
        sourceAnchorId: number;
      }[];
      if (sources.length > 1)
        throw new Error('Inventory provenance has multiple direct origins.');
      const source = sources[0];
      if (source === undefined) break;
      edges.set(
        current.itemId,
        Object.freeze({
          itemId: localId('inventory-item', current.itemId),
          sourceItemId: localId('inventory-item', source.sourceItemId),
          sourceRevisionId: localId('item-revision', source.sourceRevisionId),
          sourceAnchorId: localId('anchor', source.sourceAnchorId),
        }),
      );
      current =
        rows.get(source.sourceItemId) ??
        (item.get(null, null, null, '', '', 0, source.sourceItemId, 1) as
          InventoryRow | undefined);
      if (current === undefined)
        throw new Error('Inventory provenance source is missing.');
      rows.set(current.itemId, current);
    }
    for (const id of path) resolved.add(id);
  }
  const ancestors = [...rows.values()].filter(
    (row) => !matches.has(row.itemId),
  );
  const memberships = readContextMemberships(
    database,
    ancestors.map((row) => row.itemId),
  );
  return {
    ancestors: Object.freeze(
      ancestors.map((row) =>
        mapInventoryItem(row, memberships.get(row.itemId)),
      ),
    ),
    provenanceEdges: Object.freeze([...edges.values()]),
  };
}

function literalFtsQuery(query: string): string {
  return `"${query.replaceAll('"', '""')}"`;
}

function readContextMemberships(
  database: Database.Database,
  itemIds: readonly number[],
): ReadonlyMap<number, readonly number[]> {
  if (itemIds.length === 0) return new Map();
  const placeholders = itemIds.map(() => '?').join(', ');
  const rows = database
    .prepare(
      `SELECT item_id AS itemId, context_id AS contextId
         FROM workspace_context_item
        WHERE item_id IN (${placeholders})
        ORDER BY item_id, context_id`,
    )
    .all(...itemIds) as { itemId: number; contextId: number }[];
  const result = new Map<number, number[]>();
  for (const row of rows) {
    const contexts = result.get(row.itemId) ?? [];
    contexts.push(row.contextId);
    result.set(row.itemId, contexts);
  }
  return result;
}

function mapInventoryItem(
  row: InventoryRow,
  contextIds: readonly number[] = [],
): InventorySearchItem {
  return Object.freeze({
    lifecycle: row.lifecycle,
    itemId: localId('inventory-item', row.itemId),
    ...(row.folderId === null
      ? {}
      : { folderId: localId('inventory-folder', row.folderId) }),
    currentRevisionId: localId('item-revision', row.currentRevisionId),
    rootAnchorId: localId('anchor', row.rootAnchorId),
    itemType: row.itemType,
    originKind: row.originKind,
    displayName: row.displayName,
    ...(row.summary === null ? {} : { summary: row.summary }),
    languageTag: row.languageTag,
    contextIds: Object.freeze(
      contextIds.map((contextId) => localId('working-context', contextId)),
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function decodeInventoryCursor(cursor: string): InventoryCursor | undefined {
  const value = decodeCursor<Partial<InventoryCursor>>(cursor);
  return value?.version === 1 &&
    Number.isSafeInteger(value.dataRevision) &&
    (typeof value.query === 'string' || value.query === null) &&
    (Number.isSafeInteger(value.contextId) || value.contextId === null) &&
    typeof value.updatedAt === 'string' &&
    Number.isSafeInteger(value.itemId) &&
    (value.itemId ?? 0) > 0
    ? (value as InventoryCursor)
    : undefined;
}
