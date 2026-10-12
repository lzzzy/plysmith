import type { ChessRulesPort } from '../../../../application/chess_graph/index.ts';
import type {
  PgnTransferManifest,
  TransferAnchor,
  TransferChessRecord,
  TransferMove,
  TransferWitness,
} from '../../../../application/inventory/pgn-transfer-models.ts';
import type {
  ChessState,
  HistoryKnowledge,
} from '../../../../domain/chess_graph/index.ts';
import { inventoryFolderNameKey } from '../../../../domain/inventory/inventory-folder.ts';
import {
  requireTransfer as require,
  transferFailure,
} from './pgn-transfer-schema.ts';
import {
  transferLimits as limits,
  transferWorkBatch,
  yieldTransferWork,
} from './pgn-transfer-profile.ts';

export function transferCheckpoint(
  signal: AbortSignal,
  checkBudget: () => void,
): void {
  if (signal.aborted) transferFailure('interrupted');
  checkBudget();
}

export function withKnowledge(
  state: ChessState,
  historyKnowledge: HistoryKnowledge,
): ChessState {
  return { ...state, playState: { ...state.playState, historyKnowledge } };
}

export async function playTransferMoves(
  rules: ChessRulesPort,
  root: ChessState,
  moves: readonly TransferMove[],
  check: () => void,
): Promise<{ states: ChessState[]; san: string[] }> {
  const states = [root],
    san: string[] = [];
  for (let index = 0; index < moves.length; index++) {
    if (index % transferWorkBatch.moves === 0) await yieldTransferWork(check);
    const move = moves[index]!;
    check();
    const applied = rules.applyMove(states[states.length - 1]!, [], {
      kind: 'coordinates',
      value:
        move.from +
        move.to +
        (move.promotion === null
          ? ''
          : { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }[
              move.promotion
            ]),
    });
    require(applied.ok);
    san.push(applied.value.move.san);
    states.push(applied.value.after);
  }
  check();
  return { states, san };
}

export function transferState(
  record: TransferChessRecord,
  node: number,
): ChessState {
  require(
    Number.isSafeInteger(node) && node >= 0 && node <= record.nodes.length,
  );
  return node === 0 ? record.root : record.nodes[node - 1]!.after;
}

