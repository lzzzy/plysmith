import type {
  AnchorId,
  InventoryItemId,
  ItemRevisionId,
  WorkingContextId,
} from '../../domain/identity/index.ts';

export interface InventorySearchItem {
  readonly itemId: InventoryItemId;
  readonly currentRevisionId: ItemRevisionId;
  readonly rootAnchorId: AnchorId;
  readonly itemType: 'game' | 'analysis' | 'source';
  readonly originKind:
    | 'manual'
    | 'structured_import'
    | 'playout'
    | 'live_observed'
    | 'live_played';
  readonly displayName: string;
  readonly summary?: string;
  readonly languageTag: string;
  readonly contextIds: readonly WorkingContextId[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SearchInventoryRequest {
  readonly query?: string;
  readonly contextId?: WorkingContextId;
  readonly pageSize?: number;
  readonly cursor?: string;
}

export interface SearchInventoryResult {
  readonly items: readonly InventorySearchItem[];
  readonly nextCursor?: string;
  readonly dataRevision: number;
}

export interface AnalysisRecordCreated {
  readonly kind: 'inventory.item-created';
  readonly occurredAt: string;
  readonly dataRevision: number;
  readonly itemId: InventoryItemId;
  readonly revisionId: ItemRevisionId;
}
