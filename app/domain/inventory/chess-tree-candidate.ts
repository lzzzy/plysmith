import type { CanonicalMove, ChessState } from '../chess_graph/index.ts';

export interface ImportFidelityFinding {
  readonly code: string;
  readonly disposition:
    'preserved' | 'normalized' | 'preserved_opaque' | 'unsupported' | 'invalid';
  readonly severity: 'info' | 'warning' | 'error';
  readonly feature: string;
  readonly nodeIndex?: number;
}

export interface ImportedMoveNode {
  readonly nodeIndex: number;
  readonly parentNodeIndex: number | null;
  readonly siblingOrder: number;
  readonly move: CanonicalMove;
  readonly after: ChessState;
  /** Transient author comments for the position after this move. */
  readonly comments: readonly string[];
  /** Transient comments for the branch origin: parentNodeIndex, or the root. */
  readonly startingComments: readonly string[];
}

export interface ChessTreeCandidate {
  readonly sourceOrder: number;
  readonly suggestedName: string;
  readonly status: 'ready' | 'warning' | 'rejected';
  readonly root?: ChessState;
  /** Stable zero-based preorder; sibling zero continues the main path. */
  readonly nodes: readonly ImportedMoveNode[];
  /** Transient root comments, including readable game tags. */
  readonly initialComments: readonly string[];
  readonly result: '1-0' | '0-1' | '1/2-1/2' | '*';
  readonly findings: readonly ImportFidelityFinding[];
}
