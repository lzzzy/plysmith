import assert from 'node:assert/strict';
import type {
  InventoryTransferSnapshot,
  TransferChessRecord,
  TransferItem,
  TransferMove,
  TransferRecord,
  TransferSourcePath,
} from '../../app/application/inventory/pgn-transfer-models.ts';
import { ChessJsRulesAdapter } from '../../app/infrastructure/adapters/chess_rules/chess_js/index.ts';

export function inheritedSourcePathSnapshot(
  sourceHasPath: boolean,
  sourcesAfter: boolean,
): InventoryTransferSnapshot {
  const rules = new ChessJsRulesAdapter();
  const root = rules.initialState();
  const states = [root];
  const played = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'e2e4', 'e7e5'].map(
    (value) => {
      const result = rules.applyMove(states.at(-1)!, [], {
        kind: 'coordinates',
        value,
      });
      assert(result.ok);
      states.push(result.value.after);
      return result.value;
    },
  );
  const moves: TransferMove[] = played.map(({ move }) => ({
    from: move.from,
    to: move.to,
    promotion: move.promotion ?? null,
  }));
  const sourcePath = (length: number): TransferSourcePath => ({
    title: 'Inherited source path',
    rootFen: root.fen,
    moves: moves.slice(0, length),
    historyKnowledge: {
      root: 'unknown',
      before: moves
        .slice(0, length)
        .map((_, i) => (i % 2 === 0 ? 'unknown' : 'complete')),
      after: moves.slice(0, length).map(() => 'partial'),
    },
  });
  const trees: TransferChessRecord[] = [
    {
      root,
      nodes: played.slice(0, 4).map((step, index) => ({
        nodeIndex: index,
        parentNodeIndex: index === 0 ? null : index - 1,
        siblingOrder: 0,
        move: step.move,
        after: step.after,
        comments: [],
        startingComments: [],
      })),
      result: '*',
    },
    {
      root: states[4]!,
      nodes: [
        {
          nodeIndex: 0,
          parentNodeIndex: null,
          siblingOrder: 0,
          move: played[4]!.move,
          after: played[4]!.after,
          comments: [],
          startingComments: [],
        },
      ],
      result: '*',
    },
    { root: states[6]!, nodes: [], result: '*' },
  ];
  const order = sourcesAfter ? [2, 1, 0] : [0, 1, 2];
  const key = (prefix: string, index: number) =>
    `${prefix}${order.indexOf(index) + 1}`;
  const time = '2026-10-12T12:00:00.000Z';
  return {
    dataRevision: 1,
    records: order.map((index) => trees[index]!),
    manifest: {
      version: 1,
      carrier: false,
      folders: [],
      items: order.map<TransferItem>((index) => ({
        id: key('i', index),
        role: sourcesAfter && index !== 2 ? 'provenanceOnly' : 'inventory',
        itemType:
          index === 2 || (index === 1 && sourceHasPath) ? 'game' : 'analysis',
        originKind: 'manual',
        lifecycle: sourcesAfter && index !== 2 ? 'trashed' : 'active',
        folder: null,
        currentRevision: sourcesAfter && index !== 2 ? null : key('r', index),
        retainedRevision: sourcesAfter && index !== 2 ? key('r', index) : null,
        createdAt: time,
        updatedAt: time,
      })),
      records: order.map<TransferRecord>((index, pgnIndex) => ({
        id: key('r', index),
        item: key('i', index),
        pgnIndex,
        revisionNumber: 1,
        baseRevision: null,
        changeKind: 'created',
        name: ['Ancestor', 'Intermediate', 'Final game'][index]!,
        summary: null,
        languageTag: 'en-GB',
        creatorRole: 'user',
        createdAt: time,
        origin:
          index === 0
            ? { kind: 'initial_position' }
            : {
                kind: 'inventory_anchor',
                item: key('i', index - 1),
                revision: key('r', index - 1),
                anchor: `a${index}`,
              },
        nodes: [
          [`o${index * 10 + 1}`, null, 'unknown'],
          ...trees[index]!.nodes.map(
            (node) =>
              [
                `o${index * 10 + node.nodeIndex + 2}`,
                `m${index * 10 + node.nodeIndex + 1}`,
                'partial',
              ] as const,
          ),
        ],
        game: null,
        sourcePath:
          index === 2
            ? sourcePath(6)
            : index === 1 && sourceHasPath
              ? sourcePath(4)
              : null,
      })),
      anchors: [
        {
          id: 'a1',
          kind: 'occurrence',
          item: key('i', 0),
          occurrence: sourceHasPath ? 'o3' : 'o5',
        },
        {
          id: 'a2',
          kind: 'move_node',
          item: key('i', 1),
          move: 'm11',
        },
      ],
      contributions: [],
    },
  };
}
