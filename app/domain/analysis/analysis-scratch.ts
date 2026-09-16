import type {
  AppliedMove,
  CanonicalMove,
  ChessState,
} from '../chess_graph/index.ts';
import type {
  AnchorId,
  InventoryItemId,
  ItemRevisionId,
} from '../identity/index.ts';

export type AnalysisScratchOrigin =
  | { readonly kind: 'initial_position' }
  | { readonly kind: 'fen' }
  | {
      readonly kind: 'inventory_anchor';
      readonly itemId: InventoryItemId;
      readonly revisionId: ItemRevisionId;
      readonly anchorId: AnchorId;
    };

export type AnalysisScratchIntent =
  | { readonly kind: 'exploration' }
  | {
      readonly kind: 'inventory_revision';
      readonly mode: 'extend' | 'truncate_after' | 'replace_move' | 'metadata';
      readonly itemId: InventoryItemId;
      readonly baseRevisionId: ItemRevisionId;
      readonly cutAnchorId: AnchorId;
      readonly returnAnchorId: AnchorId;
      readonly displayName: string;
      readonly summary?: string;
    };

export interface AnalysisNoteDraft {
  readonly moves: readonly CanonicalMove[];
  readonly body: string;
}

export type AnalysisScratchStep = AppliedMove;

export interface AnalysisScratch {
  readonly scratchId: string;
  readonly scratchRevision: number;
  readonly origin: AnalysisScratchOrigin;
  readonly intent: AnalysisScratchIntent;
  readonly root: ChessState;
  readonly steps: readonly AnalysisScratchStep[];
  readonly cursor: number;
  readonly noteDraft?: AnalysisNoteDraft;
}

export function startAnalysisScratch(
  scratchId: string,
  root: ChessState,
  origin: AnalysisScratchOrigin = { kind: 'initial_position' },
  intent: AnalysisScratchIntent = { kind: 'exploration' },
): AnalysisScratch {
  if (scratchId.trim().length === 0) {
    throw new Error('An analysis scratch requires an identifier.');
  }
  return freezeScratch({
    scratchId,
    scratchRevision: 1,
    origin,
    intent,
    root,
    steps: [],
    cursor: 0,
  });
}

export function currentAnalysisState(scratch: AnalysisScratch): ChessState {
  return scratch.cursor === 0
    ? scratch.root
    : requireStep(scratch.steps, scratch.cursor - 1).after;
}

export function currentAnalysisMoves(
  scratch: AnalysisScratch,
): readonly CanonicalMove[] {
  return Object.freeze(
    scratch.steps.slice(0, scratch.cursor).map((step) => step.move),
  );
}

export function appendAnalysisMove(
  scratch: AnalysisScratch,
  applied: AppliedMove,
): AnalysisScratch {
  if (
    applied.before.position.positionKey !==
      currentAnalysisState(scratch).position.positionKey ||
    applied.before.fen !== currentAnalysisState(scratch).fen
  ) {
    throw new Error('The applied move does not continue the scratch cursor.');
  }
  const steps = [...scratch.steps.slice(0, scratch.cursor), applied];
  return freezeScratch({
    ...withoutNoteDraft(scratch),
    scratchRevision: scratch.scratchRevision + 1,
    steps,
    cursor: steps.length,
  });
}

export function removeLastAnalysisMove(
  scratch: AnalysisScratch,
): AnalysisScratch {
  if (scratch.steps.length === 0 || scratch.cursor !== scratch.steps.length) {
    throw new Error('Only the final analysis move can be removed.');
  }
  const steps = scratch.steps.slice(0, -1);
  return freezeScratch({
    ...withoutNoteDraft(scratch),
    scratchRevision: scratch.scratchRevision + 1,
    steps,
    cursor: steps.length,
  });
}

