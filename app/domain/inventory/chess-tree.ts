import type { CanonicalMove, ChessState } from '../chess_graph/index.ts';
import type { AnchorId } from '../identity/index.ts';

export interface ChessTreeNode {
  readonly nodeIndex: number;
  readonly parentNodeIndex: number | null;
  readonly siblingOrder: number;
  readonly anchorId: AnchorId;
  readonly move: CanonicalMove;
  readonly after: ChessState;
}

export interface ChessTree {
  readonly nodes: readonly ChessTreeNode[];
}
