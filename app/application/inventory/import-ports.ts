import type { ChessTreeCandidate } from '../../domain/inventory/chess-tree-candidate.ts';
import type {
  CheckImportNamesRequest,
  ImportCandidateSelection,
  ImportEncoding,
  ImportFolderDestination,
  ImportInputDescriptor,
  ImportNameChecks,
  ImportPublished,
} from './import-models.ts';

export interface AcquiredImportInput extends ImportInputDescriptor {
  readonly chunks: AsyncIterable<string>;
  close(): Promise<void>;
}

export interface SourceAcquisitionPort {
  registerLocalFile(inputLocator: string): Promise<ImportInputDescriptor>;
  acquire(
    inputHandle: string,
    encoding: ImportEncoding,
    signal: AbortSignal,
  ): Promise<AcquiredImportInput>;
  forget(inputHandle: string): void;
}

export interface ImportRepository {
  checkImportNames(request: CheckImportNamesRequest): Promise<ImportNameChecks>;
  /** Inserts ordinary inventory objects and an optional new folder atomically. */
  publishImport(request: {
    readonly candidates: readonly (ImportCandidateSelection & {
      readonly content: ChessTreeCandidate;
    })[];
    readonly folder: ImportFolderDestination;
    readonly languageTag: string;
    readonly occurredAt: string;
  }): Promise<ImportPublished>;
}
