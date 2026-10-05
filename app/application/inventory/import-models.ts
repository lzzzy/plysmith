import type {
  ChessTreeCandidate,
  ImportFidelityFinding,
} from '../../domain/inventory/chess-tree-candidate.ts';
import type {
  InventoryFolderId,
  InventoryItemId,
  ItemRevisionId,
} from '../../domain/identity/index.ts';

export type ImportEncoding = 'utf-8' | 'iso-8859-1';
export type ImportItemType = 'analysis' | 'game';

export interface ImportInputDescriptor {
  readonly inputHandle: string;
  readonly displayName: string;
  readonly inputSize: number;
}

export type ImportFolderDestination =
  | { readonly kind: 'unfiled' }
  | { readonly kind: 'existing'; readonly folderId: InventoryFolderId }
  | {
      readonly kind: 'new';
      readonly displayName: string;
      readonly parentFolderId?: InventoryFolderId;
    };

export interface ImportCandidateSelection {
  readonly sourceOrder: number;
  readonly itemType: ImportItemType;
  /** Complete user-selected inventory name, including any common prefix. */
  readonly displayName: string;
}

export interface ImportCandidatePreview {
  readonly sourceOrder: number;
  readonly status: ChessTreeCandidate['status'];
  readonly suggestedName: string;
  readonly moveCount: number;
  readonly variationCount: number;
  readonly rootFen?: string;
  readonly findings: readonly ImportFidelityFinding[];
}

/** Available only for the current host session; never stored in the inventory. */
export interface ImportPreview {
  readonly previewId: string;
  readonly sourceDisplayName: string;
  readonly inputSize: number;
  readonly encoding: ImportEncoding;
  readonly formatId: string;
  readonly candidates: readonly ImportCandidatePreview[];
}

export interface PrepareImportRequest {
  readonly inputHandle: string;
  readonly encoding?: ImportEncoding;
  readonly languageTag: string;
  readonly formatId?: string;
}

export interface CheckImportNamesRequest {
  readonly candidates: readonly Pick<
    ImportCandidateSelection,
    'sourceOrder' | 'displayName'
  >[];
}

export interface ImportNameChecks {
  readonly candidates: readonly {
    readonly sourceOrder: number;
    readonly displayName: string;
    readonly available: boolean;
    readonly suggestedDisplayName: string;
  }[];
  readonly dataRevision: number;
}

export interface PublishImportRequest {
  readonly previewId: string;
  readonly candidates: readonly ImportCandidateSelection[];
  readonly folder: ImportFolderDestination;
  readonly confirmWarnings: boolean;
}

export interface ImportPublished {
  readonly items: readonly {
    readonly itemId: InventoryItemId;
    readonly revisionId: ItemRevisionId;
    readonly sourceOrder: number;
  }[];
  readonly folderId?: InventoryFolderId;
  readonly dataRevision: number;
}

export interface DiscardImportResult {
  readonly discarded: boolean;
}
