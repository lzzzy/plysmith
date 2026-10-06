import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  LiveFairPlayGuardState,
  LiveRecordWriter,
  LiveSaved,
} from '../../../../application/live/live-models.ts';
import { ApplicationProblem } from '../../../../application/problems/application-problem.ts';
import { inventoryDisplayNameConflict } from '../../../../application/inventory/index.ts';
import { localId } from '../../../../domain/identity/index.ts';
import {
  insertLinearGraph,
  validateLinearGraph,
} from './sqlite-analysis-record.ts';
import { insertAnalysisNoteContribution } from './sqlite-analysis-note.ts';
import { inventoryDisplayNameIsAvailable } from './sqlite-inventory-display-name.ts';
import { creationFolder } from './sqlite-inventory-organization.ts';
import { requireActiveContext } from './sqlite-workspace.ts';
import { incrementDataRevision } from './sqlite-store-helpers.ts';

export function readLiveFairPlayGuard(
  db: Database.Database,
): LiveFairPlayGuardState {
  const row = db
    .prepare(
      'SELECT blocked, account_id AS accountId FROM live_fair_play_guard WHERE guard_id = 1',
    )
    .get() as { blocked: number; accountId: string | null } | undefined;
  if (!row)
    throw new ApplicationProblem(
      'live.guard_unavailable',
      'live.guard_unavailable',
    );
  return {
    blocked: row.blocked === 1,
    ...(row.accountId === null ? {} : { accountId: row.accountId }),
  };
}

export function writeLiveFairPlayGuard(
  db: Database.Database,
  state: LiveFairPlayGuardState,
): void {
  db.prepare(
    'UPDATE live_fair_play_guard SET blocked = ?, account_id = ? WHERE guard_id = 1',
  ).run(
    Number(state.blocked),
    state.blocked ? (state.accountId ?? null) : null,
  );
}

/** The caller supplies the existing SQLite writer transaction. */
export function saveLiveGame(
  db: Database.Database,
  request: Parameters<LiveRecordWriter['saveLiveGame']>[0],
): LiveSaved {
  if (
    !/^[a-zA-Z0-9]{8}$/.test(request.gameId) ||
    !['observe', 'play'].includes(request.role) ||
    request.displayName.trim() !== request.displayName ||
    !request.displayName ||
    request.displayName.length > 160 ||
    !['de-DE', 'en-GB'].includes(request.languageTag) ||
    request.steps.length > 1000 ||
    !['white_win', 'black_win', 'draw', 'unfinished'].includes(
      request.outcome,
    ) ||
    [request.folderId, request.workingContextId].some(
      (id) => id !== undefined && (!Number.isSafeInteger(id) || id < 1),
    )
  )
    throw new ApplicationProblem('live.invalid_save', 'live.invalid_save');
  if (!inventoryDisplayNameIsAvailable(db, request.displayName))
    throw inventoryDisplayNameConflict();
  const contextId =
    request.workingContextId === undefined
      ? undefined
      : localId('working-context', request.workingContextId);
  if (contextId) requireActiveContext(db, contextId);
  const folderId = creationFolder(
    db,
    request.folderId === undefined
      ? undefined
      : localId('inventory-folder', request.folderId),
    undefined,
    contextId,
  );
  const origin = request.role === 'play' ? 'live_played' : 'live_observed';
  const itemId = localId(
    'inventory-item',
    Number(
      db
        .prepare(
          "INSERT INTO inventory_item(item_type, origin_kind, lifecycle, folder_id, created_at_utc, updated_at_utc) VALUES ('game', ?, 'active', ?, ?, ?)",
        )
        .run(origin, folderId, request.occurredAt, request.occurredAt)
        .lastInsertRowid,
    ),
  );
  const revisionId = localId(
    'item-revision',
    Number(
      db
        .prepare(
          "INSERT INTO item_revision(item_id, revision_number, display_name, language_tag, content_fingerprint, creator_role, created_at_utc) VALUES (?, 1, ?, ?, ?, 'live', ?)",
        )
        .run(
          itemId.value,
          request.displayName,
          request.languageTag,
          createHash('sha256').update(JSON.stringify(request)).digest(),
          request.occurredAt,
        ).lastInsertRowid,
    ),
  );
  const graph = insertLinearGraph(db, itemId, revisionId, request);
  db.prepare(
    `INSERT INTO inventory_game_revision(revision_id, item_id, root_occurrence_id, origin_mode)
    SELECT ?, ?, occurrence_id, ? FROM chess_anchor WHERE anchor_id = ? AND anchor_kind = 'occurrence'`,
  ).run(
    revisionId.value,
    itemId.value,
    request.root.playState.historyKnowledge === 'complete'
      ? 'initial_position'
      : 'fen',
    graph.rootAnchorId.value,
  );
  validateLinearGraph(db, itemId, revisionId, request.steps.length + 1);
  db.prepare(
    'UPDATE inventory_item SET current_revision_id = ? WHERE item_id = ?',
  ).run(revisionId.value, itemId.value);
  const result = {
    white_win: '1-0',
    black_win: '0-1',
    draw: '1/2-1/2',
    unfinished: '*',
  }[request.outcome];
  const body = `${request.white.name} - ${request.black.name}\n${result}\nhttps://lichess.org/${request.gameId}`;
  insertAnalysisNoteContribution(db, {
    itemId,
    anchorId: graph.rootAnchorId,
    note: { body, moves: [] },
    noteScope: { kind: 'global' },
    languageTag: request.languageTag,
    occurredAt: request.occurredAt,
    title: request.displayName,
  });
  db.prepare(
    `INSERT INTO search_document(projection_version, subject_kind, item_id, item_revision_id, anchor_id,
    language_tag, evidence_class, scope_kind, stable_sort_value, title, aliases_concepts, metadata, body)
    VALUES (1, 'item_revision', ?, ?, ?, ?, 'source', 'global', ?, ?, '', ?, ?)`,
  ).run(
    itemId.value,
    revisionId.value,
    graph.rootAnchorId.value,
    request.languageTag,
    request.occurredAt,
    request.displayName,
    `game ${origin}`,
    body,
  );
  if (contextId) {
    db.prepare(
      'INSERT INTO workspace_context_item(context_id, item_id, relationship_version, created_at_utc) VALUES (?, ?, 1, ?)',
    ).run(contextId.value, itemId.value, request.occurredAt);
    db.prepare(
      'INSERT INTO workspace_context_reference(context_id, item_id, anchor_id, created_at_utc) VALUES (?, ?, ?, ?)',
    ).run(
      contextId.value,
      itemId.value,
      graph.rootAnchorId.value,
      request.occurredAt,
    );
    db.prepare(
      'UPDATE workspace_working_context SET updated_at_utc = ? WHERE context_id = ?',
    ).run(request.occurredAt, contextId.value);
  }
  return {
    itemId: itemId.value,
    revisionId: revisionId.value,
    dataRevision: incrementDataRevision(db, request.occurredAt),
  };
}