export function replaceAnalysisScratchIntent(
  scratch: AnalysisScratch,
  intent: AnalysisScratchIntent,
): AnalysisScratch {
  return freezeScratch({
    ...withoutNoteDraft(scratch),
    scratchRevision: scratch.scratchRevision + 1,
    intent,
  });
}

export function moveAnalysisCursor(
  scratch: AnalysisScratch,
  cursor: number,
): AnalysisScratch {
  if (
    !Number.isInteger(cursor) ||
    cursor < 0 ||
    cursor > scratch.steps.length
  ) {
    throw new Error('An analysis cursor must address an existing step.');
  }
  if (cursor === scratch.cursor) return scratch;
  return freezeScratch({
    ...withoutNoteDraft(scratch),
    scratchRevision: scratch.scratchRevision + 1,
    cursor,
  });
}

export function prepareAnalysisNote(
  scratch: AnalysisScratch,
  body: string,
): AnalysisScratch {
  const moves = currentAnalysisMoves(scratch);
  if (moves.length === 0) {
    throw new Error('A move path is required for an analysis note draft.');
  }
  return freezeScratch({
    ...scratch,
    scratchRevision: scratch.scratchRevision + 1,
    noteDraft: Object.freeze({ moves, body }),
  });
}

export function clearAnalysisNote(scratch: AnalysisScratch): AnalysisScratch {
  if (scratch.noteDraft === undefined) {
    throw new Error('An analysis note draft is required.');
  }
  return freezeScratch({
    ...withoutNoteDraft(scratch),
    scratchRevision: scratch.scratchRevision + 1,
  });
}

function requireStep(
  steps: readonly AnalysisScratchStep[],
  index: number,
): AnalysisScratchStep {
  const step = steps[index];
  if (step === undefined) throw new Error('Analysis scratch is inconsistent.');
  return step;
}

function freezeScratch(input: AnalysisScratch): AnalysisScratch {
  const base = {
    scratchId: input.scratchId,
    scratchRevision: input.scratchRevision,
    origin: freezeOrigin(input.origin),
    intent: freezeIntent(input.intent),
    root: input.root,
    steps: Object.freeze(
      input.steps.map((step) =>
        Object.freeze({
          before: step.before,
          move: Object.freeze({ ...step.move }),
          after: step.after,
        }),
      ),
    ),
    cursor: input.cursor,
  };
  if (input.noteDraft === undefined) return Object.freeze(base);
  return Object.freeze({
    ...base,
    noteDraft: Object.freeze({
      body: input.noteDraft.body,
      moves: Object.freeze(
        input.noteDraft.moves.map((move) => Object.freeze({ ...move })),
      ),
    }),
  });
}

function freezeIntent(intent: AnalysisScratchIntent): AnalysisScratchIntent {
  return Object.freeze(
    intent.kind === 'exploration'
      ? { kind: intent.kind }
      : {
          kind: intent.kind,
          mode: intent.mode,
          itemId: intent.itemId,
          baseRevisionId: intent.baseRevisionId,
          cutAnchorId: intent.cutAnchorId,
          returnAnchorId: intent.returnAnchorId,
          displayName: intent.displayName,
          ...(intent.summary === undefined ? {} : { summary: intent.summary }),
        },
  );
}

function freezeOrigin(origin: AnalysisScratchOrigin): AnalysisScratchOrigin {
  return Object.freeze(
    origin.kind === 'inventory_anchor'
      ? {
          kind: origin.kind,
          itemId: origin.itemId,
          revisionId: origin.revisionId,
          anchorId: origin.anchorId,
        }
      : { kind: origin.kind },
  );
}

function withoutNoteDraft(
  scratch: AnalysisScratch,
): Omit<AnalysisScratch, 'noteDraft'> {
  return {
    scratchId: scratch.scratchId,
    scratchRevision: scratch.scratchRevision,
    origin: scratch.origin,
    intent: scratch.intent,
    root: scratch.root,
    steps: scratch.steps,
    cursor: scratch.cursor,
  };
}
