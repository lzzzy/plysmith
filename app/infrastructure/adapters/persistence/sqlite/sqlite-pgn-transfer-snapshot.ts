import type Database from 'better-sqlite3';
import { ApplicationProblem } from '../../../../application/problems/application-problem.ts';
import type {
  InventoryTransferSnapshot,
  TransferAnchor,
  TransferChessRecord,
  TransferContribution,
  TransferFolder,
  TransferGameFacts,
  TransferItem,
  TransferNode,
  TransferRecord,
  TransferWitness,
} from '../../../../application/inventory/pgn-transfer-models.ts';
import type {
  ChessState,
  CanonicalMove,
} from '../../../../domain/chess_graph/index.ts';
import {
  chessStateFromPositionRow,
  type PositionRow,
} from './sqlite-chess-state.ts';
import { readDataRevision } from './sqlite-store-helpers.ts';

export function invalidTransfer(): ApplicationProblem {
  return new ApplicationProblem(
    'inventory_transfer.invalid_backup',
    'The inventory backup is invalid.',
  );
}

interface ItemRow {
  item_id: number;
  item_type: TransferItem['itemType'] | 'source';
  origin_kind: TransferItem['originKind'];
  lifecycle: TransferItem['lifecycle'];
  current_revision_id: number | null;
  folder_id: number | null;
  created_at_utc: string;
  updated_at_utc: string;
}
interface RevisionRow {
  revision_id: number;
  item_id: number;
  revision_number: number;
  base_revision_id: number | null;
  display_name: string;
  summary_text: string | null;
  language_tag: string;
  creator_role: TransferRecord['creatorRole'];
  created_at_utc: string;
  revision_change_kind: TransferRecord['changeKind'];
  root_occurrence_id: number;
  origin_mode: TransferRecord['origin']['kind'];
}
interface OriginRow {
  source_item_id: number;
  source_revision_id: number;
  source_anchor_id: number;
}
interface OccurrenceRow extends PositionRow {
  occurrenceId: number;
  isRoot: number;
  halfmoveClock: number;
  fullmoveNumber: number;
  historyKnowledge: ChessState['playState']['historyKnowledge'];
}
interface MoveRow {
  move_node_id: number;
  parent_occurrence_id: number;
  child_occurrence_id: number;
  sibling_order: number;
  is_main_line: number;
  from_square: string;
  to_square: string;
  promotion: NonNullable<CanonicalMove['promotion']> | null;
  san: string;
}
interface AnchorRow {
  anchor_id: number;
  anchor_kind: TransferAnchor['kind'];
  item_id: number | null;
  owner_item_id: number | null;
  position_id: number | null;
  occurrence_id: number | null;
  move_node_id: number | null;
}
interface SelectedRevision {
  row: RevisionRow;
  origin?: OriginRow;
  tree: TransferChessRecord;
  occurrences: OccurrenceRow[];
  moves: MoveRow[];
}

function keyMap(prefix: string) {
  const keys = new Map<number, string>();
  return {
    keys,
    key(id: number): string {
      let key = keys.get(id);
      if (key === undefined) {
        key = `${prefix}${keys.size + 1}`;
        keys.set(id, key);
      }
      return key;
    },
  };
}

