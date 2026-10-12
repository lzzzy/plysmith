export interface InventoryBackupCounts {
  readonly analyses: number;
  readonly games: number;
  readonly folders: number;
  readonly provenanceRecords: number;
  readonly contributions: number;
}

export interface InventoryBackupStatus {
  readonly canRestore: boolean;
  readonly blockerCodes: readonly string[];
  readonly suggestedFileName: string;
}

export interface InventoryBackupCreated {
  readonly fileName: string;
  readonly counts: InventoryBackupCounts;
  readonly bytes: number;
  readonly snapshotDataRevision: number;
}

export interface InventoryRestorePreview {
  readonly restoreId: string;
  readonly fingerprint: string;
  readonly counts: InventoryBackupCounts;
  readonly expiresAt: string;
}

export interface InventoryRestored {
  readonly counts: InventoryBackupCounts;
  readonly dataRevision: number;
  readonly noOp: boolean;
}
