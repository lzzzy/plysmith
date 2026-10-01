import type { InventoryFolderId } from '../identity/index.ts';

export interface InventoryFolder {
  readonly folderId: InventoryFolderId;
  readonly parentFolderId?: InventoryFolderId;
  readonly displayName: string;
}

export type InventoryFolderViolation =
  'invalid_name' | 'name_conflict' | 'folder_not_found' | 'cycle';

export class InventoryFolderPolicyError extends Error {
  readonly reason: InventoryFolderViolation;

  constructor(reason: InventoryFolderViolation) {
    super(`Invalid inventory folder: ${reason}.`);
    this.reason = reason;
  }
}

export function inventoryFolderNameKey(displayName: string): string {
  const name = displayName.trim().normalize('NFKC');
  if (
    name.length === 0 ||
    name.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    throw new InventoryFolderPolicyError('invalid_name');
  }
  return name.toLowerCase();
}

export function validateInventoryFolderPlacement(
  folders: readonly InventoryFolder[],
  candidate: {
    readonly folderId?: InventoryFolderId;
    readonly parentFolderId?: InventoryFolderId;
    readonly displayName: string;
  },
): void {
  const key = inventoryFolderNameKey(candidate.displayName);
  const byId = new Map(
    folders.map((folder) => [folder.folderId.value, folder]),
  );
  if (candidate.folderId !== undefined && !byId.has(candidate.folderId.value)) {
    throw new InventoryFolderPolicyError('folder_not_found');
  }
  const visited = new Set<number>();
  let parent = candidate.parentFolderId;
  while (parent !== undefined) {
    if (
      parent.value === candidate.folderId?.value ||
      visited.has(parent.value)
    ) {
      throw new InventoryFolderPolicyError('cycle');
    }
    visited.add(parent.value);
    const folder = byId.get(parent.value);
    if (folder === undefined)
      throw new InventoryFolderPolicyError('folder_not_found');
    parent = folder.parentFolderId;
  }
  if (
    folders.some(
      (folder) =>
        folder.folderId.value !== candidate.folderId?.value &&
        folder.parentFolderId?.value === candidate.parentFolderId?.value &&
        inventoryFolderNameKey(folder.displayName) === key,
    )
  ) {
    throw new InventoryFolderPolicyError('name_conflict');
  }
}

export function inventoryFolderSubtree(
  folders: readonly InventoryFolder[],
  folderId: InventoryFolderId,
): readonly InventoryFolderId[] {
  if (!folders.some((folder) => folder.folderId.value === folderId.value)) {
    throw new InventoryFolderPolicyError('folder_not_found');
  }
  const result = [folderId];
  const visited = new Set([folderId.value]);
  for (const parent of result) {
    for (const folder of folders) {
      if (folder.parentFolderId?.value !== parent.value) continue;
      if (visited.has(folder.folderId.value))
        throw new InventoryFolderPolicyError('cycle');
      visited.add(folder.folderId.value);
      result.push(folder.folderId);
    }
  }
  return Object.freeze(result);
}
