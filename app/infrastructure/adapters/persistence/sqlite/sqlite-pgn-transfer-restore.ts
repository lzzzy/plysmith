import type Database from 'better-sqlite3';
import type { ChessRulesPort } from '../../../../application/chess_graph/index.ts';
import type {
  PreparedInventoryRestore,
  TransferMove,
  TransferWitness,
} from '../../../../application/inventory/pgn-transfer-models.ts';
import { ApplicationProblem } from '../../../../application/problems/application-problem.ts';
import type {
  ChessState,
  HistoryKnowledge,
} from '../../../../domain/chess_graph/index.ts';
import { standardInitialFen } from '../../../../domain/chess_graph/index.ts';
import { localId } from '../../../../domain/identity/index.ts';
import { inventoryFolderNameKey } from '../../../../domain/inventory/inventory-folder.ts';
import {
  validateInventorySourcePath,
  validateSourcePath,
} from '../../../../domain/playout/index.ts';
import { prepareEnsurePosition, readChessState } from './sqlite-chess-state.ts';
import { importFingerprint } from './sqlite-import-graph.ts';
import {
  readDataRevision,
  incrementDataRevision,
} from './sqlite-store-helpers.ts';
import { invalidTransfer } from './sqlite-pgn-transfer-snapshot.ts';
import {
  validateLinearGraph,
  readAnalysisRecordView,
} from './sqlite-analysis-record.ts';

const contentTables = [
  'inventory_item',
  'inventory_folder',
  'item_revision',
  'inventory_analysis_revision',
  'inventory_analysis_origin',
  'inventory_game_revision',
  'inventory_game_origin',
  'inventory_game_source_path',
  'inventory_game_source_ply',
  'chess_occurrence_identity',
  'chess_occurrence_snapshot',
  'chess_play_state_snapshot',
  'chess_move_node_identity',
  'chess_move_node_snapshot',
  'chess_anchor',
  'workspace_working_context',
  'workspace_context_item',
  'workspace_context_reference',
  'workspace_context_folder',
  'workspace_contribution',
  'workspace_analysis_note_path_step',
  'workspace_pending_revision_impact',
  'workspace_revision_impact_entry',
  'analysis_scratch_draft',
  'analysis_scratch_step',
  'playout_draft',
  'playout_ply',
  'playout_source_ply',
  'playout_completion_receipt',
  'search_document',
] as const;

export function inspectFreshRestoreTarget(db: Database.Database): {
  canRestore: boolean;
  blockerCodes: readonly string[];
} {
  const blockers = new Set<string>();
  for (const table of contentTables) {
    if (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())
      blockers.add('stored_content');
  }
  if (
    db
      .prepare('SELECT 1 FROM live_fair_play_guard WHERE blocked <> 0 LIMIT 1')
      .get()
  )
    blockers.add('live_session');
  if (
    db
      .prepare(
        `SELECT 1 FROM workspace_management_resume WHERE context_id IS NOT NULL OR selected_item_id IS NOT NULL OR selected_anchor_id IS NOT NULL LIMIT 1`,
      )
      .get() ||
    db
      .prepare(
        `SELECT 1 FROM workspace_analysis_resume WHERE context_id IS NOT NULL OR item_id IS NOT NULL OR revision_id IS NOT NULL OR anchor_id IS NOT NULL OR analysis_scratch_draft_id IS NOT NULL OR mode <> 'analyze' LIMIT 1`,
      )
      .get() ||
    db
      .prepare(
        'SELECT 1 FROM workspace_startup_resume WHERE context_id IS NOT NULL LIMIT 1',
      )
      .get()
  )
    blockers.add('workspace_state');
  if (blockers.size) return { canRestore: false, blockerCodes: [...blockers] };
  for (const row of db
    .prepare('SELECT position_id FROM chess_position')
    .iterate()) {
    const state = readChessState(
      db,
      localId('position', (row as { position_id: number }).position_id),
      { halfmoveClock: 0, fullmoveNumber: 1, historyKnowledge: 'complete' },
    );
    if (state.fen !== standardInitialFen) blockers.add('workspace_state');
  }
  return { canRestore: blockers.size === 0, blockerCodes: [...blockers] };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw invalidTransfer();
  return value;
}

