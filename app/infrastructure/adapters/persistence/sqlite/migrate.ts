import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { SqlitePersistenceProblem } from './sqlite-persistence-problem.ts';

interface Migration {
  readonly id: number;
  readonly sql: string;
  readonly checksum: Buffer;
}

const migrations = [
  loadMigration(1, './migrations/001-user-preferences.sql'),
  loadMigration(2, './migrations/002-analysis-workspace.sql'),
  loadMigration(3, './migrations/003-analysis-contributions.sql'),
  loadMigration(4, './migrations/004-stable-analysis-scratch-identity.sql'),
] satisfies readonly Migration[];

export function migrateStore(
  database: Database.Database,
  isNewStore: boolean,
  now: string,
): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    let schemaVersion: number;
    if (isNewStore) {
      schemaVersion = initializeStore(database, now);
    } else {
      schemaVersion = validateStore(database);
    }

    for (const migration of migrations.slice(schemaVersion)) {
      applyMigration(database, migration, now);
    }

    validateStore(database, migrations.length);
    database.exec('COMMIT');
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK');
    if (error instanceof SqlitePersistenceProblem) throw error;
    throw new SqlitePersistenceProblem('persistence.incompatible_store');
  }
}

function initializeStore(database: Database.Database, now: string): number {
  const firstMigration = migrations[0];
  if (firstMigration === undefined) {
    throw new SqlitePersistenceProblem('persistence.incompatible_store');
  }

  database.exec(firstMigration.sql);
  database
    .prepare(
      `INSERT INTO runtime_store_state
         (store_state_id, schema_version, data_revision,
          search_projection_version, search_state, updated_at_utc)
       VALUES (1, 1, 0, 0, 'ready', ?)`,
    )
    .run(now);
  database
    .prepare(
      `INSERT INTO preference_state
         (preference_state_id, ui_locale, preference_revision, updated_at_utc)
       VALUES (1, 'de-DE', 1, ?)`,
    )
    .run(now);
  recordMigration(database, firstMigration, now);
  return firstMigration.id;
}

function applyMigration(
  database: Database.Database,
  migration: Migration,
  now: string,
): void {
  database.exec(migration.sql);
  database
    .prepare(
      `UPDATE runtime_store_state
          SET schema_version = ?, updated_at_utc = ?
        WHERE store_state_id = 1`,
    )
    .run(migration.id, now);
  recordMigration(database, migration, now);
}

function recordMigration(
  database: Database.Database,
  migration: Migration,
  now: string,
): void {
  database
    .prepare(
      `INSERT INTO runtime_schema_migration
         (migration_id, checksum_sha256, applied_at_utc)
       VALUES (?, ?, ?)`,
    )
    .run(migration.id, migration.checksum, now);
}

function validateStore(
  database: Database.Database,
  expectedSchemaVersion?: number,
): number {
  const store = database
    .prepare(
      'SELECT schema_version, data_revision FROM runtime_store_state WHERE store_state_id = 1',
    )
    .get() as { schema_version: number; data_revision: number } | undefined;
  const preference = database
    .prepare(
      'SELECT ui_locale, preference_revision FROM preference_state WHERE preference_state_id = 1',
    )
    .get() as { ui_locale: string; preference_revision: number } | undefined;
  if (store === undefined || preference === undefined) {
    throw new SqlitePersistenceProblem('persistence.incompatible_store');
  }

  const schemaVersion = store.schema_version;
  const preferenceRevision = preference.preference_revision;
  if (
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion < 1 ||
    schemaVersion > migrations.length ||
    (expectedSchemaVersion !== undefined &&
      schemaVersion !== expectedSchemaVersion) ||
    !Number.isSafeInteger(store.data_revision) ||
    store.data_revision < 0 ||
    !['de-DE', 'en-GB'].includes(preference.ui_locale) ||
    !Number.isSafeInteger(preferenceRevision) ||
    preferenceRevision < 1
  ) {
    throw new SqlitePersistenceProblem('persistence.incompatible_store');
  }

  validateMigrationHistory(database, schemaVersion);

  const check = database.pragma('quick_check', { simple: true });
  const foreignKeyViolations = database.pragma('foreign_key_check');
  if (
    check !== 'ok' ||
    !Array.isArray(foreignKeyViolations) ||
    foreignKeyViolations.length !== 0
  ) {
    throw new SqlitePersistenceProblem('persistence.incompatible_store');
  }
  return schemaVersion;
}

function validateMigrationHistory(
  database: Database.Database,
  schemaVersion: number,
): void {
  const applied = database
    .prepare(
      `SELECT migration_id, checksum_sha256
         FROM runtime_schema_migration
        ORDER BY migration_id`,
    )
    .all() as { migration_id: number; checksum_sha256: Buffer }[];
  if (applied.length !== schemaVersion) {
    throw new SqlitePersistenceProblem('persistence.incompatible_store');
  }

  for (const [index, row] of applied.entries()) {
    const expected = migrations[index];
    if (
      expected === undefined ||
      row.migration_id !== expected.id ||
      !Buffer.isBuffer(row.checksum_sha256) ||
      !row.checksum_sha256.equals(expected.checksum)
    ) {
      throw new SqlitePersistenceProblem('persistence.incompatible_store');
    }
  }
}

function loadMigration(id: number, relativeUrl: string): Migration {
  const sql = readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
  // Line-ending normalization keeps migration identity stable on Windows.
  const checksum = createHash('sha256')
    .update(sql.replaceAll('\r\n', '\n'))
    .digest();
  return Object.freeze({ id, sql, checksum });
}