export function readPgnTransferSnapshot(
  db: Database.Database,
  checkBudget: () => void,
): InventoryTransferSnapshot {
  checkBudget();
  const dataRevision = readDataRevision(db);
  const itemKeys = keyMap('i'),
    revisionKeys = keyMap('r'),
    occurrenceKeys = keyMap('o');
  const moveKeys = keyMap('m'),
    anchorKeys = keyMap('a'),
    folderKeys = keyMap('f');
  const folderRows = db
    .prepare(
      'SELECT folder_id, parent_folder_id, display_name FROM inventory_folder ORDER BY folder_id',
    )
    .all() as {
    folder_id: number;
    parent_folder_id: number | null;
    display_name: string;
  }[];
  const folderChildren = new Map<number | null, typeof folderRows>();
  for (const folder of folderRows) {
    const siblings = folderChildren.get(folder.parent_folder_id) ?? [];
    siblings.push(folder);
    folderChildren.set(folder.parent_folder_id, siblings);
  }
  const folders = [...(folderChildren.get(null) ?? [])];
  for (let cursor = 0; cursor < folders.length; cursor++) {
    checkBudget();
    const folder = folders[cursor]!;
    if (folderKeys.keys.has(folder.folder_id)) fail();
    folderKeys.key(folder.folder_id);
    folders.push(...(folderChildren.get(folder.folder_id) ?? []));
  }
  if (folders.length !== folderRows.length) fail();
  const transferFolders: TransferFolder[] = folders.map((row) => ({
    id: folderKeys.key(row.folder_id),
    parent:
      row.parent_folder_id === null
        ? null
        : (folderKeys.keys.get(row.parent_folder_id) ?? fail()),
    name: row.display_name,
  }));
  const visible = db
    .prepare(
      "SELECT * FROM inventory_item WHERE lifecycle = 'active' ORDER BY created_at_utc, item_id",
    )
    .all() as ItemRow[];
  const items = new Map<number, ItemRow>();
  const selected = new Map<number, SelectedRevision>();
  const retained = new Map<number, number>();
  const readItem = db.prepare('SELECT * FROM inventory_item WHERE item_id = ?');
  const readRevision = db.prepare(
    'SELECT r.*, c.root_occurrence_id, c.origin_mode FROM item_revision r JOIN inventory_chess_revision c ON c.revision_id = r.revision_id AND c.item_id = r.item_id WHERE r.revision_id = ?',
  );
  const readOrigin = db.prepare(
    'SELECT source_item_id, source_revision_id, source_anchor_id FROM inventory_analysis_origin WHERE analysis_revision_id = ? UNION ALL SELECT source_item_id, source_revision_id, source_anchor_id FROM inventory_game_origin WHERE game_revision_id = ?',
  );
  const readOccurrences =
    db.prepare(`SELECT o.occurrence_id AS occurrenceId, o.is_root AS isRoot, p.position_id AS positionId,
    p.board_key AS boardKey, p.side_to_move AS sideToMove, p.white_king_side AS whiteKingSide,
    p.white_queen_side AS whiteQueenSide, p.black_king_side AS blackKingSide, p.black_queen_side AS blackQueenSide,
    p.effective_en_passant_square AS effectiveEnPassantSquare, s.halfmove_clock AS halfmoveClock,
    s.fullmove_number AS fullmoveNumber, s.history_knowledge AS historyKnowledge
    FROM chess_occurrence_snapshot o JOIN chess_position p ON p.position_id = o.position_id
    JOIN chess_play_state_snapshot s ON s.revision_id = o.revision_id AND s.occurrence_id = o.occurrence_id
    WHERE o.revision_id = ?`);
  const readMoves = db.prepare(
    'SELECT * FROM chess_move_node_snapshot WHERE revision_id = ? ORDER BY is_main_line DESC, sibling_order, move_node_id',
  );
  const occurrenceCount = db.prepare(
    'SELECT count(*) AS count FROM chess_occurrence_snapshot WHERE revision_id = ?',
  );
  const include = (revisionId: number, itemId: number) => {
    checkBudget();
    if (selected.has(revisionId)) {
      if (selected.get(revisionId)!.row.item_id !== itemId) fail();
      return;
    }
    const item =
      items.get(itemId) ?? (readItem.get(itemId) as ItemRow | undefined);
    if (!item || item.item_type === 'source') fail();
    items.set(itemId, item);
    itemKeys.key(itemId);
    const row = readRevision.get(revisionId) as RevisionRow | undefined;
    if (!row || row.item_id !== itemId) fail();
    revisionKeys.key(revisionId);
    if (item.lifecycle !== 'active' && !retained.has(itemId))
      retained.set(itemId, revisionId);
    const origins = readOrigin.all(revisionId, revisionId) as OriginRow[];
    if (origins.length !== (row.origin_mode === 'inventory_anchor' ? 1 : 0))
      fail();
    const occurrences = readOccurrences.all(revisionId) as OccurrenceRow[];
    if (
      (occurrenceCount.get(revisionId) as { count: number }).count !==
      occurrences.length
    )
      fail();
    const byOccurrence = new Map(occurrences.map((o) => [o.occurrenceId, o]));
    const root = byOccurrence.get(row.root_occurrence_id) ?? fail();
    if (
      root.isRoot !== 1 ||
      occurrences.filter((o) => o.isRoot === 1).length !== 1
    )
      fail();
    const moves = readMoves.all(revisionId) as MoveRow[];
    const children = new Map<number, MoveRow[]>();
    for (const move of moves) {
      const group = children.get(move.parent_occurrence_id) ?? [];
      group.push(move);
      children.set(move.parent_occurrence_id, group);
    }
    const orderedOccurrences = [root];
    const orderedMoves: MoveRow[] = [];
    const nodes: TransferChessRecord['nodes'][number][] = [];
    const visited = new Set([root.occurrenceId]);
    const pending: { move: MoveRow; parent: number | null; sibling: number }[] =
      [];
    const pushChildren = (id: number, parent: number | null) => {
      const group = children.get(id) ?? [];
      if (
        group.length &&
        (group[0]!.is_main_line !== 1 ||
          group.slice(1).some((m) => m.is_main_line !== 0))
      )
        fail();
      for (let i = group.length - 1; i >= 0; i--)
        pending.push({ move: group[i]!, parent, sibling: i });
    };
    pushChildren(root.occurrenceId, null);
    while (pending.length) {
      checkBudget();
      const { move, parent, sibling } = pending.pop()!;
      const child = byOccurrence.get(move.child_occurrence_id) ?? fail();
      if (visited.has(child.occurrenceId)) fail();
      visited.add(child.occurrenceId);
      orderedOccurrences.push(child);
      orderedMoves.push(move);
      const nodeIndex = nodes.length;
      nodes.push({
        nodeIndex,
        parentNodeIndex: parent,
        siblingOrder: sibling,
        move: {
          from: move.from_square,
          to: move.to_square,
          san: move.san,
          ...(move.promotion === null ? {} : { promotion: move.promotion }),
        },
        after: chessStateFromPositionRow(child, child),
        comments: [],
        startingComments: [],
      });
      pushChildren(child.occurrenceId, nodeIndex);
    }
    if (
      orderedMoves.length !== moves.length ||
      visited.size !== occurrences.length
    )
      fail();
    selected.set(revisionId, {
      row,
      ...(origins[0] ? { origin: origins[0] } : {}),
      tree: { root: chessStateFromPositionRow(root, root), nodes, result: '*' },
      occurrences: orderedOccurrences,
      moves: orderedMoves,
    });
  };
  for (const item of visible) {
    items.set(item.item_id, item);
    itemKeys.key(item.item_id);
    include(item.current_revision_id ?? fail(), item.item_id);
  }
  // Preselect visible heads, then follow each exact provenance chain in stable order.
  const complete = new Set<number>();
  for (const id of [...selected.keys()]) {
    const path = new Set<number>();
    let next: number | undefined = id;
    while (next !== undefined && !complete.has(next)) {
      if (path.has(next)) fail();
      path.add(next);
      const origin: OriginRow | undefined = selected.get(next)!.origin;
      if (origin) {
        include(origin.source_revision_id, origin.source_item_id);
        next = origin.source_revision_id;
      } else next = undefined;
    }
    for (const revision of path) complete.add(revision);
  }
  const witnesses = new Map<number, TransferWitness>();
  const itemWitnesses = new Map<number, TransferWitness>();
  const occurrenceWitnesses = new Map<
    number,
    { item: number; witness: TransferWitness }
  >();
  const moveWitnesses = new Map<
    number,
    { item: number; witness: TransferWitness }
  >();
  for (const [id, record] of selected) {
    if (!itemWitnesses.has(record.row.item_id))
      itemWitnesses.set(record.row.item_id, {
        record: revisionKeys.key(id),
        node: 0,
      });
    record.occurrences.forEach((o, node) => {
      checkBudget();
      occurrenceKeys.key(o.occurrenceId);
      if (!occurrenceWitnesses.has(o.occurrenceId))
        occurrenceWitnesses.set(o.occurrenceId, {
          item: record.row.item_id,
          witness: { record: revisionKeys.key(id), node },
        });
      if (!witnesses.has(o.positionId))
        witnesses.set(o.positionId, { record: revisionKeys.key(id), node });
    });
    record.moves.forEach((m, index) => {
      moveKeys.key(m.move_node_id);
      if (!moveWitnesses.has(m.move_node_id))
        moveWitnesses.set(m.move_node_id, {
          item: record.row.item_id,
          witness: { record: revisionKeys.key(id), node: index + 1 },
        });
    });
  }
  const anchors: TransferAnchor[] = [];
  const anchorRows = new Map<number, AnchorRow>();
  const readAnchor = db.prepare(
    'SELECT * FROM chess_anchor WHERE anchor_id = ?',
  );
  const witnessFor = (
    a: AnchorRow,
    revision?: number,
  ): TransferWitness | undefined => {
    if (revision === undefined) {
      if (a.anchor_kind === 'position') return witnesses.get(a.position_id!);
      if (a.anchor_kind === 'item') return itemWitnesses.get(a.item_id!);
      const match =
        a.anchor_kind === 'occurrence'
          ? occurrenceWitnesses.get(a.occurrence_id!)
          : moveWitnesses.get(a.move_node_id!);
      return match?.item === a.owner_item_id ? match.witness : undefined;
    }
    for (const [id, record] of selected) {
      if (revision !== undefined && id !== revision) continue;
      let node = -1;
      if (a.anchor_kind === 'item' && a.item_id === record.row.item_id)
        node = 0;
      if (a.anchor_kind === 'position')
        node = record.occurrences.findIndex(
          (o) => o.positionId === a.position_id,
        );
      if (
        a.owner_item_id === record.row.item_id &&
        a.anchor_kind === 'occurrence'
      )
        node = record.occurrences.findIndex(
          (o) => o.occurrenceId === a.occurrence_id,
        );
      if (
        a.owner_item_id === record.row.item_id &&
        a.anchor_kind === 'move_node'
      ) {
        const index = record.moves.findIndex(
          (m) => m.move_node_id === a.move_node_id,
        );
        if (index >= 0) node = index + 1;
      }
      if (node >= 0) return { record: revisionKeys.key(id), node };
    }
    return undefined;
  };
  const includeAnchor = (id: number): string => {
    if (anchorKeys.keys.has(id)) return anchorKeys.key(id);
    const row = readAnchor.get(id) as AnchorRow | undefined;
    if (!row) fail();
    const witness = witnessFor(row) ?? fail();
    const key = anchorKeys.key(id);
    anchorRows.set(id, row);
    if (row.anchor_kind === 'item')
      anchors.push({
        id: key,
        kind: 'item',
        item: itemKeys.keys.get(row.item_id!) ?? fail(),
      });
    else if (row.anchor_kind === 'position')
      anchors.push({ id: key, kind: 'position', witness });
    else if (row.anchor_kind === 'occurrence')
      anchors.push({
        id: key,
        kind: 'occurrence',
        item: itemKeys.keys.get(row.owner_item_id!) ?? fail(),
        occurrence: occurrenceKeys.keys.get(row.occurrence_id!) ?? fail(),
      });
    else
      anchors.push({
        id: key,
        kind: 'move_node',
        item: itemKeys.keys.get(row.owner_item_id!) ?? fail(),
        move: moveKeys.keys.get(row.move_node_id!) ?? fail(),
      });
    return key;
  };
  const records: TransferRecord[] = [];
  const trees: TransferChessRecord[] = [];
  const readGame = prepareReadTransferGame(db);
  const readSource = prepareReadTransferSource(db, checkBudget);
  for (const [id, record] of selected) {
    checkBudget();
    const { row, origin } = record;
    const nodes: TransferNode[] = record.occurrences.map((o, index) => [
      occurrenceKeys.key(o.occurrenceId),
      index === 0 ? null : moveKeys.key(record.moves[index - 1]!.move_node_id),
      o.historyKnowledge,
    ]);
    if (origin) {
      includeAnchor(origin.source_anchor_id);
      if (
        !witnessFor(
          anchorRows.get(origin.source_anchor_id)!,
          origin.source_revision_id,
        )
      )
        fail();
    }
    const game = readGame(id);
    const source = readSource(id);
    records.push({
      id: revisionKeys.key(id),
      item: itemKeys.key(row.item_id),
      pgnIndex: records.length,
      revisionNumber: row.revision_number,
      baseRevision:
        row.base_revision_id === null
          ? null
          : (revisionKeys.keys.get(row.base_revision_id) ?? null),
      changeKind: row.revision_change_kind,
      name: row.display_name,
      summary: row.summary_text,
      languageTag: row.language_tag,
      creatorRole: row.creator_role,
      createdAt: row.created_at_utc,
      origin: origin
        ? {
            kind: 'inventory_anchor',
            item: itemKeys.key(origin.source_item_id),
            revision: revisionKeys.key(origin.source_revision_id),
            anchor: includeAnchor(origin.source_anchor_id),
          }
        : {
            kind: row.origin_mode as
              'initial_position' | 'fen' | 'position_setup',
          },
      nodes,
      game,
      sourcePath: source,
    });
    trees.push({
      ...record.tree,
      result:
        game?.result.kind === 'white_win'
          ? '1-0'
          : game?.result.kind === 'black_win'
            ? '0-1'
            : game?.result.kind === 'draw'
              ? '1/2-1/2'
              : '*',
    });
  }
  const contributions: TransferContribution[] = [];
  const readNoteMoves = db.prepare(
    'SELECT from_square AS "from", to_square AS "to", promotion FROM workspace_analysis_note_path_step WHERE contribution_id = ? ORDER BY step_index',
  );
  const notes = db.prepare(
    "SELECT * FROM workspace_contribution WHERE scope_kind = 'global' AND status = 'active' ORDER BY created_at_utc, contribution_id",
  );
  for (const value of notes.iterate()) {
    checkBudget();
    const n = value as {
      contribution_id: number;
      anchor_id: number;
      contribution_type: TransferContribution['contributionType'];
      author_role: TransferContribution['authorRole'];
      body: string;
      rationale: string | null;
      language_tag: string;
      contribution_version: number;
      created_at_utc: string;
      updated_at_utc: string;
    };
    const anchor = readAnchor.get(n.anchor_id) as AnchorRow | undefined;
    if (!anchor) fail();
    const witness = witnessFor(anchor);
    if (!witness) continue;
    const moves = readNoteMoves.all(
      n.contribution_id,
    ) as TransferContribution['moves'];
    contributions.push({
      id: `n${contributions.length + 1}`,
      anchor: includeAnchor(n.anchor_id),
      contributionType: n.contribution_type,
      authorRole: n.author_role,
      body: n.body,
      rationale: n.rationale,
      languageTag: n.language_tag,
      version: n.contribution_version,
      createdAt: n.created_at_utc,
      updatedAt: n.updated_at_utc,
      moves,
      movesRoot: moves.length ? witness : null,
    });
  }
  const transferItems: TransferItem[] = [...items.values()].map((i) => ({
    id: itemKeys.key(i.item_id),
    role: i.lifecycle === 'active' ? 'inventory' : 'provenanceOnly',
    itemType: i.item_type === 'source' ? fail() : i.item_type,
    originKind: i.origin_kind,
    lifecycle: i.lifecycle,
    folder:
      i.folder_id === null
        ? null
        : (folderKeys.keys.get(i.folder_id) ?? fail()),
    currentRevision:
      i.lifecycle === 'active'
        ? (revisionKeys.keys.get(i.current_revision_id!) ?? fail())
        : null,
    retainedRevision:
      i.lifecycle === 'active'
        ? null
        : (revisionKeys.keys.get(retained.get(i.item_id)!) ?? fail()),
    createdAt: i.created_at_utc,
    updatedAt: i.updated_at_utc,
  }));
  checkBudget();
  return {
    manifest: {
      version: 1,
      carrier: records.length === 0,
      folders: transferFolders,
      items: transferItems,
      records,
      anchors,
      contributions,
    },
    records: trees,
    dataRevision,
  };
}

