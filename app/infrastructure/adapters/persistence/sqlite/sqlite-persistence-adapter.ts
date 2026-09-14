import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import Database from 'better-sqlite3';
import type {
  AnalysisRecordWriter,
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
  SearchInventoryRequest,
} from '../../../../application/inventory/index.ts';
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
  WorkingContextReader,
  WorkingContextWriter,
} from '../../../../application/workspace/index.ts';
import type { AnalysisScratch } from '../../../../domain/analysis/index.ts';
import type { WorkingContextId } from '../../../../domain/identity/index.ts';
import type { WorkingContextDraft } from '../../../../domain/workspace/index.ts';
import { migrateStore } from './migrate.ts';
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
import { readContextAnalysisWorkspace } from './sqlite-context-analysis.ts';
import { searchInventory as searchInventoryRows } from './sqlite-inventory.ts';
import { SqlitePersistenceProblem } from './sqlite-persistence-problem.ts';
import {
  addContextReference as writeContextReference,
  createWorkingContext as writeWorkingContext,
  listWorkingContexts as listContextRows,
  readWorkingContextWorkspace,
  setWorkScopeResume as writeWorkScopeResume,
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
    UserPreferencesReader,
    PreferencesUnitOfWork,
    StoreStatusReader,
    InventoryReader,
    WorkingContextReader,
    WorkingContextWriter,
    ContextAnalysisReader,
    ContextAnalysisWriter,
    AnalysisNoteWriter,
    AnalysisRecordWriter
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
      throw new SqlitePersistenceProblem('persistence.startup_failed');
    }
  }

  async readUserPreferences(): Promise<UserPreferences> {
    return this.#readSnapshot((reader) => readPreferences(reader));
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

  setWorkScopeResume(request: SetWorkScopeResumeRequest, occurredAt: string) {
    return this.#enqueueWrite(() =>
      writeWorkScopeResume(this.#writer, request, occurredAt),
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
      throw new SqlitePersistenceProblem('persistence.unavailable');
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
      throw new SqlitePersistenceProblem('persistence.unavailable');
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
