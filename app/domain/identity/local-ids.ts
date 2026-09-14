export type LocalIdKind =
  | 'anchor'
  | 'context-reference'
  | 'contribution'
  | 'inventory-item'
  | 'item-revision'
  | 'move-node'
  | 'occurrence'
  | 'position'
  | 'working-context';

export interface LocalId<Kind extends LocalIdKind> {
  readonly kind: Kind;
  readonly value: number;
}

export type AnchorId = LocalId<'anchor'>;
export type ContextReferenceId = LocalId<'context-reference'>;
export type ContributionId = LocalId<'contribution'>;
export type InventoryItemId = LocalId<'inventory-item'>;
export type ItemRevisionId = LocalId<'item-revision'>;
export type MoveNodeId = LocalId<'move-node'>;
export type OccurrenceId = LocalId<'occurrence'>;
export type PositionId = LocalId<'position'>;
export type WorkingContextId = LocalId<'working-context'>;

export function localId<Kind extends LocalIdKind>(
  kind: Kind,
  value: number,
): LocalId<Kind> {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`A ${kind} id must be a positive safe integer.`);
  }
  return Object.freeze({ kind, value });
}