function fail(): never {
  throw invalidTransfer();
}

function prepareReadTransferGame(
  db: Database.Database,
): (revision: number) => TransferGameFacts | null {
  const statement = db.prepare(
    `SELECT player_side AS playerSide, result_kind AS kind, result_source AS source, result_reason AS reason,
    policy_capability AS capability, provider_instance_id AS providerInstanceId, provider_fingerprint AS providerFingerprint,
    provider_type AS providerType, provider_display_name AS providerDisplayName, profile_model_name AS modelName,
    profile_selection_mode AS selectionMode, profile_history_mode AS historyMode, profile_reproducibility AS reproducibility
    FROM inventory_game_revision WHERE revision_id = ?`,
  );
  return (revision) => {
    const row = statement.get(revision) as
      | (TransferGameFacts['result'] &
          TransferGameFacts['policy'] &
          NonNullable<TransferGameFacts['policy']['profile']> & {
            playerSide: TransferGameFacts['playerSide'] | null;
          })
      | undefined;
    if (!row || row.playerSide === null) return null;
    return {
      playerSide: row.playerSide,
      result: { kind: row.kind, source: row.source, reason: row.reason },
      policy: {
        capability: row.capability,
        providerInstanceId: row.providerInstanceId,
        providerFingerprint: row.providerFingerprint,
        providerType: row.providerType,
        providerDisplayName: row.providerDisplayName,
        profile:
          row.capability === 'best_move'
            ? null
            : {
                modelName: row.modelName,
                selectionMode: row.selectionMode,
                historyMode: row.historyMode,
                reproducibility: row.reproducibility,
              },
      },
    };
  };
}