function knowledge(
  state: ChessState,
  historyKnowledge: HistoryKnowledge,
): ChessState {
  return { ...state, playState: { ...state.playState, historyKnowledge } };
}

export function restorePgnTransfer(
  db: Database.Database,
  prepared: PreparedInventoryRestore,
  occurredAt: string,
  checkBudget: () => void,
  rules?: ChessRulesPort,
): { dataRevision: number; noOp: boolean } {
  checkBudget();
  if (!inspectFreshRestoreTarget(db).canRestore)
    throw new ApplicationProblem(
      'inventory_transfer.target_not_empty',
      'The restore target is not empty.',
    );
  const { manifest, records } = prepared;
  if (
    manifest.records.length !== records.length ||
    manifest.carrier !== (records.length === 0)
  )
    throw invalidTransfer();
  if (
    manifest.items.length === 0 &&
    manifest.folders.length === 0 &&
    records.length === 0
  ) {
    if (manifest.anchors.length || manifest.contributions.length)
      throw invalidTransfer();
    checkBudget();
    return { dataRevision: readDataRevision(db), noOp: true };
  }
  const folders = new Map<string, number>();
  const items = new Map<string, number>();
  const revisions = new Map<string, number>();
  const occurrences = new Map<string, number>();
  const moves = new Map<string, number>();
  const anchors = new Map<string, number>();
  const itemByKey = new Map(manifest.items.map((item) => [item.id, item]));
  const recordByKey = new Map(
    manifest.records.map((record) => [record.id, record]),
  );
  const anchorByKey = new Map(
    manifest.anchors.map((anchor) => [anchor.id, anchor]),
  );
  const insertFolder = db.prepare(
    'INSERT INTO inventory_folder(parent_folder_id, display_name, name_key) VALUES (?, ?, ?)',
  );
  const pendingFolders = new Map(
    manifest.folders.map((folder) => [folder.id, folder]),
  );
  while (pendingFolders.size) {
    const before = pendingFolders.size;
    for (const [key, folder] of pendingFolders) {
      checkBudget();
      if (folder.parent !== null && !folders.has(folder.parent)) continue;
      folders.set(
        key,
        Number(
          insertFolder.run(
            folder.parent === null
              ? null
              : required(folders.get(folder.parent)),
            folder.name,
            inventoryFolderNameKey(folder.name),
          ).lastInsertRowid,
        ),
      );
      pendingFolders.delete(key);
    }
    if (pendingFolders.size === before) throw invalidTransfer();
  }
  const insertItem = db.prepare(
    'INSERT INTO inventory_item(item_type, origin_kind, lifecycle, folder_id, created_at_utc, updated_at_utc) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const item of manifest.items) {
    checkBudget();
    if (
      items.has(item.id) ||
      (item.role === 'inventory') !== (item.lifecycle === 'active')
    )
      throw invalidTransfer();
    items.set(
      item.id,
      Number(
        insertItem.run(
          item.itemType,
          item.originKind,
          item.lifecycle,
          item.folder === null ? null : required(folders.get(item.folder)),
          item.createdAt,
          item.updatedAt,
        ).lastInsertRowid,
      ),
    );
  }
  const insertRevision = db.prepare(
    'INSERT INTO item_revision(item_id, revision_number, display_name, summary_text, language_tag, content_fingerprint, creator_role, created_at_utc, revision_change_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const [index, record] of manifest.records.entries()) {
    checkBudget();
    if (revisions.has(record.id) || record.pgnIndex !== index)
      throw invalidTransfer();
    revisions.set(
      record.id,
      Number(
        insertRevision.run(
          required(items.get(record.item)),
          record.revisionNumber,
          record.name,
          record.summary,
          record.languageTag,
          importFingerprint({ record, tree: records[index] }),
          record.creatorRole,
          record.createdAt,
          record.changeKind,
        ).lastInsertRowid,
      ),
    );
  }
  const updateBase = db.prepare(
    'UPDATE item_revision SET base_revision_id = ? WHERE revision_id = ?',
  );
  for (const record of manifest.records)
    if (record.baseRevision !== null)
      updateBase.run(
        required(revisions.get(record.baseRevision)),
        required(revisions.get(record.id)),
      );
  const ensurePosition = prepareEnsurePosition(db);
  const insertOccurrence = db.prepare(
    'INSERT INTO chess_occurrence_identity(item_id, created_revision_id) VALUES (?, ?)',
  );
  const insertMove = db.prepare(
    'INSERT INTO chess_move_node_identity(item_id, created_revision_id) VALUES (?, ?)',
  );
  const insertOccurrenceSnapshot = db.prepare(
    'INSERT INTO chess_occurrence_snapshot VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertState = db.prepare(
    'INSERT INTO chess_play_state_snapshot VALUES (?, ?, ?, ?, ?)',
  );
  const insertMoveSnapshot = db.prepare(
    'INSERT INTO chess_move_node_snapshot VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const itemAnchor = db.prepare(
    "INSERT INTO chess_anchor(anchor_kind, item_id) VALUES ('item', ?)",
  );
  const occurrenceAnchor = db.prepare(
    "INSERT INTO chess_anchor(anchor_kind, owner_item_id, occurrence_id) VALUES ('occurrence', ?, ?)",
  );
  const moveAnchor = db.prepare(
    "INSERT INTO chess_anchor(anchor_kind, owner_item_id, move_node_id) VALUES ('move_node', ?, ?)",
  );
  const itemAnchors = new Map<string, number>(),
    occurrenceAnchors = new Map<string, number>(),
    moveAnchors = new Map<string, number>();
  const occurrenceOwners = new Map<
    string,
    { item: string; position: string }
  >();
  const moveIdentities = new Map<string, string>();
  const moveOwners = new Map<string, string>();
  for (const [key, id] of items)
    itemAnchors.set(key, Number(itemAnchor.run(id).lastInsertRowid));
  const stateAt = (witness: TransferWitness): ChessState => {
    const record = required(recordByKey.get(witness.record));
    const tree = required(records[record.pgnIndex]);
    const tuple = required(record.nodes[witness.node]);
    const state =
      witness.node === 0
        ? tree.root
        : required(tree.nodes[witness.node - 1]).after;
    return knowledge(state, tuple[2]);
  };
  const insertAnalysis = db.prepare(
    'INSERT INTO inventory_analysis_revision VALUES (?, ?, ?, ?)',
  );
  const insertGame = db.prepare(
    `INSERT INTO inventory_game_revision VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const record of manifest.records) {
    checkBudget();
    const tree = required(records[record.pgnIndex]),
      item = required(items.get(record.item)),
      revision = required(revisions.get(record.id));
    if (
      record.nodes.length !== tree.nodes.length + 1 ||
      record.nodes[0]?.[1] !== null
    )
      throw invalidTransfer();
    for (const [index, tuple] of record.nodes.entries()) {
      checkBudget();
      const [key] = tuple;
      const state = stateAt({ record: record.id, node: index });
      const owner = occurrenceOwners.get(key);
      if (
        owner &&
        (owner.item !== record.item ||
          owner.position !== state.position.positionKey)
      )
        throw invalidTransfer();
      if (!occurrences.has(key)) {
        const id = Number(insertOccurrence.run(item, revision).lastInsertRowid);
        occurrences.set(key, id);
        occurrenceOwners.set(key, {
          item: record.item,
          position: state.position.positionKey,
        });
        occurrenceAnchors.set(
          key,
          Number(occurrenceAnchor.run(item, id).lastInsertRowid),
        );
      }
      const id = required(occurrences.get(key));
      insertOccurrenceSnapshot.run(
        revision,
        id,
        item,
        ensurePosition(state.position).value,
        Number(index === 0),
        importFingerprint(state),
      );
      insertState.run(
        revision,
        id,
        state.playState.halfmoveClock,
        state.playState.fullmoveNumber,
        state.playState.historyKnowledge,
      );
    }
    const siblingCounts = new Map<number | null, number>();
    const ancestry: number[] = [];
    for (const [index, node] of tree.nodes.entries()) {
      checkBudget();
      if (
        node.nodeIndex !== index ||
        (node.parentNodeIndex !== null &&
          (node.parentNodeIndex < 0 || node.parentNodeIndex >= index))
      )
        throw invalidTransfer();
      if (node.siblingOrder !== (siblingCounts.get(node.parentNodeIndex) ?? 0))
        throw invalidTransfer();
      siblingCounts.set(node.parentNodeIndex, node.siblingOrder + 1);
      while (ancestry.length && ancestry.at(-1) !== node.parentNodeIndex)
        ancestry.pop();
      if (
        node.parentNodeIndex !== null &&
        ancestry.at(-1) !== node.parentNodeIndex
      )
        throw invalidTransfer();
      ancestry.push(index);
      const parent = required(
        record.nodes[
          node.parentNodeIndex === null ? 0 : node.parentNodeIndex + 1
        ],
      )[0];
      const [child, moveKey] = required(record.nodes[index + 1]);
      if (moveKey === null) throw invalidTransfer();
      const identity = JSON.stringify([
        record.item,
        parent,
        child,
        node.move.from,
        node.move.to,
        node.move.promotion ?? null,
      ]);
      if (
        moveIdentities.has(moveKey) &&
        moveIdentities.get(moveKey) !== identity
      )
        throw invalidTransfer();
      if (!moves.has(moveKey)) {
        const id = Number(insertMove.run(item, revision).lastInsertRowid);
        moves.set(moveKey, id);
        moveIdentities.set(moveKey, identity);
        moveOwners.set(moveKey, record.item);
        moveAnchors.set(
          moveKey,
          Number(moveAnchor.run(item, id).lastInsertRowid),
        );
      }
      insertMoveSnapshot.run(
        revision,
        required(moves.get(moveKey)),
        item,
        required(occurrences.get(parent)),
        required(occurrences.get(child)),
        node.siblingOrder,
        Number(node.siblingOrder === 0),
        node.move.from,
        node.move.to,
        node.move.promotion ?? null,
        node.move.san,
        importFingerprint(node.move),
      );
    }
    const root = required(occurrences.get(record.nodes[0]![0]));
    if (required(itemByKey.get(record.item)).itemType === 'analysis') {
      if (record.game !== null || record.sourcePath !== null)
        throw invalidTransfer();
      insertAnalysis.run(revision, item, root, record.origin.kind);
    } else {
      const game = record.game,
        policy = game?.policy,
        profile = policy?.profile;
      insertGame.run(
        revision,
        item,
        root,
        record.origin.kind,
        game?.playerSide ?? null,
        game?.result.kind ?? null,
        game?.result.source ?? null,
        game?.result.reason ?? null,
        policy?.capability ?? null,
        policy?.providerInstanceId ?? null,
        policy?.providerFingerprint ?? null,
        policy?.providerType ?? null,
        policy?.providerDisplayName ?? null,
        profile?.modelName ?? null,
        profile?.selectionMode ?? null,
        profile?.historyMode ?? null,
        profile?.reproducibility ?? null,
      );
    }
    validateLinearGraph(
      db,
      localId('inventory-item', item),
      localId('item-revision', revision),
      record.nodes.length,
    );
  }
  const positionAnchor = db.prepare(
    "INSERT INTO chess_anchor(anchor_kind, position_id) VALUES ('position', ?)",
  );
  const canonicalAnchors = new Set<number>();
  for (const anchor of manifest.anchors) {
    checkBudget();
    let id: number;
    if (anchor.kind === 'item') id = required(itemAnchors.get(anchor.item));
    else if (anchor.kind === 'occurrence') {
      if (occurrenceOwners.get(anchor.occurrence)?.item !== anchor.item)
        throw invalidTransfer();
      id = required(occurrenceAnchors.get(anchor.occurrence));
    } else if (anchor.kind === 'move_node') {
      if (moveOwners.get(anchor.move) !== anchor.item) throw invalidTransfer();
      id = required(moveAnchors.get(anchor.move));
    } else
      id = Number(
        positionAnchor.run(
          ensurePosition(stateAt(anchor.witness).position).value,
        ).lastInsertRowid,
      );
    if (anchors.has(anchor.id) || canonicalAnchors.has(id))
      throw invalidTransfer();
    anchors.set(anchor.id, id);
    canonicalAnchors.add(id);
  }
  const apply = (state: ChessState, move: TransferMove) => {
    if (!rules) throw invalidTransfer();
    const promotion =
      move.promotion === null
        ? ''
        : { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }[move.promotion];
    const result = rules.applyMove(state, [], {
      kind: 'coordinates',
      value: `${move.from}${move.to}${promotion}`,
    });
    if (!result.ok) throw invalidTransfer();
    return result.value;
  };
  const sourceHeader = db.prepare(
    'INSERT INTO inventory_game_source_path VALUES (?, ?, ?, ?, ?, ?)',
  );
  const sourceStep = db.prepare(
    'INSERT INTO inventory_game_source_ply VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const analysisOrigin = db.prepare(
    'INSERT INTO inventory_analysis_origin VALUES (?, ?, ?, ?)',
  );
  const gameOrigin = db.prepare(
    'INSERT INTO inventory_game_origin VALUES (?, ?, ?, ?)',
  );
  for (const record of manifest.records) {
    checkBudget();
    const revision = required(revisions.get(record.id));
    const source = record.sourcePath;
    if (source) {
      const parsed = rules?.parseFen(source.rootFen);
      if (!parsed?.ok) throw invalidTransfer();
      const root = knowledge(parsed.value, source.historyKnowledge.root);
      sourceHeader.run(
        revision,
        source.title,
        ensurePosition(root.position).value,
        root.playState.halfmoveClock,
        root.playState.fullmoveNumber,
        root.playState.historyKnowledge,
      );
      let current = root;
      const steps = source.moves.map((move, index) => {
        checkBudget();
        const before = knowledge(
          current,
          required(source.historyKnowledge.before[index]),
        );
        const played = apply(before, move),
          after = knowledge(
            played.after,
            required(source.historyKnowledge.after[index]),
          );
        sourceStep.run(
          revision,
          index,
          ensurePosition(before.position).value,
          before.playState.halfmoveClock,
          before.playState.fullmoveNumber,
          before.playState.historyKnowledge,
          ensurePosition(after.position).value,
          after.playState.halfmoveClock,
          after.playState.fullmoveNumber,
          after.playState.historyKnowledge,
          move.from,
          move.to,
          move.promotion,
          played.move.san,
        );
        current = after;
        return { before, move: played.move, after };
      });
      validateSourcePath(
        { displayName: source.title, root, steps },
        stateAt({ record: record.id, node: 0 }),
      );
    }
    if (record.origin.kind === 'inventory_anchor') {
      const origin = record.origin;
      const sourceRecord = required(recordByKey.get(origin.revision));
      if (sourceRecord.item !== origin.item) throw invalidTransfer();
      const statement =
        required(itemByKey.get(record.item)).itemType === 'analysis'
          ? analysisOrigin
          : gameOrigin;
      statement.run(
        revision,
        required(items.get(origin.item)),
        required(revisions.get(origin.revision)),
        required(anchors.get(origin.anchor)),
      );
    }
  }
  const setHead = db.prepare(
    'UPDATE inventory_item SET current_revision_id = ? WHERE item_id = ?',
  );
  const searchItem = db.prepare(
    `INSERT INTO search_document(projection_version, subject_kind, item_id, item_revision_id, anchor_id, language_tag, evidence_class, scope_kind, stable_sort_value, title, aliases_concepts, metadata, body) VALUES (1, 'item_revision', ?, ?, ?, ?, ?, 'global', ?, ?, '', ?, ?)`,
  );
  for (const item of manifest.items) {
    checkBudget();
    const head =
      item.role === 'inventory' ? item.currentRevision : item.retainedRevision;
    if (
      head === null ||
      (item.role === 'inventory'
        ? item.retainedRevision !== null
        : item.currentRevision !== null)
    )
      throw invalidTransfer();
    const record = required(recordByKey.get(head));
    if (record.item !== item.id) throw invalidTransfer();
    const id = required(items.get(item.id)),
      revision = required(revisions.get(head));
    setHead.run(revision, id);
    if (item.role === 'inventory')
      searchItem.run(
        id,
        revision,
        required(occurrenceAnchors.get(record.nodes[0]![0])),
        record.languageTag,
        item.originKind === 'structured_import' ? 'source' : 'personal',
        item.updatedAt,
        record.name,
        `${item.itemType} ${item.originKind}`,
        record.summary ?? '',
      );
  }
  // Existing readers validate exact source-anchor membership and the complete inherited path.
  for (const record of manifest.records) {
    checkBudget();
    const view = readAnalysisRecordView(db, {
      itemId: localId('inventory-item', required(items.get(record.item))),
      revisionId: localId('item-revision', required(revisions.get(record.id))),
      anchorId: localId(
        'anchor',
        required(occurrenceAnchors.get(record.nodes[0]![0])),
      ),
    });
    if (!view) throw invalidTransfer();
    if (view.sourceLine)
      validateInventorySourcePath(view.sourceLine, view.sourcePath, view.root);
  }
  const insertNote = db.prepare(
    `INSERT INTO workspace_contribution(contribution_type, author_role, scope_kind, anchor_id, body, rationale, status, contribution_version, language_tag, created_at_utc, updated_at_utc) VALUES (?, ?, 'global', ?, ?, ?, 'active', ?, ?, ?, ?)`,
  );
  const noteStep = db.prepare(
    'INSERT INTO workspace_analysis_note_path_step VALUES (?, ?, ?, ?, ?, ?)',
  );
  const searchNote = db.prepare(
    `INSERT INTO search_document(projection_version, subject_kind, contribution_id, anchor_id, language_tag, evidence_class, scope_kind, stable_sort_value, title, aliases_concepts, metadata, body) VALUES (1, 'contribution', ?, ?, ?, ?, 'global', ?, '', '', ?, ?)`,
  );
  for (const note of manifest.contributions) {
    checkBudget();
    const anchor = required(anchors.get(note.anchor));
    const id = Number(
      insertNote.run(
        note.contributionType,
        note.authorRole,
        anchor,
        note.body,
        note.rationale,
        note.version,
        note.languageTag,
        note.createdAt,
        note.updatedAt,
      ).lastInsertRowid,
    );
    if (note.moves.length) {
      if (note.movesRoot === null) throw invalidTransfer();
      const anchorData = required(anchorByKey.get(note.anchor));
      const witnessRecord = required(recordByKey.get(note.movesRoot.record));
      const tuple = required(witnessRecord.nodes[note.movesRoot.node]);
      if (
        (anchorData.kind === 'item' &&
          (witnessRecord.item !== anchorData.item ||
            note.movesRoot.node !== 0)) ||
        (anchorData.kind === 'occurrence' &&
          (witnessRecord.item !== anchorData.item ||
            tuple[0] !== anchorData.occurrence)) ||
        (anchorData.kind === 'move_node' &&
          (witnessRecord.item !== anchorData.item ||
            tuple[1] !== anchorData.move)) ||
        (anchorData.kind === 'position' &&
          stateAt(anchorData.witness).position.positionKey !==
            stateAt(note.movesRoot).position.positionKey)
      )
        throw invalidTransfer();
      let current = stateAt(note.movesRoot);
      for (const [index, move] of note.moves.entries()) {
        checkBudget();
        const played = apply(current, move);
        noteStep.run(
          id,
          index,
          move.from,
          move.to,
          move.promotion,
          played.move.san,
        );
        current = played.after;
      }
    }
    searchNote.run(
      id,
      anchor,
      note.languageTag,
      note.authorRole === 'engine'
        ? 'machine'
        : note.authorRole === 'source'
          ? 'source'
          : 'personal',
      note.updatedAt,
      note.contributionType,
      note.body,
    );
  }
  if ((db.pragma('foreign_key_check') as unknown[]).length)
    throw invalidTransfer();
  db.prepare(
    "INSERT INTO search_document_fts(search_document_fts, rank) VALUES ('integrity-check', 1)",
  ).run();
  const dataRevision = incrementDataRevision(db, occurredAt);
  checkBudget();
  return { dataRevision, noOp: false };
}
