import type {
  InventoryFolderId,
  InventoryItemId,
  WorkingContextId,
} from '../../domain/identity/index.ts';
import type { InventoryFolder } from '../../domain/inventory/index.ts';
import type { ContextWorkLosses } from '../workspace/index.ts';
import type { InventoryItemUsageSummary } from './inventory-models.ts';

export interface GetInventoryOrganizationRequest {
  readonly contextId?: WorkingContextId;
}

export interface InventoryOrganization {
  readonly folders: readonly (InventoryFolder & {
    readonly itemCount: number;
    readonly contextLinkCount: number;
    readonly contextItemCount?: number;
  })[];
  readonly linkedFolderIds: readonly InventoryFolderId[];
  readonly dataRevision: number;
}

export type InventoryOrganizationChange =
  | {
      readonly kind: 'create_folder';
      readonly displayName: string;
      readonly parentFolderId?: InventoryFolderId;
    }
  | {
      readonly kind: 'rename_folder';
      readonly folderId: InventoryFolderId;
      readonly displayName: string;
    }
  | {
      readonly kind: 'move_folder';
      readonly folderId: InventoryFolderId;
      readonly parentFolderId?: InventoryFolderId;
    }
  | { readonly kind: 'delete_folder'; readonly folderId: InventoryFolderId }
  | {
      readonly kind: 'move_items';
      readonly itemIds: readonly InventoryItemId[];
      readonly folderId?: InventoryFolderId;
      readonly contextId?: WorkingContextId;
      readonly workContextId?: WorkingContextId;
    }
  | {
      readonly kind: 'include_folder';
      readonly folderId: InventoryFolderId;
      readonly contextId: WorkingContextId;
      readonly includeItems: boolean;
    }
  | {
      readonly kind: 'remove_context_folder';
      readonly folderId: InventoryFolderId;
      readonly contextId: WorkingContextId;
    };

export interface ChangeInventoryOrganizationRequest {
  readonly expectedDataRevision: number;
  readonly change: InventoryOrganizationChange;
}

export interface ChangeInventoryOrganizationResult {
  readonly dataRevision: number;
  readonly folderId?: InventoryFolderId;
}

export interface InventoryOrganizationChanged extends ChangeInventoryOrganizationResult {
  readonly kind: 'inventory.organization-changed';
  readonly occurredAt: string;
  readonly contextId?: WorkingContextId;
  readonly itemIds?: readonly InventoryItemId[];
}

export interface PreviewContextFolderRemovalRequest {
  readonly folderId: InventoryFolderId;
  readonly contextId: WorkingContextId;
}

export interface ContextFolderRemovalPreview extends PreviewContextFolderRemovalRequest {
  readonly folderIds: readonly InventoryFolderId[];
  readonly linkedFolderIds: readonly InventoryFolderId[];
  readonly itemIds: readonly InventoryItemId[];
  readonly loss: InventoryItemUsageSummary;
  readonly losses: ContextWorkLosses;
  readonly dataRevision: number;
}

export interface CheckInventoryNameAvailabilityRequest {
  readonly displayName: string;
  readonly excludingItemId?: InventoryItemId;
}

export interface InventoryNameAvailability {
  readonly displayName: string;
  readonly available: boolean;
  readonly suggestedDisplayName: string;
  readonly dataRevision: number;
}
