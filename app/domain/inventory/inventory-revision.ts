import type { AppliedMove, ChessState } from '../chess_graph/index.ts';
import type {
  AnchorId,
  InventoryItemId,
  ItemRevisionId,
} from '../identity/index.ts';

export type InventoryRevisionMode =
  'extend' | 'truncate_after' | 'replace_move' | 'metadata' | 'add_variation';

export interface InventoryRevisionLineStep extends AppliedMove {
  readonly anchorId: AnchorId;
}

export interface InventoryRevisionLine {
  readonly itemId: InventoryItemId;
  readonly revisionId: ItemRevisionId;
  readonly rootAnchorId: AnchorId;
  readonly root: ChessState;
  readonly steps: readonly InventoryRevisionLineStep[];
  readonly displayName: string;
  readonly summary?: string;
}

export interface InventoryRevisionPlan {
  readonly mode: InventoryRevisionMode;
  readonly cutAnchorId: AnchorId;
  readonly returnAnchorId: AnchorId;
  readonly preservedSteps: readonly InventoryRevisionLineStep[];
  readonly removedSteps: readonly InventoryRevisionLineStep[];
  readonly scratchRoot: ChessState;
  readonly intent: {
    readonly kind: 'inventory_revision';
    readonly mode: InventoryRevisionMode;
    readonly itemId: InventoryItemId;
    readonly baseRevisionId: ItemRevisionId;
    readonly cutAnchorId: AnchorId;
    readonly returnAnchorId: AnchorId;
    readonly displayName: string;
    readonly summary?: string;
  };
}

export interface InventoryRevisionCandidate {
  readonly intent: InventoryRevisionPlan['intent'];
  readonly root: ChessState;
  readonly steps: readonly AppliedMove[];
}

export function planInventoryRevision(input: {
  readonly line: InventoryRevisionLine;
  readonly mode: InventoryRevisionMode;
  readonly anchorId: AnchorId;
  readonly lineAnchorId?: AnchorId;
  readonly displayName?: string;
  readonly summary?: string | null;
}): InventoryRevisionPlan {
  const anchorIndex = lineAnchorIndex(input.line, input.anchorId);
  if (anchorIndex === undefined) {
    throw new Error('An inventory revision anchor must belong to its line.');
  }
  if (
    input.lineAnchorId !== undefined &&
    (input.mode !== 'truncate_after' ||
      (lineAnchorIndex(input.line, input.lineAnchorId) ?? -1) <= anchorIndex)
  ) {
    throw new Error('A truncation must select a continuation after its cut.');
  }

  let preservedCount: number;
  if (input.mode === 'metadata') {
    preservedCount = input.line.steps.length;
  } else if (input.mode === 'extend') {
    if (anchorIndex !== input.line.steps.length) {
      throw new Error('An inventory extension must start at the line end.');
    }
    preservedCount = anchorIndex;
  } else if (
    input.mode === 'truncate_after' ||
    input.mode === 'add_variation'
  ) {
    preservedCount = anchorIndex;
  } else {
    if (anchorIndex === 0) {
      throw new Error('Replacing a move requires a move anchor.');
    }
    preservedCount = anchorIndex - 1;
  }

  const cutAnchorId = anchorAt(input.line, preservedCount);
  const scratchRoot = stateAt(input.line, preservedCount);
  const preservedSteps = Object.freeze(
    input.line.steps.slice(0, preservedCount),
  );
  const removedSteps = Object.freeze(
    input.mode === 'add_variation'
      ? []
      : input.line.steps.slice(preservedCount),
  );
  const displayName = input.displayName ?? input.line.displayName;
  const summary =
    input.summary === undefined
      ? input.line.summary
      : (input.summary ?? undefined);
  if (displayName.trim().length < 1 || displayName.trim().length > 160) {
    throw new Error('An inventory revision requires a valid display name.');
  }
  const intent = Object.freeze({
    kind: 'inventory_revision' as const,
    mode: input.mode,
    itemId: input.line.itemId,
    baseRevisionId: input.line.revisionId,
    cutAnchorId,
    returnAnchorId: input.lineAnchorId ?? input.anchorId,
    displayName: displayName.trim(),
    ...(summary === undefined ? {} : { summary: summary.trim() }),
  });

  return Object.freeze({
    mode: input.mode,
    cutAnchorId,
    returnAnchorId: input.lineAnchorId ?? input.anchorId,
    preservedSteps,
    removedSteps,
    scratchRoot,
    intent,
  });
}

export function inventoryRevisionCandidateSteps(input: {
  readonly base: InventoryRevisionLine;
  readonly candidate: InventoryRevisionCandidate;
}): readonly AppliedMove[] {
  if (
    input.candidate.intent.kind !== 'inventory_revision' ||
    input.candidate.intent.itemId.value !== input.base.itemId.value ||
    input.candidate.intent.baseRevisionId.value !== input.base.revisionId.value
  ) {
    throw new Error('The analysis scratch is not a revision of this line.');
  }
  const preservedCount = lineAnchorIndex(
    input.base,
    input.candidate.intent.cutAnchorId,
  );
  if (preservedCount === undefined) {
    throw new Error('The revision cut anchor is not part of the base line.');
  }
  if (stateAt(input.base, preservedCount).fen !== input.candidate.root.fen) {
    throw new Error('The revision scratch does not form a complete suffix.');
  }
  if (
    input.candidate.intent.mode === 'replace_move' &&
    input.candidate.steps.length === 0
  ) {
    throw new Error('Replacing a move requires a replacement move.');
  }
  if (
    input.candidate.intent.mode === 'metadata' &&
    input.candidate.steps.length > 0
  ) {
    throw new Error('A metadata revision cannot change the move line.');
  }
  return Object.freeze([
    ...input.base.steps.slice(0, preservedCount),
    ...input.candidate.steps,
  ]);
}

export function inventoryRevisionHasChanges(input: {
  readonly base: InventoryRevisionLine;
  readonly candidate: InventoryRevisionCandidate;
}): boolean {
  const steps = inventoryRevisionCandidateSteps(input);
  const intent = input.candidate.intent;
  if (intent.kind !== 'inventory_revision') {
    throw new Error('An inventory revision intent is required.');
  }
  return (
    intent.displayName !== input.base.displayName ||
    intent.summary !== input.base.summary ||
    steps.length !== input.base.steps.length ||
    steps.some((step, index) => {
      const other = input.base.steps[index];
      return (
        other === undefined ||
        step.move.from !== other.move.from ||
        step.move.to !== other.move.to ||
        step.move.promotion !== other.move.promotion ||
        step.after.fen !== other.after.fen
      );
    })
  );
}

function lineAnchorIndex(
  line: InventoryRevisionLine,
  anchorId: AnchorId,
): number | undefined {
  if (line.rootAnchorId.value === anchorId.value) return 0;
  const index = line.steps.findIndex(
    (step) => step.anchorId.value === anchorId.value,
  );
  return index < 0 ? undefined : index + 1;
}

function anchorAt(line: InventoryRevisionLine, cursor: number): AnchorId {
  if (cursor === 0) return line.rootAnchorId;
  const step = line.steps[cursor - 1];
  if (step === undefined)
    throw new Error('The inventory line is inconsistent.');
  return step.anchorId;
}

function stateAt(line: InventoryRevisionLine, cursor: number): ChessState {
  if (cursor === 0) return line.root;
  const step = line.steps[cursor - 1];
  if (step === undefined)
    throw new Error('The inventory line is inconsistent.');
  return step.after;
}
