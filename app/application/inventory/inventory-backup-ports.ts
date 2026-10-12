import type {
  InventoryTransferSnapshot,
  PreparedInventoryRestore,
} from './pgn-transfer-models.ts';

export interface PgnTransferCodecPort {
  encode(
    snapshot: InventoryTransferSnapshot,
    signal: AbortSignal,
    checkBudget: () => void,
  ): Promise<Uint8Array>;
  decode(
    bytes: Uint8Array,
    signal: AbortSignal,
    checkBudget: () => void,
  ): Promise<PreparedInventoryRestore>;
}

export interface InventoryBackupFilePort {
  read(
    inputLocator: string,
    signal: AbortSignal,
    checkBudget: () => void,
  ): Promise<{ readonly bytes: Uint8Array; readonly fingerprint: string }>;
  write(
    destinationPath: string,
    bytes: Uint8Array,
    signal: AbortSignal,
    checkBudget: () => void,
  ): Promise<{ readonly fileName: string }>;
}
