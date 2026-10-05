import type { ChessTreeCandidate } from '../../domain/inventory/chess-tree-candidate.ts';
import { ApplicationProblem } from '../problems/application-problem.ts';

export interface ContentFormatLimits {
  readonly maxInputCharacters: number;
  readonly maxCandidateCharacters: number;
  readonly maxCandidates: number;
  readonly maxNodesPerCandidate: number;
  readonly maxVariationDepth: number;
  readonly maxHeadersPerCandidate: number;
  readonly maxStringCharacters: number;
  readonly maxLineCharacters: number;
  readonly maxSyntaxCharacters: number;
  readonly maxTokensPerCandidate: number;
  readonly maxCommentsPerCandidate: number;
  readonly maxVariationsPerCandidate: number;
}

export interface ContentFormatRequest {
  readonly signal: AbortSignal;
  /** Emitted candidates remain provisional until decoding completes. */
  readonly onCandidate: (candidate: ChessTreeCandidate) => Promise<void>;
}

export interface ContentFormatPort {
  readonly descriptor: {
    readonly formatId: string;
    readonly fileExtensions: readonly string[];
    readonly adapterVersion: string;
    readonly limits: ContentFormatLimits;
  };
  /** Source owns strict streaming UTF-8 decoding and explicit Latin-1 retry. */
  decode(
    chunks: AsyncIterable<string>,
    request: ContentFormatRequest,
  ): Promise<void>;
}

export type ContentFormatProblemCode =
  | 'interrupted'
  | 'input_too_large'
  | 'provider_resource_exhausted'
  | 'format_not_recognized';

export class ContentFormatError extends ApplicationProblem {
  readonly code: ContentFormatProblemCode;

  constructor(code: ContentFormatProblemCode) {
    super(`import.${code}`, `Import: ${code}.`);
    this.name = 'ContentFormatError';
    this.code = code;
  }
}
