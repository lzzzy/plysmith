import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import Database from 'better-sqlite3';
import type { ImportRepository } from '../../../../application/inventory/import-ports.ts';
import * as imports from './sqlite-import.ts';
import type {
  AnalysisRecordWriter,
  FreeAnalysisPersistence,
  AnalysisNoteWriter,
  ContextAnalysisReader,
  ContextAnalysisWriter,
  PersistAnalysisNoteRequest,
  PersistDeleteAnalysisNoteRequest,
  PersistPositionNoteRequest,
  PersistAnalysisRecordRequest,
  PersistUpdateAnalysisNoteRequest,
} from '../../../../application/analysis/index.ts';
import type {
  InventoryReader,
  InventoryOrganizationReader,
  InventoryOrganizationWriter,
  InventoryNameAvailabilityReader,
  InventoryLifecycleReader,
  InventoryLifecycleWriter,
  InventoryRevisionReader,
  InventoryRevisionWriter,
  SearchInventoryRequest,
} from '../../../../application/inventory/index.ts';
import type {
  PlayoutReader,
  PlayoutWriter,
  PersistDiscardPlayoutRequest,
  PersistCompletePlayoutRequest,
  PersistReplacePlayoutRequest,
  PersistStartPlayoutRequest,
} from '../../../../application/playout/index.ts';
import { ApplicationProblem } from '../../../../application/problems/application-problem.ts';
import type {
  PreferencesTransaction,
  PreferencesUnitOfWork,
  UiLocale,
  UserPreferences,
  UserPreferencesReader,
} from '../../../../application/preferences/index.ts';
import type {
  StoreStatus,
  StoreStatusReader,
} from '../../../../application/system/index.ts';
import type {
  AddContextReferenceRequest,
  SetWorkScopeResumeRequest,
  SetManagementPresentationRequest,
  WorkingContextReader,
  WorkingContextWriter,
  StartupResumePort,
  WorkScopeWorkspaceReader,
  ContextRemovalPreviewReader,
  WorkingContextDeletionWriter,
} from '../../../../application/workspace/index.ts';
import type { AnalysisScratch } from '../../../../domain/analysis/index.ts';
import type {
  PlayoutDraftId,
  WorkingContextId,
} from '../../../../domain/identity/index.ts';
import type { WorkingContextDraft } from '../../../../domain/workspace/index.ts';
import { migrateStore } from './migrate.ts';
import {
  readInventoryOrganization,
  changeInventoryOrganization,
  previewContextFolderRemoval,
  checkInventoryNameAvailability,
} from './sqlite-inventory-organization.ts';
import {
  createAnalysisRecord as writeAnalysisRecord,
  readAnalysisRecordView,
} from './sqlite-analysis-record.ts';
import {
  createAnalysisNote as writeAnalysisNote,
  createPositionNote as writePositionNote,
  deleteAnalysisNote as writeDeleteAnalysisNote,
  updateAnalysisNote as writeUpdateAnalysisNote,
} from './sqlite-analysis-note.ts';
import {
  discardContextAnalysisScratch as discardAnalysisScratch,
  replaceContextAnalysisScratch as replaceAnalysisScratch,
} from './sqlite-analysis-scratch.ts';
import {
  readContextAnalysisWorkspace,
  readFreeAnalysisWorkspace,
} from './sqlite-context-analysis.ts';
import {
  previewInventoryItemDeletion,
  deleteInventoryItem as writeDeleteInventoryItem,
} from './sqlite-inventory-lifecycle.ts';
import { searchInventory as searchInventoryRows } from './sqlite-inventory.ts';
import {
  createPlayout as writePlayout,
  discardPlayout as writeDiscardPlayout,
  readPlayout as readPlayoutRow,
  replacePlayout as writeReplacePlayout,
  removeContextPlayoutDraft,
} from './sqlite-playout.ts';
import {
  completePlayout as writeCompletePlayout,
  readPlayoutCompletion as readPlayoutCompletionRow,
} from './sqlite-game-record.ts';
import {
  listInventoryRevisions as listInventoryRevisionRows,
  previewInventoryRevision as previewInventoryRevisionRows,
  readAnalysisRevision as readAnalysisRevisionRow,
  saveInventoryRevision as writeInventoryRevision,
} from './sqlite-inventory-revision.ts';
import {
  readPendingRevisionImpact as readPendingRevisionImpactRow,
  resolvePendingRevisionImpact as writeRevisionImpactResolution,
} from './sqlite-revision-impact.ts';
import { SqlitePersistenceProblem } from './sqlite-persistence-problem.ts';
import {
  addContextReference as writeContextReference,
  createWorkingContext as writeWorkingContext,
  updateWorkingContextMetadata as writeWorkingContextMetadata,
  listWorkingContexts as listContextRows,
  readWorkingContextWorkspace,
  removeContextItem as writeRemoveContextItem,
  setWorkScopeResume as writeWorkScopeResume,
  setManagementPresentation as writeManagementPresentation,
  readWorkScopeWorkspace,
  readStartupResume,
  setStartupResume as writeStartupResume,
  previewContextItemRemoval,
  previewWorkingContextDeletion,
  deleteWorkingContext as writeDeleteWorkingContext,
} from './sqlite-workspace.ts';

