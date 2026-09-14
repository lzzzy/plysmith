import type { AnalysisWorkspaceDto } from '../../host_client/index.ts';

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

type PathState = AnalysisWorkspaceDto['currentState'];

interface StoredPathStep {
  readonly anchorId: string;
  readonly before: PathState;
  readonly move: PathMove;
  readonly after: PathState;
}

interface SourcePathStep extends StoredPathStep {
  readonly itemId: string;
  readonly revisionId: string;
}

interface ScratchPathStep {
  readonly before: PathState;
  readonly move: PathMove;
  readonly after: PathState;
}

interface StoredPath {
  readonly itemId: string;
  readonly revisionId: string;
  readonly rootAnchorId: string;
  readonly currentAnchorId: string;
  readonly root: PathState;
  readonly cursor: number;
  readonly contributions: readonly PathContribution[];
  readonly sourceLine?: {
    readonly sourceItemId: string;
    readonly sourceRevisionId: string;
    readonly sourceAnchorId: string;
    readonly sourceDisplayName: string;
    readonly root: PathState;
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
  readonly root: PathState;
  readonly cursor: number;
  readonly steps: readonly ScratchPathStep[];
  readonly noteDraft?: unknown;
}

export interface AnalysisPathEntry {
  readonly kind: 'source' | 'stored' | 'scratch';
  readonly before: PathState;
  readonly move: PathMove;
  readonly after: PathState;
  readonly positionIndex: number;
  readonly anchorId?: string;
  readonly scratchCursor?: number;
  readonly current: boolean;
  readonly branchOrigin: boolean;
  readonly noteTarget?: AnalysisNoteTarget;
}

export interface AnalysisNavigationTarget {
  readonly itemId: string;
  readonly revisionId: string;
  readonly anchorId: string;
}

export interface AnalysisNoteTarget extends AnalysisNavigationTarget {
  readonly start?: PathState;
  readonly contributions: readonly PathContribution[];
}

export interface AnalysisPathPosition {
  readonly state: PathState;
  readonly target?: AnalysisNavigationTarget;
  readonly scratchCursor?: number;
}

export interface AnalysisPathPresentation {
  readonly entries: readonly AnalysisPathEntry[];
  readonly positions: readonly AnalysisPathPosition[];
  readonly currentPositionIndex: number;
  readonly analysisOriginPositionIndex: number | undefined;
  readonly rootCurrent: boolean;
  readonly sourceDisplayName: string | undefined;
  readonly hasSourcePrefix: boolean;
  readonly hasStoredPrefix: boolean;
  readonly scratchCursor: number | undefined;
  readonly scratchLength: number | undefined;
  readonly sourceOriginTarget: AnalysisNavigationTarget | undefined;
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
        after: step.after,
        positionIndex: index + 1,
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
  const sourceOriginTarget =
    record?.sourceLine === undefined
      ? undefined
      : Object.freeze({
          itemId: record.sourceLine.sourceItemId,
          revisionId: record.sourceLine.sourceRevisionId,
          anchorId: record.sourceLine.sourceAnchorId,
        });
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
        after: step.after,
        positionIndex: sourceEntries.length + index + 1,
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
    const entries = Object.freeze([...sourceEntries, ...storedEntries]);
    return Object.freeze({
      entries,
      positions: pathPositions(
        record?.sourceLine?.root ?? record?.root,
        entries,
        record?.sourceLine === undefined ? recordRootTarget : sourceRootTarget,
        sourceEntries.length,
        recordRootTarget,
      ),
      currentPositionIndex:
        record === undefined ? 0 : sourceEntries.length + record.cursor,
      analysisOriginPositionIndex:
        record === undefined ? undefined : sourceEntries.length,
      rootCurrent: record?.cursor === 0,
      sourceDisplayName: record?.sourceLine?.sourceDisplayName,
      hasSourcePrefix: record?.sourceLine !== undefined,
      hasStoredPrefix: false,
      scratchCursor: undefined,
      scratchLength: undefined,
      sourceOriginTarget,
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
  const awaitingFirstScratchMove = attachedRecord && scratch.steps.length === 0;
  const sourcePositionCount = attachedRecord ? sourceEntries.length : 0;
  const storedPrefix = attachedRecord
    ? awaitingFirstScratchMove
      ? record.steps
      : record.steps.slice(0, record.cursor)
    : [];
  const hasStoredPrefix = storedPrefix.length > 0;
  const storedEntries = storedPrefix.map((step, index) =>
    Object.freeze({
      kind: 'stored' as const,
      before: step.before,
      move: step.move,
      after: step.after,
      positionIndex: sourcePositionCount + index + 1,
      anchorId: step.anchorId,
      current:
        scratch.cursor === 0 &&
        index ===
          (awaitingFirstScratchMove
            ? record!.cursor - 1
            : storedPrefix.length - 1),
      branchOrigin:
        !awaitingFirstScratchMove && index === storedPrefix.length - 1,
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
      after: step.after,
      positionIndex: sourcePositionCount + storedPrefix.length + index + 1,
      scratchCursor: index + 1,
      current: scratch.cursor === index + 1,
      branchOrigin: false,
    }),
  );

  const visibleSourceEntries = attachedRecord ? sourceEntries : [];
  const entries = Object.freeze([
    ...visibleSourceEntries,
    ...storedEntries,
    ...scratchEntries,
  ]);
  const scratchOriginPositionIndex = attachedRecord
    ? sourcePositionCount + record.cursor
    : 0;
  return Object.freeze({
    entries,
    positions: pathPositions(
      attachedRecord ? (record.sourceLine?.root ?? record.root) : scratch.root,
      entries,
      attachedRecord
        ? record.sourceLine === undefined
          ? recordRootTarget
          : sourceRootTarget
        : undefined,
      attachedRecord ? visibleSourceEntries.length : undefined,
      attachedRecord ? recordRootTarget : undefined,
      scratchOriginPositionIndex,
    ),
    currentPositionIndex: scratchOriginPositionIndex + scratch.cursor,
    analysisOriginPositionIndex: attachedRecord
      ? visibleSourceEntries.length
      : undefined,
    rootCurrent:
      scratch.cursor === 0 && (!attachedRecord || record.cursor === 0),
    sourceDisplayName: attachedRecord
      ? record.sourceLine?.sourceDisplayName
      : undefined,
    hasSourcePrefix: attachedRecord && record.sourceLine !== undefined,
    hasStoredPrefix,
    scratchCursor: scratch.cursor,
    scratchLength: scratch.steps.length,
    sourceOriginTarget: attachedRecord ? sourceOriginTarget : undefined,
    sourceRootTarget: attachedRecord ? sourceRootTarget : undefined,
    recordRootTarget: attachedRecord ? recordRootTarget : undefined,
  });
}

function pathPositions(
  root: PathState | undefined,
  entries: readonly AnalysisPathEntry[],
  rootTarget?: AnalysisNavigationTarget,
  analysisOriginPositionIndex?: number,
  analysisOriginTarget?: AnalysisNavigationTarget,
  scratchOriginPositionIndex?: number,
): readonly AnalysisPathPosition[] {
  if (root === undefined) return Object.freeze([]);
  const positions: AnalysisPathPosition[] = [
    Object.freeze({
      state: root,
      ...(rootTarget === undefined ? {} : { target: rootTarget }),
    }),
  ];
  for (const entry of entries) {
    positions.push(
      Object.freeze({
        state: entry.after,
        ...(entry.noteTarget === undefined ? {} : { target: entry.noteTarget }),
        ...(entry.scratchCursor === undefined
          ? {}
          : { scratchCursor: entry.scratchCursor }),
      }),
    );
  }
  if (
    analysisOriginPositionIndex !== undefined &&
    analysisOriginTarget !== undefined &&
    positions[analysisOriginPositionIndex] !== undefined
  ) {
    positions[analysisOriginPositionIndex] = Object.freeze({
      ...positions[analysisOriginPositionIndex],
      target: analysisOriginTarget,
    });
  }
  if (
    scratchOriginPositionIndex !== undefined &&
    positions[scratchOriginPositionIndex] !== undefined
  ) {
    positions[scratchOriginPositionIndex] = Object.freeze({
      ...positions[scratchOriginPositionIndex],
      scratchCursor: 0,
    });
  }
  return Object.freeze(positions);
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
