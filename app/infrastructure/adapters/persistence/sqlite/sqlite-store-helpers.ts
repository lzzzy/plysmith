import type Database from 'better-sqlite3';
import { SqlitePersistenceProblem } from './sqlite-persistence-problem.ts';

export function readDataRevision(database: Database.Database): number {
  const row = database
    .prepare(
      'SELECT data_revision AS dataRevision FROM runtime_store_state WHERE store_state_id = 1',
    )
    .get() as { dataRevision: number } | undefined;
  if (row === undefined) {
    throw new SqlitePersistenceProblem('persistence.incompatible_store');
  }
  return row.dataRevision;
}

export function incrementDataRevision(
  database: Database.Database,
  occurredAt: string,
): number {
  const result = database
    .prepare(
      `UPDATE runtime_store_state
          SET data_revision = data_revision + 1,
              search_projection_version = data_revision + 1,
              updated_at_utc = ?
        WHERE store_state_id = 1
          AND data_revision < 9007199254740991`,
    )
    .run(occurredAt);
  if (result.changes !== 1) {
    throw new SqlitePersistenceProblem('persistence.unavailable');
  }
  return readDataRevision(database);
}

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T>(cursor: string): T | undefined {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    return decoded as T;
  } catch {
    return undefined;
  }
}
