import type { SearchInventoryResultDto } from '../../host_client/index.ts';

type InventoryItem = SearchInventoryResultDto['items'][number];

export interface InventoryFamilyNode {
  readonly item: InventoryItem;
  readonly isMatch: boolean;
  readonly children: readonly InventoryFamilyNode[];
}

export function inventoryFamilyPresentation(
  inventory: Pick<
    SearchInventoryResultDto,
    'items' | 'ancestors' | 'provenanceEdges'
  >,
): readonly InventoryFamilyNode[] {
  const matches = new Set(inventory.items.map((item) => item.itemId));
  const nodes = new Map<
    string,
    {
      item: InventoryItem;
      isMatch: boolean;
      children: InventoryFamilyNode[];
    }
  >();
  for (const item of [...inventory.ancestors, ...inventory.items]) {
    nodes.set(item.itemId, {
      item,
      isMatch:
        matches.has(item.itemId) &&
        item.lifecycle !== 'trashed' &&
        item.lifecycle !== 'tombstone',
      children: [],
    });
  }
  const parents = new Map<string, string>();
  for (const edge of inventory.provenanceEdges) {
    if (nodes.has(edge.itemId) && nodes.has(edge.sourceItemId)) {
      parents.set(edge.itemId, edge.sourceItemId);
    }
  }

  // Invalid cycles cannot hide records or recurse forever. Only cyclic edges
  // are removed; valid descendants keep their actual parent.
  const checked = new Set<string>();
  for (const itemId of nodes.keys()) {
    const path: string[] = [];
    const pathIndexes = new Map<string, number>();
    let current: string | undefined = itemId;
    while (current !== undefined && !checked.has(current)) {
      const cycleStart = pathIndexes.get(current);
      if (cycleStart !== undefined) {
        for (const cyclicItem of path.slice(cycleStart))
          parents.delete(cyclicItem);
        break;
      }
      pathIndexes.set(current, path.length);
      path.push(current);
      current = parents.get(current);
    }
    for (const visited of path) checked.add(visited);
  }

  const roots: InventoryFamilyNode[] = [];
  for (const [itemId, node] of nodes) {
    const parentId = parents.get(itemId);
    const parent = parentId === undefined ? undefined : nodes.get(parentId);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }
  return roots;
}
