import type { AnalysisScratchStep } from '../analysis/index.ts';
import {
  currentAnalysisMoves,
  type AnalysisScratch,
} from '../analysis/index.ts';
import type { ChessState } from '../chess_graph/index.ts';

export interface AnalysisRecordDraft {
  readonly displayName: string;
  readonly languageTag: string;
  readonly originMode: 'initial_position' | 'fen' | 'inventory_anchor';
  readonly root: ChessState;
  readonly steps: readonly AnalysisScratchStep[];
  readonly note?: AnalysisScratch['noteDraft'];
}

export function createAnalysisRecordDraft(input: {
  readonly displayName: string;
  readonly languageTag: string;
  readonly scratch: AnalysisScratch;
}): AnalysisRecordDraft {
  if (input.scratch.intent.kind !== 'exploration') {
    throw new Error(
      'An inventory revision scratch cannot create another item.',
    );
  }
  requireTrimmedText(input.displayName, 200, 'display name');
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(input.languageTag)) {
    throw new Error('An analysis record requires a BCP-47 language tag.');
  }
  const currentMoves = currentAnalysisMoves(input.scratch);
  if (currentMoves.length === 0) {
    throw new Error('An analysis record requires a move path.');
  }
  const noteDraft = input.scratch.noteDraft;
  if (noteDraft !== undefined) {
    requireTrimmedText(noteDraft.body, 100_000, 'note');
  }

  return Object.freeze({
    displayName: input.displayName,
    languageTag: input.languageTag,
    originMode: input.scratch.origin.kind,
    root: input.scratch.root,
    steps: Object.freeze(input.scratch.steps.slice(0, input.scratch.cursor)),
    ...(noteDraft === undefined
      ? {}
      : {
          note: Object.freeze({
            body: noteDraft.body,
            moves: Object.freeze([]),
          }),
        }),
  });
}

function requireTrimmedText(value: string, max: number, name: string): void {
  if (value.trim() !== value || value.length === 0 || value.length > max) {
    throw new Error(`An analysis record requires a valid ${name}.`);
  }
}