const readPreferencesSql = `
  SELECT p.ui_locale AS uiLocale,
         p.preference_revision AS preferenceRevision,
         s.data_revision AS dataRevision,
         p.updated_at_utc AS updatedAt
    FROM preference_state AS p
    JOIN runtime_store_state AS s ON s.store_state_id = 1
   WHERE p.preference_state_id = 1`;

export interface SqlitePersistenceOptions {
  readonly databasePath: string;
  readonly now?: () => string;
}

export class SqlitePersistenceAdapter
  implements
    ImportRepository,
    UserPreferencesReader,
    PreferencesUnitOfWork,
    StoreStatusReader,
    InventoryReader,
    InventoryOrganizationReader,
    InventoryOrganizationWriter,
    InventoryNameAvailabilityReader,
    InventoryLifecycleReader,
    InventoryLifecycleWriter,
    StartupResumePort,
    WorkScopeWorkspaceReader,
    ContextRemovalPreviewReader,
    WorkingContextDeletionWriter,
    FreeAnalysisPersistence,
    InventoryRevisionReader,
    InventoryRevisionWriter,
    WorkingContextReader,
    WorkingContextWriter,
    ContextAnalysisReader,
    ContextAnalysisWriter,
    AnalysisNoteWriter,
    AnalysisRecordWriter,
    PlayoutReader,
    PlayoutWriter
{
  readonly #databasePath: string;
  readonly #writer: Database.Database;
  #tail: Promise<void> = Promise.resolve();
  #closing = false;
  #closePromise: Promise<void> | undefined;
  #inWork = false;

  constructor(options: SqlitePersistenceOptions) {
    if (!isAbsolute(options.databasePath)) {
      throw new SqlitePersistenceProblem('persistence.startup_failed');
    }
    this.#databasePath = options.databasePath;
    const isNewStore = !existsSync(options.databasePath);
    let writer: Database.Database | undefined;
    try {
      mkdirSync(dirname(options.databasePath), { recursive: true });
      writer = new Database(options.databasePath, { timeout: 1000 });
      verifySqliteRuntime(writer);
      writer.pragma('journal_mode = WAL');
      configureConnection(writer);
      migrateStore(
        writer,
        isNewStore,
        (options.now ?? (() => new Date().toISOString()))(),
      );
      this.#writer = writer;
    } catch (error) {
      writer?.close();
      if (error instanceof ApplicationProblem) throw error;
      throw new SqlitePersistenceProblem('persistence.startup_failed', error);
    }
  }

  async readUserPreferences(): Promise<UserPreferences> {
    return this.#readSnapshot((reader) => readPreferences(reader));
  }

  async checkImportNames(
    request: Parameters<ImportRepository['checkImportNames']>[0],
  ) {
    return this.#readSnapshot((reader) =>
      imports.checkImportNames(reader, request),
    );
  }

  publishImport(request: Parameters<ImportRepository['publishImport']>[0]) {
    return this.#enqueueWrite(() =>
      imports.publishImport(this.#writer, request),
    );
  }

  async readInventoryOrganization(
    request: Parameters<
      InventoryOrganizationReader['readInventoryOrganization']
    >[0],
  ) {
    return this.#readSnapshot((reader) =>
      readInventoryOrganization(reader, request),
    );
  }

  async previewContextFolderRemoval(
    request: Parameters<
      InventoryOrganizationReader['previewContextFolderRemoval']
    >[0],
  ) {
    return this.#readSnapshot((reader) =>
      previewContextFolderRemoval(reader, request),
    );
  }

  async checkInventoryNameAvailability(
    request: Parameters<
      InventoryNameAvailabilityReader['checkInventoryNameAvailability']
    >[0],
  ) {
    return this.#readSnapshot((reader) =>
      checkInventoryNameAvailability(reader, request),
    );
  }

  changeInventoryOrganization(
    request: Parameters<
      InventoryOrganizationWriter['changeInventoryOrganization']
    >[0],
    occurredAt: string,
  ) {
    return this.#enqueueWrite(() =>
      changeInventoryOrganization(this.#writer, request, occurredAt),
    );
  }

  async previewInventoryItemDeletion(
    request: Parameters<
      InventoryLifecycleReader['previewInventoryItemDeletion']
    >[0],
  ) {
    return this.#readSnapshot((reader) =>
      previewInventoryItemDeletion(reader, request),
    );
  }

  deleteInventoryItem(
    request: Parameters<InventoryLifecycleWriter['deleteInventoryItem']>[0],
    occurredAt: string,
  ) {
    return this.#enqueueWrite(() =>
      writeDeleteInventoryItem(this.#writer, request, occurredAt),
    );
  }

  async readWorkScopeWorkspace(
    scope: Parameters<WorkScopeWorkspaceReader['readWorkScopeWorkspace']>[0],
  ) {
    return this.#readSnapshot((reader) =>
      readWorkScopeWorkspace(reader, scope),
    );
  }

  async readStartupResume() {
    return this.#readSnapshot(readStartupResume);
  }

  setStartupResume(
    request: Parameters<StartupResumePort['setStartupResume']>[0],
    occurredAt: string,
  ) {
    return this.#enqueueWrite(() =>
      writeStartupResume(this.#writer, request, occurredAt),
    );
  }

  async previewContextItemRemoval(
    request: Parameters<
      ContextRemovalPreviewReader['previewContextItemRemoval']
    >[0],
  ) {
    return this.#readSnapshot((reader) =>
      previewContextItemRemoval(reader, request),
    );
  }

  async previewWorkingContextDeletion(
    request: Parameters<
      ContextRemovalPreviewReader['previewWorkingContextDeletion']
    >[0],
  ) {
    return this.#readSnapshot((reader) =>
      previewWorkingContextDeletion(reader, request),
    );
  }

  deleteWorkingContext(
    request: Parameters<
      WorkingContextDeletionWriter['deleteWorkingContext']
    >[0],
    occurredAt: string,
  ) {
    return this.#enqueueWrite(() => {
      let removedPlayoutDraftId: PlayoutDraftId | null = null;
      const result = writeDeleteWorkingContext(
        this.#writer,
        request,
        occurredAt,
        (contextId) => {
          removedPlayoutDraftId =
            readPlayoutRow(this.#writer, { kind: 'context', contextId })?.draft
              .draftId ?? null;
          removeContextPlayoutDraft(this.#writer, contextId.value);
        },
      );
      return { ...result, removedPlayoutDraftId };
    });
  }

  async readFreeAnalysisWorkspace() {
    return this.#readSnapshot(readFreeAnalysisWorkspace);
  }

  replaceFreeAnalysisScratch(
    request: Parameters<
      FreeAnalysisPersistence['replaceFreeAnalysisScratch']
    >[0],
  ) {
    return this.#enqueueWrite(() =>
      replaceAnalysisScratch(this.#writer, { ...request, contextId: null }),
    );
  }

  discardFreeAnalysisScratch(
    request: Parameters<
      FreeAnalysisPersistence['discardFreeAnalysisScratch']
    >[0],
  ) {
    return this.#enqueueWrite(() =>
      discardAnalysisScratch(this.#writer, { ...request, contextId: null }),
    );
  }

  async readStoreStatus(): Promise<StoreStatus> {
    return this.#readSnapshot((reader) => {
      const row = reader
        .prepare(
          `SELECT schema_version AS schemaVersion, data_revision AS dataRevision
             FROM runtime_store_state WHERE store_state_id = 1`,
        )
        .get() as StoreStatus | undefined;
      if (row === undefined) {
        throw new SqlitePersistenceProblem('persistence.incompatible_store');
      }
      return Object.freeze({ ...row });
    });
  }

  async searchInventory(
    request: Required<Pick<SearchInventoryRequest, 'pageSize'>> &
      Omit<SearchInventoryRequest, 'pageSize'>,
  ) {
    return this.#readSnapshot((reader) => searchInventoryRows(reader, request));
  }

  async readAnalysisRevision(
    request: Parameters<InventoryRevisionReader['readAnalysisRevision']>[0],
  ) {
    return this.#readSnapshot((reader) =>
      readAnalysisRevisionRow(reader, request),
    );
  }

  async previewInventoryRevision(
    request: Parameters<InventoryRevisionReader['previewInventoryRevision']>[0],
  ) {
    return this.#readSnapshot((reader) =>
      previewInventoryRevisionRows(reader, request),
    );
  }

  async listInventoryRevisions(
    request: Parameters<InventoryRevisionReader['listInventoryRevisions']>[0],
  ) {
    return this.#readSnapshot((reader) =>
      listInventoryRevisionRows(reader, request),
    );
  }

  async readPendingRevisionImpact(
    impactId: Parameters<
      InventoryRevisionReader['readPendingRevisionImpact']
    >[0],
  ) {
    return this.#readSnapshot((reader) =>
      readPendingRevisionImpactRow(reader, impactId),
    );
  }

  async listWorkingContexts(request: {
    readonly pageSize: number;
    readonly cursor?: string;
  }) {
    return this.#readSnapshot((reader) => listContextRows(reader, request));
  }

  async readWorkingContextWorkspace(contextId: WorkingContextId) {
    return this.#readSnapshot((reader) =>
      readWorkingContextWorkspace(reader, contextId),
    );
  }

  async readContextAnalysisWorkspace(contextId: WorkingContextId) {
    return this.#readSnapshot((reader) =>
      readContextAnalysisWorkspace(reader, contextId),
    );
  }

  async readAnalysisRecord(
    request: Parameters<ContextAnalysisReader['readAnalysisRecord']>[0],
  ) {
    return this.#readSnapshot((reader) =>
      readAnalysisRecordView(reader, request),
    );
  }

  async readPlayout(scope: Parameters<PlayoutReader['readPlayout']>[0]) {
    return this.#readSnapshot((reader) => readPlayoutRow(reader, scope));
  }

  async readPlayoutCompletion(
    request: Parameters<PlayoutReader['readPlayoutCompletion']>[0],
  ) {
    return this.#readSnapshot((reader) =>
      readPlayoutCompletionRow(reader, request),
    );
  }

  updateWorkingContextMetadata(
    request: Parameters<
      WorkingContextWriter['updateWorkingContextMetadata']
    >[0],
    occurredAt: string,
  ) {
    return this.#enqueueWrite(() =>
      writeWorkingContextMetadata(this.#writer, request, occurredAt),
    );
  }

  createWorkingContext(draft: WorkingContextDraft, occurredAt: string) {
    return this.#enqueueWrite(() =>
      writeWorkingContext(this.#writer, draft, occurredAt),
    );
  }

  addContextReference(request: AddContextReferenceRequest, occurredAt: string) {
    return this.#enqueueWrite(() =>
      writeContextReference(this.#writer, request, occurredAt),
    );
  }

  removeContextItem(
    request: Parameters<WorkingContextWriter['removeContextItem']>[0],
    occurredAt: string,
  ) {
    return this.#enqueueWrite(() =>
      writeRemoveContextItem(this.#writer, request, occurredAt),
    );
  }

  setWorkScopeResume(request: SetWorkScopeResumeRequest, occurredAt: string) {
    return this.#enqueueWrite(() =>
      writeWorkScopeResume(this.#writer, request, occurredAt),
    );
  }

  setManagementPresentation(
    request: SetManagementPresentationRequest,
    occurredAt: string,
  ) {
    return this.#enqueueWrite(() =>
      writeManagementPresentation(this.#writer, request, occurredAt),
    );
  }

  replaceContextAnalysisScratch(request: {
    readonly contextId: WorkingContextId;
    readonly expectedScratchId: string | null;
    readonly expectedScratchRevision: number | null;
    readonly scratch: AnalysisScratch;
    readonly occurredAt: string;
  }) {
    return this.#enqueueWrite(() =>
      replaceAnalysisScratch(this.#writer, request),
    );
  }

  discardContextAnalysisScratch(request: {
    readonly contextId: WorkingContextId;
    readonly expectedScratchId: string;
    readonly expectedScratchRevision: number;
    readonly occurredAt: string;
  }) {
    return this.#enqueueWrite(() =>
      discardAnalysisScratch(this.#writer, request),
    );
  }

  createAnalysisRecord(request: PersistAnalysisRecordRequest) {
    return this.#enqueueWrite(() => writeAnalysisRecord(this.#writer, request));
  }

  createPlayout(request: PersistStartPlayoutRequest) {
    return this.#enqueueWrite(() => writePlayout(this.#writer, request));
  }

  replacePlayout(request: PersistReplacePlayoutRequest) {
    return this.#enqueueWrite(() => writeReplacePlayout(this.#writer, request));
  }

  discardPlayout(request: PersistDiscardPlayoutRequest) {
    return this.#enqueueWrite(() => writeDiscardPlayout(this.#writer, request));
  }

  completePlayout(request: PersistCompletePlayoutRequest) {
    return this.#enqueueWrite(() =>
      writeCompletePlayout(this.#writer, request),
    );
  }

  createAnalysisNote(request: PersistAnalysisNoteRequest) {
    return this.#enqueueWrite(() => writeAnalysisNote(this.#writer, request));
  }

  createPositionNote(request: PersistPositionNoteRequest) {
    return this.#enqueueWrite(() => writePositionNote(this.#writer, request));
  }

  updateAnalysisNote(request: PersistUpdateAnalysisNoteRequest) {
    return this.#enqueueWrite(() =>
      writeUpdateAnalysisNote(this.#writer, request),
    );
  }

  deleteAnalysisNote(request: PersistDeleteAnalysisNoteRequest) {
    return this.#enqueueWrite(() =>
      writeDeleteAnalysisNote(this.#writer, request),
    );
  }

  saveInventoryRevision(
    request: Parameters<InventoryRevisionWriter['saveInventoryRevision']>[0],
  ) {
    return this.#enqueueWrite(() =>
      writeInventoryRevision(this.#writer, request),
    );
  }

  resolvePendingRevisionImpact(
    request: Parameters<
      InventoryRevisionWriter['resolvePendingRevisionImpact']
    >[0],
    occurredAt: string,
  ) {
    return this.#enqueueWrite(() =>
      writeRevisionImpactResolution(this.#writer, request, occurredAt),
    );
  }

  run<T>(work: (transaction: PreferencesTransaction) => T): Promise<T> {
    // Enqueue the entire unit of work, including the guarded revision read.
    if (this.#inWork) {
      throw new Error('Nested persistence transactions are not supported.');
    }
    if (this.#closing) {
      return Promise.reject(new SqlitePersistenceProblem('persistence.closed'));
    }
    return this.#enqueueWrite(() => this.#runPreferencesWork(work));
  }

  #enqueueWrite<T>(work: () => T): Promise<T> {
    if (this.#inWork) {
      throw new Error('Nested persistence transactions are not supported.');
    }
    if (this.#closing) {
      return Promise.reject(new SqlitePersistenceProblem('persistence.closed'));
    }
    const result = this.#tail.then(() => this.#executeWrite(work));
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    this.#closing = true;
    this.#closePromise = this.#tail.then(() => {
      this.#writer.close();
    });
    return this.#closePromise;
  }

  #runPreferencesWork<T>(work: (transaction: PreferencesTransaction) => T): T {
    let active = true;
    let changed = false;
    const assertActive = (): void => {
      if (!active) throw new Error('The transaction scope has ended.');
    };
    const transaction: PreferencesTransaction = {
      getUserPreferences: () => {
        assertActive();
        return readPreferences(this.#writer);
      },
      setUiLanguage: (uiLocale: UiLocale, updatedAt: string) => {
        assertActive();
        if (changed)
          throw new Error('A preference command may write only once.');
        const current = readPreferences(this.#writer);
        if (current.uiLocale === uiLocale) return current;
        this.#writer
          .prepare(
            `UPDATE preference_state
                SET ui_locale = ?, preference_revision = preference_revision + 1,
                    updated_at_utc = ?
              WHERE preference_state_id = 1`,
          )
          .run(uiLocale, updatedAt);
        this.#writer
          .prepare(
            `UPDATE runtime_store_state
                SET data_revision = data_revision + 1, updated_at_utc = ?
              WHERE store_state_id = 1`,
          )
          .run(updatedAt);
        changed = true;
        return readPreferences(this.#writer);
      },
    };

    try {
      return work(transaction);
    } finally {
      active = false;
    }
  }

  #executeWrite<T>(work: () => T): T {
    try {
      this.#writer.exec('BEGIN IMMEDIATE');
      this.#inWork = true;
      const result = work();
      if (isThenable(result)) {
        // Consume a possible rejection; asynchronous work cannot retain a
        // live transaction or continue after rollback.
        void Promise.resolve(result).catch(() => undefined);
        throw new Error('Transaction work must be synchronous.');
      }
      this.#writer.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.#writer.inTransaction) this.#writer.exec('ROLLBACK');
      if (error instanceof ApplicationProblem) throw error;
      throw new SqlitePersistenceProblem('persistence.unavailable', error);
    } finally {
      this.#inWork = false;
    }
  }

  #readSnapshot<T>(query: (reader: Database.Database) => T): T {
    if (this.#closing) throw new SqlitePersistenceProblem('persistence.closed');
    let reader: Database.Database | undefined;
    try {
      reader = new Database(this.#databasePath, {
        readonly: true,
        fileMustExist: true,
        timeout: 1000,
      });
      configureConnection(reader);
      reader.exec('BEGIN');
      const result = query(reader);
      reader.exec('COMMIT');
      return result;
    } catch (error) {
      if (error instanceof ApplicationProblem) throw error;
      throw new SqlitePersistenceProblem('persistence.unavailable', error);
    } finally {
      if (reader?.inTransaction) reader.exec('ROLLBACK');
      reader?.close();
    }
  }
}

function readPreferences(database: Database.Database): UserPreferences {
  const row = database.prepare(readPreferencesSql).get() as
    UserPreferences | undefined;
  if (row === undefined) {
    throw new SqlitePersistenceProblem('persistence.incompatible_store');
  }
  return Object.freeze({ ...row });
}

function configureConnection(database: Database.Database): void {
  database.pragma('foreign_keys = ON');
  database.pragma('synchronous = FULL');
  if (
    database.pragma('foreign_keys', { simple: true }) !== 1 ||
    database.pragma('synchronous', { simple: true }) !== 2 ||
    database.pragma('journal_mode', { simple: true }) !== 'wal'
  ) {
    throw new SqlitePersistenceProblem('persistence.startup_failed');
  }
}

function verifySqliteRuntime(database: Database.Database): void {
  const row = database.prepare('SELECT sqlite_version() AS version').get() as {
    version: string;
  };
  const [major = 0, minor = 0, patch = 0] = row.version.split('.').map(Number);
  if (
    major < 3 ||
    (major === 3 && (minor < 53 || (minor === 53 && patch < 4)))
  ) {
    throw new SqlitePersistenceProblem('persistence.unsupported_runtime');
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  );
}