export async function validateTransferGraph(
  manifest: PgnTransferManifest,
  input: readonly TransferChessRecord[],
  rules: ChessRulesPort,
  signal: AbortSignal,
  checkBudget: () => void,
): Promise<readonly TransferChessRecord[]> {
  const check = (): void => transferCheckpoint(signal, checkBudget);
  check();
  require(input.length === manifest.records.length);
  const items = new Map(manifest.items.map((v) => [v.id, v]));
  const records = new Map(manifest.records.map((v) => [v.id, v]));
  const folders = new Map(manifest.folders.map((v) => [v.id, v]));
  const anchors = new Map<string, TransferAnchor>();
  for (let index = 0; index < manifest.anchors.length; index++) {
    if (index % transferWorkBatch.objects === 0) await yieldTransferWork(check);
    const anchor = manifest.anchors[index]!;
    anchors.set(anchor.id, anchor);
  }
  const folderNames = new Set<string>();
  let work = 0;
  for (const folder of folders.values()) {
    if (++work % transferWorkBatch.objects === 0)
      await yieldTransferWork(check);
    check();
    let normalized: string;
    try {
      normalized = inventoryFolderNameKey(folder.name);
    } catch {
      transferFailure();
    }
    const name = JSON.stringify([folder.parent, normalized]);
    require(!folderNames.has(name));
    folderNames.add(name);
    const visited = new Set<string>([folder.id]);
    let parent = folder.parent;
    while (parent !== null) {
      require(!visited.has(parent) && folders.has(parent));
      visited.add(parent);
      if (visited.size > limits.folderDepth)
        transferFailure('resource_exhausted');
      parent = folders.get(parent)!.parent;
    }
  }
  const currentNames = new Set<string>();
  const heads: string[] = [];
  for (const item of items.values()) {
    if (++work % transferWorkBatch.objects === 0)
      await yieldTransferWork(check);
    require(item.folder === null || folders.has(item.folder));
    const head = records.get((item.currentRevision ?? item.retainedRevision)!);
    require(head && head.item === item.id);
    if (item.role === 'inventory') {
      const name = head.name.trim().normalize('NFKC').toLocaleLowerCase();
      require(!currentNames.has(name));
      currentNames.add(name);
      heads.push(head.id);
    }
  }
  const occurrences = new Map<string, { item: string; position: string }>();
  const moveKeys = new Map<string, string>();
  const output: TransferChessRecord[] = [];
  const revisionNumbers = new Set<string>();
  for (let index = 0; index < input.length; index++) {
    await yieldTransferWork(check);
    const metadata = manifest.records[index]!,
      record = input[index]!;
    const item = items.get(metadata.item);
    require(
      item &&
        metadata.pgnIndex === index &&
        metadata.nodes.length === record.nodes.length + 1,
    );
    const revisionKey = `${metadata.item}:${metadata.revisionNumber}`;
    require(!revisionNumbers.has(revisionKey));
    revisionNumbers.add(revisionKey);
    if (metadata.baseRevision !== null) {
      const base = records.get(metadata.baseRevision);
      require(
        base &&
          base.item === metadata.item &&
          base.revisionNumber < metadata.revisionNumber,
      );
    }
    if (item.itemType === 'analysis')
      require(
        metadata.game === null &&
          metadata.sourcePath === null &&
          record.result === '*',
      );
    const result =
      metadata.game === null
        ? '*'
        : {
            white_win: '1-0',
            black_win: '0-1',
            draw: '1/2-1/2',
            unfinished: '*',
          }[metadata.game.result.kind];
    require(record.result === result);
    const parsedRoot = rules.parseFen(record.root.fen);
    require(
      parsedRoot.ok &&
        parsedRoot.value.fen === record.root.fen &&
        parsedRoot.value.position.positionKey ===
          record.root.position.positionKey,
    );
    require(
      Number.isSafeInteger(record.root.playState.halfmoveClock) &&
        Number.isSafeInteger(record.root.playState.fullmoveNumber),
    );
    require(
      record.root.playState.halfmoveClock ===
        parsedRoot.value.playState.halfmoveClock &&
        record.root.playState.fullmoveNumber ===
          parsedRoot.value.playState.fullmoveNumber,
    );
    if (metadata.origin.kind === 'initial_position')
      require(
        (metadata.sourcePath?.rootFen ?? record.root.fen) ===
          rules.initialState().fen,
      );
    const root = withKnowledge(parsedRoot.value, metadata.nodes[0]![2]);
    const nodes: TransferChessRecord['nodes'][number][] = [];
    const children = new Map<number | null, number[]>();
    const depths: number[] = [];
    for (const node of record.nodes) {
      if (nodes.length % transferWorkBatch.moves === 0)
        await yieldTransferWork(check);
      require(
        node.nodeIndex === nodes.length &&
          (node.parentNodeIndex === null ||
            (Number.isSafeInteger(node.parentNodeIndex) &&
              node.parentNodeIndex >= 0 &&
              node.parentNodeIndex < nodes.length)),
      );
      const siblings = children.get(node.parentNodeIndex) ?? [];
      require(node.siblingOrder === siblings.length);
      siblings.push(node.nodeIndex);
      children.set(node.parentNodeIndex, siblings);
      const depth =
        node.parentNodeIndex === null ? 1 : depths[node.parentNodeIndex]! + 1;
      if (siblings.length > 65 || depth > limits.path)
        transferFailure('resource_exhausted');
      depths.push(depth);
      const before =
        node.parentNodeIndex === null
          ? root
          : nodes[node.parentNodeIndex]!.after;
      const applied = rules.applyMove(before, [], {
        kind: 'coordinates',
        value:
          node.move.from +
          node.move.to +
          (node.move.promotion === undefined
            ? ''
            : { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }[
                node.move.promotion
              ]),
      });
      require(
        applied.ok &&
          applied.value.after.fen === node.after.fen &&
          applied.value.move.san === node.move.san &&
          applied.value.after.position.positionKey ===
            node.after.position.positionKey,
      );
      require(
        Number.isSafeInteger(node.after.playState.halfmoveClock) &&
          Number.isSafeInteger(node.after.playState.fullmoveNumber),
      );
      require(
        node.after.playState.halfmoveClock ===
          applied.value.after.playState.halfmoveClock &&
          node.after.playState.fullmoveNumber ===
            applied.value.after.playState.fullmoveNumber,
      );
      nodes.push({
        ...node,
        after: withKnowledge(
          applied.value.after,
          metadata.nodes[node.nodeIndex + 1]![2],
        ),
        comments: [],
        startingComments: [],
      });
    }
    const stack = [...(children.get(null) ?? [])].reverse();
    let cursor = 0;
    while (stack.length) {
      if (cursor % transferWorkBatch.objects === 0)
        await yieldTransferWork(check);
      const node = stack.pop()!;
      require(node === cursor++);
      stack.push(...[...(children.get(node) ?? [])].reverse());
    }
    require(cursor === nodes.length);
    const prepared = { root, nodes, result: record.result };
    output.push(prepared);
    for (let nodeIndex = 0; nodeIndex < metadata.nodes.length; nodeIndex++) {
      if (nodeIndex % transferWorkBatch.objects === 0)
        await yieldTransferWork(check);
      const [occurrence, move] = metadata.nodes[nodeIndex]!;
      const state = transferState(prepared, nodeIndex),
        existing = occurrences.get(occurrence);
      require(
        !existing ||
          (existing.item === metadata.item &&
            existing.position === state.position.positionKey),
      );
      occurrences.set(occurrence, {
        item: metadata.item,
        position: state.position.positionKey,
      });
      if (move !== null) {
        const node = nodes[nodeIndex - 1]!;
        const parentOccurrence =
          metadata.nodes[
            node.parentNodeIndex === null ? 0 : node.parentNodeIndex + 1
          ]![0];
        const identity = JSON.stringify([
          metadata.item,
          parentOccurrence,
          occurrence,
          node.move.from,
          node.move.to,
          node.move.promotion ?? null,
        ]);
        require(!moveKeys.has(move) || moveKeys.get(move) === identity);
        moveKeys.set(move, identity);
      }
    }
    if (metadata.sourcePath !== null) {
      const path = metadata.sourcePath,
        pathRoot = rules.parseFen(path.rootFen);
      require(pathRoot.ok && pathRoot.value.fen === path.rootFen);
      const played = await playTransferMoves(
        rules,
        withKnowledge(pathRoot.value, path.historyKnowledge.root),
        path.moves,
        check,
      );
      require(played.states[played.states.length - 1]!.fen === root.fen);
    }
  }
  const witnessState = (witness: TransferWitness): ChessState => {
    const record = records.get(witness.record);
    require(record);
    return transferState(output[record.pgnIndex]!, witness.node);
  };
  const matches = (
    anchor: TransferAnchor,
    recordId: string,
    node: number,
  ): boolean => {
    const record = records.get(recordId);
    require(record);
    require(node >= 0 && node < record.nodes.length);
    if (anchor.kind === 'position')
      return (
        witnessState(anchor.witness).position.positionKey ===
        transferState(output[record.pgnIndex]!, node).position.positionKey
      );
    if (anchor.item !== record.item) return false;
    if (anchor.kind === 'item') return node === 0;
    return anchor.kind === 'occurrence'
      ? record.nodes[node]![0] === anchor.occurrence
      : record.nodes[node]![1] === anchor.move;
  };
  const canonicalAnchors = new Set<string>();
  for (const anchor of anchors.values()) {
    if (++work % transferWorkBatch.objects === 0)
      await yieldTransferWork(check);
    check();
    let identity: string;
    if (anchor.kind === 'position')
      identity = `position:${witnessState(anchor.witness).position.positionKey}`;
    else {
      require(items.has(anchor.item));
      if (anchor.kind === 'item') identity = `item:${anchor.item}`;
      else if (anchor.kind === 'occurrence') {
        require(occurrences.get(anchor.occurrence)?.item === anchor.item);
        identity = `occurrence:${anchor.occurrence}`;
      } else {
        require(
          moveKeys.has(anchor.move) &&
            JSON.parse(moveKeys.get(anchor.move)!)[0] === anchor.item,
        );
        identity = `move:${anchor.move}`;
      }
    }
    require(!canonicalAnchors.has(identity));
    canonicalAnchors.add(identity);
  }
  const usedAnchors = new Set<string>();
  for (const contribution of manifest.contributions) {
    if (++work % transferWorkBatch.objects === 0)
      await yieldTransferWork(check);
    check();
    const anchor = anchors.get(contribution.anchor);
    require(anchor);
    usedAnchors.add(anchor.id);
    if (contribution.movesRoot !== null) {
      const witness = contribution.movesRoot;
      witnessState(witness);
      require(matches(anchor, witness.record, witness.node));
      await playTransferMoves(
        rules,
        witnessState(witness),
        contribution.moves,
        check,
      );
    }
  }
  const originWitnesses = new Map<string, TransferWitness>();
  for (const record of manifest.records) {
    if (++work % transferWorkBatch.objects === 0)
      await yieldTransferWork(check);
    check();
    const origin = record.origin;
    if (origin.kind !== 'inventory_anchor') continue;
    const source = records.get(origin.revision),
      anchor = anchors.get(origin.anchor);
    require(source && source.item === origin.item && anchor);
    usedAnchors.add(anchor.id);
    let node = -1;
    for (let index = 0; index < source.nodes.length; index++) {
      if (index % transferWorkBatch.objects === 0)
        await yieldTransferWork(check);
      if (matches(anchor, source.id, index)) {
        node = index;
        break;
      }
    }
    require(node >= 0);
    originWitnesses.set(record.id, { record: source.id, node });
    const sourceTree = output[source.pgnIndex]!,
      target = output[record.pgnIndex]!;
    if (record.sourcePath === null)
      require(transferState(sourceTree, node).fen === target.root.fen);
  }
  // Resolve inherited prefixes only after every origin is bound, including later records.
  for (const record of manifest.records) {
    const path = record.sourcePath;
    const origin = originWitnesses.get(record.id);
    if (path === null || origin === undefined) continue;
    const segments: (readonly TransferMove[])[] = [];
    const visited = new Set<string>([record.id]);
    let witness: TransferWitness | undefined = origin;
    let rootFen = '';
    let prefixLength = 0;
    while (witness !== undefined) {
      await yieldTransferWork(check);
      require(!visited.has(witness.record));
      visited.add(witness.record);
      const source = records.get(witness.record)!;
      const sourceTree = output[source.pgnIndex]!;
      const local: TransferMove[] = [];
      let cursor: number | null = witness.node === 0 ? null : witness.node - 1;
      while (cursor !== null) {
        if (local.length % transferWorkBatch.objects === 0)
          await yieldTransferWork(check);
        const step = sourceTree.nodes[cursor]!;
        local.push({
          from: step.move.from,
          to: step.move.to,
          promotion: step.move.promotion ?? null,
        });
        require(++prefixLength <= path.moves.length);
        cursor = step.parentNodeIndex;
      }
      segments.push(local.reverse());
      if (source.sourcePath !== null) {
        prefixLength += source.sourcePath.moves.length;
        require(prefixLength <= path.moves.length);
        segments.push(source.sourcePath.moves);
        rootFen = source.sourcePath.rootFen;
        break;
      }
      rootFen = sourceTree.root.fen;
      witness = originWitnesses.get(source.id);
    }
    require(path.rootFen === rootFen);
    let index = 0;
    for (const segment of segments.reverse()) {
      for (const step of segment) {
        if (index % transferWorkBatch.objects === 0)
          await yieldTransferWork(check);
        const move = path.moves[index++]!;
        require(
          step.from === move.from &&
            step.to === move.to &&
            step.promotion === move.promotion,
        );
      }
    }
    const parsed = rules.parseFen(path.rootFen);
    require(parsed.ok);
    const played = await playTransferMoves(
      rules,
      parsed.value,
      path.moves.slice(0, prefixLength),
      check,
    );
    require(
      played.states[played.states.length - 1]!.fen === witnessState(origin).fen,
    );
  }
  require(usedAnchors.size === anchors.size);
  // Follow exactly the selected roots and their provenance, never base/history edges.
  const selected = new Set(heads),
    ordered = [...heads],
    firstRetained = new Map<string, string>();
  const done = new Set<string>();
  for (const head of heads) {
    let cursor: string | undefined = head;
    const visiting = new Set<string>();
    while (cursor !== undefined && !done.has(cursor)) {
      if (++work % transferWorkBatch.objects === 0)
        await yieldTransferWork(check);
      check();
      require(!visiting.has(cursor));
      visiting.add(cursor);
      const record = records.get(cursor);
      require(record);
      if (!firstRetained.has(record.item))
        firstRetained.set(record.item, record.id);
      if (!selected.has(cursor)) {
        selected.add(cursor);
        ordered.push(cursor);
      }
      cursor =
        record.origin.kind === 'inventory_anchor'
          ? record.origin.revision
          : undefined;
    }
    for (const id of visiting) done.add(id);
  }
  require(
    ordered.length === manifest.records.length &&
      ordered.every((id, index) => manifest.records[index]!.id === id),
  );
  for (const item of items.values())
    if (item.role === 'provenanceOnly')
      require(firstRetained.get(item.id) === item.retainedRevision);
  require(new Set(manifest.records.map((r) => r.item)).size === items.size);
  check();
  return output;
}
