import type Database from 'better-sqlite3';

export function inventoryDisplayNameIsAvailable(
  database: Database.Database,
  displayName: string,
  excludingItemId?: number,
): boolean {
  const requestedKey = displayNameKey(displayName);
  const rows = database
    .prepare(
      `SELECT item.item_id AS itemId, revision.display_name AS displayName
         FROM inventory_item AS item
         JOIN item_revision AS revision
           ON revision.revision_id = item.current_revision_id
        WHERE item.lifecycle = 'active'`,
    )
    .all() as { itemId: number; displayName: string }[];
  return !rows.some(
    (row) =>
      row.itemId !== excludingItemId &&
      displayNameKey(row.displayName) === requestedKey,
  );
}

function displayNameKey(displayName: string): string {
  return displayName.trim().normalize('NFKC').toLocaleLowerCase();
}
