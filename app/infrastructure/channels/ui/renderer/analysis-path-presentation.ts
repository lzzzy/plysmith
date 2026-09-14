interface PathMove {
  readonly from: string;
  readonly to: string;
  readonly san: string;
}

export interface PathContribution {
  readonly contributionId: string;
  readonly anchorId: string;
  readonly body: string;
  readonly moves: readonly PathMove[];
  readonly languageTag: string;
  readonly scopeKind: 'global' | 'context';
  readonly contextId?: string;
  readonly contributionVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface PathState {
  readonly position: { readonly sideToMove: 'white' | 'black' };
  readonly playState: { readonly fullmoveNumber: number };
}

interface StoredPathStep {
  readonly anchorId: string;
  readonly before: PathState;
  readonly move: PathMove;
  readonly after?: PathState;
}

interface SourcePathStep extends StoredPathStep {
  readonly itemId: string;
  readonly revisionId: string;
}

interface ScratchPathStep {
  readonly before: PathState;
  readonly move: PathMove;
}

interface StoredPath {
  readonly itemId: string;
  readonly revisionId: string;
  readonly rootAnchorId: string;
  readonly currentAnchorId: string;
  readonly root?: PathState;
  readonly cursor: number;
  readonly contributions: readonly PathContribution[];
  readonly sourceLine?: {
    readonly sourceDisplayName: string;
    readonly root?: PathState;
    readonly rootTarget: {
      readonly itemId: string;
      readonly revisionId: string;
      readonly anchorId: string;
    };
    readonly steps: readonly SourcePathStep[];
    readonly contributions: readonly PathContribution[];
  };
  readonly steps: readonly StoredPathStep[];
}

interface ScratchPath {
  readonly origin:
    | { readonly kind: 'initial_position' }
    | { readonly kind: 'fen' }
    | {
        readonly kind: 'inventory_anchor';
        readonly itemId: string;
        readonly revisionId: string;
        readonly anchorId: string;
      };
  readonly cursor: number;
  readonly steps: readonly ScratchPathStep[];
  readonly noteDraft?: unknown;
}

export interface AnalysisPathEntry {
  readonly kind: 'source' | 'stored' | 'scratch';
  readonly before: PathState;
  readonly move: PathMove;
  readonly anchorId?: string;
  readonly scratchCursor?: number;
  readonly current: boolean;
  readonly branchOrigin: boolean;
  readonly noteTarget?: AnalysisNoteTarget;
}

export interface AnalysisNoteTarget {
  readonly itemId: string;
  readonly revisionId: string;
  readonly anchorId: string;
  readonly start?: PathState;
  readonly contributions: readonly PathContribution[];
}

export interface AnalysisPathPresentation {
  readonly entries: readonly AnalysisPathEntry[];
  readonly rootCurrent: boolean;
  readonly sourceDisplayName: string | undefined;
  readonly hasSourcePrefix: boolean;
  readonly hasStoredPrefix: boolean;
  readonly scratchCursor: number | undefined;
  readonly scratchLength: number | undefined;
  readonly sourceRootTarget: AnalysisNoteTarget | undefined;
  readonly recordRootTarget: AnalysisNoteTarget | undefined;
}

export function analysisPathPresentation(source: {
  readonly record?: StoredPath;
  readonly scratch?: ScratchPath;
}): AnalysisPathPresentation {
  const { record, scratch } = source;
  const sourceEntries = (record?.sourceLine?.steps ?? []).map(
    (step, index, all) =>
      Object.freeze({
        kind: 'source' as const,
        before: step.before,
        move: step.move,
        current: false,
        branchOrigin: index === all.length - 1,
        noteTarget: noteTarget(
          step.itemId,
          step.revisionId,
          step.anchorId,
          step.after,
          record?.sourceLine?.contributions ?? [],
        ),
      }),
  );
  const sourceRootTarget =
    record?.sourceLine === undefined
      ? undefined
      : noteTarget(
          record.sourceLine.rootTarget.itemId,
          record.sourceLine.rootTarget.revisionId,
          record.sourceLine.rootTarget.anchorId,
          record.sourceLine.root,
          record.sourceLine.contributions,
        );
  const recordRootTarget =
    record === undefined
      ? undefined
      : noteTarget(
          record.itemId,
          record.revisionId,
          record.rootAnchorId,
          record.root,
          record.contributions,
        );

  if (scratch === undefined) {
    const storedEntries = (record?.steps ?? []).map((step, index) =>
      Object.freeze({
        kind: 'stored' as const,
        before: step.before,
        move: step.move,
        anchorId: step.anchorId,
        current: record?.cursor === index + 1,
        branchOrigin: false,
        noteTarget: noteTarget(
          record!.itemId,
          record!.revisionId,
          step.anchorId,
          step.after,
          record!.contributions,
        ),
      }),
    );
    return Object.freeze({
      entries: Object.freeze([...sourceEntries, ...storedEntries]),
      rootCurrent: record?.cursor === 0,
      sourceDisplayName: record?.sourceLine?.sourceDisplayName,
      hasSourcePrefix: record?.sourceLine !== undefined,
      hasStoredPrefix: false,
      scratchCursor: undefined,
      scratchLength: undefined,
      sourceRootTarget,
      recordRootTarget,
    });
  }

  const attachedRecord =
    scratch.origin.kind === 'inventory_anchor' &&
    record !== undefined &&
    scratch.origin.itemId === record.itemId &&
    scratch.origin.revisionId === record.revisionId &&
    scratch.origin.anchorId === record.currentAnchorId;
  const storedPrefix = attachedRecord
    ? record.steps.slice(0, record.cursor)
    : [];
  const hasStoredPrefix = storedPrefix.length > 0;
  const storedEntries = storedPrefix.map((step, index) =>
    Object.freeze({
      kind: 'stored' as const,
      before: step.before,
      move: step.move,
      anchorId: step.anchorId,
      current: scratch.cursor === 0 && index === storedPrefix.length - 1,
      branchOrigin: index === storedPrefix.length - 1,
      noteTarget: noteTarget(
        record!.itemId,
        record!.revisionId,
        step.anchorId,
        step.after,
        record!.contributions,
      ),
    }),
  );
  const scratchEntries = scratch.steps.map((step, index) =>
    Object.freeze({
      kind: 'scratch' as const,
      before: step.before,
      move: step.move,
      scratchCursor: index + 1,
      current: scratch.cursor === index + 1,
      branchOrigin: false,
    }),
  );

  return Object.freeze({
    entries: Object.freeze([
      ...(attachedRecord ? sourceEntries : []),
      ...storedEntries,
      ...scratchEntries,
    ]),
    rootCurrent:
      scratch.cursor === 0 && (!attachedRecord || record.cursor === 0),
    sourceDisplayName: attachedRecord
      ? record.sourceLine?.sourceDisplayName
      : undefined,
    hasSourcePrefix: attachedRecord && record.sourceLine !== undefined,
    hasStoredPrefix,
    scratchCursor: scratch.cursor,
    scratchLength: scratch.steps.length,
    sourceRootTarget: attachedRecord ? sourceRootTarget : undefined,
    recordRootTarget: attachedRecord ? recordRootTarget : undefined,
  });
}

export interface AnalysisMoveRow {
  readonly fullmoveNumber: number;
  readonly white?: AnalysisPathEntry;
  readonly black?: AnalysisPathEntry;
}

export function analysisMoveRows(
  entries: readonly AnalysisPathEntry[],
): readonly AnalysisMoveRow[] {
  const rows: AnalysisMoveRow[] = [];
  for (const entry of entries) {
    const fullmoveNumber = entry.before.playState.fullmoveNumber;
    const side = entry.before.position.sideToMove;
    const previous = rows.at(-1);
    if (
      previous !== undefined &&
      previous.fullmoveNumber === fullmoveNumber &&
      previous[side] === undefined
    ) {
      rows[rows.length - 1] = Object.freeze({ ...previous, [side]: entry });
      continue;
    }
    rows.push(Object.freeze({ fullmoveNumber, [side]: entry }));
  }
  return Object.freeze(rows);
}

export interface AnalysisNoteMoveRow {
  readonly fullmoveNumber: number;
  readonly white?: PathMove;
  readonly black?: PathMove;
}

export function analysisNoteMoveRows(
  target: AnalysisNoteTarget,
  moves: readonly PathMove[],
): readonly AnalysisNoteMoveRow[] {
  if (target.start === undefined) return Object.freeze([]);
  const rows: AnalysisNoteMoveRow[] = [];
  let side = target.start.position.sideToMove;
  let fullmoveNumber = target.start.playState.fullmoveNumber;
  for (const move of moves) {
    const previous = rows.at(-1);
    if (
      previous !== undefined &&
      previous.fullmoveNumber === fullmoveNumber &&
      previous[side] === undefined
    ) {
      rows[rows.length - 1] = Object.freeze({ ...previous, [side]: move });
    } else {
      rows.push(Object.freeze({ fullmoveNumber, [side]: move }));
    }
    if (side === 'black') fullmoveNumber += 1;
    side = side === 'white' ? 'black' : 'white';
  }
  return Object.freeze(rows);
}

function noteTarget(
  itemId: string,
  revisionId: string,
  anchorId: string,
  start: PathState | undefined,
  contributions: readonly PathContribution[],
): AnalysisNoteTarget {
  return Object.freeze({
    itemId,
    revisionId,
    anchorId,
    ...(start === undefined ? {} : { start }),
    contributions: Object.freeze(
      contributions.filter(
        (contribution) => contribution.anchorId === anchorId,
      ),
    ),
  });
}
