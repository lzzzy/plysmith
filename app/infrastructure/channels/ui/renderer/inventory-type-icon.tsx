import { BookOpen, FileSearch, GitBranch } from 'lucide-react';

export function InventoryTypeIcon({
  itemType,
  size,
}: {
  readonly itemType: 'analysis' | 'game' | 'source';
  readonly size: number;
}) {
  const Icon =
    itemType === 'game'
      ? BookOpen
      : itemType === 'analysis'
        ? GitBranch
        : FileSearch;
  return <Icon aria-hidden="true" size={size} />;
}
