import type {
  AppliedMove,
  CanonicalMove,
  ChessState,
} from '../chess_graph/index.ts';

export interface AnalysisRecordDraft {
  readonly displayName: string;
  readonly languageTag: string;
  readonly originMode:
    'initial_position' | 'fen' | 'position_setup' | 'inventory_anchor';
  readonly root: ChessState;
  readonly steps: readonly AppliedMove[];
  readonly note?: {
    readonly body: string;
    readonly moves: readonly CanonicalMove[];
  };
}

export function createAnalysisRecordDraft(input: {
  readonly displayName: string;
  readonly languageTag: string;
  readonly originMode: AnalysisRecordDraft['originMode'];
  readonly root: ChessState;
  readonly steps: readonly AppliedMove[];
  readonly noteBody?: string;
}): AnalysisRecordDraft {
  requireTrimmedText(input.displayName, 160, 'display name');
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(input.languageTag)) {
    throw new Error('An analysis record requires a BCP-47 language tag.');
  }
  if (input.noteBody !== undefined) {
    requireTrimmedText(input.noteBody, 128_000, 'note');
  }

  return Object.freeze({
    displayName: input.displayName,
    languageTag: input.languageTag,
    originMode: input.originMode,
    root: input.root,
    steps: Object.freeze([...input.steps]),
    ...(input.noteBody === undefined
      ? {}
      : {
          note: Object.freeze({
            body: input.noteBody,
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
