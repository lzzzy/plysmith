import type { ChessTreeCandidate } from '../../domain/inventory/chess-tree-candidate.ts';
import { IMPORT_LIMITS } from './import-limits.ts';
import { importProblem } from './import-problems.ts';

export interface ImportContentBudget {
  readonly nodes: number;
  readonly noteCharacters: number;
}

export function measureImportCandidate(
  candidate: ChessTreeCandidate,
): ImportContentBudget {
  if (
    candidate.nodes.length > IMPORT_LIMITS.maxNodesPerCandidate ||
    candidate.findings.length > IMPORT_LIMITS.maxFindingsPerCandidate
  )
    throw importProblem('provider_resource_exhausted');
  const depths: number[] = [];
  const children = new Map<number | null, number>();
  const notes = new Map<number | null, number>();
  let noteCharacters = 0;
  const addComments = (
    anchor: number | null,
    comments: readonly string[],
  ): void => {
    for (const comment of comments) {
      const length = comment.length;
      if (length === 0) continue;
      const existing = notes.get(anchor) ?? 0;
      const additional = length + (existing === 0 ? 0 : 2);
      if (existing + additional > IMPORT_LIMITS.maxSingleNoteCharacters)
        throw importProblem('provider_resource_exhausted');
      notes.set(anchor, existing + additional);
      noteCharacters += additional;
    }
  };
  addComments(null, candidate.initialComments);
  for (const [index, node] of candidate.nodes.entries()) {
    const parent = node.parentNodeIndex;
    if (
      node.nodeIndex !== index ||
      (parent !== null &&
        (!Number.isSafeInteger(parent) || parent < 0 || parent >= index))
    )
      throw importProblem('invalid_candidate');
    const depth = (parent === null ? 0 : depths[parent]!) + 1;
    const count = (children.get(parent) ?? 0) + 1;
    if (
      depth > IMPORT_LIMITS.maxPathHalfMoves ||
      count > IMPORT_LIMITS.maxAlternativesPerOccurrence + 1
    )
      throw importProblem('provider_resource_exhausted');
    depths.push(depth);
    children.set(parent, count);
    addComments(index, node.comments);
    addComments(parent, node.startingComments);
  }
  return { nodes: candidate.nodes.length, noteCharacters };
}

export function assertImportPublicationBudget(
  candidates: readonly ChessTreeCandidate[],
): void {
  if (candidates.length > IMPORT_LIMITS.maxPublishedCandidates)
    throw importProblem('invalid_selection');
  let nodes = 0;
  let noteCharacters = 0;
  for (const candidate of candidates) {
    const budget = measureImportCandidate(candidate);
    nodes += budget.nodes;
    noteCharacters += budget.noteCharacters;
    if (
      nodes > IMPORT_LIMITS.maxPublicationNodes ||
      noteCharacters > IMPORT_LIMITS.maxNoteCharacters
    )
      throw importProblem('provider_resource_exhausted');
  }
}
