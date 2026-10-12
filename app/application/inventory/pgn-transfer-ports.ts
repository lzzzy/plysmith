import type {
  InventoryTransferSnapshot,
  PreparedInventoryRestore,
} from './pgn-transfer-models.ts';

export interface InventoryTransferRepository {
  readPgnTransferSnapshot(
    checkBudget: () => void,
  ): Promise<InventoryTransferSnapshot>;
  inspectFreshRestoreTarget(): Promise<{
    canRestore: boolean;
    blockerCodes: readonly string[];
  }>;
  restorePgnTransfer(
    prepared: PreparedInventoryRestore,
    occurredAt: string,
    checkBudget: () => void,
  ): Promise<{ dataRevision: number; noOp: boolean }>;
}