function prepareReadTransferSource(
  db: Database.Database,
  checkBudget: () => void,
): (revision: number) => TransferRecord['sourcePath'] {
  const header =
    db.prepare(`SELECT s.display_name AS title, s.root_halfmove_clock AS halfmoveClock,
    s.root_fullmove_number AS fullmoveNumber, s.root_history_knowledge AS historyKnowledge,
    p.position_id AS positionId, p.board_key AS boardKey, p.side_to_move AS sideToMove,
    p.white_king_side AS whiteKingSide, p.white_queen_side AS whiteQueenSide,
    p.black_king_side AS blackKingSide, p.black_queen_side AS blackQueenSide,
    p.effective_en_passant_square AS effectiveEnPassantSquare
    FROM inventory_game_source_path s JOIN chess_position p ON p.position_id = s.root_position_id WHERE s.revision_id = ?`);
  const plies =
    db.prepare(`SELECT ply_index AS plyIndex, from_square AS "from", to_square AS "to", promotion,
    before_history_knowledge AS "before", after_history_knowledge AS "after" FROM inventory_game_source_ply WHERE revision_id = ? ORDER BY ply_index`);
  return (revision) => {
    const row = header.get(revision) as
      | (PositionRow & {
          title: string;
          halfmoveClock: number;
          fullmoveNumber: number;
          historyKnowledge: ChessState['playState']['historyKnowledge'];
        })
      | undefined;
    if (!row) return null;
    const steps = plies.all(revision) as {
      plyIndex: number;
      from: string;
      to: string;
      promotion: NonNullable<CanonicalMove['promotion']> | null;
      before: ChessState['playState']['historyKnowledge'];
      after: ChessState['playState']['historyKnowledge'];
    }[];
    return {
      title: row.title,
      rootFen: chessStateFromPositionRow(row, row).fen,
      moves: steps.map((step, index) => {
        checkBudget();
        if (step.plyIndex !== index) fail();
        return { from: step.from, to: step.to, promotion: step.promotion };
      }),
      historyKnowledge: {
        root: row.historyKnowledge,
        before: steps.map((s) => s.before),
        after: steps.map((s) => s.after),
      },
    };
  };
}
