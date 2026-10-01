import type {
  InventoryItem,
  InventoryOrganization,
} from './plysmith-application-store.ts';

export interface InventoryFolderGroup {
  readonly folderId?: string;
  readonly path: string;
  readonly depth: number;
  readonly parentFolderId?: string;
  readonly items: readonly InventoryItem[];
  readonly itemCount: number;
}

export function inventoryFolderGroups(
  organization: InventoryOrganization,
  items: readonly InventoryItem[],
  contextOnly: boolean,
  locale: string,
): readonly InventoryFolderGroup[] {
  const folders = new Map(
    organization.folders.map((folder) => [folder.folderId, folder]),
  );
  const byFolder = new Map<string | undefined, InventoryItem[]>();
  for (const item of items) {
    const key =
      item.folderId !== undefined && folders.has(item.folderId)
        ? item.folderId
        : undefined;
    const group = byFolder.get(key) ?? [];
    group.push(item);
    byFolder.set(key, group);
  }
  const linked = new Set(organization.linkedFolderIds);
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: 'base',
  });
  const pathParts = (id: string): readonly string[] => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let folder = folders.get(id);
    while (folder !== undefined && !seen.has(folder.folderId)) {
      seen.add(folder.folderId);
      parts.unshift(folder.displayName);
      folder =
        folder.parentFolderId === undefined
          ? undefined
          : folders.get(folder.parentFolderId);
    }
    return parts;
  };
  const result: InventoryFolderGroup[] = [];
  const append = (parentId?: string, depth = 0) => {
    for (const folder of organization.folders
      .filter((candidate) => candidate.parentFolderId === parentId)
      .sort((a, b) => collator.compare(a.displayName, b.displayName))) {
      if (
        !contextOnly ||
        linked.has(folder.folderId) ||
        (folder.contextItemCount ?? 0) > 0
      ) {
        result.push({
          folderId: folder.folderId,
          ...(folder.parentFolderId === undefined
            ? {}
            : { parentFolderId: folder.parentFolderId }),
          path: pathParts(folder.folderId).join(' / '),
          depth: contextOnly ? 0 : depth,
          items: byFolder.get(folder.folderId) ?? [],
          itemCount: contextOnly
            ? (folder.contextItemCount ?? 0)
            : folder.itemCount,
        });
      }
      append(folder.folderId, depth + 1);
    }
  };
  append();
  if (contextOnly) result.sort((a, b) => collator.compare(a.path, b.path));
  result.push({
    path: '',
    depth: 0,
    items: byFolder.get(undefined) ?? [],
    itemCount: byFolder.get(undefined)?.length ?? 0,
  });
  return result;
}

export function inventoryDefaultFolder(
  organization: InventoryOrganization,
  selectedFolderId: string | undefined,
  contextOnly: boolean,
): string | null {
  const folder = organization.folders.find(
    (candidate) => candidate.folderId === selectedFolderId,
  );
  return folder !== undefined &&
    (!contextOnly ||
      organization.linkedFolderIds.includes(folder.folderId) ||
      (folder.contextItemCount ?? 0) > 0)
    ? folder.folderId
    : null;
}

export function inventoryFolderSubtreeHasItems(
  organization: InventoryOrganization,
  folderId: string,
): boolean {
  return organization.folders.some((folder) => {
    if (folder.itemCount === 0) return false;
    const seen = new Set<string>();
    let current: typeof folder | undefined = folder;
    while (current !== undefined && !seen.has(current.folderId)) {
      if (current.folderId === folderId) return true;
      seen.add(current.folderId);
      current = organization.folders.find(
        (entry) => entry.folderId === current?.parentFolderId,
      );
    }
    return false;
  });
}
