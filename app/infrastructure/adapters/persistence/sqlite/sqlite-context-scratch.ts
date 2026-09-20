import type Database from 'better-sqlite3';

import { deleteUnreferencedPositions } from './sqlite-chess-state.ts';

export function deleteContextScratch(
  database: Database.Database,
  contextId: number,
): void {
  const row = database
    .prepare(
      `SELECT scratch_draft_id AS scratchId
         FROM analysis_scratch_draft WHERE context_id = ?`,
    )
    .get(contextId) as { scratchId: number } | undefined;
  if (row === undefined) return;
  const positionIds = readScratchPositionIds(database, row.scratchId);
  database
    .prepare('DELETE FROM analysis_scratch_step WHERE scratch_draft_id = ?')
    .run(row.scratchId);
  database
    .prepare('DELETE FROM analysis_scratch_draft WHERE scratch_draft_id = ?')
    .run(row.scratchId);
  deleteUnreferencedPositions(database, positionIds);
}

export function readScratchPositionIds(
  database: Database.Database,
  scratchId: number,
): readonly number[] {
  const rows = database
    .prepare(
      `SELECT root_position_id AS positionId
         FROM analysis_scratch_draft WHERE scratch_draft_id = ?
       UNION
       SELECT before_position_id AS positionId
         FROM analysis_scratch_step WHERE scratch_draft_id = ?
       UNION
       SELECT after_position_id AS positionId
         FROM analysis_scratch_step WHERE scratch_draft_id = ?`,
    )
    .all(scratchId, scratchId, scratchId) as { positionId: number }[];
  return rows.map((row) => row.positionId);
}
