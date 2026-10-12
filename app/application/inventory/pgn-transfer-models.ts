import type {
  ChessState,
  HistoryKnowledge,
  PromotionPiece,
} from '../../domain/chess_graph/index.ts';
import type { ImportedMoveNode } from '../../domain/inventory/chess-tree-candidate.ts';
import type { InventoryRevisionMode } from '../../domain/inventory/inventory-revision.ts';

export interface TransferMove {
  readonly from: string;
  readonly to: string;
  readonly promotion: PromotionPiece | null;
}

export interface TransferWitness {
  readonly record: string;
  readonly node: number;
}

export type TransferOrigin =
  | { readonly kind: 'initial_position' | 'fen' | 'position_setup' }
  | {
      readonly kind: 'inventory_anchor';
      readonly item: string;
      readonly revision: string;
      readonly anchor: string;
    };

export interface TransferFolder {
  readonly id: string;
  readonly parent: string | null;
  readonly name: string;
}

export interface TransferItem {
  readonly id: string;
  readonly role: 'inventory' | 'provenanceOnly';
  readonly itemType: 'analysis' | 'game';
  readonly originKind:
    | 'manual'
    | 'structured_import'
    | 'playout'
    | 'live_observed'
    | 'live_played';
  readonly lifecycle: 'active' | 'archived' | 'trashed' | 'tombstone';
  readonly folder: string | null;
  readonly currentRevision: string | null;
  readonly retainedRevision: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TransferGameFacts {
  readonly playerSide: 'white' | 'black';
  readonly result: {
    readonly kind: 'white_win' | 'black_win' | 'draw' | 'unfinished';
    readonly source: 'manual' | 'automatic';
    readonly reason:
      | 'checkmate'
      | 'stalemate'
      | 'insufficient_material'
      | 'threefold_repetition'
      | 'seventy_five_move'
      | null;
  };
  readonly policy: {
    readonly capability: 'best_move' | 'human_profile';
    readonly providerInstanceId: string;
    readonly providerFingerprint: string;
    readonly providerType: string;
    readonly providerDisplayName: string;
    readonly profile: {
      readonly modelName: string;
      readonly selectionMode: 'most_likely' | 'sampled';
      readonly historyMode: 'known_position_history' | 'position_only';
      readonly reproducibility: 'deterministic' | 'stochastic';
    } | null;
  };
}

export interface TransferSourcePath {
  readonly title: string;
  readonly rootFen: string;
  readonly moves: readonly TransferMove[];
  readonly historyKnowledge: {
    readonly root: HistoryKnowledge;
    readonly before: readonly HistoryKnowledge[];
    readonly after: readonly HistoryKnowledge[];
  };
}

export type TransferNode = readonly [
  occurrence: string,
  move: string | null,
  historyKnowledge: HistoryKnowledge,
];

export interface TransferRecord {
  readonly id: string;
  readonly item: string;
  readonly pgnIndex: number;
  readonly revisionNumber: number;
  readonly baseRevision: string | null;
  readonly changeKind: 'created' | InventoryRevisionMode;
  readonly name: string;
  readonly summary: string | null;
  readonly languageTag: string;
  readonly creatorRole: 'user' | 'importer' | 'playout' | 'live';
  readonly createdAt: string;
  readonly origin: TransferOrigin;
  readonly nodes: readonly TransferNode[];
  readonly game: TransferGameFacts | null;
  readonly sourcePath: TransferSourcePath | null;
}

export type TransferAnchor =
  | { readonly id: string; readonly kind: 'item'; readonly item: string }
  | {
      readonly id: string;
      readonly kind: 'position';
      readonly witness: TransferWitness;
    }
  | {
      readonly id: string;
      readonly kind: 'occurrence';
      readonly item: string;
      readonly occurrence: string;
    }
  | {
      readonly id: string;
      readonly kind: 'move_node';
      readonly item: string;
      readonly move: string;
    };

export interface TransferContribution {
  readonly id: string;
  readonly anchor: string;
  readonly contributionType:
    'note' | 'question' | 'decision' | 'machine_finding' | 'source_statement';
  readonly authorRole: 'user' | 'engine' | 'source';
  readonly body: string;
  readonly rationale: string | null;
  readonly languageTag: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly moves: readonly TransferMove[];
  readonly movesRoot: TransferWitness | null;
}

export interface PgnTransferManifest {
  readonly version: 1;
  readonly pgnSha256: string;
  readonly carrier: boolean;
  readonly folders: readonly TransferFolder[];
  readonly items: readonly TransferItem[];
  readonly records: readonly TransferRecord[];
  readonly anchors: readonly TransferAnchor[];
  readonly contributions: readonly TransferContribution[];
}

export interface TransferChessRecord {
  readonly root: ChessState;
  readonly nodes: readonly ImportedMoveNode[];
  readonly result: '1-0' | '0-1' | '1/2-1/2' | '*';
}

export interface InventoryTransferSnapshot {
  readonly manifest: Omit<PgnTransferManifest, 'pgnSha256'>;
  readonly records: readonly TransferChessRecord[];
  readonly dataRevision: number;
}

export interface PreparedInventoryRestore {
  readonly manifest: PgnTransferManifest;
  readonly records: readonly TransferChessRecord[];
}
