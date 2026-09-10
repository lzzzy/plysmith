import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { SqlitePersistenceProblem } from './sqlite-persistence-problem.ts';

export function migrateStore(
  database: Database.Database,
  isNewStore: boolean,
  now: string,
): void {
  const sql = readFileSync(
    new URL('./migrations/001-user-preferences.sql', import.meta.url),
    'utf8',
  );
  // Line-ending normalization keeps the migration identity stable on Windows.
  const checksum = createHash('sha256')
    .update(sql.replaceAll('\r\n', '\n'))
    .digest();

  database.exec('BEGIN IMMEDIATE');
  try {
    if (isNewStore) {
      database.exec(sql);
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
      database
        .prepare(
          `INSERT INTO runtime_schema_migration
             (migration_id, checksum_sha256, applied_at_utc)
           VALUES (1, ?, ?)`,
        )
        .run(checksum, now);
    }

    validateStore(database, checksum);
    database.exec('COMMIT');
  } catch (error) {
    if (database.inTransaction) database.exec('ROLLBACK');
    if (error instanceof SqlitePersistenceProblem) throw error;
    throw new SqlitePersistenceProblem('persistence.incompatible_store');
  }
}

function validateStore(database: Database.Database, checksum: Buffer): void {
  const migrations = database
    .prepare(
      'SELECT migration_id, checksum_sha256 FROM runtime_schema_migration',
    )
    .all() as { migration_id: number; checksum_sha256: Buffer }[];
  const migration = migrations[0];
  if (
    migrations.length !== 1 ||
    migration?.migration_id !== 1 ||
    !Buffer.isBuffer(migration.checksum_sha256) ||
    !migration.checksum_sha256.equals(checksum)
  ) {
    throw new SqlitePersistenceProblem('persistence.incompatible_store');
  }

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
  const preferenceRevision = preference?.preference_revision;
  if (
    store?.schema_version !== 1 ||
    !Number.isSafeInteger(store.data_revision) ||
    store.data_revision < 0 ||
    preference === undefined ||
    !['de-DE', 'en-GB'].includes(preference.ui_locale) ||
    preferenceRevision === undefined ||
    !Number.isSafeInteger(preferenceRevision) ||
    preferenceRevision < 1
  ) {
    throw new SqlitePersistenceProblem('persistence.incompatible_store');
  }

  const check = database.pragma('quick_check', { simple: true });
  const foreignKeyViolations = database.pragma('foreign_key_check');
  if (
    check !== 'ok' ||
    !Array.isArray(foreignKeyViolations) ||
    foreignKeyViolations.length !== 0
  ) {
    throw new SqlitePersistenceProblem('persistence.incompatible_store');
  }
}
